-- Phone-verified accounts may add or update a contact email after confirming ownership.
-- Store only the one-time token hash; the FK removes pending addresses on account deletion.
ALTER TABLE users
  ADD COLUMN email_change_requested_at DATETIME(3) NULL;

CREATE TABLE email_change_tokens (
  token_hash CHAR(64)     NOT NULL,
  user_id    CHAR(36)     NOT NULL,
  email      VARCHAR(254) NOT NULL,
  email_norm VARCHAR(254) NOT NULL,
  expires_at DATETIME(3)  NOT NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (token_hash),
  KEY ix_email_change_user (user_id, created_at),
  KEY ix_email_change_expiry (expires_at),
  CONSTRAINT fk_email_change_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
