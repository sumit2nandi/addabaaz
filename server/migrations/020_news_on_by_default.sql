-- Announcements & offers are ON by default.
--
-- Until now `news` defaulted to 0 on both channels, so everyone who never touched the three switches in
-- Account → Notifications was silently left out of announcements — the switch looked "off by default"
-- and most people never noticed it. The owner's call: turning notifications on means all three kinds
-- (new episodes, Coming Soon launches, announcements) unless the viewer turns one off.
--
-- The defaults move to 1, and existing rows are back-filled. A viewer who had deliberately switched
-- announcements off is switched back on once — they can turn it off again from the same screen (and the
-- switch now shows exactly what the server will do).
ALTER TABLE push_subscriptions ALTER COLUMN news SET DEFAULT 1;
ALTER TABLE push_devices       ALTER COLUMN news SET DEFAULT 1;
UPDATE push_subscriptions SET news = 1 WHERE news = 0;
UPDATE push_devices       SET news = 1 WHERE news = 0;
