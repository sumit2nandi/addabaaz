-- Keep bulk video deletion efficient on large viewer datasets.
ALTER TABLE list_items
  ADD KEY ix_list_item_lookup (item_type, item_id);

ALTER TABLE watch_progress
  ADD KEY ix_progress_video (video_id);
