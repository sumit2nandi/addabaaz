-- Per-recipient results for Admin → Broadcast. Recipient identity is snapshotted so history remains
-- useful if an account is later renamed, unsubscribed, merged, or deleted. Delivery keys are SHA-256
-- digests of an account/device identifier; raw push tokens and browser endpoints are never stored here.
CREATE TABLE IF NOT EXISTS campaign_deliveries (
  id              CHAR(36)      NOT NULL,
  campaign_id     CHAR(36)      NOT NULL,
  delivery_key    CHAR(64)      NOT NULL,
  channel         ENUM('push','email') NOT NULL,
  transport       ENUM('email','web_push','app_push') NOT NULL,
  user_id         CHAR(36)      NULL,
  recipient_name  VARCHAR(120)  NULL,
  recipient_email VARCHAR(254)  NULL,
  destination     VARCHAR(160)  NULL,
  status          ENUM('pending','sent','failed','skipped') NOT NULL DEFAULT 'pending',
  error           VARCHAR(500) NULL,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_campaign_delivery (campaign_id, delivery_key),
  KEY ix_campaign_delivery_status (campaign_id, status, created_at),
  CONSTRAINT fk_campaign_delivery_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
