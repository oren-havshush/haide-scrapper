// Run: npx tsx worker/lib/holdProbe.test.ts
//
// The Saturday probe of held sites (G5, owner 2026-10-13): what one GET's
// answer means, which held sites are probed (never a Cloudflare one), the
// selection of a probe-passed site for the same run, and that the runner makes
// one GET per site, redirect not followed, no retry, writing the probe columns
// only.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { judgeProbe, PROBE_TIMEOUT_MS, probeEligible, probeResultText, probeRunResult } from "./holdProbe";
import { selectSitesForSweep, type SelectableSite } from "./sweepSelection";
import { parseNightlyArgs } from "./nightlyArgs";

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

const URL_ = "https://tl-care.co.il/";
const HE_TITLE = String.fromCharCode(0x5e8, 0x5e7, 0x20, 0x5e8, 0x5d2, 0x5e2) + "...";

check("judgeProbe", () => {
  const cases: Array<[string, number, Record<string, string>, string, string]> = [
    ["SiteGround 202 with sg-captcha", 202, { "sg-captcha": "challenge" }, `<meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2F">`, "challenged"],
    ["SiteGround's refresh in the body only", 202, {}, `<meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2F">`, "challenged"],
    ["SiteGround's interactive captcha path", 200, {}, `<meta http-equiv="refresh" content="0;/.well-known/captcha/?r=%2F">`, "challenged"],
    ["Cloudflare 403 cf-mitigated", 403, { "cf-mitigated": "challenge" }, "<title>Just a moment...</title>", "challenged"],
    ["Cloudflare's English title, no header", 403, {}, "<html><head><title>Just a moment...</title>", "challenged"],
    ["Cloudflare's Hebrew title", 200, {}, `<html><head><title>${HE_TITLE}</title>`, "challenged"],
    ["a clean 200", 200, { "content-type": "text/html" }, "<html><head><title>Careers</title></head><body>jobs</body>", "passed"],
    ["a 301", 301, { location: "https://www.tl-care.co.il/" }, "", "inconclusive"],
    ["a 202 without a mark", 202, {}, "<html></html>", "inconclusive"],
    ["a 500", 500, {}, "", "inconclusive"],
    ["a 403 without a mark", 403, {}, "<title>Forbidden</title>", "inconclusive"],
  ];
  for (const [name, status, headers, body, want] of cases) {
    const v = judgeProbe(status, headers, body, URL_);
    assert(v.result === want, `${name}: ${want} (got ${JSON.stringify(v)})`);
    const text = probeResultText(v);
    assert([...text].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126), `${name}: the stored line is ASCII ("${text}")`);
  }
  assert(probeResultText(judgeProbe(200, {}, "<title>ok</title>", URL_)) === "passed", "a pass is stored as \"passed\"");
  assert(/^still challenged: SiteGround/.test(probeResultText(judgeProbe(202, { "sg-captcha": "challenge" }, "", URL_))), "a challenge names the vendor");
  assert(probeResultText(judgeProbe(301, {}, "", URL_)) === "inconclusive: HTTP 301 redirect, not followed", "a redirect is inconclusive, not followed");
});

check("which held sites are probed", () => {
  assert(probeEligible("HOST_CHALLENGE", "SiteGround interactive challenge on the box IP since 2026-10-12"), "a SiteGround hold is probed");
  assert(probeEligible("HOST_CHALLENGE", "auto: SiteGround challenge (interactive captcha) on 3 nights, 2026-10-10..2026-10-12"), "an automatic SiteGround hold too");
  assert(probeEligible("HOST_CHALLENGE", "held by hand"), "a hold naming no host is probed");
  assert(!probeEligible("HOST_CHALLENGE", "Cloudflare challenge on headless browsers since 2026-10-09 (one1)"), "a Cloudflare hold is never probed: a GET cannot pass it");
  assert(!probeEligible("CHALLENGE_RETRY_SATURDAY", "auto: Cloudflare challenge on 2026-10-14; retry Saturday night"), "a pause is retried by the run, not probed");
  assert(!probeEligible(null, null), "an unheld site is not probed");
});

check("the probe line after the run", () => {
  assert(probeRunResult({ outcome: "success", failureCategory: null }) === "passed; the run passed", "the run wrote rows");
  assert(probeRunResult({ outcome: "soft_failure", failureCategory: "blocked" }) === "passed; the run was blocked", "the run was blocked");
  assert(probeRunResult({ outcome: "hard_failure", failureCategory: "timeout" }) === "passed; the run failed (timeout)", "the run failed otherwise");
});

check("a probe-passed held site is selected for the same run; no other held site is", () => {
  const now = new Date("2026-10-16T23:01:00Z");
  const mappings = { title: { selector: ".t" }, location: { selector: ".l" } };
  const site = (id: string, hold: string | null): SelectableSite =>
    ({ id, siteUrl: `https://${id}.example/`, status: "ACTIVE", fieldMappings: mappings, lastSuccessAt: null, lastAttemptAt: null, sweepHold: hold, sweepHoldNote: null }) as SelectableSite;
  const sites = [site("passed", "HOST_CHALLENGE"), site("challenged", "HOST_CHALLENGE")];
  const sel = selectSitesForSweep(sites, { now, probePassed: new Set(["passed"]) });
  assert(sel.selected.map((s) => s.id).join() === "passed", `only the probe-passed site (got ${sel.selected.map((s) => s.id).join()})`);
  const pausedOnly = selectSitesForSweep([site("paused", "CHALLENGE_RETRY_SATURDAY")], { now, probePassed: new Set(["paused"]) });
  assert(pausedOnly.selected.length === 0, "a probe pass never selects a paused site; only retryPaused does");
});

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

check("the runner: one GET per site, redirect manual, 15 s, no retry, probe columns only", () => {
  assert(PROBE_TIMEOUT_MS === 15_000, "15 s");
  const src = read("worker/sweep/holdProbe.ts").replace(/^\s*\/\/.*$/gm, "");
  const fetches = src.match(/\bfetch\(/g) ?? [];
  assert(fetches.length === 1, `one fetch call in the runner (got ${fetches.length})`);
  assert(/redirect: "manual"/.test(src), "the redirect is not followed");
  assert(/signal: AbortSignal\.timeout\(PROBE_TIMEOUT_MS\)/.test(src), "with the 15 s timeout");
  const once = src.slice(src.indexOf("async function probeOnce"), src.indexOf("export async function probeHeldSites"));
  assert(!/\b(for|while)\s*\(/.test(once) && !/retry/i.test(once), "probeOnce has no loop and no retry");
  const held = src.slice(src.indexOf("export async function probeHeldSites"), src.indexOf("export async function recordProbeRuns"));
  assert((held.match(/probeOnce\(/g) ?? []).length === 1, "probeHeldSites calls probeOnce once per site");
  const writes = src.match(/prisma\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g) ?? [];
  assert(writes.length === 2 && writes.every((w) => w === "prisma.site.updateMany("), `two writes, both prisma.site.updateMany (got ${writes.join(", ")})`);
  const datas = [...src.matchAll(/data: \{([^}]*)\}/g)].map((m) => m[1].split(",").map((kv) => kv.split(":")[0].trim()).filter(Boolean));
  assert(datas.length === 2 && datas.flat().every((k) => k === "sweepHoldProbeAt" || k === "sweepHoldProbeResult"), `the writes touch the probe columns only (got ${JSON.stringify(datas)})`);
  assert((src.match(/where: \{ id: [\w.]+, sweepHold: "HOST_CHALLENGE" \}/g) ?? []).length === 2, "and only while the site is still held");
});

check("nightly.ts: the probe runs before selection on the Saturday-night timer run only", () => {
  const src = read("worker/sweep/nightly.ts");
  const run = src.slice(src.indexOf("async function realRun"), src.indexOf("async function probeHoldsOnly"));
  assert(/const saturdayNight = timerNight && isSaturdayRun\(now\);/.test(run), "saturdayNight is the timer's nightly fleet run on a Jerusalem Saturday");
  const probe = run.indexOf("await probeHeldSites(");
  const guard = run.lastIndexOf("if (saturdayNight) {", probe);
  assert(probe > 0 && guard > 0 && probe - guard < 200, "probeHeldSites is called inside if (saturdayNight)");
  assert((run.match(/probeHeldSites\(/g) ?? []).length === 1, "and only there in realRun");
  assert(probe < run.indexOf("selectSitesForSweep("), "before the selection");
  assert(/probePassed,\n/.test(run), "the passes reach the selection");
  const recorded = run.match(/if \(probePassed\.size > 0\) await recordProbeRuns\(results, probePassed, log\);/g) ?? [];
  assert(recorded.length === 2, `the run's result is recorded on the close and the halt (got ${recorded.length})`);
});

check("--probe-holds stands alone", () => {
  assert(JSON.stringify(parseNightlyArgs(["--probe-holds"])) === JSON.stringify({ kind: "probe-holds" }), "--probe-holds parses");
  let threw = false;
  try {
    parseNightlyArgs(["--probe-holds", "--now"]);
  } catch {
    threw = true;
  }
  assert(threw, "and refuses company");
});

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("holdProbe: all assertions passed");
