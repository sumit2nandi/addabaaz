ALTER TABLE auth_tokens MODIFY purpose ENUM('reset','verify','pin_reset') NOT NULL;
