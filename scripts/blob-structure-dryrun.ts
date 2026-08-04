/**
 * Read-only dry run: how many blob descriptions would `structureDescription`
 * actually repair, measured against real production data?
 *
 * Writes nothing. Fetches ACTIVE sites and their latest-run jobs via the same
 * API path as jobs-quality-audit.ts, applies the normalizer in memory, and
 * reports the before/after blob count per site.
 *
 *   npx tsx scripts/blob-structure-dryrun.ts            # all ACTIVE sites
 *   npx tsx scripts/blob-structure-dryrun.ts --top 10   # 10 worst sites only
 *   npx tsx scripts/blob-structure-dryrun.ts --samples  # print before/after text
 */
import * as fs from "fs";
import * as path from "path";
import { isBlob, structureDescription } from "../worker/lib/descriptionStructure";

const BASE = "https://scrapper.haide-jobs.co.il";
const PAGE_SIZE = 100; // LRN-API-1: >100 silently returns []

function token(): string {
  const t = fs
    .readFileSync(path.resolve(".claude", "scrap-token"), "utf8")
    .replace(/\s/g, "");
  if (!t || t.startsWith("REPLACE_ME"))
    throw new Error(".claude/scrap-token missing/placeholder");
  return t;
}

// The edge in front of the API 403s unknown user agents.
const HEADERS = {
  Authorization: `Bearer ${token()}`,
  "Content-Type": "application/json",
  "User-Agent": "curl/8.7.1",
};

async function fetchAllPages<T>(url: (p: number) => string): Promise<T[]> {
  const out: T[] = [];
  for (let p = 1; p <= 50; p++) {
    const r = await fetch(url(p), { headers: HEADERS });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} on ${url(p)}`);
    const body = (await r.json()) as { data?: T[] };
    const items = body.data ?? [];
    if (items.length === 0) break;
    out.push(...items);
    if (items.length < PAGE_SIZE) break;
  }
  return out;
}

type Site = { id: string; companyName: string | null; status: string };
type Job = { description: string | null };

async function main() {
  const args = process.argv.slice(2);
  const topN = args.includes("--top")
    ? Number(args[args.indexOf("--top") + 1])
    : Infinity;
  const showSamples = args.includes("--samples");

  const sites = (
    await fetchAllPages<Site>((p) => `${BASE}/api/sites?pageSize=${PAGE_SIZE}&page=${p}`)
  ).filter((s) => s.status === "ACTIVE");

  console.log(`ACTIVE sites: ${sites.length}\n`);

  const rows: {
    name: string;
    jobs: number;
    before: number;
    after: number;
  }[] = [];
  const samples: { name: string; before: string; after: string }[] = [];

  for (const site of sites) {
    let jobs: Job[];
    try {
      jobs = await fetchAllPages<Job>(
        (p) =>
          `${BASE}/api/jobs?siteId=${encodeURIComponent(site.id)}&pageSize=${PAGE_SIZE}&page=${p}`,
      );
    } catch {
      continue;
    }

    let before = 0;
    let after = 0;
    for (const j of jobs) {
      const d = j.description ?? "";
      if (!isBlob(d)) continue;
      before++;
      const fixed = structureDescription(d);
      if (isBlob(fixed)) after++;
      else if (showSamples && samples.length < 12) {
        samples.push({
          name: site.companyName ?? "(none)",
          before: d.slice(0, 220),
          after: fixed.slice(0, 320),
        });
      }
    }
    if (before > 0)
      rows.push({
        name: site.companyName ?? "(none)",
        jobs: jobs.length,
        before,
        after,
      });
  }

  rows.sort((a, b) => b.before - a.before);
  const shown = rows.slice(0, topN);

  console.log("Site                          jobs   blob  →  still  fixed   %");
  console.log("-".repeat(66));
  for (const r of shown) {
    const fixed = r.before - r.after;
    const pct = r.before ? Math.round((fixed / r.before) * 100) : 0;
    console.log(
      `${r.name.slice(0, 28).padEnd(30)}${String(r.jobs).padStart(4)}  ${String(
        r.before,
      ).padStart(5)}  →  ${String(r.after).padStart(5)}  ${String(fixed).padStart(5)}  ${String(
        pct,
      ).padStart(3)}%`,
    );
  }

  const totBefore = rows.reduce((a, r) => a + r.before, 0);
  const totAfter = rows.reduce((a, r) => a + r.after, 0);
  console.log("-".repeat(66));
  console.log(
    `TOTAL (all ${rows.length} sites with blobs): ${totBefore} blob → ${totAfter} remaining, ` +
      `${totBefore - totAfter} fixed (${Math.round(((totBefore - totAfter) / (totBefore || 1)) * 100)}%)`,
  );

  if (showSamples) {
    for (const s of samples) {
      console.log(`\n=== ${s.name} ===\nBEFORE: ${s.before}\nAFTER:\n${s.after}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
