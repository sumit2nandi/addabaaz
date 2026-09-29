-- Social login (Google, Facebook). Accounts created through a provider have no password.
ALTER TABLE users MODIFY password_hash VARCHAR(255) NULL;

-- One row per linked provider account. (provider, subject) is the provider's stable user id — never the email.
CREATE TABLE auth_identities (
  provider      ENUM('google','facebook') NOT NULL,
  subject       VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  user_id       CHAR(36)     NOT NULL,
  email         VARCHAR(254) NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_login_at DATETIME(3)  NULL,
  PRIMARY KEY (provider, subject),
  KEY ix_identities_user (user_id),
  CONSTRAINT fk_identities_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
