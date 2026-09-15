// Run: npx tsx src/lib/listingRun.test.ts
//
// The dashboard's run for a site is the latest scrape run that OWNS ROWS, not
// the latest run.
//
// 2026-09-15: maccabi4u's 433 listings were restored under their original run
// (2026-08-13). A newer run (the 01:36 sweep run whose 8 rows were removed)
// still existed, owned nothing, and was "latest" — so the jobs page showed the
// site with 0 listings while 433 were published. The same default hides the
// kept listings of every site whose newest run wrote nothing: silent drift, and
// every drop the undersize guard refuses.
//
// No database is reachable from a test here, so the queries run against an
// in-memory store that implements exactly the Prisma arguments they use — and
// THROWS on any it does not, so a changed query cannot pass by being ignored.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findListingRunId, findListingRunsBySiteIds, type ListingRunDb } from "./listingRun";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

async function check(name: string, body: () => Promise<void>) {
  try {
    await body();
  } catch (err) {
    console.error(`FAIL: ${name} threw: ${(err as Error).message}`);
    failures++;
  }
}

// ---------------------------------------------------------------------------
// The fixture: the newest run is empty, an older one has the rows
// ---------------------------------------------------------------------------

type Run = { id: string; siteId: string; createdAt: Date; completedAt: Date | null; warnings: string[] | null };

const RUNS: Run[] = [
  // maccabi4u, as it stands after the restore.
  { id: "m-0811", siteId: "maccabi", createdAt: new Date("2026-08-11T16:01:35Z"), completedAt: new Date("2026-08-11T16:03:00Z"), warnings: null },
  { id: "m-0813", siteId: "maccabi", createdAt: new Date("2026-08-13T15:49:28Z"), completedAt: new Date("2026-08-13T15:50:33Z"), warnings: ["region_over_city: 130"] },
  { id: "m-0915", siteId: "maccabi", createdAt: new Date("2026-09-15T01:36:14Z"), completedAt: new Date("2026-09-15T01:36:36Z"), warnings: ["job_count_drop: 8 saved vs previous 433 (-98%)"] },
  // A healthy site: the newest run owns the rows.
  { id: "h-1", siteId: "healthy", createdAt: new Date("2026-09-14T00:00:00Z"), completedAt: null, warnings: null },
  { id: "h-2", siteId: "healthy", createdAt: new Date("2026-09-15T00:00:00Z"), completedAt: new Date("2026-09-15T00:01:00Z"), warnings: null },
  // A site with runs and no listings at all.
  { id: "e-1", siteId: "empty", createdAt: new Date("2026-09-15T00:00:00Z"), completedAt: null, warnings: null },
];

/** Job rows: scrapeRunId -> count. Only m-0813 and h-2 own anything. */
const ROWS: Record<string, number> = { "m-0813": 433, "h-2": 12 };

function makeDb(): ListingRunDb {
  const matches = (run: Run, where: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(where)) {
      if (key === "siteId") {
        if (typeof value === "string") {
          if (run.siteId !== value) return false;
        } else if (value && typeof value === "object" && Array.isArray((value as { in?: unknown }).in)) {
          if (!(value as { in: string[] }).in.includes(run.siteId)) return false;
        } else {
          throw new Error(`unsupported siteId filter ${JSON.stringify(value)}`);
        }
      } else if (key === "jobs") {
        if (JSON.stringify(value) !== JSON.stringify({ some: {} })) {
          throw new Error(`unsupported jobs filter ${JSON.stringify(value)}`);
        }
        if (!((ROWS[run.id] ?? 0) > 0)) return false;
      } else {
        throw new Error(`unsupported where key "${key}"`);
      }
    }
    return true;
  };

  const project = (run: Run, select: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(select)) {
      if (key === "_count") {
        if (JSON.stringify(value) !== JSON.stringify({ select: { jobs: true } })) {
          throw new Error(`unsupported _count ${JSON.stringify(value)}`);
        }
        out._count = { jobs: ROWS[run.id] ?? 0 };
      } else if (["id", "siteId", "createdAt", "completedAt", "warnings"].includes(key) && value === true) {
        out[key] = run[key as keyof Run];
      } else {
        throw new Error(`unsupported select key "${key}"`);
      }
    }
    return out;
  };

  const query = (args: Record<string, unknown>) => {
    for (const key of Object.keys(args)) {
      if (!["where", "orderBy", "select"].includes(key)) throw new Error(`unsupported argument "${key}"`);
    }
    if (JSON.stringify(args.orderBy) !== JSON.stringify({ createdAt: "desc" })) {
      throw new Error(`unsupported orderBy ${JSON.stringify(args.orderBy)}`);
    }
    return RUNS.filter((r) => matches(r, (args.where ?? {}) as Record<string, unknown>))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => project(r, (args.select ?? {}) as Record<string, unknown>));
  };

  return {
    scrapeRun: {
      findFirst: async (args: Record<string, unknown>) => query(args)[0] ?? null,
      findMany: async (args: Record<string, unknown>) => query(args),
    },
  } as unknown as ListingRunDb;
}

async function main() {
  await check("one site", async () => {
    const db = makeDb();
    assert(
      (await findListingRunId(db, "maccabi")) === "m-0813",
      "maccabi4u: the older run that owns the 433 rows, not the empty 01:36 run",
    );
    assert((await findListingRunId(db, "healthy")) === "h-2", "a healthy site: its newest run, which owns the rows");
    assert((await findListingRunId(db, "empty")) === null, "a site with no listings has no listing run");
    assert((await findListingRunId(db, "nope")) === null, "nor does an unknown site");
  });

  await check("many sites", async () => {
    const db = makeDb();
    const map = await findListingRunsBySiteIds(db, ["maccabi", "healthy", "empty"]);
    assert(map.get("maccabi")?.id === "m-0813", "maccabi4u's listing run is the 08-13 run");
    assert(map.get("maccabi")?.listingCount === 433, `with the rows it owns, 433 (got ${map.get("maccabi")?.listingCount})`);
    assert(
      map.get("maccabi")?.completedAt?.toISOString() === "2026-08-13T15:50:33.000Z",
      "and that run's completion time, not the empty run's",
    );
    assert(
      JSON.stringify(map.get("maccabi")?.warnings) === JSON.stringify(["region_over_city: 130"]),
      "and that run's warnings — they describe the rows being shown",
    );
    assert(map.get("healthy")?.id === "h-2" && map.get("healthy")?.listingCount === 12, "a healthy site: newest run, 12");
    assert(!map.has("empty"), "a site with no listings is absent, so the table shows no count");
    assert((await findListingRunsBySiteIds(db, [])).size === 0, "no sites, no query result");
  });

  // -------------------------------------------------------------------------
  // The dashboard asks this module, not its own "latest run"
  // -------------------------------------------------------------------------

  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const route = strip(readFileSync(join(__dirname, "..", "app", "api", "jobs", "route.ts"), "utf8"));
  const sites = strip(readFileSync(join(__dirname, "..", "services", "siteService.ts"), "utf8"));
  const table = strip(readFileSync(join(__dirname, "..", "components", "sites", "SitesTable.tsx"), "utf8"));

  assert(route.length > 500 && sites.length > 500 && table.length > 500, "the sources were actually read");
  assert(route.includes("findListingRunId("), "the jobs route defaults a site to its listing run");
  assert(!/scrapeRun\.findFirst\(/.test(route), "and no longer picks a run of its own");

  const listSites = sites.slice(sites.indexOf("export async function listSites"), sites.indexOf("export async function getStatusCounts"));
  assert(listSites.length > 200, "listSites was extracted");
  assert(listSites.includes("findListingRunsBySiteIds("), "the sites list attaches each site's listing run");
  assert(/listingRun:/.test(listSites), "as listingRun");

  const indicator = table.slice(table.indexOf("function ScrapeStatusIndicator"), table.indexOf("export function SitesTable"));
  assert(indicator.length > 200, "ScrapeStatusIndicator was extracted");
  assert(indicator.includes("listingRun.listingCount"), "the table's count is the listing run's");
  assert(!/scrapeRun\??\.jobCount/.test(indicator), "never the latest run's jobCount");

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.info("listingRun: a site's listings are the latest run that owns rows");
}

main();
