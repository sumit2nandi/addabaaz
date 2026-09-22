-- MySQL 8.4. Idempotent initial schema. Never DROP live data here.
CREATE TABLE IF NOT EXISTS content_meta (id TINYINT PRIMARY KEY, revision BIGINT UNSIGNED NOT NULL DEFAULT 0, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB;
INSERT IGNORE INTO content_meta (id, revision) VALUES (1, 0);
CREATE TABLE IF NOT EXISTS content_shows (
  `key` VARCHAR(190) NOT NULL,
  `title` TEXT NOT NULL,
  `subtitle` TEXT NOT NULL,
  `description` TEXT NOT NULL,
  `image` TEXT NOT NULL,
  `genre` TEXT NOT NULL,
  sort_order INT UNSIGNED NOT NULL,
  PRIMARY KEY (`key`),
  INDEX (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS content_episodes (
  `id` VARCHAR(190) NOT NULL,
  `position` TEXT NOT NULL,
  `title` TEXT NOT NULL,
  `youtubeId` TEXT NOT NULL,
  `publishDate` TEXT NOT NULL,
  `duration` TEXT NOT NULL,
  `views` TEXT NOT NULL,
  `thumbnail` TEXT NOT NULL,
  `availability` TEXT NOT NULL,
  `project` VARCHAR(190) NOT NULL,
  `episode` TEXT NOT NULL,
  `kind` TEXT NOT NULL,
  sort_order INT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  INDEX (sort_order),
  CONSTRAINT fk_episode_show FOREIGN KEY (project) REFERENCES content_shows (`key`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS content_promos (
  `id` VARCHAR(190) NOT NULL,
  `position` TEXT NOT NULL,
  `title` TEXT NOT NULL,
  `youtubeId` TEXT NOT NULL,
  `publishDate` TEXT NOT NULL,
  `duration` TEXT NOT NULL,
  `views` TEXT NOT NULL,
  `thumbnail` TEXT NOT NULL,
  `availability` TEXT NOT NULL,
  `project` TEXT NOT NULL,
  `episode` TEXT NOT NULL,
  `kind` TEXT NOT NULL,
  sort_order INT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  INDEX (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS content_upcoming (
  `file` VARCHAR(190) NOT NULL,
  `title` TEXT NOT NULL,
  `featured` TEXT NOT NULL,
  `home` TEXT NOT NULL,
  sort_order INT UNSIGNED NOT NULL,
  PRIMARY KEY (`file`),
  INDEX (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS content_bts (
  `file` VARCHAR(190) NOT NULL,
  `title` TEXT NOT NULL,
  sort_order INT UNSIGNED NOT NULL,
  PRIMARY KEY (`file`),
  INDEX (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS content_team (
  `id` VARCHAR(190) NOT NULL,
  `name` TEXT NOT NULL,
  `role` TEXT NOT NULL,
  `quote` TEXT NOT NULL,
  `image` TEXT NOT NULL,
  sort_order INT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  INDEX (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS content_services (
  `id` VARCHAR(190) NOT NULL,
  `number` TEXT NOT NULL,
  `title` TEXT NOT NULL,
  `description` TEXT NOT NULL,
  sort_order INT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  INDEX (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS content_missions (
  `id` VARCHAR(190) NOT NULL,
  `language` TEXT NOT NULL,
  `text` TEXT NOT NULL,
  sort_order INT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  INDEX (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS content_copy (
  `key` VARCHAR(190) NOT NULL,
  `value` TEXT NOT NULL,
  sort_order INT UNSIGNED NOT NULL,
  PRIMARY KEY (`key`),
  INDEX (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS content_settings (
  `key` VARCHAR(190) NOT NULL,
  `value` TEXT NOT NULL,
  sort_order INT UNSIGNED NOT NULL,
  PRIMARY KEY (`key`),
  INDEX (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS inquiries (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120) NOT NULL, email VARCHAR(254) NOT NULL, phone VARCHAR(40) NOT NULL, message TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
