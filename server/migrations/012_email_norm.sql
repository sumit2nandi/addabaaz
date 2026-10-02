-- One address = one account.
--
-- `users.email` is UNIQUE, but that index cannot see characters that look like nothing: a zero-width
-- space, soft hyphen, full-width ＠ or non-breaking space make a different string and therefore a second
-- account for what everyone sees as the same address (reported: two accounts in Admin → Users).
--
-- This migration adds `email_norm` — the normalized address the application compares and stores — with
-- its own UNIQUE index, plus `email_dup` to flag rows that already collide (they are listed in
-- Admin → Users → "accounts sharing one e-mail" and merged from there).
--
-- Existing colliding rows keep their e-mail but get `email_norm = NULL` (MySQL allows several NULLs in a
-- unique index) so the index can be created and no NEW account can be added for that address.
-- The application re-normalizes every stored address on boot (db.adminUsers.renormalizeEmails), which
-- also catches the invisible-character cases SQL cannot strip.

ALTER TABLE users ADD COLUMN email_norm VARCHAR(254) NULL AFTER email;
ALTER TABLE users ADD COLUMN email_dup TINYINT(1) NOT NULL DEFAULT 0 AFTER email_norm;

-- First pass: what SQL can normalize (case + outer spaces). Shorter rows are skipped here — the
-- application's normalizer (5-character minimum, exactly like signup validation) flags them instead.
UPDATE users SET email_norm = LOWER(TRIM(email)) WHERE CHAR_LENGTH(TRIM(email)) >= 5;

-- Flag every row that collides with an older one, keeping the first row per address.
UPDATE users u
  JOIN (SELECT LOWER(TRIM(email)) AS k, MIN(id) AS keep_id FROM users GROUP BY k HAVING COUNT(*) > 1) d
    ON d.k = LOWER(TRIM(u.email))
   SET u.email_dup = 1
 WHERE u.id <> d.keep_id;

-- The flagged rows step aside so the unique index can be created.
UPDATE users SET email_norm = NULL WHERE email_dup = 1;

CREATE UNIQUE INDEX uq_users_email_norm ON users (email_norm);
