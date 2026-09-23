-- A manual location override is keyed by (siteId, jobKey), and jobKey is
-- `externalJobId ?? detailUrl`. On a site with no id mapping that key is a
-- synthesised `h-<hash>` — and a hash is only as stable as the config that
-- seeds it. halilit re-keyed 6 of its 7 jobs across one config change.
--
-- When that happens the override stops matching anything and becomes a row
-- that says: site X, key h-1p1cu0x, location חיפה. Nobody can tell what job an
-- operator meant, so nobody can re-apply it or delete it with confidence.
--
-- The title it was set against is the one piece of information that keeps it
-- readable. Additive and nullable: existing overrides stay NULL, which is
-- honest — the title was not recorded when they were written.

ALTER TABLE "JobLocationOverride"
  ADD COLUMN "jobTitle" TEXT;
