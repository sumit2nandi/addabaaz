-- Native app push can be enabled for connected guests without creating an account.
-- Their FCM token is retained for general broadcasts only; personalized audiences still
-- resolve through server-side account profiles and reminders.
ALTER TABLE push_devices MODIFY user_id CHAR(36) NULL;
