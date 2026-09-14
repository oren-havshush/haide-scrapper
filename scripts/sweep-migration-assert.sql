-- Assertions for the sweep migration, run against the throwaway database after
-- the migration has been applied over scripts/sweep-migration-fixtures.sql.
--
-- Every check RAISEs, so psql exits non-zero on the first failure and the test
-- cannot pass quietly.

DO $$
DECLARE
  v_total      integer;
  v_link       text;
  v_superseded integer;
  v_survivors  integer;
  v_ok         boolean;
BEGIN
  -- ---- nothing was deleted -------------------------------------------
  SELECT count(*) INTO v_total FROM "WorkerJob";
  IF v_total <> 14 THEN
    RAISE EXCEPTION 'rows were deleted or added: expected 14 WorkerJob rows, found %', v_total;
  END IF;

  -- ---- backfill: the live run is linked -------------------------------
  SELECT "scrapeRunId" INTO v_link FROM "WorkerJob" WHERE id = 'W_LIVE';
  IF v_link IS DISTINCT FROM 'RUN_LIVE' THEN
    RAISE EXCEPTION 'W_LIVE should link to RUN_LIVE, got %', coalesce(v_link, '<null>');
  END IF;

  -- ---- backfill: a deleted run must NOT be written --------------------
  -- This is the whole reason the backfill carries a WHERE EXISTS. Writing the
  -- id would assert that a run is there when it is not.
  SELECT "scrapeRunId" INTO v_link FROM "WorkerJob" WHERE id = 'W_DEAD';
  IF v_link IS NOT NULL THEN
    RAISE EXCEPTION 'W_DEAD names a deleted run and must stay NULL, got %', v_link;
  END IF;

  -- ---- payload shapes that carry no id --------------------------------
  FOR v_link IN SELECT id FROM "WorkerJob" WHERE id IN ('W_NOPAY','W_EMPTY','W_NULLKEY') LOOP
    SELECT "scrapeRunId" IS NULL INTO v_ok FROM "WorkerJob" WHERE id = v_link;
    IF NOT v_ok THEN
      RAISE EXCEPTION '% has no usable scrapeRunId in its payload and must stay NULL', v_link;
    END IF;
  END LOOP;

  -- ---- dedupe: newest active row per (siteId, type) survives ----------
  SELECT count(*) INTO v_superseded
  FROM "WorkerJob" WHERE error = 'superseded: a newer active job exists for this site and type';
  IF v_superseded <> 3 THEN
    RAISE EXCEPTION 'expected 3 superseded rows (S2 old+mid, one of the S3 tie), found %', v_superseded;
  END IF;

  SELECT status INTO v_link FROM "WorkerJob" WHERE id = 'W_S2_NEW';
  IF v_link <> 'PENDING' THEN
    RAISE EXCEPTION 'the newest S2 SCRAPE job must survive, got %', v_link;
  END IF;

  SELECT status INTO v_link FROM "WorkerJob" WHERE id = 'W_S2_ANLZ';
  IF v_link <> 'PENDING' THEN
    RAISE EXCEPTION 'the S2 ANALYSIS job is a different type and must survive, got %', v_link;
  END IF;

  -- ---- the tie leaves exactly one -------------------------------------
  SELECT count(*) INTO v_survivors
  FROM "WorkerJob"
  WHERE "siteId" = 'S3' AND status IN ('PENDING','IN_PROGRESS');
  IF v_survivors <> 1 THEN
    RAISE EXCEPTION 'the createdAt tie must leave exactly 1 active row, found % (0 = both discarded, 2 = index would not create)', v_survivors;
  END IF;

  -- ---- terminal rows are untouched ------------------------------------
  SELECT count(*) INTO v_survivors
  FROM "WorkerJob" WHERE id IN ('W_S4_DONE','W_S4_FAIL') AND error IS NULL;
  IF v_survivors <> 2 THEN
    RAISE EXCEPTION 'COMPLETED/FAILED rows must not be relabelled; % of 2 left clean', v_survivors;
  END IF;

  SELECT status INTO v_link FROM "WorkerJob" WHERE id = 'W_S4_LIVE';
  IF v_link <> 'PENDING' THEN
    RAISE EXCEPTION 'the only active S4 job must survive, got %', v_link;
  END IF;

  -- ---- the superseded rows are closed properly ------------------------
  SELECT count(*) INTO v_survivors
  FROM "WorkerJob"
  WHERE error LIKE 'superseded:%' AND (status <> 'FAILED' OR "completedAt" IS NULL);
  IF v_survivors <> 0 THEN
    RAISE EXCEPTION '% superseded row(s) are not FAILED with a completedAt', v_survivors;
  END IF;

  RAISE NOTICE 'backfill + dedupe assertions passed';
END $$;

-- ---- the partial unique index exists and is enforced --------------------
DO $$
DECLARE
  v_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'WorkerJob' AND indexname = 'worker_job_one_active_per_site_type'
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'the partial unique index was not created';
  END IF;
END $$;

-- A second active job for a site+type must now be refused. Wrapped so the
-- expected failure is caught and turned into a pass.
DO $$
BEGIN
  INSERT INTO "WorkerJob" (id, "siteId", type, status, "createdAt")
  VALUES ('W_DUPE_ATTEMPT', 'S4', 'SCRAPE', 'PENDING', NOW());
  RAISE EXCEPTION 'a second active SCRAPE job for S4 was ACCEPTED — the index is not enforcing';
EXCEPTION
  WHEN unique_violation THEN
    RAISE NOTICE 'a duplicate active job is refused by the index, as intended';
END $$;

-- ...but a terminal one is still allowed, or the queue could never move on.
DO $$
BEGIN
  INSERT INTO "WorkerJob" (id, "siteId", type, status, "createdAt")
  VALUES ('W_DONE_EXTRA', 'S4', 'SCRAPE', 'COMPLETED', NOW());
  RAISE NOTICE 'a terminal row alongside an active one is still allowed';
END $$;

-- ---- the sweep tables exist --------------------------------------------
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO v_missing
  FROM unnest(ARRAY['ScrapeSweep','ScrapeSweepItem']) AS t
  WHERE NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = t);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing sweep table(s): %', v_missing;
  END IF;

  INSERT INTO "ScrapeSweep" (id, kind, trigger, status) VALUES ('SW1', 'SCRAPE', 'manual', 'RUNNING');
  INSERT INTO "ScrapeSweepItem" (id, "sweepId", "siteId", phase, outcome, "siteStatus")
  VALUES ('SI1', 'SW1', 'S1', 'scrape', 'ok', 'ACTIVE');

  RAISE NOTICE 'sweep tables accept rows';
END $$;

-- The per-sweep/site/phase uniqueness the log depends on.
DO $$
BEGIN
  INSERT INTO "ScrapeSweepItem" (id, "sweepId", "siteId", phase, outcome, "siteStatus")
  VALUES ('SI_DUP', 'SW1', 'S1', 'scrape', 'ok', 'ACTIVE');
  RAISE EXCEPTION 'a duplicate (sweep, site, phase) row was accepted';
EXCEPTION
  WHEN unique_violation THEN
    RAISE NOTICE 'one row per sweep/site/phase, as intended';
END $$;

-- Deleting a sweep takes its items; nothing else cascades.
DO $$
DECLARE
  v_items integer;
BEGIN
  DELETE FROM "ScrapeSweep" WHERE id = 'SW1';
  SELECT count(*) INTO v_items FROM "ScrapeSweepItem" WHERE "sweepId" = 'SW1';
  IF v_items <> 0 THEN
    RAISE EXCEPTION 'sweep items survived their sweep (% left)', v_items;
  END IF;
  RAISE NOTICE 'sweep items cascade with their sweep';
END $$;

SELECT 'ALL MIGRATION ASSERTIONS PASSED' AS result;
