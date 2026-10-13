// Run: npx tsx worker/lib/sweepHold.test.ts
//
// The sweep hold (owner, 2026-10-13): a site blocked by a host bot challenge is
// held, not SKIPPED; it stays ACTIVE and visible, and the nightly and policy
// sweeps leave it out. A --site run and a dashboard scrape still work on it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { selectSitesForSweep, type SelectableSite } from "./sweepSelection";
import { selectDuePolicyReviews, type PolicyCandidate } from "../../src/lib/policySelection";
import { holdSetBy, holdVendor, scrapeRunGuarded, sweepHoldBodySchema, sweepHoldData } from "../../src/lib/sweepHold";
import { buildScrapeJobRow } from "../../src/lib/scrapeJobRow";
import { readScheduledFlag } from "./scheduledRun";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
function check(name: string, body: () => void) {
  try {
    body();
  } catch (err) {
    console.error(`FAIL: ${name} threw: ${(err as Error).message}`);
    failures++;
  }
}

const now = new Date("2026-10-13T23:01:00Z");
const mappings = { title: { selector: ".t" }, location: { selector: ".l" } };
const site = (id: string, hold: string | null, note: string | null = null): SelectableSite =>
  ({ id, siteUrl: `https://${id}.example/`, status: "ACTIVE", fieldMappings: mappings, lastSuccessAt: null, lastAttemptAt: null, sweepHold: hold, sweepHoldNote: note }) as SelectableSite;

check("the nightly leaves a held site out, by name", () => {
  const { selected, excluded } = selectSitesForSweep([site("held", "HOST_CHALLENGE", "SiteGround interactive challenge"), site("open", null)], { now });
  assert(selected.map((s) => s.id).join() === "open", `only the unheld site is selected (got ${selected.map((s) => s.id).join()})`);
  const e = excluded.find((x) => x.site.id === "held");
  assert(!!e, "the held site is in the exclusions");
  assert((e as { kind?: string } | undefined)?.kind === "hold", `its kind is "hold" (got ${(e as { kind?: string } | undefined)?.kind})`);
  assert(/^on hold \(HOST_CHALLENGE\): SiteGround interactive challenge$/.test(e?.reason ?? ""), `the reason names the hold and the note (got ${e?.reason})`);
});

check("the policy sweep leaves a held site out; the backfill does not", () => {
  const cand = (id: string, hold: string | null): PolicyCandidate =>
    ({ id, siteUrl: `https://${id}.example/`, status: "ACTIVE", scrapingPolicyStatus: "RESTRICTED", scrapingPolicyCheckedAt: null, companyProfileAt: new Date("2026-01-01"), sweepHold: hold }) as PolicyCandidate;
  const opts = { now, recheckIntervalDays: 30, statuses: ["ACTIVE", "REVIEW"], requireCompanyProfile: true };
  const sweep = selectDuePolicyReviews([cand("held", "HOST_CHALLENGE"), cand("open", null)], { ...opts, excludeHeld: true } as typeof opts);
  assert(sweep.selected.map((s) => s.id).join() === "open", `the sweep selects only the unheld site (got ${sweep.selected.map((s) => s.id).join()})`);
  assert(sweep.excluded.some((x) => x.site.id === "held" && /^on hold \(HOST_CHALLENGE\)/.test(x.reason)), "and names the held one");
  const backfill = selectDuePolicyReviews([cand("held", "HOST_CHALLENGE"), cand("open", null)], opts);
  assert(backfill.selected.length === 2, "a caller that does not ask (the backfill) is not filtered");
});

check("set and release write the three fields", () => {
  const at = new Date("2026-10-13T20:00:00Z");
  const set = sweepHoldData(sweepHoldBodySchema.parse({ hold: "HOST_CHALLENGE", note: "Cloudflare challenge on headless browsers since 2026-10-09" }), at);
  assert(set.sweepHold === "HOST_CHALLENGE" && set.sweepHoldAt?.getTime() === at.getTime() && set.sweepHoldNote === "Cloudflare challenge on headless browsers since 2026-10-09", `set (got ${JSON.stringify(set)})`);
  const release = sweepHoldData(sweepHoldBodySchema.parse({ hold: null }), at);
  assert(release.sweepHold === null && release.sweepHoldAt === null && release.sweepHoldNote === null, `release clears all three (got ${JSON.stringify(release)})`);
  assert(!sweepHoldBodySchema.safeParse({ hold: "HOST_CHALLENGE" }).success, "a hold needs a note");
  assert(!sweepHoldBodySchema.safeParse({ hold: null, note: "x" }).success, "a release takes no note");
  assert(!sweepHoldBodySchema.safeParse({ hold: "BLOCKED", note: "x" }).success, "only the named reasons");
  assert(!sweepHoldBodySchema.safeParse({ hold: "CHALLENGE_RETRY_SATURDAY", note: "x" }).success, "the pause is the nightly's, never set through the route");
});

check("G2: a hold records who set it; a release clears the source and the probe", () => {
  const at = new Date("2026-10-13T20:00:00Z");
  const set = sweepHoldData(sweepHoldBodySchema.parse({ hold: "HOST_CHALLENGE", note: "SiteGround interactive challenge" }), at) as Record<string, unknown>;
  assert(set.sweepHoldBy === "owner", `a hold through the route is the owner's (got ${JSON.stringify(set.sweepHoldBy)})`);
  assert(set.sweepHoldProbeAt === null && set.sweepHoldProbeResult === null, "and starts with no probe result");
  const release = sweepHoldData(sweepHoldBodySchema.parse({ hold: null }), at) as Record<string, unknown>;
  for (const k of ["sweepHold", "sweepHoldAt", "sweepHoldNote", "sweepHoldBy", "sweepHoldProbeAt", "sweepHoldProbeResult"]) {
    assert(k in release && release[k] === null, `release clears ${k} (got ${JSON.stringify(release[k])})`);
  }
  assert(holdSetBy(null) === "owner" && holdSetBy("owner") === "owner" && holdSetBy("auto") === "auto", "NULL is read as the owner");
});

check("G2: holdVendor names the host from the hold and its note", () => {
  const cases: Array<[string | null, string | null, string]> = [
    ["HOST_CHALLENGE", "Cloudflare challenge on headless browsers since 2026-10-09 (one1)", "Cloudflare"],
    ["HOST_CHALLENGE", "SiteGround interactive challenge on the box IP since 2026-10-12 (tl-care) / 2026-10-13 (eso-group)", "SiteGround"],
    ["HOST_CHALLENGE", "auto: SiteGround challenge (interactive captcha) on 3 nights, 2026-10-10..2026-10-12", "SiteGround"],
    ["HOST_CHALLENGE", "blocked by cf-mitigated: challenge", "Cloudflare"],
    ["CHALLENGE_RETRY_SATURDAY", "auto: Cloudflare challenge on 2026-10-09; retry Saturday night", "Cloudflare"],
    ["CHALLENGE_RETRY_SATURDAY", null, "Cloudflare"],
    ["HOST_CHALLENGE", "the owner held it", "host"],
    ["HOST_CHALLENGE", null, "host"],
  ];
  for (const [hold, note, want] of cases) {
    const got = holdVendor(hold, note);
    assert(got === want, `holdVendor(${hold}, ${JSON.stringify(note)}) is ${want} (got ${got})`);
  }
});

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");
check("the sweeps, the route and the script are wired", () => {
  const nightly = read("worker/sweep/nightly.ts");
  const load = nightly.slice(nightly.indexOf("async function loadSelectableSites"), nightly.indexOf("async function loadSelectableSites") + 900);
  assert(/sweepHold: true/.test(load) && /sweepHoldNote: true/.test(load), "loadSelectableSites reads the hold");
  assert(!/sweepHold: null/.test(load), "and does not filter it there, so a --site run still finds a held site");
  assert(/on hold/.test(nightly), "the selection log prints the held count");
  const policy = read("worker/sweep/policy.ts");
  assert(/sweepHold: true/.test(policy) && /excludeHeld: true/.test(policy), "the policy sweep reads the hold and asks for held sites to be left out");
  assert(/on hold/.test(policy), "and logs how many");
  const schema = read("prisma/schema.prisma");
  assert(/enum SweepHold \{\s*HOST_CHALLENGE\s+CHALLENGE_RETRY_SATURDAY\s*\}/.test(schema) && /sweepHold\s+SweepHold\?/.test(schema) && /sweepHoldAt\s+DateTime\?/.test(schema) && /sweepHoldNote\s+String\?/.test(schema), "the schema has the enum, both values, and the three columns");
  assert(/sweepHoldBy\s+String\?/.test(schema) && /sweepHoldProbeAt\s+DateTime\?/.test(schema) && /sweepHoldProbeResult\s+String\?/.test(schema), "and the source and probe columns (G2)");
  const migration = read("prisma/migrations/20261013100000_sweep_hold_pause_and_probe/migration.sql");
  assert(/ALTER TYPE "SweepHold" ADD VALUE 'CHALLENGE_RETRY_SATURDAY'/.test(migration) && /"sweepHoldBy" TEXT/.test(migration) && /"sweepHoldProbeAt" TIMESTAMP\(3\)/.test(migration) && /"sweepHoldProbeResult" TEXT/.test(migration), "the G2 migration adds the value and the three columns");
  assert(!/UPDATE|DELETE|NOT NULL/.test(migration.replace(/^--.*$/gm, "")), "and is additive: no backfill, nothing required");
  const route = read("src/app/api/sites/[id]/sweep-hold/route.ts");
  assert(/sweepHoldBodySchema/.test(route) && /setSweepHold\(/.test(route), "the route validates the body and writes through the service");
  const svc = read("src/services/siteService.ts");
  assert(/export async function setSweepHold/.test(svc) && /sweepHoldData\(/.test(svc), "the service writes sweepHoldData's three fields");
  const script = read("scripts/addsite-batch.ts");
  assert(script.includes("  hold: cmdHold,") && script.includes("/sweep-hold"), "addsite-batch.ts has the hold command, through the route");
  assert(/release[\s\S]{0,1200}\[y\/N\]/.test(script.slice(script.indexOf("async function cmdHold"))), "release asks y/N");
});

check("G4: a hand run on a held or paused site is guarded, and releases nothing", () => {
  assert(scrapeRunGuarded(undefined, "HOST_CHALLENGE") === true, "a dashboard scrape of a held site is guarded");
  assert(scrapeRunGuarded(undefined, "CHALLENGE_RETRY_SATURDAY") === true, "and of a paused one");
  assert(scrapeRunGuarded(undefined, null) === false && scrapeRunGuarded(false, null) === false, "an unheld site's hand run is as today, unguarded");
  assert(scrapeRunGuarded(true, null) === true, "the sweep's own runs stay guarded");
  const row = buildScrapeJobRow({ siteId: "s1", scrapeRunId: "r1", scheduled: scrapeRunGuarded(undefined, "HOST_CHALLENGE") });
  assert(readScheduledFlag(row.payload) === true, "the worker reads the held site's job as scheduled");
  const open = buildScrapeJobRow({ siteId: "s1", scrapeRunId: "r1", scheduled: scrapeRunGuarded(undefined, null) });
  assert(readScheduledFlag(open.payload) === false && !("scheduled" in (open.payload as Record<string, unknown>)), "and an unheld site's payload is unchanged");
  const svc = read("src/services/siteService.ts");
  const at = svc.indexOf("export async function createScrapeRun");
  const create = svc.slice(at, svc.indexOf("\n}\n", at)).replace(/^\s*\/\/.*$/gm, "");
  assert(/scheduled: scrapeRunGuarded\(options\?\.scheduled, site\.sweepHold\)/.test(create), "createScrapeRun guards from the site's own hold");
  const route = read("src/app/api/sites/[id]/scrape/route.ts");
  assert(!/scheduled|sweepHold/.test(route), "the route still cannot choose it");
  assert(!/sweepHold/.test(create.replace(/scrapeRunGuarded\(options\?\.scheduled, site\.sweepHold\)/, "")), "and the run writes no hold column");
});

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("sweepHold: all assertions passed");
