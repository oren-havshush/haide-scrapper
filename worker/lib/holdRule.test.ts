// Run: npx tsx worker/lib/holdRule.test.ts
//
// When the nightly holds or pauses a site on its own (worker/lib/holdRule.ts).
// The replay is the fleet's own history: every timer SCRAPE item of the seven
// sites that ever showed a challenge, 2026-09-29 to 2026-10-12 (Jerusalem
// nights), read on the box on 2026-10-13, with the challenge warnings each
// night recorded. Under the rule one1 (Cloudflare) is paused on the 10-09
// night and never held; no SiteGround site reaches three nights in a row.

import { challengeWaitRecord } from "./challengeWait";
import {
  classifyNight,
  decideNight,
  isSaturdayRun,
  pauseNote,
  shouldHold,
  type HoldState,
  type NightDecision,
  type NightItem,
  type NightRecord,
} from "./holdRule";

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

// Cloudflare's Hebrew interstitial title, "Just a moment", from its code points.
const HE_TITLE = String.fromCharCode(0x5e8, 0x5e7, 0x20, 0x5e8, 0x5d2, 0x5e2) + "...";
const SG_SEEN = "blocked_challenge: SiteGround challenge (sg-captcha: challenge)";
const SG_INTERACTIVE = challengeWaitRecord("captcha", 11_000);
const SG_SETTLED = challengeWaitRecord("settled", 3_000, "ipr");

// ---------------------------------------------------------------------------
// The 21-night fixture
// ---------------------------------------------------------------------------

type Row = [night: string, outcome: string, category: string | null, warnings: string[]];
const ok = (night: string, warnings: string[] = []): Row => [night, "success", null, warnings];
const plainNights = (from: number, to: number) => {
  const out: Row[] = [];
  for (let d = from; d <= to; d++) {
    const day = d <= 30 ? `2026-09-${String(d).padStart(2, "0")}` : `2026-10-${String(d - 30).padStart(2, "0")}`;
    out.push(ok(day));
  }
  return out;
};
// Days are numbered from 2026-09-01: 29 = 09-29, 31 = 10-01, 42 = 10-12.
const FIXTURE: Record<string, Row[]> = {
  "eso-group.co.il": [
    ...plainNights(29, 36),
    ["2026-10-07", "soft_failure", "structure_changed", []],
    ["2026-10-08", "soft_failure", "blocked", [SG_SEEN]],
    ["2026-10-09", "soft_failure", "blocked", []],
    ok("2026-10-10", [SG_SETTLED]),
    ok("2026-10-11", [SG_SETTLED]),
    ["2026-10-12", "soft_failure", "blocked", [SG_SEEN, SG_INTERACTIVE]],
  ],
  "tl-care.co.il": [
    ...plainNights(29, 37),
    ["2026-10-08", "soft_failure", "blocked", []],
    ["2026-10-09", "suspicious_drop", "suspicious_drop", []],
    ok("2026-10-10", [SG_SETTLED]),
    ["2026-10-11", "soft_failure", "blocked", [SG_SEEN]],
    ["2026-10-12", "soft_failure", "blocked", [SG_SEEN, SG_INTERACTIVE]],
  ],
  "www.fritz.co.il": [
    ...plainNights(29, 31),
    ["2026-10-02", "soft_failure", "structure_changed", []],
    ...plainNights(33, 39),
    ok("2026-10-10", ["blocked_challenge: Cloudflare challenge (cf-mitigated: challenge)"]),
    ok("2026-10-11"),
    ok("2026-10-12", ["challenge_passed: Cloudflare challenge (cf-mitigated: challenge)"]),
  ],
  "www.gazit.co.il": [
    ...plainNights(29, 36),
    ["2026-10-07", "soft_failure", "structure_changed", []],
    ["2026-10-08", "soft_failure", "blocked", [SG_SEEN]],
    ["2026-10-09", "soft_failure", "empty_results", []],
    ok("2026-10-10", [SG_SETTLED]),
    ok("2026-10-11", [SG_SETTLED]),
    ok("2026-10-12", [SG_SETTLED]),
  ],
  "www.one1.co.il": [
    ...plainNights(29, 33),
    ["2026-10-04", "hard_failure", "timeout", []],
    ...plainNights(35, 37),
    ["2026-10-08", "soft_failure", "structure_changed", []],
    ["2026-10-09", "soft_failure", "blocked", [`blocked_challenge: ${HE_TITLE}`]],
    ["2026-10-10", "soft_failure", "blocked", [`blocked_challenge: ${HE_TITLE}`]],
    ["2026-10-11", "soft_failure", "blocked", [`blocked_challenge: ${HE_TITLE}`]],
    ["2026-10-12", "soft_failure", "blocked", [`blocked_challenge: ${HE_TITLE}`]],
  ],
  "www.sinaistore.com": [
    ...plainNights(29, 36),
    ["2026-10-07", "soft_failure", "structure_changed", []],
    ["2026-10-08", "soft_failure", "blocked", [SG_SEEN]],
    ["2026-10-09", "soft_failure", "blocked", []],
    ok("2026-10-10", [SG_SETTLED]),
    ok("2026-10-11", [SG_SETTLED]),
    ok("2026-10-12", [SG_SETTLED]),
  ],
};

const item = (r: Row): NightItem => ({ outcome: r[1], failureCategory: r[2], warnings: r[3] });
// The timer starts at 02:00 Jerusalem on the night's own date.
const startOf = (night: string) => new Date(`${night}T02:00:00+03:00`);

/**
 * Replays the nights in order, as the nightly would have: a held site is not
 * selected; a paused site is selected only on the Saturday-night run.
 */
function replay(): Map<string, Array<{ night: string; decision: NightDecision; state: HoldState }>> {
  const nights = [...new Set(Object.values(FIXTURE).flatMap((rows) => rows.map((r) => r[0])))].sort();
  const state = new Map<string, HoldState>();
  const history = new Map<string, NightRecord[]>();
  const log = new Map<string, Array<{ night: string; decision: NightDecision; state: HoldState }>>();
  for (let n = 0; n < nights.length; n++) {
    const night = nights[n];
    const saturday = isSaturdayRun(startOf(night));
    for (const [host, rows] of Object.entries(FIXTURE)) {
      const row = rows.find((r) => r[0] === night);
      if (!row) continue;
      const s = state.get(host) ?? null;
      if (s === "HOST_CHALLENGE") continue;
      if (s === "CHALLENGE_RETRY_SATURDAY" && !saturday) continue;
      const tonight: NightRecord = { night, verdict: classifyNight(item(row)) };
      const h = [...(history.get(host) ?? []), tonight];
      history.set(host, h);
      const decision = decideNight({ state: s, tonight, history: h, timerNights: nights.slice(0, n + 1), saturday });
      const next: HoldState =
        decision.action === "hold" ? "HOST_CHALLENGE" : decision.action === "pause" ? "CHALLENGE_RETRY_SATURDAY" : decision.action === "lift_pause" ? null : s;
      state.set(host, next);
      log.set(host, [...(log.get(host) ?? []), { night, decision, state: next }]);
    }
  }
  return log;
}

check("the 21-night replay: one1 paused on the 10-09 night and never held; no SiteGround site held", () => {
  const log = replay();
  const one1 = log.get("www.one1.co.il") ?? [];
  const first = one1.find((e) => e.decision.action !== "none");
  assert(first?.night === "2026-10-09" && first.decision.action === "pause", `one1's first decision is a pause on 2026-10-09 (got ${JSON.stringify(first)})`);
  assert(first?.decision.action === "pause" && first.decision.note === "auto: Cloudflare challenge on 2026-10-09; retry Saturday night", `the pause note (got ${JSON.stringify(first?.decision)})`);
  assert(!one1.some((e) => e.decision.action === "hold"), "one1 is never auto-held");
  // 10-10 is the Saturday-night run: retried, blocked again, the pause stays.
  const sat = one1.find((e) => e.night === "2026-10-10");
  assert(sat?.decision.action === "pause_stays" && sat.decision.blockedAgain === true, `one1's Saturday retry is blocked again (got ${JSON.stringify(sat?.decision)})`);
  assert(!one1.some((e) => e.night === "2026-10-11" || e.night === "2026-10-12"), "and the weekday nightlies after it skip one1");
  assert(one1[one1.length - 1]?.state === "CHALLENGE_RETRY_SATURDAY", "one1 ends paused");
  for (const host of ["eso-group.co.il", "tl-care.co.il", "www.gazit.co.il", "www.sinaistore.com", "www.fritz.co.il"]) {
    const acted = (log.get(host) ?? []).filter((e) => e.decision.action !== "none");
    assert(acted.length === 0, `${host}: never held or paused (got ${JSON.stringify(acted)})`);
  }
});

check("classifyNight", () => {
  const v = (i: NightItem) => JSON.stringify(classifyNight(i));
  assert(classifyNight({ outcome: "success", failureCategory: null, warnings: ["blocked_challenge: Cloudflare challenge (cf-mitigated: challenge)"] }).verdict === "resets", "a run that wrote rows resets, even after a challenge (fritz)");
  const sgi = classifyNight({ outcome: "soft_failure", failureCategory: "blocked", warnings: [SG_SEEN, SG_INTERACTIVE] });
  assert(sgi.verdict === "counts" && sgi.vendor === "SiteGround" && sgi.detail === "interactive captcha", `SiteGround's interactive captcha counts (got ${JSON.stringify(sgi)})`);
  const sgt = classifyNight({ outcome: "soft_failure", failureCategory: "blocked", warnings: [challengeWaitRecord("timeout", 20_000, "ipc")] });
  assert(sgt.verdict === "counts" && sgt.vendor === "SiteGround" && sgt.detail === "did not settle", `the unanswered wait counts (got ${JSON.stringify(sgt)})`);
  const cf = classifyNight({ outcome: "soft_failure", failureCategory: "blocked", warnings: ["blocked_challenge: Cloudflare challenge (cf-mitigated: challenge)"] });
  assert(cf.verdict === "counts" && cf.vendor === "Cloudflare", `cf-mitigated counts as Cloudflare (got ${JSON.stringify(cf)})`);
  const he = classifyNight({ outcome: "soft_failure", failureCategory: "blocked", warnings: [`blocked_challenge: ${HE_TITLE}`] });
  assert(he.verdict === "counts" && he.vendor === "Cloudflare", `the Hebrew title counts as Cloudflare (got ${JSON.stringify(he)})`);
  assert(classifyNight({ outcome: "soft_failure", failureCategory: "blocked", warnings: [SG_SEEN] }).verdict === "neutral", `a SiteGround block with no wait recorded is neutral (got ${v({ outcome: "soft_failure", failureCategory: "blocked", warnings: [SG_SEEN] })})`);
  assert(classifyNight({ outcome: "soft_failure", failureCategory: "blocked", warnings: [] }).verdict === "neutral", "a block with nothing recorded is neutral");
  assert(classifyNight({ outcome: "hard_failure", failureCategory: "timeout", warnings: [] }).verdict === "neutral", "a timeout is neutral");
  assert(classifyNight({ outcome: "soft_failure", failureCategory: "blocked", warnings: [SG_SETTLED] }).verdict === "neutral", "a settled wait on a blocked run is not a counting wait");
});

const sg = (night: string): NightRecord => ({ night, verdict: { verdict: "counts", vendor: "SiteGround", detail: "interactive captcha" } });
const reset = (night: string): NightRecord => ({ night, verdict: { verdict: "resets" } });
const neutral = (night: string): NightRecord => ({ night, verdict: { verdict: "neutral" } });
const cfn = (night: string): NightRecord => ({ night, verdict: { verdict: "counts", vendor: "Cloudflare", detail: "cf-mitigated: challenge" } });
const days = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => `2026-10-${String(a + i).padStart(2, "0")}`);

check("shouldHold: three SiteGround nights in a row within seven timer nights", () => {
  assert(shouldHold([sg("2026-10-10"), sg("2026-10-11"), sg("2026-10-12")], days(6, 12)), "three in a row hold");
  assert(!shouldHold([sg("2026-10-11"), sg("2026-10-12")], days(6, 12)), "two do not");
  assert(shouldHold([sg("2026-10-09"), neutral("2026-10-10"), sg("2026-10-11"), sg("2026-10-12")], days(6, 12)), "a neutral night between does not break the run");
  assert(!shouldHold([sg("2026-10-09"), reset("2026-10-10"), sg("2026-10-11"), sg("2026-10-12")], days(6, 12)), "a reset between breaks it");
  assert(!shouldHold([sg("2026-10-04"), neutral("2026-10-08"), sg("2026-10-11"), sg("2026-10-12")], days(4, 12)), "a counting night outside the last seven timer nights does not add up");
  assert(!shouldHold([cfn("2026-10-10"), cfn("2026-10-11"), cfn("2026-10-12")], days(6, 12)), "Cloudflare nights never add up to a hold");
});

check("decideNight: the pause, its lift, and the hold", () => {
  const sat = { saturday: true, timerNights: days(6, 12) };
  const wk = { saturday: false, timerNights: days(6, 12) };
  const p = decideNight({ state: null, tonight: cfn("2026-10-12"), history: [cfn("2026-10-12")], ...wk });
  assert(p.action === "pause" && p.note === pauseNote("2026-10-12"), `a Cloudflare night pauses (got ${JSON.stringify(p)})`);
  const lift = decideNight({ state: "CHALLENGE_RETRY_SATURDAY", tonight: reset("2026-10-17"), history: [], ...sat });
  assert(lift.action === "lift_pause", `a Saturday retry that wrote rows lifts the pause (got ${JSON.stringify(lift)})`);
  const again = decideNight({ state: "CHALLENGE_RETRY_SATURDAY", tonight: cfn("2026-10-17"), history: [], ...sat });
  assert(again.action === "pause_stays" && again.blockedAgain, `blocked again on Saturday: the pause stays, with the action line (got ${JSON.stringify(again)})`);
  const other = decideNight({ state: "CHALLENGE_RETRY_SATURDAY", tonight: neutral("2026-10-17"), history: [], ...sat });
  assert(other.action === "pause_stays" && !other.blockedAgain, `another failure keeps the pause, no action line (got ${JSON.stringify(other)})`);
  const weekday = decideNight({ state: "CHALLENGE_RETRY_SATURDAY", tonight: reset("2026-10-14"), history: [], ...wk });
  assert(weekday.action === "none", `only the Saturday run lifts a pause (got ${JSON.stringify(weekday)})`);
  const held = decideNight({ state: "HOST_CHALLENGE", tonight: reset("2026-10-17"), history: [], ...sat });
  assert(held.action === "none", `nothing here releases a HOST_CHALLENGE hold (got ${JSON.stringify(held)})`);
  const hold = decideNight({ state: null, tonight: sg("2026-10-12"), history: [sg("2026-10-10"), sg("2026-10-11"), sg("2026-10-12")], ...wk });
  assert(hold.action === "hold" && hold.note === "auto: SiteGround challenge (interactive captcha) on 3 nights, 2026-10-10..2026-10-12", `the third SiteGround night holds (got ${JSON.stringify(hold)})`);
});

check("notes are ASCII", () => {
  const notes = [pauseNote("2026-10-09"), (decideNight({ state: null, tonight: sg("2026-10-12"), history: [sg("2026-10-10"), sg("2026-10-11"), sg("2026-10-12")], saturday: false, timerNights: days(6, 12) }) as { note: string }).note];
  for (const n of notes) assert([...n].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126), `no byte outside printable ASCII in "${n}"`);
});

check("isSaturdayRun reads Jerusalem, not the host clock", () => {
  assert(isSaturdayRun(new Date("2026-10-16T23:01:00Z")), "23:01Z on Friday is 02:01 Saturday in Jerusalem");
  assert(!isSaturdayRun(new Date("2026-10-16T20:00:00Z")), "20:00Z on Friday is still Friday");
  assert(isSaturdayRun(new Date("2026-10-31T00:01:00Z")), "after the clocks change (UTC+2), 00:01Z Saturday is 02:01 Saturday");
});

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("holdRule: all assertions passed");
