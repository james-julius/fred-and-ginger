-- What a renter wants to know, read from every site's raw data (src/facts.ts). NULL = not read yet.
ALTER TABLE listings ADD COLUMN facts TEXT;
