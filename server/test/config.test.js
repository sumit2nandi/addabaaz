// Database settings from the environment: URL vs DB_* variables, and the TLS options used by managed MySQL (Aiven, RDS, ...). No database needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dbConfigFromEnv } from '../src/config.js';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n';

test('plain settings: no TLS unless asked for', () => {
  const c = dbConfigFromEnv({ DB_HOST: 'h', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'd', DB_PORT: '3307' });
  assert.deepEqual([c.host, c.port, c.user, c.password, c.database], ['h', 3307, 'u', 'p', 'd']); assert.equal(c.ssl, undefined);
});

test('Aiven-style URL: ssl-mode=REQUIRED switches TLS on (certificate verified), special characters decoded', () => {
  const c = dbConfigFromEnv({ DATABASE_URL: 'mysql://avnadmin:p%40ss%23w@mysql-x.aivencloud.com:21345/defaultdb?ssl-mode=REQUIRED' });
  assert.equal(c.host, 'mysql-x.aivencloud.com'); assert.equal(c.port, 21345); assert.equal(c.password, 'p@ss#w'); assert.equal(c.database, 'defaultdb');
  assert.equal(c.ssl.rejectUnauthorized, true); assert.equal(c.ssl.minVersion, 'TLSv1.2');
  assert.equal(dbConfigFromEnv({ DATABASE_URL: 'mysql://u:p@h:3306/d?ssl-mode=DISABLED' }).ssl, undefined);
});

test('private CA: from a file path or pasted text (\\n allowed); a missing file is a clear error', () => {
  const f = path.join(os.tmpdir(), `ca-${process.pid}.pem`); fs.writeFileSync(f, PEM);
  try {
    assert.equal(dbConfigFromEnv({ DB_HOST: 'h', DB_SSL: 'true', DB_SSL_CA_FILE: f }).ssl.ca, PEM);
    const withCa = dbConfigFromEnv({ DB_HOST: 'h', DB_SSL_CA: PEM.replace(/\n/g, '\\n') }).ssl;
    assert.equal(withCa.ca, PEM);   // a CA alone also turns TLS on
    assert.equal(withCa.checkServerIdentity, undefined, 'hostname verification stays enabled by default');
    const withoutHostnameCheck = dbConfigFromEnv({ DB_HOST: 'h', DB_SSL_CA: PEM, DB_SSL_VERIFY_IDENTITY: 'false' }).ssl;
    assert.equal(withoutHostnameCheck.checkServerIdentity('h', {}), undefined, 'hostname verification is opt-out only');
  } finally { fs.unlinkSync(f); }
  assert.throws(() => dbConfigFromEnv({ DB_HOST: 'h', DB_SSL_CA_FILE: '/nope/ca.pem' }), /DB_SSL_CA_FILE: cannot read/);
});

test('TLS verification controls are explicit opt-outs', () => {
  assert.equal(dbConfigFromEnv({ DB_HOST: 'h', DB_SSL: '1', DB_SSL_VERIFY: 'false' }).ssl.rejectUnauthorized, false);
  const hostnameOptOut = dbConfigFromEnv({ DB_HOST: 'h', DB_SSL: '1', DB_SSL_VERIFY_IDENTITY: 'false' }).ssl;
  assert.equal(hostnameOptOut.rejectUnauthorized, true, 'certificate-chain validation stays enabled');
  assert.equal(hostnameOptOut.checkServerIdentity('h', {}), undefined, 'hostname verification can be opted out independently');
});

test('a pasted certificate survives what hosting dashboards do to it (spaces, literal \\n, quotes); garbage is rejected', () => {
  const body = 'MIIBfakeAAAA'.repeat(20);
  const good = `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
  const oneLine = good.replace(/\n/g, ' ').trim();                     // newlines became spaces
  const literal = good.replace(/\n/g, '\\n');                         // newlines became backslash-n
  const quoted = `"${literal}"`;
  for (const v of [good, oneLine, literal, quoted]) assert.equal(dbConfigFromEnv({ DB_HOST: 'h', DB_SSL_CA: v }).ssl.ca, good);
  assert.throws(() => dbConfigFromEnv({ DB_HOST: 'h', DB_SSL_CA: 'not a certificate' }), /does not contain a certificate/);
});
