-- Phone sign-in (SMS OTP, MSG91 — see docs/MSG91.md).
--
-- 1. users.phone / users.phone_verified_at: the number a viewer signed up (or signed in) with. It is
--    verified, unique and stored in international format without "+" (919812345678), so the same person
--    always maps to the same account. A unique key over a NULLable column still allows many NULLs, which is
--    what accounts created with email + password need.
-- 2. phone_otps: one row per code sent. Only the SHA-256 hash of the code is stored — a database leak
--    cannot be used to sign in. Attempts and expiry are enforced here, not by the SMS provider.

ALTER TABLE users ADD COLUMN phone VARCHAR(20) NULL, ADD COLUMN phone_verified_at DATETIME(3) NULL;
ALTER TABLE users ADD UNIQUE KEY uq_user_phone (phone);

CREATE TABLE IF NOT EXISTS phone_otps (
  id          CHAR(36)    NOT NULL,
  phone       VARCHAR(20) NOT NULL,
  code_hash   CHAR(64)    NOT NULL,
  attempts    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at  DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_otp_phone (phone, created_at),
  KEY ix_otp_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
