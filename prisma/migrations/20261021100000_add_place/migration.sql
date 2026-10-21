-- Place (report fixes 3, item 18): every place in "CSV files/city.csv", for
-- the public site to read nightly. Created empty; scripts/sync-places.ts,
-- which deploy.sh runs right after the migrations, fills it from the CSV. No
-- backfill here: the CSV is the source, and only the sync reads it.

-- CreateTable
CREATE TABLE "Place" (
    "name" TEXT NOT NULL,
    "region" TEXT,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Place_pkey" PRIMARY KEY ("name")
);
