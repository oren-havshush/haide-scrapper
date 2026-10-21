/**
 * scripts/setup-script-dryrun.ts — a worker-faithful dry run of one site's
 * setupScript against its live listing page (report fixes 3, item 16b).
 *
 *   npx tsx scripts/setup-script-dryrun.ts --site <id> [--script <file>] [--listing-url <url>] [--fail <text>] [--out <file>]
 *
 *   --site <id>          the site whose stored config (fieldMappings, pageFlow,
 *                        browserOverrides) is read through the API, GET only
 *   --script <file>      run this script instead of the stored one (a candidate)
 *   --listing-url <url>  the page to load (default: the first pageFlow step, else siteUrl)
 *   --fail <text>        abort every request whose URL contains <text>: a failure
 *                        run, which fails when it aborted nothing. From Git Bash
 *                        set MSYS_NO_PATHCONV=1, or a value like "/noc/" is
 *                        rewritten into a Windows path and matches nothing
 *                        (LRN-SETUP-31).
 *   --out <file>         write the report as JSON
 *
 * What it does is scripts/lib/setupDryRun.ts: a planted cookie, cookies counted
 * with allHeaders(), every non-GET and every filtered request aborted and
 * logged, the worker's own extraction, location map, normaliser, validator and
 * id fallback. Read-only on the employer's side: GET only, no click. Writes
 * nothing to our database. Exit 0 = the run's checks passed; 1 = they did not.
 */
import fs from "node:fs";
import path from "node:path";
import { setupScriptDryRun } from "./lib/setupDryRun";

const BASE = process.env.SCRAP_BASE ?? "https://scrapper.haide-jobs.co.il";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function apiGet<T>(p: string, token: string): Promise<T> {
  const r = await fetch(`${BASE}${p}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`GET ${p}: ${r.status}`);
  return (await r.json()) as T;
}

async function main() {
  const siteId = arg("site");
  if (!siteId) throw new Error("--site <id> is required");
  const token = fs.readFileSync(path.join(".claude", "scrap-token"), "utf8").replace(/\s/g, "");

  const cfg = (await apiGet<{ data: { fieldMappings: Record<string, unknown>; pageFlow?: Array<{ url?: string }> } }>(`/api/sites/${siteId}/config`, token)).data;
  const site = (await apiGet<{ data: { siteUrl: string } }>(`/api/sites/${siteId}`, token)).data;
  const scriptFile = arg("script");
  const meta = (cfg.fieldMappings?._meta ?? {}) as { setupScript?: string | null; browserOverrides?: Record<string, unknown> | null };
  const setupScript = scriptFile ? fs.readFileSync(scriptFile, "utf8") : (meta.setupScript ?? null);
  const listingUrl = arg("listing-url") ?? cfg.pageFlow?.[0]?.url ?? site.siteUrl;

  // The worker's own browser and identity (worker/lib/playwright.ts).
  const { launchBrowser, createPage, closeBrowser } = await import("../worker/lib/playwright");
  const browser = await launchBrowser();
  try {
    const { page } = await createPage(browser, (meta.browserOverrides ?? undefined) as never);
    const report = await setupScriptDryRun(page, { listingUrl, fieldMappings: cfg.fieldMappings, setupScript, failFilter: arg("fail") ?? null });
    const outFile = arg("out");
    if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + "\n");

    const c = report.cookies;
    console.log(`[dryrun] ${listingUrl}`);
    console.log(`[dryrun] script ${report.script}${scriptFile ? ` (${scriptFile})` : " (stored)"}; records ${report.records}, valid ${report.valid}`);
    console.log(`[dryrun] cookies: navigations ${c.navigationsWithCookie}/${c.navigations} (planted ${c.planted}), fetches ${c.fetchesWithCookie}/${c.fetches}`);
    for (const u of c.fetchUrlsWithCookie.slice(0, 10)) console.log(`[dryrun]   cookie sent: ${u}`);
    console.log(`[dryrun] aborted ${report.aborted.length}`);
    for (const a of report.aborted) console.log(`[dryrun]   aborted (${a.why}) ${a.method} ${a.url.slice(0, 160)}`);
    const kinds = report.ids.reduce<Record<string, number>>((m, i) => ((m[i.kind] = (m[i.kind] ?? 0) + 1), m), {});
    console.log(`[dryrun] ids: ${JSON.stringify(kinds)}; first ${JSON.stringify(report.ids.slice(0, 3).map((i) => i.id))}`);
    if (!report.verdict.ok) {
      for (const p of report.verdict.problems) console.log(`[dryrun] FAIL: ${p}`);
      process.exitCode = 1;
    } else {
      console.log("[dryrun] OK");
    }
  } finally {
    await closeBrowser(browser);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
