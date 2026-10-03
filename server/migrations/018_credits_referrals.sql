-- Promotional credit and referrals.
--
-- ADDABAAZ credit (1 rupee = 100 paise, integers everywhere) is money the *business* gives away: a welcome
-- bonus for new accounts, a reward for inviting a friend, or goodwill an administrator decides on. It can
-- only be spent on a plan — it is never cash, never refundable and cannot be transferred.
--
-- 1. users.referral_code — the short code a viewer shares. Generated on first use ("ADDABAAZ", 8 characters
--    from an unambiguous alphabet), unique, case-insensitive by way of normalisation in promos.js.
-- 2. user_credit — an append-only ledger, one row per movement:
--      amount_paise    the size of the movement (positive = granted, negative = spent)
--      remaining_paise grants only: how much of this grant is still unused. Spending walks the ledger
--                      oldest-expiry-first and decrements it, so a grant that expires can never be spent
--                      and a spend can never resurrect value from an expired grant.
--      status          pending   = granted but on hold (a referral whose friend has not been verified yet)
--                      available = spendable right now
--                      spent     = a spend that was applied / a grant that is fully used
--                      expired   = a grant whose expiry passed with value left on it
--                      void      = a spend that was undone (the order was never paid for)
-- 3. referrals — one row per invited friend (at most one per account, enforced by the unique key), so a
--    person can be referred once and cannot refer themselves.
-- 4. payments.credit_applied_paise — how much of that order was paid with credit, so receipts, the admin
--    console and refunds can explain the amount that was charged to the card/UPI.

ALTER TABLE users ADD COLUMN referral_code VARCHAR(12) NULL, ADD UNIQUE KEY uq_user_referral_code (referral_code);

CREATE TABLE IF NOT EXISTS user_credit (
  id              CHAR(36)     NOT NULL,
  user_id         CHAR(36)     NOT NULL,
  kind            ENUM('signup','referral_join','referral_invite','admin','spend','refund') NOT NULL,
  amount_paise    INT          NOT NULL,                 -- + grant, - spend
  remaining_paise INT          NOT NULL DEFAULT 0,       -- grants only: value still unused
  status          ENUM('pending','available','spent','expired','void') NOT NULL DEFAULT 'available',
  reason          VARCHAR(200) NULL,                     -- shown to the viewer and in the console
  ref_type        VARCHAR(24)  NULL,                     -- payment | referral | user | admin
  ref_id          VARCHAR(64)  NULL,                     -- payment id, referral id, user id …
  expires_at      DATETIME(3)  NULL,                     -- NULL = never expires
  settled_at      DATETIME(3)  NULL,                     -- when a pending row became final (or void)
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_credit_user (user_id, status, created_at),
  KEY ix_credit_ref (ref_type, ref_id),
  KEY ix_credit_expiry (status, expires_at),
  CONSTRAINT fk_credit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referrals (
  id           CHAR(36)     NOT NULL,
  inviter_id   CHAR(36)     NOT NULL,
  invitee_id   CHAR(36)     NOT NULL,
  code         VARCHAR(12)  NOT NULL,                    -- the code that was used
  status       ENUM('pending','completed','void') NOT NULL DEFAULT 'pending',
  bonus_paise  INT UNSIGNED NOT NULL DEFAULT 0,          -- what the inviter earns when it completes
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_referral_invitee (invitee_id),           -- one referral per account, ever
  KEY ix_referral_inviter (inviter_id, created_at),
  CONSTRAINT fk_referral_inviter FOREIGN KEY (inviter_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_referral_invitee FOREIGN KEY (invitee_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE payments ADD COLUMN credit_applied_paise INT UNSIGNED NOT NULL DEFAULT 0 AFTER discount_paise;
