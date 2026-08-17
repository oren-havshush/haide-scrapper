/**
 * Mirror every site's scraping config out of the database and into the repo.
 *
 * The database is the runtime source of truth — the worker reads
 * `site.fieldMappings` and never looks at `sites/`. That means a config has
 * exactly one copy, and a re-analyze overwrites it with no undo (see
 * `sites/iec/notes.md` §4 for the incident this exists to prevent). This script
 * gives every config a second, diffable copy in git.
 *
 *   npx tsx scripts/export-site-configs.ts                 # all ACTIVE sites
 *   npx tsx scripts/export-site-configs.ts --all-statuses  # every site
 *   npx tsx scripts/export-site-configs.ts --site <id>     # just one
 *
 * CAUTION (LRN-API-4): --site regenerates INDEX.md from ONLY that site, deleting
 * every other row. Prefer the full export; if you must use --site, restore
 * INDEX.md afterwards or edit its single row by hand. Note also that every run
 * rewrites `_exportedAt` on all files, so a full export always looks like a
 * ~140-file change — diff past that noise to find the real drift.
 *   npx tsx scripts/export-site-configs.ts --dry-run       # report, write nothing
 *
 * Output, one pair per site under sites/_configs/:
 *   <slug>.json      the config, minus setupScript — readable, small diffs
 *   <slug>.setup.js  the setupScript verbatim — kept separate so changes to it
 *                    show as real line diffs instead of one escaped JSON blob
 *
 * Restoring is a PUT of the JSON (plus setupScript) back to
 * /api/sites/{id}/config — see notes.md in any site bucket.
 */
import * as fs from "fs";
import * as path from "path";

const BASE = "https://scrapper.haide-jobs.co.il";
const PAGE_SIZE = 100; // LRN-API-1: >100 silently returns []
const OUT_DIR = path.resolve("sites", "_configs");

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

type Site = {
  id: string;
  siteUrl: string;
  companyName: string | null;
  status: string;
};

/**
 * Stable, readable filename per site. Derived from the host so it stays put
 * across renames of companyName, with the site id appended because two hosts
 * can reduce to the same label (careers.x.co.il and jobs.x.com).
 */
function slugFor(site: Site): string {
  let host: string;
  try {
    host = new URL(site.siteUrl).hostname;
  } catch {
    host = site.siteUrl;
  }
  const label =
    host
      .replace(/^www\./, "")
      .replace(/^(careers?|jobs?|hr|drushim|recruit)\./, "")
      .replace(/\.(co|org|net|ac|gov)?\.?(il|com|net|org)$/, "")
      .replace(/[^a-z0-9.-]/gi, "-")
      .replace(/\.+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "site";
  return `${label}--${site.id.slice(-6)}`;
}

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

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const allStatuses = args.includes("--all-statuses");
  const oneSite = args.includes("--site")
    ? args[args.indexOf("--site") + 1]
    : undefined;

  let sites = await fetchAllPages<Site>(
    (p) => `${BASE}/api/sites?pageSize=${PAGE_SIZE}&page=${p}`,
  );
  if (oneSite) sites = sites.filter((s) => s.id === oneSite);
  else if (!allStatuses) sites = sites.filter((s) => s.status === "ACTIVE");

  console.log(
    `${dryRun ? "DRY RUN — writing nothing" : `writing to ${OUT_DIR}`} | sites: ${sites.length}`,
  );
  if (!dryRun) fs.mkdirSync(OUT_DIR, { recursive: true });

  const index: string[] = [];
  let withScript = 0;
  let noConfig = 0;
  let failed = 0;

  for (const site of sites) {
    let cfg: Record<string, unknown>;
    try {
      const r = await fetch(`${BASE}/api/sites/${site.id}/config`, {
        headers: HEADERS,
      });
      if (!r.ok) throw new Error(`${r.status}`);
      cfg = ((await r.json()) as { data?: Record<string, unknown> }).data ?? {};
    } catch (e) {
      console.log(`  ! ${site.companyName ?? site.id}: fetch failed (${e})`);
      failed++;
      continue;
    }

    const fm = (cfg.fieldMappings ?? {}) as Record<string, unknown>;
    const meta = (fm._meta ?? {}) as Record<string, unknown>;
    const setupScript = (meta.setupScript as string) ?? "";
    const fieldCount = Object.keys(fm).filter((k) => k !== "_meta").length;
    if (fieldCount === 0 && !setupScript) noConfig++;
    if (setupScript) withScript++;

    const slug = slugFor(site);
    // setupScript is split out so its diffs are readable; everything else stays
    // in the JSON exactly as the API returned it, so a restore is a straight PUT.
    const metaNoScript = { ...meta };
    delete metaNoScript.setupScript;
    const doc = {
      _exportedAt: new Date().toISOString(),
      _note:
        "Mirror of the live config. The DB is authoritative; the worker never reads this file. setupScript lives alongside in <slug>.setup.js.",
      id: site.id,
      siteUrl: site.siteUrl,
      companyName: site.companyName,
      status: site.status,
      setupScriptFile: setupScript ? `${slug}.setup.js` : null,
      pageFlow: cfg.pageFlow ?? [],
      fieldMappings: { ...fm, _meta: metaNoScript },
    };

    if (!dryRun) {
      fs.writeFileSync(
        path.join(OUT_DIR, `${slug}.json`),
        JSON.stringify(doc, null, 2) + "\n",
        "utf8",
      );
      if (setupScript)
        fs.writeFileSync(
          path.join(OUT_DIR, `${slug}.setup.js`),
          setupScript.endsWith("\n") ? setupScript : setupScript + "\n",
          "utf8",
        );
    }
    index.push(
      `| ${site.companyName ?? "*(none)*"} | ${site.status} | ${fieldCount} | ${
        setupScript ? `${setupScript.length}` : "—"
      } | \`${slug}\` |`,
    );
  }

  index.sort();
  const md = [
    "# Site config mirror",
    "",
    "Generated by `scripts/export-site-configs.ts`. **The database is authoritative** —",
    "the worker reads `site.fieldMappings` and never reads these files. They exist so a",
    "config that gets overwritten (a re-analyze clears `configLocked`, see",
    "`sites/iec/notes.md` §4) can be restored instead of rebuilt.",
    "",
    // Kept in this template, not just in the generated file: INDEX.md is
    // overwritten wholesale on every run, so a hand-added paragraph silently
    // disappears on the next full export (it did — LRN-API-4's own warning was
    // lost that way).
    "**Keeping the mirror honest.** These files go stale silently, and a stale mirror is",
    "worse than a missing one — restoring from one that predates a fix reinstates the bug",
    "(`kahane` held a pre-2026-08-13 setupScript that flattened descriptions). Run the",
    "**full** export after any config change; never `--site <id>`, which regenerates this",
    "index from that one site and deletes every other row. Ignore `_exportedAt`-only diffs;",
    "anything else is drift that was never mirrored. Cite: `LRN-API-4`.",
    "",
    "Restore: PUT the JSON back to `/api/sites/{id}/config`, adding `setupScript` from",
    "the matching `.setup.js` as a top-level field — `saveSiteConfig` rebuilds `_meta`",
    "from top-level params, so a setupScript left only inside `_meta` is dropped.",
    "",
    "| Company | Status | Fields | setupScript chars | File |",
    "| --- | --- | --- | --- | --- |",
    ...index,
    "",
  ].join("\n");
  if (!dryRun) fs.writeFileSync(path.join(OUT_DIR, "INDEX.md"), md, "utf8");

  console.log(
    `\nexported ${sites.length - failed} site(s)\n` +
      `  with a setupScript : ${withScript}\n` +
      `  with no config yet : ${noConfig}\n` +
      `  fetch failures     : ${failed}`,
  );
  if (dryRun) console.log("\nDRY RUN — nothing written.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
