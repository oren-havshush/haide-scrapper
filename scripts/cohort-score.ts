// The addsite2 → addsite3 comparison (addsite2 phase two, step 7). Read-only:
// two GETs through the API, nothing written.
//
//   npx tsx scripts/cohort-score.ts [--now <iso>]
//
// Prints control (addsite2, frozen) against test (addsite3) per site — items,
// distinct fields, estimated minutes, final status — the medians and means,
// the CHECK items on codes live across both windows only, and how many control
// windows have completed and the date the tenth will (the switch date). The
// scoring is src/lib/fixScore.ts; the rest is scripts/lib/cohortScore.ts.
// Uses the token in .claude/scrap-token; the token is never printed.

import fs from "node:fs";
import path from "node:path";
import { buildCohortReport, formatCohortReport, type ApiItem, type ApiSite } from "./lib/cohortScore";

const BASE_URL = "https://scrapper.haide-jobs.co.il";
const TOKEN_PATH = path.join(process.cwd(), ".claude", "scrap-token");
const PAGE_SIZE = 100;

function readToken(): string {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(`Missing ${TOKEN_PATH} — paste the prod API token into that file.`);
  }
  const t = fs.readFileSync(TOKEN_PATH, "utf8").replace(/\s/g, "");
  if (!t || t.startsWith("REPLACE_ME")) {
    throw new Error(".claude/scrap-token is empty or still contains the placeholder.");
  }
  return t;
}

async function get<T>(route: string, token: string): Promise<T> {
  const r = await fetch(`${BASE_URL}${route}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await r.text();
  if (!r.ok) throw new Error(`GET ${route} -> ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

/** Every site, page by page: a cohort site with no fix item is still a site. */
async function allSites(token: string): Promise<ApiSite[]> {
  const out: ApiSite[] = [];
  for (let page = 1; ; page++) {
    const body = await get<{ data: ApiSite[]; meta: { total: number } }>(
      `/api/sites?page=${page}&pageSize=${PAGE_SIZE}&sortBy=createdAt&sortOrder=asc`,
      token,
    );
    out.push(...body.data);
    if (body.data.length === 0 || out.length >= body.meta.total) return out;
  }
}

function parseNow(argv: string[]): Date {
  const i = argv.indexOf("--now");
  if (i === -1) return new Date();
  const d = new Date(argv[i + 1] ?? "");
  if (Number.isNaN(d.getTime())) throw new Error("--now needs an ISO date");
  return d;
}

(async () => {
  const now = parseNow(process.argv.slice(2));
  const token = readToken();
  const [sites, queue] = await Promise.all([
    allSites(token),
    get<{ data: ApiItem[] }>("/api/dashboard/fix-queue", token),
  ]);
  const report = buildCohortReport({ sites, items: queue.data, now });
  for (const line of formatCohortReport(report)) console.info(line);
})().catch((e) => {
  console.error(`cohort-score: ${(e as Error).message}`);
  process.exit(1);
});
