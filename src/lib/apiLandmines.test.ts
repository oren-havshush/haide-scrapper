// Run: npx tsx src/lib/apiLandmines.test.ts
//
// addsite2 phase two, step 5: the API landmines, fixed once in the API so
// addsite3 can stop teaching operators to step around them. Every fix keeps
// addsite2's documented calls working.
//
//   (j) malformed JSON is a 400 BAD_JSON, not a 500
//   (d, h, i) a zod failure is a 400 VALIDATION_ERROR naming the path, so
//       pageSize over 100 is a 400 and not a 500 a caller reads as []
//   (a) a site PATCH naming more than one of companyName/adminNote/status is a
//       400 naming them, through the pure pickSitePatchAction
//   (b) POST /api/sites stores companyName
//   (c) GET /api/sites/[id] exists
//   (e) the /api/sites query is strict: an unknown parameter (?id=, ?search=)
//       is a 400; every caller under src/ and scripts/ uses only allowed ones

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { formatErrorResponse } from "./errors";
import { pickSitePatchAction } from "./sitePatch";
import { createSiteSchema, paginationSchema, siteListQuerySchema } from "./validators";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
const ROOT = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const threw = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

(async () => {
  // --- (j) malformed JSON -----------------------------------------------------------
  {
    let syntax: unknown;
    try {
      JSON.parse("{ not json");
    } catch (e) {
      syntax = e;
    }
    const res = formatErrorResponse(syntax);
    const body = (await res.json()) as { error: { code: string; message: string } };
    assert(res.status === 400, `malformed JSON: 400 (got ${res.status})`);
    assert(body.error.code === "BAD_JSON", `with code BAD_JSON (got ${body.error.code})`);
  }

  // --- (d, h, i) a zod failure names its path -------------------------------------------
  {
    let zerr: unknown;
    try {
      paginationSchema.parse({ pageSize: "500" });
    } catch (e) {
      zerr = e;
    }
    const res = formatErrorResponse(zerr);
    const body = (await res.json()) as { error: { code: string; message: string } };
    assert(res.status === 400, `pageSize 500: 400, not a 500 read as an empty list (got ${res.status})`);
    assert(body.error.code === "VALIDATION_ERROR", `with code VALIDATION_ERROR (got ${body.error.code})`);
    assert(body.error.message.includes("pageSize"), `naming the path (${body.error.message})`);
    const other = formatErrorResponse(new Error("boom"));
    assert(other.status === 500, "an unexpected error is still a 500");
  }

  // --- an unrecognised query key is named as a parameter, not "(body)" (owner, 2026-10-03)
  {
    const messageFor = async (query: Record<string, string>) => {
      try {
        siteListQuerySchema.parse(query);
      } catch (e) {
        const res = formatErrorResponse(e);
        return { status: res.status, message: ((await res.json()) as { error: { message: string } }).error.message };
      }
      return { status: 200, message: "" };
    };
    const one = await messageFor({ id: "x" });
    assert(one.status === 400, `?id=x: 400 (got ${one.status})`);
    assert(one.message === "unrecognized parameter(s): id", `?id=x names the parameter (got ${one.message})`);
    const two = await messageFor({ id: "x", search: "y", page: "1" });
    assert(two.message === "unrecognized parameter(s): id, search", `two unknown keys, one message (got ${two.message})`);
    const mixed = await messageFor({ id: "x", pageSize: "500" });
    assert(
      mixed.message.includes("unrecognized parameter(s): id") && mixed.message.includes("pageSize: "),
      `with another issue, both are named (got ${mixed.message})`,
    );
    assert(!mixed.message.includes("(body)"), `and "(body)" is gone (got ${mixed.message})`);
  }

  // --- (e) the strict /api/sites query ----------------------------------------------------
  {
    const allowed = { page: "2", pageSize: "100", status: "ACTIVE", policyStatus: "OK", siteUrl: "https://x.test/", companyNameSearch: "a", urlSearch: "b", sortBy: "createdAt", sortOrder: "asc" };
    assert(siteListQuerySchema.safeParse(allowed).success, "every parameter in use is allowed");
    assert(!siteListQuerySchema.safeParse({ id: "abc" }).success, "?id= is refused, not silently ignored");
    assert(!siteListQuerySchema.safeParse({ search: "kahane" }).success, "?search= is refused");
    assert(!siteListQuerySchema.safeParse({ pageSize: "101" }).success, "pageSize 101 is refused");
    const route = read("src", "app", "api", "sites", "route.ts");
    assert(/siteListQuerySchema\.parse\(Object\.fromEntries\(searchParams\)\)/.test(route), "the list route parses the whole query with it");

    // Every caller under src/ and scripts/ that builds a /api/sites?... query
    // passes only allowed parameters.
    const allowedKeys = new Set(Object.keys(siteListQuerySchema.shape));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (f === "node_modules" || f === "generated" || f.startsWith(".")) continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|mjs|js)$/.test(f) && !/\.test\.ts$/.test(f)) files.push(p);
      }
    };
    walk(join(ROOT, "src"));
    walk(join(ROOT, "scripts"));
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\/api\/sites\?([^`"'\s)]*)/g)) {
        for (const pair of m[1]!.split("&")) {
          const key = pair.split("=")[0]!;
          if (!key || key.startsWith("$")) continue;
          if (!allowedKeys.has(key)) bad.push(`${relative(ROOT, f)}: ${key}`);
        }
      }
    }
    assert(bad.length === 0, `no caller passes a parameter the strict schema rejects (${bad.join("; ")})`);
  }

  // --- (a) a site PATCH names one action ------------------------------------------------------
  {
    assert(pickSitePatchAction({ companyName: "x" }) === "companyName", "companyName alone: companyName");
    assert(pickSitePatchAction({ adminNote: null }) === "adminNote", "adminNote alone (null clears): adminNote");
    assert(pickSitePatchAction({ status: "ACTIVE" }) === "status", "status alone: status");
    assert(pickSitePatchAction({}) === "status", "none of them: the status path, as before (its schema reports the missing key)");
    const two = threw(() => pickSitePatchAction({ companyName: "x", status: "ACTIVE" }));
    assert(!!two && two.includes("companyName") && two.includes("status"), `two keys: refused, naming both (${two})`);
    const three = threw(() => pickSitePatchAction({ companyName: "x", adminNote: "y", status: "ACTIVE" }));
    assert(!!three && three.includes("adminNote"), `three keys: refused, naming all (${three})`);
    const route = read("src", "app", "api", "sites", "[id]", "route.ts");
    assert(/pickSitePatchAction\(body\)/.test(route), "the PATCH route picks through pickSitePatchAction");
  }

  // --- (b) POST stores companyName ---------------------------------------------------------------
  {
    const parsed = createSiteSchema.safeParse({ siteUrl: "https://x.test/jobs", companyName: "קבוצת כהנא" });
    assert(parsed.success && (parsed.data as { companyName?: string }).companyName === "קבוצת כהנא", "the create schema keeps companyName");
    const route = read("src", "app", "api", "sites", "route.ts");
    assert(/companyName: parsed\.data\.companyName/.test(route), "the POST route passes it to createSite");
    const service = read("src", "services", "siteService.ts");
    const create = service.slice(service.indexOf("export async function createSite("), service.indexOf("export async function listSites("));
    assert(/companyName: opts\.companyName/.test(create), "and createSite stores it");
  }

  // --- (c) GET /api/sites/[id] ---------------------------------------------------------------------
  {
    const route = read("src", "app", "api", "sites", "[id]", "route.ts");
    const get = route.indexOf("export async function GET(");
    assert(get >= 0, "GET /api/sites/[id] exists");
    const body = get >= 0 ? route.slice(get, route.indexOf("export async function", get + 10)) : "";
    assert(/recordSiteCall\(/.test(body), "and records its call like every site route");
    const batch = read("scripts", "addsite-batch.ts");
    const skip = batch.slice(batch.indexOf("async function skipSite("), batch.indexOf("async function cmdParse("));
    assert(/apiGet\(\s*`\/api\/sites\/\$\{encodeURIComponent\(siteId\)\}`/.test(skip), "skipSite looks the site up by id with the new GET");
  }

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.info("apiLandmines: bad JSON and zod failures are 400s; one PATCH action; companyName stored; GET by id; a strict list query");
})().catch((e) => {
  console.error("FAIL: threw", e);
  process.exit(1);
});
