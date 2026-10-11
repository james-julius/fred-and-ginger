-- the search a crawler run was for (ingest.ts critKey), so Fred doesn't re-run a site for the same search too soon
ALTER TABLE runs ADD COLUMN criteria TEXT;
