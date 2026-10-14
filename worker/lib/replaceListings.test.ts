// Run: npx tsx worker/lib/replaceListings.test.ts
//
// H1 (owner, 2026-10-14): a manual run saves like a scheduled one, the delete
// and every insert in ONE transaction. A manual run used to delete every job
// first and then insert in chunks of 20, each its own transaction, so a
// timeout or an error mid-save left only the chunks already saved.
//
// 1. Behaviour: replaceListingsInTx run inside a store that commits or rolls
//    back the way Postgres does. An insert that throws leaves the old rows.
// 2. Wiring: scrape.ts has one commit, reached by manual and scheduled runs
//    alike, and no chunked path.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { replaceListingsInTx, type ListingsTx } from "./replaceListings";
import { INSERT_BATCH } from "./scheduledRun";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

type Row = { siteId: string; title: string };
type Store = { jobs: Row[]; runs: Record<string, Record<string, unknown>> };

/** A store with Postgres's all-or-nothing: the body works on a copy, kept only if it resolves. */
function makeDb(initial: Store, opts: { failOnBatch?: number } = {}) {
  let store: Store = structuredClone(initial);
  let batches = 0;
  return {
    get store() {
      return store;
    },
    async transaction<T>(body: (tx: ListingsTx<Row>) => Promise<T>): Promise<T> {
      const draft: Store = structuredClone(store);
      const tx: ListingsTx<Row> = {
        job: {
          async deleteMany(a) {
            draft.jobs = draft.jobs.filter((j) => j.siteId !== a.where.siteId);
          },
          async createMany(a) {
            batches++;
            if (opts.failOnBatch === batches) throw new Error("insert failed (connection reset)");
            draft.jobs.push(...a.data);
          },
        },
        scrapeRun: {
          async update(a) {
            draft.runs[a.where.id] = { ...(draft.runs[a.where.id] ?? {}), ...a.data };
          },
        },
      };
      const out = await body(tx);
      store = draft;
      return out;
    },
  };
}

const old: Row[] = Array.from({ length: 7 }, (_, i) => ({ siteId: "s1", title: `old ${i}` }));
const other: Row = { siteId: "s2", title: "another site's job" };
const fresh: Row[] = Array.from({ length: INSERT_BATCH + 20 }, (_, i) => ({ siteId: "s1", title: `new ${i}` }));
const args = { siteId: "s1", scrapeRunId: "r1", rows: fresh, totalJobs: fresh.length + 2, invalidJobs: 2, now: new Date("2026-10-14T13:00:00Z") };

(async () => {
  // An insert that throws on the second batch: nothing of the run lands.
  {
    const db = makeDb({ jobs: [...old, other], runs: { r1: { status: "IN_PROGRESS" } } }, { failOnBatch: 2 });
    let threw = false;
    try {
      await db.transaction((tx) => replaceListingsInTx(tx, args));
    } catch {
      threw = true;
    }
    assert(threw, "the failed insert reaches the caller");
    const s1 = db.store.jobs.filter((j) => j.siteId === "s1").map((j) => j.title);
    assert(JSON.stringify(s1) === JSON.stringify(old.map((j) => j.title)), `the old rows are all still there (got ${s1.length}: ${s1.slice(0, 3).join(", ")}…)`);
    assert(db.store.jobs.some((j) => j.siteId === "s2"), "and no other site is touched");
    assert(db.store.runs.r1.status === "IN_PROGRESS", "the run is not closed COMPLETED");
  }

  // The whole set in one go.
  {
    const db = makeDb({ jobs: [...old, other], runs: { r1: { status: "IN_PROGRESS" } } });
    await db.transaction((tx) => replaceListingsInTx(tx, args));
    const s1 = db.store.jobs.filter((j) => j.siteId === "s1");
    assert(s1.length === fresh.length && s1.every((j) => j.title.startsWith("new")), `every new row, no old one (got ${s1.length})`);
    assert(db.store.jobs.some((j) => j.siteId === "s2"), "another site's rows stay");
    const run = db.store.runs.r1;
    assert(run.status === "COMPLETED" && run.jobCount === fresh.length && run.validJobs === fresh.length, "the run closes COMPLETED with the count, in the same transaction");
    assert(run.totalJobs === fresh.length + 2 && run.invalidJobs === 2, "and the totals it was given");
  }

  // The wiring in scrape.ts.
  const raw = readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8");
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const count = (needle: string) => src.split(needle).length - 1;
  assert(count("replaceListingsInTx(tx,") === 1, "one call to the transaction body");
  assert(count("beginCommit(runMode.abort") === 1, "one commit");
  assert(/\n {2}const commit = beginCommit\(runMode\.abort, \(\) =>\n {4}prisma\.\$transaction\(/.test(src), "at function level, after the scheduled branch: manual and scheduled runs both reach it");
  const body = src.slice(src.indexOf("const commit = beginCommit(runMode.abort"), src.indexOf("await commit;"));
  assert(body.includes("replaceListingsInTx(tx,"), "the body runs inside that transaction");
  assert(count("CHUNK_SIZE") === 0 && count("tx.job.create(") === 0, "the chunked manual save is gone");
  const failStart = src.indexOf("async function failScrapeRun(");
  const failBody = src.slice(failStart, src.indexOf("\nasync function ", failStart + 10));
  assert(count("prisma.job.deleteMany(") === (failBody.includes("prisma.job.deleteMany(") ? 1 : 0), "no listing delete outside a transaction except failScrapeRun's gated one");

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("replaceListings: one transaction for every run; a failed insert keeps the old rows");
})();
