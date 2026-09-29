-- Paid access. Plans are prepaid passes, so a subscription has an expiry date.
ALTER TABLE subscriptions ADD COLUMN expires_at DATETIME(3) NULL AFTER started_at;

-- One row per checkout attempt (audit trail + idempotency). Kept for accounting if the account is later deleted (user_id → NULL).
CREATE TABLE payments (
  id                  CHAR(36)     NOT NULL,
  user_id             CHAR(36)     NULL,
  plan_id             VARCHAR(40)  NOT NULL,
  provider            VARCHAR(30)  NOT NULL,
  provider_order_id   VARCHAR(64)  NOT NULL,
  provider_payment_id VARCHAR(64)  NULL,
  amount_paise        INT UNSIGNED NOT NULL,
  currency            CHAR(3)      NOT NULL DEFAULT 'INR',
  status              ENUM('created','paid','failed') NOT NULL DEFAULT 'created',
  created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  paid_at             DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_order (provider, provider_order_id),
  UNIQUE KEY uq_payments_payment (provider, provider_payment_id),
  KEY ix_payments_user (user_id, created_at),
  CONSTRAINT fk_payments_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
