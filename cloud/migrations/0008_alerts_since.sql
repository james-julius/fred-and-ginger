-- When alerts last started (verified or switched on), in unix seconds. Only places that turn up
-- after it are alerted, so turning alerts on doesn't email a backlog.
ALTER TABLE alert_settings ADD COLUMN alerts_since INTEGER;
