-- Reported crime near a spot (src/safety.ts), one row per ~100 m cell so nearby listings share it.
CREATE TABLE areas (cell TEXT PRIMARY KEY, violent INTEGER, property INTEGER, total INTEGER, report TEXT, fetched INTEGER);
