-- 1 once a listing's photos are copied to R2 (src/photos.ts), 0 if some couldn't be
ALTER TABLE listings ADD COLUMN photos_saved INTEGER;
