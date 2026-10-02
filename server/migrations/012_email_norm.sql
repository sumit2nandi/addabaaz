-- One address = one account.
--
-- `users.email` has a UNIQUE index, but that index only refuses a string MySQL considers equal. A
-- copy-pasted address often carries a character the eye cannot see and the collation does not ignore — a
-- non-breaking space, an ideographic space, a full-width ＠, a soft hyphen — so `rupa\u00a0@example.com`
-- is a DIFFERENT string from `rupa@example.com` and buys a second account (reported: two accounts in
-- Admin → Users). A database whose users table predates the unique key can even hold two identical
-- addresses.
--
-- This migration adds `email_norm` — the normalized address the application compares and stores — with
-- its own UNIQUE index, plus `email_dup` to flag the rows that already collide (they are listed in
-- Admin → Users and merged from there).
--
-- Existing colliding rows keep their e-mail but only the OLDEST of an address keeps `email_norm`; the
-- later ones get `email_dup = 1, email_norm = NULL` (NULL never collides), so the unique index below can
-- always be created. The application re-normalizes every stored address on boot
-- (db.adminUsers.renormalizeEmails), which also catches the characters SQL alone cannot strip.

ALTER TABLE users ADD COLUMN email_norm VARCHAR(254) NULL AFTER email;
ALTER TABLE users ADD COLUMN email_dup TINYINT(1) NOT NULL DEFAULT 0 AFTER email_norm;

-- First pass: what SQL can normalize (case + outer spaces). Shorter rows are skipped here — the
-- application's normalizer (5-character minimum, exactly like signup validation) flags them instead.
UPDATE users SET email_norm = LOWER(TRIM(email)) WHERE CHAR_LENGTH(TRIM(email)) >= 5;

-- Only the oldest row of an address keeps its normalized address (the same rule the application uses);
-- every later row steps aside and is flagged for the admin to merge. This must survive rows that are
-- IDENTICAL — a users table created before `uq_users_email` existed can hold them.
UPDATE users u
  JOIN (
    SELECT email_norm AS k, MIN(CONCAT(DATE_FORMAT(created_at, '%Y%m%d%H%i%s'), id)) AS first_key
      FROM users WHERE email_norm IS NOT NULL GROUP BY email_norm HAVING COUNT(*) > 1
  ) d ON d.k = u.email_norm
   SET u.email_dup = 1, u.email_norm = NULL
 WHERE CONCAT(DATE_FORMAT(u.created_at, '%Y%m%d%H%i%s'), u.id) <> d.first_key;

CREATE UNIQUE INDEX uq_users_email_norm ON users (email_norm);
