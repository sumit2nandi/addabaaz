// Resolve signed-in identity once at the HTTP boundary. Features receive a user, never parse bearer tokens.
import { sessionValid, verifyToken } from './auth.js';

/** Resolve a valid first-party session token into its user and claims; scoped media/OAuth tokens are rejected. */
export async function sessionForRequest(req, { db, secret }) {
  const authorization = req.headers.authorization || '';
  const bearer = authorization.match(/^Bearer\s+(.+)$/i);
  const claims = bearer ? verifyToken(bearer[1], secret) : null;
  if (!claims || claims.aud || !claims.sub) return null;
  const user = await db.users.byId(String(claims.sub));
  if (!user || !sessionValid(claims, user)) return null;
  return { user, claims };
}

/** Session lookup for optional-auth endpoints: invalid, disabled and scoped sessions all become anonymous. */
export function createSessionResolver(dependencies) {
  return async (req) => {
    const session = await sessionForRequest(req, dependencies);
    return session && !session.user.disabledAt ? session.user : null;
  };
}
