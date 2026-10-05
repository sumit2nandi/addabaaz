import crypto from 'node:crypto';
import { safeErrorUrl } from './http.js';

const SECRET_KEY = /authorization|cookie|password|passphrase|secret|token|api.?key|access.?key|private.?key|credential|signature|session|email|phone|mobile|otp/i;
const SECRET_TEXT = [
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, (_match, prefix) => `${prefix}[redacted]`],
  [/([?&](?:access_?token|refresh_?token|token|password|secret|signature|key|email|phone|mobile|otp)=)[^&#\s]*/gi, (_match, prefix) => `${prefix}[redacted]`],
  [/((?:password|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|email|phone|mobile|otp)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, (_match, prefix) => `${prefix}[redacted]`],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, () => '[redacted email]'],
  [/\b\+?\d(?:[\d\s().-]{8,}\d)\b/g, () => '[redacted number]'],
];
const MAX_DETAILS_BYTES = 24_000;
const MAX_STACK_CHARS = 48_000;

/** Redact common credentials and direct e-mail identifiers before a diagnostic is persisted. */
export function redactErrorText(value, max = 8_000) {
  let text;
  try { text = String(value ?? ''); } catch { text = '[unprintable value]'; }
  for (const [pattern, replace] of SECRET_TEXT) text = text.replace(pattern, replace);
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max);
}

function cleanScalar(value, max = 128) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/[^\w.:-]/g, '').slice(0, max);
  return text || null;
}

function cleanUserId(value) {
  return typeof value === 'string' && value.length <= 36 && /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

function sanitizeValue(value, { depth = 0, seen = new WeakSet() } = {}) {
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactErrorText(value, 4_000);
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return undefined;
  if (typeof value === 'function') return `[Function${value.name ? ` ${value.name}` : ''}]`;
  if (typeof value === 'symbol') return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Error) {
    const out = { name: redactErrorText(value.name || 'Error', 128), message: redactErrorText(value.message, 2_000) };
    if (value.code != null) out.code = cleanScalar(value.code);
    if (value.stack) out.stack = redactErrorText(value.stack, 8_000);
    return out;
  }
  if (depth >= 6) return '[maximum detail depth reached]';
  if (seen.has(value)) return '[circular reference]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, { depth: depth + 1, seen }));
  const out = {};
  let count = 0;
  for (const [key, item] of Object.entries(value)) {
    if (count++ >= 80) { out.truncated = true; break; }
    const safeKey = redactErrorText(key, 100);
    if (!safeKey) continue;
    out[safeKey] = SECRET_KEY.test(key) ? '[redacted]' : sanitizeValue(item, { depth: depth + 1, seen });
  }
  return out;
}

function causesOf(error) {
  const causes = [];
  let current = error?.cause;
  const seen = new Set([error]);
  while (current && causes.length < 5 && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      causes.push({
        name: redactErrorText(current.name || 'Error', 128),
        message: redactErrorText(current.message || '', 2_000),
        ...(cleanScalar(current.code) ? { code: cleanScalar(current.code) } : {}),
        ...(current.stack ? { stack: redactErrorText(current.stack, 8_000) } : {}),
      });
      current = current.cause;
    } else {
      causes.push({ value: sanitizeValue(current) });
      break;
    }
  }
  return causes;
}

function parseError(error) {
  if (error instanceof Error) return error;
  const message = typeof error === 'string' ? error : (() => {
    try { return JSON.stringify(error) || String(error); } catch { return String(error); }
  })();
  return new Error(message || 'Unknown error');
}

function logMessage(args) {
  return args.map((value) => {
    if (value instanceof Error) return `${value.name || 'Error'}: ${value.message || ''}`;
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  }).join(' ').trim() || 'Application warning';
}

function safeConsoleArgs(args) {
  return args.map((value) => {
    if (value instanceof Error) return `${redactErrorText(value.name || 'Error', 128)}: ${redactErrorText(value.message || '', 2_000)}${value.stack ? `\\n${redactErrorText(value.stack, MAX_STACK_CHARS)}` : ''}`;
    if (typeof value === 'string' || typeof value === 'number') return redactErrorText(value, 8_000);
    if (value && typeof value === 'object') return sanitizeValue(value);
    return value;
  });
}

function loggedError(args) {
  const actual = args.find((value) => value instanceof Error);
  if (!actual) return new Error(logMessage(args));
  const wrapped = new Error(logMessage(args), { cause: actual });
  wrapped.name = actual.name || 'Error';
  wrapped.stack = actual.stack || wrapped.stack;
  for (const key of ['code', 'errno', 'sqlState', 'sqlTemplate', 'sqlParamCount', 'sqlException', 'status', 'fatal']) {
    if (actual[key] !== undefined) wrapped[key] = actual[key];
  }
  return wrapped;
}

/**
 * Build the single database-backed error reporter shared by the API, background workers and process hooks.
 * It deliberately stores request metadata and error context, never request bodies, auth headers, SQL values,
 * or unredacted access tokens. When MySQL itself is unavailable, it falls back to the host runtime log.
 */
export function createErrorLogger({ db, appVersion = '', release = '', environment = process.env.NODE_ENV || 'development', rawConsole = console, instanceId = crypto.randomUUID() } = {}) {
  const pending = new Set();
  const normalizedRelease = /^[0-9a-f]{7,40}$/i.test(String(release || '')) ? String(release).toLowerCase() : '';

  async function persist(input, context = {}) {
    const error = parseError(input);
    const source = context.source === 'client' ? 'client' : 'server';
    const status = Number.isInteger(context.status ?? error.status) && (context.status ?? error.status) >= 100 && (context.status ?? error.status) <= 599
      ? Number(context.status ?? error.status) : null;
    const method = typeof context.method === 'string' && /^[A-Za-z-]{1,12}$/.test(context.method) ? context.method.toUpperCase() : null;
    const requestId = cleanScalar(context.requestId, 64) || crypto.randomUUID();
    const causeChain = causesOf(error);
    const errCode = cleanScalar(error.code);
    const errno = Number.isSafeInteger(Number(error.errno)) ? Number(error.errno) : null;
    const sqlParamCount = Number.isSafeInteger(error.sqlParamCount) && error.sqlParamCount >= 0 ? error.sqlParamCount : null;
    let details = sanitizeValue({
      ...(context.details && typeof context.details === 'object' ? context.details : {}),
      kind: context.kind || 'exception',
      ...(causeChain.length ? { causes: causeChain } : {}),
      ...(errCode ? { code: errCode } : {}),
      ...(errno != null ? { errno } : {}),
      ...(error.sqlState ? { sqlState: redactErrorText(error.sqlState, 5) } : {}),
      ...(sqlParamCount != null ? { sqlParamCount, sqlBoundValuesStored: false } : {}),
      ...(error.sqlException ? { sqlException: error.sqlException } : {}),
      runtime: {
        service: 'addabaaz', appVersion: appVersion || null, release: normalizedRelease || null,
        environment: redactErrorText(environment, 32), node: source === 'server' ? process.version : null,
        platform: source === 'server' ? process.platform : null, pid: source === 'server' ? process.pid : null,
      },
    });
    let detailsJson;
    try {
      detailsJson = JSON.stringify(details);
      if (detailsJson.length > MAX_DETAILS_BYTES) {
        detailsJson = JSON.stringify({ truncated: true, preview: detailsJson.slice(0, MAX_DETAILS_BYTES - 100) });
      }
      details = detailsJson ? JSON.parse(detailsJson) : null;
    } catch {
      details = { serializationError: 'Error details could not be serialized.' };
    }

    const record = {
      source,
      severity: ['warning', 'error', 'fatal'].includes(context.severity) ? context.severity : 'error',
      errorName: redactErrorText(error.name || 'Error', 128) || 'Error',
      message: redactErrorText(error.message || String(input) || 'Unknown error', 500),
      stack: error.stack ? redactErrorText(error.stack, MAX_STACK_CHARS) : null,
      code: errCode,
      status,
      method,
      requestId,
      release: normalizedRelease || null,
      environment: redactErrorText(environment, 32),
      instanceId,
      details,
      sqlQuery: error.sqlTemplate ? redactErrorText(error.sqlTemplate, 8_000) : null,
      sqlParamCount,
      sqlException: error.sqlException ? sanitizeValue(error.sqlException) : null,
      url: safeErrorUrl(context.url || ''),
      userAgent: redactErrorText(context.userAgent || '', 512),
      userId: cleanUserId(context.userId),
    };

    try {
      if (!db?.errors?.add) throw new Error('The error-log database service is unavailable.');
      await db.errors.add(record);
      return true;
    } catch (persistError) {
      try {
        rawConsole.error('[error-log] Could not persist an application error to MySQL:', {
          name: redactErrorText(persistError?.name || 'Error', 128),
          message: redactErrorText(persistError?.message || 'Database write failed.', 2_000),
          code: cleanScalar(persistError?.code), errno: Number.isSafeInteger(Number(persistError?.errno)) ? Number(persistError.errno) : null,
        });
        rawConsole.error('[error-log] Original error summary:', {
          message: record.message, stack: record.stack, code: record.code, status: record.status,
          requestId: record.requestId, url: record.url,
        });
      } catch { /* runtime log is best effort */ }
      return false;
    }
  }

  function capture(input, context = {}) {
    const work = Promise.resolve().then(() => persist(input, context)).catch((reportError) => {
      try { rawConsole.error('[error-log] Could not format an application error report:', safeConsoleArgs([reportError])[0]); } catch { /* runtime log is best effort */ }
      return false;
    });
    pending.add(work);
    void work.then(() => pending.delete(work), () => pending.delete(work));
    return work;
  }

  function schedule(error, context) { return capture(error, context); }

  function logAt(severity, args) {
    const write = severity === 'warning' ? rawConsole.warn : rawConsole.error;
    try { write?.apply(rawConsole, safeConsoleArgs(args)); } catch { /* reporting must not break the caller */ }
    const error = loggedError(args);
    schedule(error, { severity, kind: 'application-log', details: { loggerMessage: logMessage(args) } });
  }

  const logger = {
    error(...args) { logAt('error', args); },
    warn(...args) { logAt('warning', args); },
    info(...args) { try { rawConsole.info?.apply(rawConsole, args); } catch { /* no-op */ } },
    log(...args) { try { rawConsole.log?.apply(rawConsole, args); } catch { /* no-op */ } },
    debug(...args) { try { rawConsole.debug?.apply(rawConsole, args); } catch { /* no-op */ } },
  };

  return { capture, logger, instanceId, async flush() { await Promise.allSettled([...pending]); } };
}

/** Install best-effort handlers for fatal process errors. Each is persisted before the process shuts down. */
export function installProcessErrorHandlers({ errorLogger, onFatal = () => process.exit(1), processRef = process, persistTimeoutMs = 3_000 } = {}) {
  if (!errorLogger?.capture) throw new TypeError('installProcessErrorHandlers requires an error logger');
  let handlingFatal = false;
  const fatal = (input, kind, origin = null) => {
    if (handlingFatal) return;
    handlingFatal = true;
    const error = parseError(input);
    const work = errorLogger.capture(error, { severity: 'fatal', kind, details: origin ? { origin } : {} });
    let timeout;
    Promise.race([work, new Promise((resolve) => { timeout = setTimeout(resolve, persistTimeoutMs); timeout.unref?.(); })])
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout);
        try { Promise.resolve(onFatal(error, kind)).catch(() => {}); }
        catch { try { processRef.exitCode = 1; } catch { /* test doubles may be immutable */ } }
      });
  };
  const onException = (error, origin) => fatal(error, 'uncaught-exception', origin);
  const onRejection = (reason) => fatal(reason, 'unhandled-rejection');
  processRef.on('uncaughtException', onException);
  processRef.on('unhandledRejection', onRejection);
  return () => {
    processRef.removeListener('uncaughtException', onException);
    processRef.removeListener('unhandledRejection', onRejection);
  };
}
