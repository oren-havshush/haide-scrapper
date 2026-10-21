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
 * --site writes only that site's .json and .setup.js and leaves INDEX.md alone
 * (it used to regenerate the index from that one site, LRN-API-4). A full
 * export regenerates INDEX.md, skips a file whose only change would be
 * `_exportedAt`, and refuses to overwrite a file whose config is newer than the
 * one it fetched (another session's uncommitted export); scripts/lib/configMirror.ts.
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
import { mdCell, planMirrorWrite, writesIndex } from "./lib/configMirror";

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
  let unchanged = 0;
  let refusedNewer = 0;

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

    const jsonPath = path.join(OUT_DIR, `${slug}.json`);
    const scriptPath = path.join(OUT_DIR, `${slug}.setup.js`);
    const scriptText = setupScript ? (setupScript.endsWith("\n") ? setupScript : setupScript + "\n") : null;
    const readOrNull = (p: string) => {
      try {
        return fs.readFileSync(p, "utf8");
      } catch {
        return null;
      }
    };
    const plan = planMirrorWrite(readOrNull(jsonPath), readOrNull(scriptPath), doc, scriptText);
    if (plan === "refuse_newer") {
      refusedNewer++;
      console.log(`  ! ${slug}: the mirror on disk is from a newer config than the one fetched — left as it is`);
    } else if (plan === "skip_identical") {
      unchanged++;
    } else if (!dryRun) {
      fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
      if (scriptText) fs.writeFileSync(scriptPath, scriptText, "utf8");
    }
    // How many listing pages this site scrapes: 1 unless it has listingUrls.
    const listingUrls = (meta as { listingUrls?: unknown } | undefined)?.listingUrls;
    const pages = Array.isArray(listingUrls) && listingUrls.length > 0 ? listingUrls.length : 1;
    // Every cell escaped: a "|" in a company name split its row (Gal HR).
    const cells = [site.companyName ?? "*(none)*", site.status, `${fieldCount}`, setupScript ? `${setupScript.length}` : "—", `${pages}`, `\`${slug}\``];
    index.push(`| ${cells.map(mdCell).join(" | ")} |`);
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
    "(`kahane` held a pre-2026-08-13 setupScript that flattened descriptions). After a",
    "config change run `--site <id>` (that site's files only; this index is left alone) or",
    "the full export (which also regenerates this index). The export skips a file whose only",
    "change would be `_exportedAt`, and never overwrites a file from a newer config than the",
    "one it fetched. Anything else in a diff is drift that was never mirrored. Cite: `LRN-API-4`.",
    "",
    "Restore: PUT to `/api/sites/{id}/config` a body built from the JSON, not the file as",
    "it is. The save is strict (H3, 2026-10-14): an unknown key is a 400 that names it,",
    "where it used to be dropped silently. So leave out the file's own keys (`_exportedAt`,",
    "`_note`, `id`, `siteUrl`, `companyName`, `status`, `setupScriptFile`); take",
    "`fieldMappings` without its `_meta`; send every key of `_meta` except `savedAt` at the",
    "TOP level, `setupScript` included (from the matching `.setup.js`) — `saveSiteConfig`",
    "rebuilds `_meta` from the top-level keys, and a `_meta` sent inside `fieldMappings` is",
    "refused. This is how `listingUrls` gets back too: on a site whose Pages column is above",
    "1, leaving it out turns a company's several listing pages back into one. Then run",
    "`addsite-batch.ts verify-config --expect-file <the body>`, which compares every key sent.",
    "",
    "| Company | Status | Fields | setupScript chars | Pages | File |",
    "| --- | --- | --- | --- | --- | --- |",
    ...index,
    "",
  ].join("\n");
  // Only an export that saw every site may regenerate the index; a per-site
  // export would delete every other row (LRN-API-4).
  if (!dryRun && writesIndex({ oneSite })) fs.writeFileSync(path.join(OUT_DIR, "INDEX.md"), md, "utf8");

  console.log(
    `\nexported ${sites.length - failed} site(s)\n` +
      `  with a setupScript : ${withScript}\n` +
      `  with no config yet : ${noConfig}\n` +
      `  unchanged, skipped : ${unchanged}\n` +
      `  newer on disk, kept: ${refusedNewer}\n` +
      `  fetch failures     : ${failed}` +
      (oneSite ? "\n  INDEX.md           : left alone (--site)" : ""),
  );
  if (dryRun) console.log("\nDRY RUN — nothing written.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
