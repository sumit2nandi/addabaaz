-- Support tickets (the public Support page → Admin → Support).
--
-- 1. support_tickets: one row per issue a viewer raises (trouble signing in, registration, payments,
--    playback, content, account …). A ticket is linked to an account when the sender is signed in, but
--    guests can raise one too — that is why user_id is nullable and name/email are copied onto the row.
-- 2. support_ticket_replies: the conversation (viewer replies and admin replies) in one thread.

CREATE TABLE IF NOT EXISTS support_tickets (
  id            CHAR(36)     NOT NULL,
  user_id       CHAR(36)     NULL,
  name          VARCHAR(80)  NOT NULL,
  email         VARCHAR(254) NOT NULL,
  phone         VARCHAR(24)  NULL,
  category      ENUM('signin','registration','payment','playback','content','account','other') NOT NULL DEFAULT 'other',
  subject       VARCHAR(160) NOT NULL,
  body          TEXT         NOT NULL,
  status        ENUM('open','pending','resolved','closed') NOT NULL DEFAULT 'open',
  priority      ENUM('low','normal','high') NOT NULL DEFAULT 'normal',
  app_version   VARCHAR(40)  NULL,          -- "which build were you on" — from the client, helps reproduce bugs
  platform      VARCHAR(40)  NULL,          -- web | android | ios
  device        VARCHAR(120) NULL,          -- the user-agent / device label reported by the app
  admin_note    VARCHAR(300) NULL,          -- internal note (never shown to the viewer)
  handled_by    VARCHAR(254) NULL,          -- the admin who last touched the ticket
  replies       INT UNSIGNED NOT NULL DEFAULT 0,
  last_reply_by ENUM('user','admin') NULL,
  last_reply_at DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at   DATETIME(3)  NULL,
  PRIMARY KEY (id),
  KEY ix_ticket_status (status, updated_at),
  KEY ix_ticket_user (user_id, created_at),
  KEY ix_ticket_email (email),
  CONSTRAINT fk_ticket_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_ticket_replies (
  id          CHAR(36)     NOT NULL,
  ticket_id   CHAR(36)     NOT NULL,
  author      ENUM('user','admin') NOT NULL,
  author_name VARCHAR(120) NULL,
  author_id   CHAR(36)     NULL,            -- kept only for admins (audit trail); no FK so a deleted user never breaks the thread
  body        TEXT         NOT NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_reply_ticket (ticket_id, created_at),
  CONSTRAINT fk_reply_ticket FOREIGN KEY (ticket_id) REFERENCES support_tickets (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
