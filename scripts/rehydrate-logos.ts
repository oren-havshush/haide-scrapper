/**
 * scripts/rehydrate-logos.ts — refill the company-logo volume from provenance.
 *
 *   npx tsx scripts/rehydrate-logos.ts --dry-run
 *   npx tsx scripts/rehydrate-logos.ts [--limit 200] [--concurrency 3]
 *   npx tsx scripts/rehydrate-logos.ts --site <siteId>
 *
 * Flags:
 *   --dry-run         Report what is missing, upload nothing.
 *   --site <id>       Just this one site.
 *   --limit <N>       Cap how many sites are examined. Default: 500.
 *   --concurrency <N> Sites in flight at once. Default: 3.
 *   --force           Re-download even when the logo is already being served.
 *
 * WHY THIS EXISTS: company logos live in the `company_logos` named Docker
 * volume (docker-compose.yml), not in the database and not in the git tree. The
 * volume survives `docker compose build` and deploy.sh's rsync --delete, but it
 * does NOT survive `docker compose down -v` or a host migration. Site
 * .companyLogoSourceUrl is retained for exactly this moment: it is the only
 * record of where each logo came from.
 *
 * This is a REPAIR tool, not a refresh. It only ever re-fetches the URL already
 * recorded for a site — it never goes looking for a new logo, and it never
 * touches any other company field. A site whose source URL has since gone dead
 * is reported and skipped; recapturing it is scripts/company-profile.ts's job.
 *
 * Bytes are downloaded HERE and uploaded as raw bytes, through the same
 * scripts/lib/fetch-image.ts guards and the same server-side magic-byte
 * validation as the original capture. The server still never fetches a URL.
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fetchImage, ImageRejected } from "./lib/fetch-image";

const BASE = process.env.SCRAP_BASE ?? "https://scrapper.haide-jobs.co.il";
const TOKEN_PATH = path.join(process.cwd(), ".claude", "scrap-token");
const HEAD_TIMEOUT_MS = 10_000;

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function intArg(name: string, fallback: number): number {
  const raw = arg(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`--${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return n;
}

let cachedToken: string | null = null;
function token(): string {
  if (cachedToken === null) cachedToken = readFileSync(TOKEN_PATH, "utf8").trim();
  return cachedToken;
}

interface SiteRow {
  id: string;
  siteUrl: string;
  companyName: string | null;
  companyLogoPath: string | null;
  companyLogoSourceUrl: string | null;
}

async function api<T>(
  method: string,
  pathname: string,
  body?: Uint8Array,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, ...headers },
    body: body === undefined ? undefined : Buffer.from(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${pathname} -> ${res.status} ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

/** Sites that claim a logo, i.e. every row this tool could possibly repair. */
async function sitesWithLogos(limit: number): Promise<SiteRow[]> {
  const single = arg("site");
  if (single) {
    // NOT `GET /api/sites/:id` — that route exposes only PATCH and DELETE and
    // answers a GET with 405. The company-profile sub-resource returns
    // COMPANY_PROFILE_SELECT, which carries companyLogoPath and
    // companyLogoSourceUrl, i.e. exactly what this tool repairs from.
    const res = await api<{ data: SiteRow }>("GET", `/api/sites/${single}/company-profile`);
    return [res.data];
  }

  const out: SiteRow[] = [];
  for (let page = 1; out.length < limit; page++) {
    const res = await api<{ data: SiteRow[] }>("GET", `/api/sites?page=${page}&pageSize=100`);
    if (res.data.length === 0) break;
    for (const site of res.data) {
      if (site.companyLogoPath) out.push(site);
      if (out.length >= limit) break;
    }
    if (res.data.length < 100) break;
  }
  return out;
}

/**
 * Is the logo actually being served right now?
 *
 * The database column is not evidence — that is the entire failure mode this
 * tool repairs. Ask the server that serves it.
 */
async function isLogoServed(logoPath: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${logoPath}`, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "manual",
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

type Outcome = "OK_ALREADY_SERVED" | "REHYDRATED" | "WOULD_REHYDRATE" | "NO_SOURCE_URL" | "FAILED";

interface Result {
  siteId: string;
  companyName: string | null;
  logoPath: string;
  outcome: Outcome;
  detail?: string;
}

async function repair(site: SiteRow, dryRun: boolean, force: boolean): Promise<Result> {
  const logoPath = site.companyLogoPath as string;
  const base: Result = { siteId: site.id, companyName: site.companyName, logoPath, outcome: "FAILED" };

  if (!force && (await isLogoServed(logoPath))) {
    return { ...base, outcome: "OK_ALREADY_SERVED" };
  }

  if (!site.companyLogoSourceUrl) {
    // Nothing to re-fetch from. Recapturing needs scripts/company-profile.ts,
    // which is a different decision than "repair what we already had".
    return {
      ...base,
      outcome: "NO_SOURCE_URL",
      detail: "companyLogoSourceUrl is NULL — re-run company-profile.ts --force to recapture",
    };
  }

  if (dryRun) {
    return { ...base, outcome: "WOULD_REHYDRATE", detail: site.companyLogoSourceUrl };
  }

  try {
    const image = await fetchImage(site.companyLogoSourceUrl);
    const uploaded = await api<{ data: { logoPath: string } }>(
      "POST",
      `/api/sites/${site.id}/company-logo`,
      image.bytes,
      {
        "Content-Type": image.contentType,
        "x-logo-source-url": image.finalUrl.slice(0, 1_000),
      },
    );
    return {
      ...base,
      outcome: "REHYDRATED",
      detail: `${uploaded.data.logoPath} (${image.inspection.byteLength}B)`,
    };
  } catch (error) {
    return {
      ...base,
      outcome: "FAILED",
      detail:
        error instanceof ImageRejected
          ? `source rejected (${error.reason}): ${site.companyLogoSourceUrl}`
          : error instanceof Error
            ? error.message
            : String(error),
    };
  }
}

async function main() {
  const dryRun = flag("dry-run");
  const force = flag("force");
  const limit = intArg("limit", 500);
  const concurrency = intArg("concurrency", 3);

  const sites = await sitesWithLogos(limit);
  if (sites.length === 0) {
    console.log("[rehydrate-logos] no site currently records a companyLogoPath");
    return;
  }

  console.log(
    `[rehydrate-logos] checking ${sites.length} site(s) with a logo, concurrency ${concurrency}` +
      `${dryRun ? " — DRY RUN (uploads nothing)" : ""}${force ? " — FORCE (ignores what is served)" : ""}`,
  );

  const results: Result[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, sites.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= sites.length) return;
        const result = await repair(sites[index], dryRun, force);
        results.push(result);
        // A served logo is the boring majority — only print the interesting rows.
        if (result.outcome !== "OK_ALREADY_SERVED") {
          console.log(
            `[rehydrate-logos] ${result.outcome.padEnd(18)} ${result.siteId} ` +
              `${result.companyName ?? ""} ${result.logoPath}` +
              (result.detail ? ` :: ${result.detail}` : ""),
          );
        }
      }
    }),
  );

  const count = (outcome: Outcome) => results.filter((r) => r.outcome === outcome).length;
  console.log(
    JSON.stringify(
      {
        checked: results.length,
        alreadyServed: count("OK_ALREADY_SERVED"),
        rehydrated: count("REHYDRATED"),
        wouldRehydrate: count("WOULD_REHYDRATE"),
        noSourceUrl: count("NO_SOURCE_URL"),
        failed: count("FAILED"),
      },
      null,
      2,
    ),
  );

  // Exit 2 on an unrepaired gap so a deploy script can notice.
  if (count("FAILED") > 0 || count("NO_SOURCE_URL") > 0) process.exit(2);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
