-- Fixtures for the sweep migration test. Loaded into a throwaway database
-- created from a --schema-only dump of production, so the migration runs
-- against the exact schema it will meet on the box.
--
-- Every case here is one the migration has to survive on real data.

BEGIN;

INSERT INTO "Site" (id, "siteUrl", status, "createdAt", "updatedAt") VALUES
  ('S1', 'https://example.test/s1', 'ACTIVE',    NOW(), NOW()),
  ('S2', 'https://example.test/s2', 'ACTIVE',    NOW(), NOW()),
  ('S3', 'https://example.test/s3', 'ANALYZING', NOW(), NOW()),
  ('S4', 'https://example.test/s4', 'ACTIVE',    NOW(), NOW());

INSERT INTO "ScrapeRun" (id, "siteId", status, "jobCount", "createdAt") VALUES
  ('RUN_LIVE',    'S1', 'COMPLETED', 3, NOW()),
  ('RUN_DELETED', 'S1', 'COMPLETED', 3, NOW());

-- --------------------------------------------------------------------------
-- The case that decides the foreign-key question.
--
-- `clearSiteJobs` deletes a site's ScrapeRuns and leaves its WorkerJobs, so a
-- payload naming a run that no longer exists is a state the box can already be
-- in. Reproduced faithfully — created, then deleted — rather than by inventing
-- an id that never existed.
-- --------------------------------------------------------------------------
DELETE FROM "ScrapeRun" WHERE id = 'RUN_DELETED';

INSERT INTO "WorkerJob" (id, "siteId", type, status, payload, "createdAt") VALUES
  -- backfills to the live run
  ('W_LIVE',    'S1', 'SCRAPE',   'COMPLETED', '{"scrapeRunId":"RUN_LIVE"}'::jsonb,    NOW()),
  -- must stay NULL: the run is gone
  ('W_DEAD',    'S1', 'SCRAPE',   'COMPLETED', '{"scrapeRunId":"RUN_DELETED"}'::jsonb, NOW()),
  -- no payload at all
  ('W_NOPAY',   'S1', 'ANALYSIS', 'COMPLETED', NULL,                                   NOW()),
  -- payload without the key
  ('W_EMPTY',   'S1', 'SCRAPE',   'COMPLETED', '{"maxJobs":5}'::jsonb,                 NOW()),
  -- key present but not a string id
  ('W_NULLKEY', 'S1', 'SCRAPE',   'COMPLETED', '{"scrapeRunId":null}'::jsonb,          NOW());

-- --------------------------------------------------------------------------
-- Dedupe. Three active SCRAPE jobs on S2, distinct createdAt: the newest wins.
-- The ANALYSIS job on S2 must survive — the index is per (siteId, type).
-- --------------------------------------------------------------------------
INSERT INTO "WorkerJob" (id, "siteId", type, status, "createdAt") VALUES
  ('W_S2_OLD',  'S2', 'SCRAPE',   'PENDING',     NOW() - INTERVAL '3 hours'),
  ('W_S2_MID',  'S2', 'SCRAPE',   'IN_PROGRESS', NOW() - INTERVAL '2 hours'),
  ('W_S2_NEW',  'S2', 'SCRAPE',   'PENDING',     NOW() - INTERVAL '1 hour'),
  ('W_S2_ANLZ', 'S2', 'ANALYSIS', 'PENDING',     NOW() - INTERVAL '3 hours');

-- --------------------------------------------------------------------------
-- The tie. Two active jobs with the SAME createdAt.
--
-- With a `n."createdAt" > w."createdAt"` comparison alone, neither row sees the
-- other as newer and BOTH survive — the unique index then fails to create. With
-- a naive `>=`, each sees the other as newer and BOTH are marked superseded,
-- the index creates over an empty set, and two queued jobs are silently
-- discarded. Only the (createdAt, id) tuple leaves exactly one.
-- --------------------------------------------------------------------------
INSERT INTO "WorkerJob" (id, "siteId", type, status, "createdAt") VALUES
  ('W_S3_A', 'S3', 'ANALYSIS', 'PENDING', TIMESTAMP '2026-09-01 00:00:00'),
  ('W_S3_B', 'S3', 'ANALYSIS', 'PENDING', TIMESTAMP '2026-09-01 00:00:00');

-- --------------------------------------------------------------------------
-- A terminal row alongside an active one. The COMPLETED job must not be
-- touched, and must not block the index.
-- --------------------------------------------------------------------------
INSERT INTO "WorkerJob" (id, "siteId", type, status, "createdAt") VALUES
  ('W_S4_DONE', 'S4', 'SCRAPE', 'COMPLETED', NOW() - INTERVAL '5 hours'),
  ('W_S4_FAIL', 'S4', 'SCRAPE', 'FAILED',    NOW() - INTERVAL '4 hours'),
  ('W_S4_LIVE', 'S4', 'SCRAPE', 'PENDING',   NOW() - INTERVAL '1 hour');

COMMIT;
