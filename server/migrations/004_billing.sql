-- Billing: coupons, GST invoices / credit notes, refunds, expiry reminders.

-- Pricing details on each payment: list price, discount and coupon used, the buyer's GST billing details (JSON), and how much has been refunded so far.
ALTER TABLE payments
  ADD COLUMN list_price_paise  INT UNSIGNED NULL AFTER amount_paise,
  ADD COLUMN discount_paise    INT UNSIGNED NOT NULL DEFAULT 0 AFTER list_price_paise,
  ADD COLUMN coupon_code       VARCHAR(30)  NULL AFTER discount_paise,
  ADD COLUMN billing           JSON         NULL AFTER coupon_code,
  ADD COLUMN refunded_paise    INT UNSIGNED NOT NULL DEFAULT 0 AFTER billing,
  ADD COLUMN failed_notified_at DATETIME(3) NULL,
  ADD KEY ix_payments_coupon (coupon_code, status, created_at);

-- Remembers which expiry date we already sent a reminder for, so each plan end triggers exactly one reminder.
ALTER TABLE subscriptions ADD COLUMN expiry_reminder_for DATETIME(3) NULL;

-- Discount codes: percent or flat, optional plan restriction, validity dates and redemption limits (overall and per user).
CREATE TABLE coupons (
  code             VARCHAR(30)  NOT NULL,
  description      VARCHAR(120) NULL,
  kind             ENUM('percent','flat') NOT NULL,
  value            INT UNSIGNED NOT NULL,
  plan_ids         VARCHAR(200) NULL,
  max_redemptions  INT UNSIGNED NULL,
  per_user_limit   INT UNSIGNED NOT NULL DEFAULT 1,
  starts_at        DATETIME(3)  NULL,
  expires_at       DATETIME(3)  NULL,
  active           TINYINT(1)   NOT NULL DEFAULT 1,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Gapless per-series, per-financial-year invoice counters (row-locked while numbering).
CREATE TABLE invoice_counters (
  series  VARCHAR(8)   NOT NULL,
  fy      CHAR(4)      NOT NULL,
  last_no INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (series, fy)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE refunds (
  id                 CHAR(36)     NOT NULL,
  payment_id         CHAR(36)     NOT NULL,
  provider_refund_id VARCHAR(64)  NOT NULL,
  amount_paise       INT UNSIGNED NOT NULL,
  status             ENUM('pending','processed','failed') NOT NULL DEFAULT 'pending',
  reason             VARCHAR(200) NULL,
  source             ENUM('admin','provider') NOT NULL,
  revoked_access     TINYINT(1)   NOT NULL DEFAULT 0,
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_refund_provider (provider_refund_id),
  KEY ix_refund_payment (payment_id),
  CONSTRAINT fk_refund_payment FOREIGN KEY (payment_id) REFERENCES payments (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tax invoices and credit notes. Kept for the statutory retention period, so they survive account deletion (user_id → NULL);
-- the buyer/seller details are snapshotted in `doc`.
CREATE TABLE invoices (
  id            CHAR(36)     NOT NULL,
  number        VARCHAR(20)  NOT NULL,
  kind          ENUM('invoice','credit_note') NOT NULL,
  doc_key       CHAR(36)     NOT NULL,
  payment_id    CHAR(36)     NOT NULL,
  refund_id     CHAR(36)     NULL,
  parent_id     CHAR(36)     NULL,
  user_id       CHAR(36)     NULL,
  fy            CHAR(4)      NOT NULL,
  issued_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  taxable_paise INT UNSIGNED NOT NULL,
  cgst_paise    INT UNSIGNED NOT NULL DEFAULT 0,
  sgst_paise    INT UNSIGNED NOT NULL DEFAULT 0,
  igst_paise    INT UNSIGNED NOT NULL DEFAULT 0,
  total_paise   INT UNSIGNED NOT NULL,
  gst_rate      DECIMAL(5,2) NOT NULL DEFAULT 0,
  doc           JSON         NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invoice_number (number),
  UNIQUE KEY uq_invoice_doc (doc_key),
  KEY ix_invoice_payment (payment_id),
  KEY ix_invoice_user (user_id, issued_at),
  KEY ix_invoice_issued (issued_at),
  CONSTRAINT fk_invoice_payment FOREIGN KEY (payment_id) REFERENCES payments (id),
  CONSTRAINT fk_invoice_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
