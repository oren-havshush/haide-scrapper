// Run: npx tsx src/lib/autoFixWiring.test.ts
//
// addsite2 phase two, step 1c: src/lib/autoFix.ts decides, but only the routes
// can call it. Source-level, like fixQueueRoutes.test.ts, because the handlers
// need a live database.
//   - every handler on a site records its call, for the minutes estimate;
//   - each of the four writes the rules name reads the site's status BEFORE
//     writing and hands the right write to applyAutoFix AFTER it;
//   - the service never fails a request and never stores the token.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const SRC = join(__dirname, "..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const read = (p: string) => (existsSync(join(SRC, p)) ? strip(readFileSync(join(SRC, p), "utf8")) : "");

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...routeFiles(p));
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

/** Each exported handler's body: from its export to the next export or the end. */
function handlers(src: string): Array<{ method: string; body: string }> {
  const re = /export async function (GET|POST|PUT|PATCH|DELETE)\(/g;
  const starts = [...src.matchAll(re)].map((m) => ({ method: m[1], at: m.index ?? 0 }));
  return starts.map((s, i) => ({ method: s.method, body: src.slice(s.at, starts[i + 1]?.at ?? src.length) }));
}

// --- every handler on a site records its call ---------------------------------
const siteRoutes = [
  ...routeFiles(join(SRC, "app", "api", "sites", "[id]")),
  join(SRC, "app", "api", "jobs", "[id]", "route.ts"),
];
assert(siteRoutes.length >= 12, `the site-scoped routes were found (${siteRoutes.length})`);
for (const file of siteRoutes) {
  const rel = relative(SRC, file).split("\\").join("/");
  for (const h of handlers(strip(readFileSync(file, "utf8")))) {
    if (rel === "app/api/sites/[id]/route.ts" && h.method === "DELETE") continue; // the site is gone
    assert(
      h.body.includes("recordSiteCall(") || h.body.includes("applyAutoFix(") || h.body.includes("noteSiteWrite("),
      `${h.method} ${rel} records its call on the site`,
    );
  }
}

// --- the four writes ------------------------------------------------------------
function write(file: string, method: string, action: string, kind: string) {
  const h = handlers(read(file)).find((x) => x.method === method);
  const body = h?.body ?? "";
  const before = body.indexOf("statusBefore");
  const act = body.indexOf(action);
  const apply = body.indexOf("applyAutoFix(", act);
  assert(act > 0, `${method} ${file}: the write ${action.trim()} is there`);
  assert(before > 0 && before < act, `${method} ${file}: the status is read before the write`);
  assert(apply > act, `${method} ${file}: applyAutoFix runs after the write`);
  assert(body.slice(apply).includes(`kind: "${kind}"`), `${method} ${file}: as a ${kind} write`);
}
write("app/api/sites/[id]/config/route.ts", "PUT", "saveSiteConfig(", "config");
write("app/api/sites/[id]/route.ts", "PATCH", "updateSiteStatus(", "status");
write("app/api/sites/[id]/jobs/route.ts", "DELETE", "clearSiteJobs(", "jobs_delete");
write("app/api/jobs/[id]/route.ts", "PATCH", "updateJobLocation(", "location_override");
// Company fields (owner, 2026-09-30): each files COMPANY after its write.
write("app/api/sites/[id]/company-profile/route.ts", "PUT", "saveCompanyProfile(", "company");
write("app/api/sites/[id]/company-logo/route.ts", "POST", "saveCompanyLogo(", "company");
write("app/api/sites/[id]/company-hq-city/route.ts", "PUT", "saveCompanyHqCity(", "company");
write("app/api/sites/[id]/company-homepage/route.ts", "PUT", "saveCompanyHomepage(", "company");
// Refined (owner, 2026-10-02): each company write passes the company fields as
// they were before the write and as they are after it.
function companySnapshots(file: string, method: string, action: string) {
  const body = handlers(read(file)).find((x) => x.method === method)?.body ?? "";
  const snapBefore = body.indexOf("companySnapshotOf(");
  const act = body.indexOf(action);
  const apply = body.indexOf("applyAutoFix(", act);
  assert(snapBefore > 0 && snapBefore < act, `${method} ${file}: the company fields are read before the write`);
  const call = body.slice(apply, body.indexOf("});", apply));
  assert(/kind: "company", before: companyBefore, after: await companySnapshotOf\(id\)/.test(call), `${method} ${file}: and passed before and after to applyAutoFix`);
}
companySnapshots("app/api/sites/[id]/company-profile/route.ts", "PUT", "saveCompanyProfile(");
companySnapshots("app/api/sites/[id]/company-logo/route.ts", "POST", "saveCompanyLogo(");
companySnapshots("app/api/sites/[id]/company-hq-city/route.ts", "PUT", "saveCompanyHqCity(");
companySnapshots("app/api/sites/[id]/company-homepage/route.ts", "PUT", "saveCompanyHomepage(");
companySnapshots("app/api/sites/[id]/route.ts", "PATCH", "updateSiteCompanyName(");
{
  const patch = handlers(read("app/api/sites/[id]/route.ts")).find((x) => x.method === "PATCH")?.body ?? "";
  const name = patch.indexOf("updateSiteCompanyName(");
  const note = patch.indexOf("updateSiteAdminNote(");
  assert(name > 0 && patch.slice(name, note > name ? note : undefined).includes('kind: "company"'), "a company-name PATCH files COMPANY");
  assert(note > 0 && patch.slice(note, patch.indexOf("updateSiteStatus(")).includes('kind: "other"'), "an admin-note PATCH stays excluded");
}
// Still excluded: scrape, analyze, policy review.
for (const [file, method] of [
  ["app/api/sites/[id]/scrape/route.ts", "POST"],
  ["app/api/sites/[id]/analyze/route.ts", "POST"],
  ["app/api/sites/[id]/policy-review/route.ts", "POST"],
] as const) {
  const body = handlers(read(file)).find((x) => x.method === method)?.body ?? "";
  assert(body.includes("noteSiteWrite(") && !body.includes("applyAutoFix("), `${method} ${file} files nothing`);
}

{
  const put = handlers(read("app/api/sites/[id]/config/route.ts")).find((x) => x.method === "PUT")?.body ?? "";
  assert(/fieldMappings: true/.test(put) && /pageFlow: true/.test(put), "the config PUT reads the stored config before saving, for the diff");
}

// --- the service: never fails the request, never keeps the token -------------
{
  const svc = read("services/autoFixService.ts");
  assert(svc.length > 0, "src/services/autoFixService.ts exists");
  for (const fn of ["recordSiteCall", "applyAutoFix"]) {
    const start = svc.indexOf(`export async function ${fn}(`);
    const body = start >= 0 ? svc.slice(start, svc.indexOf("\n}\n", start)) : "";
    assert(/\btry \{/.test(body) && /\bcatch \(/.test(body), `${fn} catches its own errors — a fix record never fails the write`);
  }
  assert(/createHash\("sha256"\)/.test(svc), "the token is kept only as a sha256 prefix");
  assert(!/data: \{[^}]*\btoken:/.test(svc), "and never written as itself");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("autoFixWiring: every site call recorded; the four writes open their items after writing");
