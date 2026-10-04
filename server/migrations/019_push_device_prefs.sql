-- Per-device notification choices for the native apps.
--
-- The browser (Web Push) already has three switches per subscription: episodes, launches and news
-- (migration 006). The apps had only a master switch, so a viewer who follows one show on the web could
-- not say the same thing in the app. The same three columns now live on push_devices:
--
--   episodes  new episodes of shows I follow        default on  (like the web)
--   launches  when a Coming Soon title launches     default on
--   news      announcements & offers                default off (opt-in, like the web)
--
-- A device that has never opened the new settings screen keeps today's behaviour: it is in the
-- "everyone" broadcast audience, and it now counts as opted in to episode/launch notifications — which
-- is exactly what it was already receiving.
ALTER TABLE push_devices
  ADD COLUMN episodes TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN launches TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN news     TINYINT(1) NOT NULL DEFAULT 0;
