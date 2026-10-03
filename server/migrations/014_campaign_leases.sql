-- A database-backed lease prevents two server instances from resuming/sending the same broadcast at once.
ALTER TABLE campaigns
  ADD COLUMN claim_token CHAR(36) NULL AFTER updated_at,
  ADD COLUMN claim_until DATETIME(3) NULL AFTER claim_token,
  ADD KEY ix_campaign_lease (status, claim_until);
