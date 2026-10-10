import test from 'node:test';
import assert from 'node:assert/strict';
import { signJwt, signToken } from '../src/auth.js';
import { createSessionResolver, sessionForRequest } from '../src/sessions.js';

const secret = 'test-session-secret-0123456789abcdef';
const req = (token) => ({ headers: { authorization: token ? `bearer ${token}` : '' } });

test('session resolution accepts only current first-party bearer sessions', async () => {
  const user = { id: 'user-1', sessionVersion: 4, disabledAt: null };
  const db = { users: { async byId(id) { return id === user.id ? { ...user } : null; } } };
  const token = signToken(user.id, secret, undefined, user.sessionVersion);
  const resolver = createSessionResolver({ db, secret });

  assert.equal((await resolver(req(token))).id, user.id);
  assert.equal((await resolver(req('not-a-jwt'))), null);
  assert.equal((await resolver(req(signJwt({ aud: 'media', sub: user.id }, secret)) )), null, 'scoped media tokens are not sessions');

  user.sessionVersion++;
  assert.equal(await resolver(req(token)), null, 'revoked session versions are rejected');
  user.sessionVersion--;
  user.disabledAt = new Date().toISOString();
  assert.equal(await resolver(req(token)), null, 'optional-auth requests treat disabled users as anonymous');

  user.disabledAt = null;
  const session = await sessionForRequest(req(token), { db, secret });
  assert.equal(session.user.id, user.id);
  assert.equal(session.claims.sub, user.id);
});
