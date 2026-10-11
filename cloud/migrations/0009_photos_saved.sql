-- 1 once a listing's photos are copied to R2 (src/photos.ts); otherwise the unix time of the last try
ALTER TABLE listings ADD COLUMN photos_saved INTEGER;
