-- Account deletion and duplicate-account merges look up delivery history by user_id.
-- The recipient history is retained after deletion, so this index keeps those paths bounded by one account.
CREATE INDEX ix_campaign_delivery_user ON campaign_deliveries (user_id);
