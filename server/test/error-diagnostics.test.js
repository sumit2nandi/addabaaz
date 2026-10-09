import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { createFeatures } from '../src/features.js';
import { createApp, createHttpErrorHandler } from '../src/app.js';
import { HttpError } from '../src/http.js';
import { createErrorLogger, installProcessErrorHandlers } from '../src/error-reporting.js';
import { createMsg91 } from '../src/sms.js';
import { queryRows } from '../src/db.js';
import { extraDb } from '../src/db-extra.js';
import { ensureCreditLedgerAmountColumn } from '../src/migrate.js';
import { fakeDeps } from './helpers/app-fakes.js';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

/** Decode a MySQL single-quoted string body the way the server does: '' is one literal quote. */
const decodeSqlStringLiteral = (body) => body.replace(/''/g, "'");

test('credit-ledger migrations recheck amount_paise safely, including after an older repair was recorded', () => {
  for (const file of ['021_repair_credit_ledger_amount.sql', '022_verify_credit_ledger_amount.sql', '024_repair_credit_ledger_amount_again.sql']) {
    const migration = read(`server/migrations/${file}`);
    assert.match(migration, /information_schema\.COLUMNS/, `${file} checks the active database schema`);
    assert.match(migration, /TABLE_NAME = 'user_credit'[\s\S]*COLUMN_NAME = 'amount_paise'/);
    assert.match(migration, /'ALTER TABLE user_credit ADD COLUMN amount_paise INT NOT NULL DEFAULT 0'/);
    assert.match(migration, /'SELECT 1'/, 'a healthy schema is a safe no-op');
    assert.match(migration, /SET amount_paise = remaining_paise[\s\S]*WHERE amount_paise = 0 AND remaining_paise > 0/,
      'any remaining legacy grant balance stays usable after the repair');
  }
});

test('credit amount schema guard repairs drift even when no migration is pending', async () => {
  let hasColumn = false;
  const statements = [], messages = [];
  const conn = { async query(sql) {
    statements.push(sql);
    if (sql.includes('information_schema.COLUMNS')) return [[{ n: hasColumn ? 1 : 0 }], []];
    if (sql.startsWith('ALTER TABLE user_credit ADD COLUMN amount_paise')) hasColumn = true;
    return [{ affectedRows: 0 }, []];
  } };

  assert.equal(await ensureCreditLedgerAmountColumn(conn, { log: (m) => messages.push(m) }), true);
  assert.equal(await ensureCreditLedgerAmountColumn(conn, { log: (m) => messages.push(m) }), false,
    'the next boot is a fast no-op once the column is present');
  assert.equal(statements.filter((s) => s.startsWith('ALTER TABLE user_credit')).length, 1);
  assert.equal(statements.filter((s) => s.startsWith('UPDATE user_credit')).length, 1);
  assert.deepEqual(messages, ['repairing missing user_credit.amount_paise column', 'verified user_credit.amount_paise column']);
});

test('error-log migrations retain parameterized SQL and structured SQL exceptions safely', () => {
  const migration = read('server/migrations/025_error_sql_diagnostics.sql');
  assert.match(migration, /TABLE_NAME = 'error_log'[\s\S]*COLUMN_NAME = 'sql_query'/);
  assert.match(migration, /ADD COLUMN sql_query TEXT NULL/);
  assert.match(migration, /COLUMN_NAME = 'sql_param_count'/);
  assert.match(migration, /ADD COLUMN sql_param_count SMALLINT UNSIGNED NULL/);
  assert.match(migration, /'SELECT 1'/, 'SQL fields are safe to re-run after partial DDL');
  const exception = read('server/migrations/026_error_sql_exception_details.sql');
  assert.match(exception, /COLUMN_NAME = 'sql_exception'/);
  assert.match(exception, /ADD COLUMN sql_exception TEXT NULL/);
  assert.match(exception, /err\.sql/,
    'the driver SQL string is intentionally excluded because it may interpolate bound values');
});

test('error-context migration stores severity, runtime and request diagnostics idempotently', () => {
  const migration = read('server/migrations/029_error_context.sql');
  for (const column of ['severity', 'error_name', 'error_code', 'http_status', 'http_method', 'request_id', 'release_id', 'environment', 'instance_id', 'details']) {
    assert.match(migration, new RegExp(`COLUMN_NAME = '${column}'`), `${column} is added only when absent`);
    assert.match(migration, new RegExp(`ADD COLUMN ${column}\\b`), `${column} is persisted`);
  }
  assert.match(migration, /ADD COLUMN details JSON NULL/);
  assert.match(migration, /MODIFY COLUMN user_agent VARCHAR\(512\)/);
  assert.match(migration, /ix_errors_request_id/);
  assert.match(migration, /'SELECT 1'/, 'partial schema changes can safely be rerun');
});

test('error-context dynamic DDL stays a single-quoted string under ANSI_QUOTES', () => {
  const migration = read('server/migrations/029_error_context.sql');
  // Prose comments may use double quotes; only the executable SQL has to survive ANSI_QUOTES,
  // where MySQL reads a double-quoted token as an identifier instead of a string.
  const executable = migration.replace(/^\s*--.*$/gm, '');
  assert.equal(executable.includes('"'), false,
    'dynamic DDL cannot be double-quoted: ANSI_QUOTES turns it into a column reference and the statement fails with "Unknown column ... in field list"');

  // Every prepared DDL literal must parse as a MySQL string literal, with inner quotes doubled.
  const assignments = executable.match(/SET @\w+_ddl = \(/g) || [];
  const guarded = [...executable.matchAll(/SET (@\w+_ddl) = \(\s*SELECT IF\(COUNT\(\*\) = 0,\s*'((?:[^']|'')*?)',\s*'SELECT 1'\)/g)];
  assert.ok(assignments.length >= 10, 'the error-context migration prepares its DDL dynamically');
  assert.equal(guarded.length, assignments.length,
    'each dynamic DDL assignment is a single-quoted literal whose inner quotes are doubled, so no assignment silently degrades to an identifier');
  for (const [, variable, literal] of guarded) {
    const ddl = decodeSqlStringLiteral(literal);
    assert.ok(/^(ALTER TABLE|SELECT 1)\b/.test(ddl), `${variable} decodes to runnable SQL, got: ${ddl}`);
  }

  const severity = decodeSqlStringLiteral(
    executable.match(/SET @error_severity_ddl = \(\s*SELECT IF\(COUNT\(\*\) = 0,\s*'((?:[^']|'')*?)',\s*'SELECT 1'\)/)[1]);
  assert.equal(severity,
    "ALTER TABLE error_log ADD COLUMN severity ENUM('warning','error','fatal') NOT NULL DEFAULT 'error' AFTER source",
    'doubled inner quotes decode back to the ENUM values and default, not to stray text');
  assert.match(executable, /PREPARE error_severity_stmt FROM @error_severity_ddl;/,
    'the prepared statement is built from the string variable, never from an identifier');
});

test('credit-ledger admin statistics aggregate from user_credit', async () => {
  const statements = [];
  const q = async (sql) => {
    statements.push(sql);
    if (sql.includes('GROUP BY kind')) return [];
    return [{ outstanding: 0, granted: 0, spent: 0, expired: 0, accounts: 0 }];
  };
  const db = extraDb({ q, tx: async (fn) => fn({ query: q }), iso: () => null });

  const stats = await db.credits.stats();
  assert.match(statements[0], /COUNT\(DISTINCT CASE WHEN amount_paise > 0 THEN user_id END\) AS accounts\s+FROM user_credit/,
    'the aggregate query reads ledger columns from the ledger table');
  assert.match(statements[1], /FROM user_credit GROUP BY kind/);
  assert.deepEqual(stats, { outstandingPaise: 0, grantedPaise: 0, spentPaise: 0, expiredPaise: 0, accounts: 0, byKind: {} });
});

test('failed SQL diagnostics retain the query template but never the bound values', async () => {
  const sql = 'SELECT amount_paise FROM user_credit WHERE user_id = ? AND status = ?';
  const values = ['person@example.com', 'secret-token'];
  const driverError = Object.assign(new Error("Unknown column 'amount_paise'"), {
    code: 'ER_BAD_FIELD_ERROR', errno: 1054, sqlState: '42S22', sqlMessage: "Unknown column 'amount_paise' in 'field list'",
    sql: 'SELECT * FROM users WHERE email = "person@example.com" AND token = "secret-token"',
  });
  let seen;
  const target = { async query(...args) { seen = args; throw driverError; } };

  await assert.rejects(queryRows(target, sql, values), (error) => {
    assert.equal(error, driverError, 'the original exception object and stack are preserved');
    assert.equal(error.sqlTemplate, sql);
    assert.equal(error.sqlParamCount, 2);
    assert.deepEqual(error.sqlException, {
      name: 'Error', message: "Unknown column 'amount_paise'", sqlMessage: "Unknown column 'amount_paise' in 'field list'",
      code: 'ER_BAD_FIELD_ERROR', errno: 1054, sqlState: '42S22', fatal: null,
    });
    assert.equal(error.sqlTemplate.includes(values[0]), false);
    assert.equal(error.sqlTemplate.includes(values[1]), false);
    assert.equal(JSON.stringify(error.sqlException).includes(values[0]), false);
    assert.equal(JSON.stringify(error.sqlException).includes(values[1]), false,
      'driver fields containing interpolated values are not copied into the structured exception');
    return true;
  });
  assert.deepEqual(seen, [sql, values], 'the wrapper does not alter the query sent to mysql');
});

test('error records persist and return safe SQL-template diagnostics', async () => {
  const insert = [];
  const at = new Date('2026-10-05T12:00:00.000Z');
  const exception = { name: 'Error', message: 'Unknown column', sqlMessage: "Unknown column 'amount_paise'", code: 'ER_BAD_FIELD_ERROR', errno: 1054, sqlState: '42S22', fatal: null };
  const recentRow = {
    id: 17, source: 'server', severity: 'error', message: 'Unknown column', error_name: 'Error', error_code: 'ER_BAD_FIELD_ERROR',
    http_status: 500, http_method: 'GET', request_id: 'request-17', release_id: 'a'.repeat(40), environment: 'test', instance_id: 'b'.repeat(36),
    details: JSON.stringify({ component: 'database' }), stack: 'driver trace',
    sql_query: 'SELECT amount_paise FROM user_credit WHERE id = ?', sql_param_count: '1', sql_exception: JSON.stringify(exception),
    url: '/api/v1/admin/promos', user_agent: 'test', user_id: null, account_name: null, account_email: null, created_at: at,
  };
  const q = async (sql, params) => {
    if (sql.includes('INSERT INTO error_log')) { insert.push({ sql, params }); return { affectedRows: 1 }; }
    if (sql.includes('SELECT e.id')) return [recentRow];
    if (sql.includes('COUNT(*) AS n FROM error_log')) return [{ n: 1 }];
    if (sql.includes('GROUP BY source, severity')) return [{ source: 'server', severity: 'error', error_name: 'Error', error_code: 'ER_BAD_FIELD_ERROR', http_status: 500, message: 'Unknown column', n: '1', last_at: at, first_at: at, url: '/api/v1/admin/promos' }];
    return [];
  };
  const db = extraDb({ q, tx: async (fn) => fn({ query: q }), iso: (d) => d instanceof Date ? d.toISOString() : null });
  await db.errors.add({
    source: 'server', severity: 'error', message: 'Unknown column', errorName: 'Error', code: 'ER_BAD_FIELD_ERROR', status: 500,
    method: 'GET', requestId: 'request-17', release: 'a'.repeat(40), environment: 'test', instanceId: 'b'.repeat(36), details: { component: 'database' },
    stack: 'driver trace', sqlQuery: 'SELECT amount_paise FROM user_credit WHERE id = ?', sqlParamCount: 1, sqlException: exception,
    url: '/api/v1/admin/promos', userAgent: 'test', userId: null,
  });
  assert.match(insert[0].sql, /sql_query, sql_param_count, sql_exception/);
  assert.equal(insert[0].params[3], 'Error');
  assert.equal(insert[0].params[4], 'ER_BAD_FIELD_ERROR');
  assert.equal(insert[0].params[7], 'request-17');
  assert.deepEqual(JSON.parse(insert[0].params[11]), { component: 'database' });
  assert.equal(insert[0].params[13], 'SELECT amount_paise FROM user_credit WHERE id = ?');
  assert.equal(insert[0].params[14], 1);
  assert.deepEqual(JSON.parse(insert[0].params[15]), exception);

  const listed = await db.errors.list({ limit: 50, offset: 0, source: 'server' });
  assert.equal(listed.recent[0].sqlQuery, recentRow.sql_query);
  assert.equal(listed.recent[0].sqlParamCount, 1);
  assert.deepEqual(listed.recent[0].sqlException, exception);
  assert.deepEqual(listed.recent[0].details, { component: 'database' });
  assert.equal(listed.recent[0].requestId, 'request-17');
  assert.equal(listed.recent[0].status, 500);
  assert.equal(listed.total, 1);
  assert.equal(listed.groups[0].severity, 'error');
  assert.equal(listed.groups[0].errorCode, 'ER_BAD_FIELD_ERROR');
  assert.equal(listed.recent[0].at, at.toISOString());
});

test('server error reports include verified account context and useful database diagnostics', () => {
  const app = read('server/src/app.js');
  const media = read('server/src/routes/media.js');
  const features = read('server/src/features.js');
  const migrate = read('server/src/migrate.js');
  const index = read('server/src/index.js');
  const db = read('server/src/db-extra.js');
  const reporter = read('server/src/error-reporting.js');

  assert.match(app, /const userId = req\.user\?\.id \|\| req\.admin\?\.id \|\| null/,
    'server failures identify the viewer or administrator when the request is authenticated');
  assert.match(app, /errorLogger\.capture\(err,[\s\S]*?status: responseStatus, method: req\.method/,
    'unexpected server failures and provider 5xx responses share the database reporter');
  assert.match(media, /await pipeline\(Readable\.fromWeb\(upstream\.body\), res\)/,
    'native HLS stream failures propagate to the shared HTTP boundary with request context');
  assert.doesNotMatch(media, /logger\.error\('\[media\] native video stream failed/,
    'the streaming route does not swallow post-header failures into an uncorrelated log entry');
  assert.match(reporter, /sqlQuery: error\.sqlTemplate[\s\S]*?sqlException: error\.sqlException/,
    'safe SQL templates, parameter counts and structured driver exceptions are preserved');
  assert.match(reporter, /requestId,[\s\S]*?runtime:/, 'request correlation and runtime/release context are stored');
  assert.match(db, /sql_query, sql_param_count, sql_exception/, 'the error log persists SQL templates, parameter counts and exception details');
  assert.match(db, /sqlQuery: r\.sql_query \|\| null/);
  assert.match(db, /sqlException: parseErrorJson\(r\.sql_exception\)/);
  assert.match(db, /details: parseErrorJson\(r\.details\)/, 'structured context is decoded for the admin API');
  assert.match(migrate, /await ensureCreditLedgerAmountColumn\(conn, \{ log \}\)/,
    'the schema guard runs on every migration invocation, even if its numbered repair was already recorded');
  assert.match(migrate, /verified user_credit\.amount_paise column/,
    'startup logs prove the important credit column was checked when it already exists');
  assert.match(index, /process\.env\.DB_MIGRATE !== 'false'/,
    'startup migrations are enabled by default when DB_MIGRATE is absent');
  assert.match(index, /automatic startup migrations enabled[\s\S]*?startup check complete/,
    'Render boot logs state that migrations ran and how many were applied');
  assert.match(index, /RENDER_GIT_COMMIT/,
    'Render logs and public health checks identify the deployed source commit');
  assert.match(index, /const errorLogger = createErrorLogger\(\{ db, appVersion: APP_VERSION, release: releaseSha \}\)/,
    'a database-backed reporter is ready before startup migrations');
  assert.match(index, /kind: 'startup-migration'[\s\S]*?errorLogger\.flush\(\)[\s\S]*?await db\.close\(\)/,
    'migration failures are captured and flushed before startup exits');
  assert.match(index, /kind: 'startup-app-creation'[\s\S]*?errorLogger\.flush\(\)[\s\S]*?await db\.close\(\)/,
    'app-construction failures are captured and flushed before startup exits');
  assert.match(features, /userFromRequest\?\.\(req\)/, 'client errors resolve an optional first-party session');
  assert.match(features, /userId: user\?\.id \|\| null/, 'client-supplied IDs are not trusted');
  assert.match(db, /e\.user_agent, e\.user_id, u\.name AS account_name, u\.email AS account_email/);
  assert.match(db, /LEFT JOIN users u ON u\.id = e\.user_id/, 'deleted accounts stay visible as error records through the left join');
  assert.match(db, /userId: r\.user_id \|\| null/, 'recent error reports include their account ID');
  assert.match(db, /accountName: r\.account_name \|\| null/);
  assert.match(db, /accountEmail: r\.account_email \|\| null/);
});

test('central error reporter stores diagnostic context while redacting credentials and direct identifiers', async () => {
  const saved = [];
  const rawConsole = { error() {}, warn() {}, info() {}, log() {}, debug() {} };
  const reporter = createErrorLogger({
    db: { errors: { async add(record) { saved.push(record); } } }, appVersion: '2.0.1', release: 'a'.repeat(40),
    environment: 'test', instanceId: '11111111-1111-4111-8111-111111111111', rawConsole,
  });
  const cause = Object.assign(new Error('provider failed for reader@example.com token=private-token phone=919812345678 otp=654321'), { code: 'ER_ACCESS_DENIED_ERROR' });
  const error = Object.assign(new Error('Query failed at /api/v1/catalog?token=private-token'), {
    code: 'ER_BAD_FIELD_ERROR', errno: 1054, sqlState: '42S22',
    sqlTemplate: 'SELECT title FROM catalog_items WHERE id = ?', sqlParamCount: 1,
    sqlException: { message: 'Unknown column', password: 'password-value', code: 'ER_BAD_FIELD_ERROR' }, cause,
  });
  assert.equal(await reporter.capture(error, {
    kind: 'http-request', status: 500, method: 'GET', requestId: 'trace-123', url: '/api/v1/catalog?token=private-token',
    userAgent: 'TestBrowser/1.0', userId: '12345678-1234-1234-1234-123456789012',
    details: { browser: 'TestBrowser', accessToken: 'private-token', viewport: { width: 390, height: 844 } },
  }), true);
  await reporter.logger.warn('background task failed:', new Error('contact reader@example.com token=private-token'));
  await reporter.flush();

  assert.equal(saved.length, 2);
  assert.equal(saved[0].requestId, 'trace-123');
  assert.equal(saved[0].status, 500);
  assert.equal(saved[0].method, 'GET');
  assert.equal(saved[0].errorName, 'Error');
  assert.equal(saved[0].url, '/api/v1/catalog');
  assert.equal(saved[0].sqlQuery, 'SELECT title FROM catalog_items WHERE id = ?');
  assert.equal(saved[0].details.runtime.appVersion, '2.0.1');
  assert.equal(saved[0].details.runtime.release, 'a'.repeat(40));
  assert.equal(saved[0].details.browser, 'TestBrowser');
  assert.equal(saved[0].details.accessToken, '[redacted]');
  assert.equal(saved[0].details.causes[0].code, 'ER_ACCESS_DENIED_ERROR');
  assert.equal(saved[1].severity, 'warning');
  assert.doesNotMatch(JSON.stringify(saved), /private-token|reader@example\.com|password-value|919812345678|654321/);
});

test('error reports retain structured AggregateError and network-system diagnostics', async () => {
  const saved = [];
  const reporter = createErrorLogger({
    db: { errors: { async add(record) { saved.push(record); } } },
    rawConsole: { error() {}, warn() {}, info() {}, log() {}, debug() {} },
  });
  const aggregate = Object.assign(new AggregateError([
    new TypeError('first renderer failed'),
    Object.assign(new Error('second renderer failed'), { code: 'ECONNRESET' }),
  ], 'all renderers failed'), { code: 'EUPSTREAM', syscall: 'connect', address: '127.0.0.1', port: 3306 });
  await reporter.capture(aggregate, { kind: 'background-worker' });
  assert.equal(saved[0].details.code, 'EUPSTREAM');
  assert.equal(saved[0].details.syscall, 'connect');
  assert.equal(saved[0].details.address, '127.0.0.1');
  assert.equal(saved[0].details.port, 3306);
  assert.equal(saved[0].details.aggregateErrors.length, 2);
  assert.equal(saved[0].details.aggregateErrors[0].name, 'TypeError');
  assert.equal(saved[0].details.aggregateErrors[1].code, 'ECONNRESET');
});

test('fatal process hooks persist uncaught exceptions and unhandled rejections before shutdown', async () => {
  const { EventEmitter } = await import('node:events');
  const processRef = new EventEmitter();
  processRef.exitCode = 0;
  const reports = [], fatals = [];
  const remove = installProcessErrorHandlers({
    processRef, persistTimeoutMs: 100,
    errorLogger: { async capture(error, context) { reports.push({ error, context }); return true; } },
    onFatal(error, kind) { fatals.push({ error, kind }); },
  });
  try {
    processRef.emit('unhandledRejection', new Error('unhandled scheduled task failure'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(reports[0].context.kind, 'unhandled-rejection');
    assert.equal(reports[0].context.severity, 'fatal');
    assert.equal(fatals[0].kind, 'unhandled-rejection');
  } finally { remove(); }
});

test('SMS provider network failures preserve their cause without storing the phone or one-time code', async () => {
  const saved = [];
  const rawConsole = { error() {}, warn() {}, info() {}, log() {}, debug() {} };
  const sms = createMsg91({
    authKey: 'private-auth-key', templateId: 'test-template', log: rawConsole,
    fetchImpl: async (url) => { throw Object.assign(new Error(`network failed for ${url}`), { code: 'ECONNRESET' }); },
  });
  const reporter = createErrorLogger({ db: { errors: { async add(record) { saved.push(record); } } }, rawConsole });
  let captured;
  await assert.rejects(sms.send({ phone: '919812345678', code: '654321' }), (error) => {
    captured = error;
    assert.equal(error.name, 'SmsError');
    assert.equal(error.cause.code, 'ECONNRESET');
    return true;
  });
  await reporter.capture(captured, { kind: 'http-request', status: 503, method: 'POST', url: '/api/v1/auth/otp/request' });
  await reporter.flush();
  assert.equal(saved[0].details.causes[0].code, 'ECONNRESET');
  assert.doesNotMatch(JSON.stringify(saved), /919812345678|654321|private-auth-key/);
});

test('HTTP boundary records auth, rate-limit, maintenance, ordinary failures, and errors after headers', async () => {
  const records = [], external = [];
  const handler = createHttpErrorHandler({
    errorLogger: { capture(error, context) { records.push({ error, context }); return Promise.resolve(true); } },
    captureError(error, req) { external.push({ error, url: req.originalUrl }); },
  });
  const req = (path = '/api/v1/test') => ({
    method: 'GET', requestId: 'request-test', originalUrl: path, get: () => 'TestAgent',
    route: { path: '/test' }, baseUrl: '/api/v1', protocol: 'https', httpVersion: '1.1',
    user: null, admin: null,
  });
  const response = (headersSent = false, statusCode = 200) => ({
    headersSent, statusCode, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });

  for (const error of [
    new HttpError(401, 'unauthorized', 'Please sign in.'),
    new HttpError(429, 'rate_limited', 'Slow down.'),
    new HttpError(503, 'maintenance', 'Temporarily unavailable.'),
  ]) {
    const res = response();
    handler(error, req(), res, () => assert.fail('handled client errors should return JSON'));
    assert.equal(res.statusCode, error.status);
  }
  const repeatedAuth = response();
  handler(new HttpError(401, 'unauthorized', 'Please sign in.'), req(), repeatedAuth, () => {});
  assert.equal(repeatedAuth.statusCode, 401, 'sampling never changes the client response');
  const ordinary = Object.assign(new Error('unexpected handler failure'), { code: 'EFAULT' });
  handler(ordinary, req('/api/v1/broken'), response(), () => {});
  const streamError = Object.assign(new Error('stream failed after response began'), { code: 'ECONNRESET' });
  let forwarded;
  handler(streamError, req('/api/v1/media/stream'), response(true, 206), (error) => { forwarded = error; });

  assert.deepEqual(records.map(({ context }) => context.severity), ['warning', 'warning', 'warning', 'error', 'error']);
  assert.equal(records[0].context.status, 401);
  assert.equal(records[1].context.status, 429);
  assert.equal(records[2].context.kind, 'http-request');
  assert.equal(records[3].context.details.responseHeadersSent, false);
  assert.equal(records[4].context.kind, 'http-after-headers');
  assert.equal(records[4].context.status, 206);
  assert.equal(records[4].context.details.responseHeadersSent, true);
  assert.equal(records[4].context.details.errorStatus, 500, 'the original failure status is retained when committed response headers cannot change');
  assert.equal(forwarded, streamError, 'the original streaming error is still passed to Express');
  assert.deepEqual(external.map(({ url }) => url), ['/api/v1/broken', '/api/v1/media/stream'],
    'only application faults reach external exception monitoring');

  for (let i = 0; i < 400; i++) {
    handler(new HttpError(400, 'bad_input', `invalid input ${i}`), req(), response(), () => {});
  }
  assert.equal(records.filter(({ context }) => context.severity === 'warning').length, 300,
    'unique 4xx bursts are capped per process/minute after duplicate-route sampling');
});

test('HTTP provider failures are persisted with a request ID; every authored 4xx is a warning', async () => {
  const { db, mailer, payments, sms, secret } = fakeDeps();
  const saved = [];
  db.errors.add = async (record) => { saved.push(record); };
  db.errors.list = async () => { throw new HttpError(503, 'error_list_unavailable', 'The error store is temporarily unavailable.', { cause: Object.assign(new Error('MySQL read failed'), { code: 'ER_QUERY_INTERRUPTED' }) }); };
  const adminToken = 'test-admin-token-that-is-long-enough';
  const errorLogger = createErrorLogger({ db, appVersion: 'test', environment: 'test', rawConsole: { error() {}, warn() {}, info() {}, log() {}, debug() {} } });
  const app = createApp({ db, jwtSecret: secret, adminToken, mailer, payments, sms, errorLogger, serveStatic: false, rate: false, catalogPath: '/tmp/error-log-test-catalog.json' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  try {
    const response = await fetch(`${base}/admin/errors`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.ok(body.requestId);
    assert.equal(response.headers.get('x-request-id'), body.requestId);
    await app.locals.errorLogger.flush();
    assert.equal(saved.length, 1);
    assert.equal(saved[0].status, 503);
    assert.equal(saved[0].method, 'GET');
    assert.equal(saved[0].requestId, body.requestId);
    assert.equal(saved[0].code, 'error_list_unavailable');
    assert.equal(saved[0].errorName, 'HttpError');
    assert.equal(saved[0].details.kind, 'http-request');
    assert.equal(saved[0].details.causes[0].code, 'ER_QUERY_INTERRUPTED');

    const unauthorized = await fetch(`${base}/me`);
    assert.equal(unauthorized.status, 401);
    await app.locals.errorLogger.flush();
    assert.equal(saved.length, 2, '401 sign-in failures are included as warnings');
    assert.equal(saved[1].severity, 'warning');
    assert.equal(saved[1].status, 401);

    // Authored 4xx responses are warnings so Admin → Errors captures client mistakes as well as faults.
    const broken = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
    assert.equal(broken.status, 400);
    await app.locals.errorLogger.flush();
    assert.equal(saved.length, 3, 'authored 4xx responses reach the admin error log');
    assert.equal(saved[2].severity, 'warning');
    assert.equal(saved[2].status, 400);
    assert.equal(saved[2].code, 'invalid_json');
    assert.equal(saved[2].method, 'POST');
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test('client error reports are linked to a verified session, never a browser-supplied user ID', async () => {
  const reports = [];
  const router = express.Router();
  router.use(express.json());
  const features = createFeatures({
    db: { errors: { async add(report) { reports.push(report); } } },
    secret: 'error-report-test-secret', mailer: { provider: 'none' }, push: null, catalog: {}, siteUrl: '', rate: false,
    publicUser: () => ({}), notDisabled: (user) => user,
    userFromRequest: async (req) => req.get('authorization') === 'Bearer valid-session' ? { id: 'verified-user-17' } : null,
  });
  features.public(router);
  const app = express(); app.use('/api/v1', router);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1/client-errors`;
  try {
    const response = await fetch(base, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-session' },
      body: JSON.stringify({ message: 'Playback failure', errorName: 'MediaError', errorCode: 'UPSTREAM_DOWN', status: 503, severity: 'warning', stack: 'diagnostic trace', url: '/watch/title?token=secret', details: { browser: 'test', accessToken: 'private-token', contact: { email: 'reader@example.com' } }, userId: 'forged-user' }),
    });
    assert.equal(response.status, 204);
    assert.equal(reports[0].userId, 'verified-user-17');
    assert.equal(reports[0].url, '/watch/title', 'the query string is still removed from saved URLs');
    assert.equal(reports[0].errorName, 'MediaError');
    assert.equal(reports[0].code, 'UPSTREAM_DOWN');
    assert.equal(reports[0].status, 503);
    assert.equal(reports[0].severity, 'warning', 'client severity is preserved and validated on the server');
    assert.deepEqual(reports[0].details, { client: { browser: 'test', accessToken: '[redacted]', contact: { email: '[redacted]' } } });
    assert.doesNotMatch(JSON.stringify(reports[0]), /private-token|reader@example\.com/,
      'the direct database fallback uses the same privacy filters as the shared reporter');

    await fetch(base, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Anonymous failure', userId: 'forged-user' }),
    });
    assert.equal(reports[1].userId, null, 'an unauthenticated client cannot attach someone else’s ID');

    await fetch(base, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'No HTTP response', status: 0, errorCode: 'network' }),
    });
    assert.equal(reports[2].status, 0, 'network failures with no HTTP response remain distinguishable from HTTP errors');
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});
