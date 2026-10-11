-- runs are ingested in small batches by the cron (Workers cap requests per invocation)
ALTER TABLE runs ADD COLUMN dataset TEXT;
ALTER TABLE runs ADD COLUMN ingested INTEGER DEFAULT 0;
