#!/usr/bin/env node
/* Manage administrator accounts from the server's shell (the account must already exist: sign up on the site first).
 *   node server/src/admin-cli.js grant you@example.com
 *   node server/src/admin-cli.js revoke you@example.com
 *   node server/src/admin-cli.js list
 * In Docker:  docker compose exec app node server/src/admin-cli.js grant you@example.com */
import { createDb } from './db.js';
import { normalizeEmail } from './email-address.js';
import { migrate } from './migrate.js';

// Read the command (grant | revoke | list) and e-mail from the command line.
const [cmd, email] = process.argv.slice(2);
if (!['grant', 'revoke', 'list'].includes(cmd) || (cmd !== 'list' && !email)) {
  console.error('Usage: admin-cli.js grant|revoke <email>   |   admin-cli.js list');
  process.exit(2);
}
// Connect using the normal DB_* / DATABASE_URL settings, then run the requested command.
const db = await createDb();
try {
  await migrate(db);                                   // makes sure the is_admin column exists
  if (cmd === 'list') {
    const admins = await db.adminUsers.admins();
    console.log(admins.length ? admins.map((a) => `${a.email}  (${a.name})`).join('\n') : 'No administrators yet. Run: grant <email>');
  } else {
    const e = email.trim().toLowerCase();
    if (cmd === 'revoke' && (await db.adminUsers.countAdmins()) <= 1 && (await db.users.byEmailNorm(normalizeEmail(e).email))?.isAdmin) { console.error('Refusing to remove the last administrator.'); process.exitCode = 1; }
    else if (!(await db.adminUsers.setAdminByEmail(normalizeEmail(e).email, cmd === 'grant'))) { console.error(`No account with the email ${e}. Sign up on the site first.`); process.exitCode = 1; }
    else console.log(`${e} is ${cmd === 'grant' ? 'now' : 'no longer'} an administrator.`);
  }
} finally { await db.close(); }
