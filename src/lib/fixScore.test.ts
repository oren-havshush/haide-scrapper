// Run: npx tsx src/lib/fixScore.test.ts
//
// addsite2 phase two, step 1a: the cohort score. Per site, the fix items opened
// in the 14 days after it went ACTIVE — items, distinct fields, minutes — and
// its final status. The primary score counts operator-logged (MANUAL) items
// only. CHECK items are reported apart, and a code is scored for a site only if
// it was live when that site's window opened (step 7), so a check shipping
// mid-window cannot count for part of one. Cohorts: control = untagged and created in [freezeAt, switchAt);
// test = tagged addsite3; untagged after the switch is listed, never scored.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SWITCH_AT } from "../../scripts/lib/checkLearnings.mjs";
import {
  ADDSITE2_FREEZE_AT,
  ADDSITE3_SWITCH_AT,
  FIX_WINDOW_DAYS,
  cohortBoundsFrom,
  cohortOf,
  scoreCohorts,
  scoreSite,
  type CohortBounds,
  type ScoreItem,
  type ScoreSite,
} from "./fixScore";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
const eq = (got: unknown, want: unknown, msg: string) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL: ${msg}\n  got=${g}\n  want=${w}`);
    failures++;
  }
};

const D = (s: string) => new Date(s);
const DAY = 86_400_000;
const FREEZE = D("2026-10-01T00:00:00Z");
const SWITCH = D("2026-11-01T00:00:00Z");
const bounds: CohortBounds = { freezeAt: FREEZE, switchAt: SWITCH };
const NOW = D("2026-12-15T00:00:00Z");

const site = (over: Partial<ScoreSite> = {}): ScoreSite => ({
  id: "s1",
  siteUrl: "https://s1.test",
  status: "ACTIVE",
  createdAt: D("2026-10-05T08:00:00Z"),
  activeAt: D("2026-10-06T08:00:00Z"),
  onboardingSkill: null,
  ...over,
});
const item = (over: Partial<ScoreItem> = {}): ScoreItem => ({
  siteId: "s1",
  field: "APPLY",
  source: "MANUAL",
  code: "manual",
  openedAt: D("2026-10-07T08:00:00Z"),
  minutes: 10,
  ...over,
});

eq(FIX_WINDOW_DAYS, 14, "the window is fourteen days");

// --- the cohort rule --------------------------------------------------------
{
  eq(cohortOf(site(), bounds), "control", "untagged, created after the freeze and before the switch: control");
  eq(cohortOf(site({ createdAt: FREEZE }), bounds), "control", "created exactly at the freeze: control (closed start)");
  eq(
    cohortOf(site({ createdAt: D("2026-09-20T00:00:00Z") }), bounds),
    "none",
    "created before the freeze: in no cohort — an old site, not a control",
  );
  eq(
    cohortOf(site({ createdAt: SWITCH }), bounds),
    "addsite2_after_switch",
    "untagged and created at the switch: listed apart (open end)",
  );
  eq(
    cohortOf(site({ createdAt: D("2026-11-20T00:00:00Z") }), bounds),
    "addsite2_after_switch",
    "untagged after the switch: addsite2 after switch",
  );
  eq(cohortOf(site({ onboardingSkill: "addsite3" }), bounds), "test", "tagged addsite3: test");
  eq(
    cohortOf(site({ onboardingSkill: "addsite3", createdAt: D("2026-11-20T00:00:00Z") }), bounds),
    "test",
    "tagged addsite3 after the switch: still test",
  );
  eq(cohortOf(site({ onboardingSkill: "other" }), bounds), "none", "another tag is no cohort");
  eq(
    cohortOf(site(), { freezeAt: null, switchAt: null }),
    "none",
    "before the freeze exists there is no control cohort",
  );
  eq(
    cohortOf(site({ createdAt: D("2027-01-01T00:00:00Z") }), { freezeAt: FREEZE, switchAt: null }),
    "control",
    "with no switch yet, every untagged site after the freeze is control",
  );
}

// --- the window -------------------------------------------------------------
{
  const s = site();
  const start = s.activeAt!.getTime();
  const items = [
    item({ openedAt: new Date(start - 60_000), minutes: 100 }), // before ACTIVE
    item({ openedAt: new Date(start), minutes: 1, field: "APPLY" }), // at ACTIVE: in
    item({ openedAt: new Date(start + 3 * DAY), minutes: 2, field: "LOCATION" }),
    item({ openedAt: new Date(start + FIX_WINDOW_DAYS * DAY - 1), minutes: 4, field: "APPLY" }), // last ms: in
    item({ openedAt: new Date(start + FIX_WINDOW_DAYS * DAY), minutes: 1000 }), // the bound itself: out
    item({ siteId: "other", openedAt: new Date(start + DAY), minutes: 5000 }), // another site
  ];
  const r = scoreSite(s, items, { now: NOW, bounds });
  eq(r.cohort, "control", "the score carries the cohort");
  eq(r.items, 3, "three items fall in [activeAt, activeAt + 14d)");
  eq(r.minutes, 7, "their minutes add up; before, at the bound and other sites' do not");
  eq(r.fields, 2, "distinct fields: APPLY and LOCATION");
  eq(r.windowStart?.toISOString(), s.activeAt!.toISOString(), "the window starts at activeAt");
  eq(r.windowEnd?.toISOString(), new Date(start + FIX_WINDOW_DAYS * DAY).toISOString(), "and ends 14 days later");
  assert(r.complete, "a window that ended before now is complete");
  assert(
    !scoreSite(s, items, { now: new Date(start + DAY), bounds }).complete,
    "one still open is not complete",
  );

  const never = scoreSite(site({ activeAt: null, status: "SKIPPED" }), items, { now: NOW, bounds });
  eq([never.items, never.minutes, never.windowStart], [0, 0, null], "a site never ACTIVE has no window and no items");
  assert(never.rank3, "and SKIPPED counts toward rank 3");
  assert(scoreSite(site({ status: "REVIEW" }), [], { now: NOW, bounds }).rank3, "so does REVIEW");
  assert(!scoreSite(site(), [], { now: NOW, bounds }).rank3, "ACTIVE does not");
  eq(scoreSite(site({ status: "REVIEW" }), [], { now: NOW, bounds }).finalStatus, "REVIEW", "the final status is reported");

  const noMinutes = scoreSite(s, [item({ minutes: null })], { now: NOW, bounds });
  eq([noMinutes.items, noMinutes.minutes], [1, 0], "an item with no minutes logged still counts as an item");
}

// --- MANUAL is the score; CHECK only for codes live when the site's window opened --
{
  const s = site();
  const t = s.activeAt!.getTime();
  const items = [
    item({ openedAt: new Date(t + DAY), minutes: 5 }),
    item({ source: "CHECK", code: "apply_replay_token", field: "APPLY", openedAt: new Date(t + DAY), minutes: 30 }),
    item({ source: "CHECK", code: "undated_rate", field: "DATE", openedAt: new Date(t + 2 * DAY), minutes: null }),
  ];
  // undated_rate went live a day into this site's window: its item there is
  // not scored, although it was opened after the code went live.
  const liveFrom = { apply_replay_token: D("2026-09-01T00:00:00Z"), undated_rate: new Date(t + DAY) };
  const all = scoreSite(s, items, { now: NOW, bounds, checkCodeLiveFrom: liveFrom });
  eq([all.items, all.minutes], [1, 5], "the primary score counts MANUAL items and minutes only");
  eq(all.checkItems, 1, "CHECK items are counted apart, for codes live when the window opened");
  eq(all.checkCodes, ["apply_replay_token"], "and named");
  eq(scoreSite(s, items, { now: NOW, bounds }).checkItems, 0, "with no live-from dates, no CHECK item counts");
  const atOpen = scoreSite(s, items, { now: NOW, bounds, checkCodeLiveFrom: { ...liveFrom, undated_rate: new Date(t) } });
  eq(atOpen.checkCodes, ["apply_replay_token", "undated_rate"], "a code live at the very instant the window opened is scored");

  // Two cohorts. undated_rate went live after the control's window opened and
  // before the test's: it is scored for the test site, not for the control.
  const ctl = site({ id: "c", siteUrl: "https://c.test" });
  const tst = site({
    id: "t",
    siteUrl: "https://t.test",
    onboardingSkill: "addsite3",
    createdAt: D("2026-11-10T00:00:00Z"),
    activeAt: D("2026-11-11T00:00:00Z"),
  });
  const late = site({
    id: "late",
    siteUrl: "https://late.test",
    createdAt: D("2026-11-12T00:00:00Z"),
    activeAt: D("2026-11-13T00:00:00Z"),
  });
  const dated = (siteId: string, at: string) =>
    item({ siteId, source: "CHECK", code: "undated_rate", field: "DATE", openedAt: D(at), minutes: null });
  const rep = scoreCohorts([ctl, tst, late], [dated("c", "2026-10-15T00:00:00Z"), dated("t", "2026-11-12T00:00:00Z")], {
    now: NOW,
    bounds,
    checkCodeLiveFrom: {
      apply_replay_token: D("2026-09-01T00:00:00Z"),
      undated_rate: D("2026-10-10T00:00:00Z"),
    },
  });
  eq(
    rep.checkCodeSites,
    { apply_replay_token: { control: 1, test: 1 }, undated_rate: { control: 0, test: 1 } },
    "per code, the sites it was comparable on, by cohort",
  );
  eq(rep.sites.find((x) => x.siteId === "c")?.checkItems, 0, "the control's undated_rate item is not scored: live mid-window");
  eq(rep.sites.find((x) => x.siteId === "t")?.checkItems, 1, "the test's is: live before its window opened");
  assert(!("comparableCheckCodes" in rep), "the cross-cohort code list is gone");
  eq(rep.sites.map((x) => x.siteId).sort(), ["c", "t"], "control and test are scored");
  eq(rep.excluded.map((x) => x.siteId), ["late"], "the untagged after-switch site is listed and excluded");
  eq(rep.excluded[0]?.cohort, "addsite2_after_switch", "under its own name");
  eq([rep.control.sites, rep.test.sites], [1, 1], "one site per cohort");
}

// --- step 1c: auto items are the score; estimated minutes once per site-day ---
// Items opened by API writes are CHECK items coded auto:<route>. They are the
// measurement now, so they count in the primary score like MANUAL ones. Their
// minutes are the day's estimate, carried by every item that day, so a day's
// estimate counts once — the largest, if two differ — not once per item.
{
  const s = site();
  const t = s.activeAt!.getTime(); // 2026-10-06 11:00 Jerusalem
  const auto = (field: string, dayOffset: number, minutes: number, hour = 0): ScoreItem => ({
    siteId: "s1",
    field,
    source: "CHECK",
    code: "auto:PUT /api/sites/[id]/config",
    openedAt: new Date(t + dayOffset * DAY + hour * 3_600_000),
    minutes,
    minutesEstimated: true,
  });
  const items: ScoreItem[] = [
    auto("APPLY", 1, 40),
    auto("COVERAGE", 1, 40, 2), // same day, same estimate
    auto("LOCATION", 2, 25),
    item({ openedAt: new Date(t + 3 * DAY), minutes: 10 }), // MANUAL, typed
  ];
  const r = scoreSite(s, items, { now: NOW, bounds });
  eq(r.items, 4, "auto items count as items alongside MANUAL ones");
  eq(r.fields, 3, "with their fields (APPLY, COVERAGE, LOCATION; the MANUAL item is APPLY too)");
  eq(r.minutes, 75, "one day's estimate once (40), the next day's (25), plus typed minutes (10)");

  const differ = scoreSite(s, [auto("APPLY", 1, 30), auto("COVERAGE", 1, 45, 1)], { now: NOW, bounds });
  eq(differ.minutes, 45, "two estimates on one day: the larger, once");

  const plainCheck = scoreSite(s, [{ ...auto("APPLY", 1, 30), code: "apply_replay_token", minutesEstimated: false }], { now: NOW, bounds });
  eq([plainCheck.items, plainCheck.minutes], [0, 0], "a nightly check's item is still not in the primary score");
}

// --- step A: the window is anchored on firstActiveAt --------------------------
// A fix sets the site ACTIVE again, which rewrites activeAt. Anchored on
// activeAt, the window restarted at every fix and the fix's own item fell
// before it (kahane, 2026-09-30). firstActiveAt is written once and never again.
{
  const first = D("2026-10-06T08:00:00Z");
  const fixedAt = D("2026-10-09T08:00:00Z");
  const s = site({ firstActiveAt: first, activeAt: new Date(fixedAt.getTime() + 2 * 60_000) });
  const fixItem = item({ source: "CHECK", code: "auto:PUT /api/sites/[id]/config", field: "COVERAGE", openedAt: fixedAt, minutes: 2, minutesEstimated: true });
  const r = scoreSite(s, [fixItem], { now: NOW, bounds });
  eq(r.windowStart?.toISOString(), first.toISOString(), "the window starts at firstActiveAt, not the latest activeAt");
  eq([r.items, r.minutes], [1, 2], "so the item the fix itself opened is counted");
  const legacy = scoreSite(site({ firstActiveAt: null }), [], { now: NOW, bounds });
  eq(legacy.windowStart?.toISOString(), D("2026-10-06T08:00:00Z").toISOString(), "a site without firstActiveAt falls back to activeAt");

  const late = site({ id: "t", siteUrl: "https://t.test", onboardingSkill: "addsite3", createdAt: D("2026-11-10T00:00:00Z"), firstActiveAt: D("2026-09-01T00:00:00Z"), activeAt: D("2026-11-11T00:00:00Z") });
  const rep = scoreCohorts([late], [], {
    now: NOW,
    bounds,
    checkCodeLiveFrom: { apply_replay_token: D("2026-10-01T00:00:00Z") },
  });
  eq(rep.checkCodeSites, { apply_replay_token: { control: 0, test: 0 } }, "the comparable-code cut-off uses firstActiveAt too");
}

// --- cohort summaries: median minutes, mean items, over complete windows ------
{
  const mk = (id: string, day: number) =>
    site({ id, siteUrl: `https://${id}.test`, createdAt: D(`2026-10-${String(day).padStart(2, "0")}T00:00:00Z`), activeAt: D(`2026-10-${String(day).padStart(2, "0")}T01:00:00Z`) });
  const a = mk("a", 2);
  const b = mk("b", 3);
  const c = mk("c", 4);
  const open = site({ id: "o", siteUrl: "https://o.test", createdAt: D("2026-10-30T00:00:00Z"), activeAt: D("2026-12-10T00:00:00Z") });
  const at = (s: ScoreSite, minutes: number) => item({ siteId: s.id, openedAt: new Date(s.activeAt!.getTime() + DAY), minutes });
  const rep = scoreCohorts([a, b, c, open], [at(a, 10), at(a, 20), at(b, 5), at(open, 999)], { now: NOW, bounds });
  eq(rep.control.sites, 4, "four control sites");
  eq(rep.control.complete, 3, "three with complete windows");
  eq(rep.control.medianMinutes, 5, "median minutes over complete windows: 30, 5, 0 -> 5");
  eq(rep.control.meanItems, 1, "mean items over complete windows: (2 + 1 + 0) / 3");
  eq(rep.test, { sites: 0, complete: 0, medianMinutes: 0, meanItems: 0 }, "an empty cohort summarises to zeros");
}

// --- step 1b: the freeze time is the control window's default -------------------------
// freezeAt = the later of 2026-10-01 00:00 Asia/Jerusalem and the last commit that
// touched addsite2 (a1c5672, 2026-09-30 10:05 +03:00). The fix-queue GET no longer
// needs it as a query parameter.
{
  eq(ADDSITE2_FREEZE_AT, "2026-09-30T21:00:00.000Z", "freezeAt is 2026-10-01 00:00 Asia/Jerusalem");
  const def = cohortBoundsFrom({});
  eq([def.freezeAt?.toISOString() ?? null, def.switchAt], [ADDSITE2_FREEZE_AT, null], "no query: freezeAt defaults to the freeze, no switch yet");
  eq(cohortBoundsFrom({ freezeAt: "2026-10-05T00:00:00Z" }).freezeAt?.toISOString(), "2026-10-05T00:00:00.000Z", "a freezeAt in the query still overrides");
  eq(cohortBoundsFrom({ switchAt: "2026-11-01T00:00:00Z" }).switchAt?.toISOString(), "2026-11-01T00:00:00.000Z", "and switchAt is read when given");
  eq(cohortOf(site({ createdAt: D("2026-10-01T06:00:00Z") }), def), "control", "a site onboarded with addsite2 on 2026-10-01 is control by default");
  eq(cohortOf(site({ createdAt: D("2026-09-30T20:59:59Z") }), def), "none", "one onboarded just before the freeze is not");
  const route = readFileSync(join(__dirname, "..", "app", "api", "dashboard", "fix-queue", "route.ts"), "utf8");
  assert(/bounds: cohortBoundsFrom\(/.test(route), "the fix-queue GET takes its bounds from cohortBoundsFrom");
}

// --- step 7: the switch time is the default switchAt, and equals SWITCH_AT ------------
// The switch commit sets ADDSITE3_SWITCH_AT here and SWITCH_AT in
// scripts/lib/checkLearnings.mjs; this pins the two together.
{
  eq(ADDSITE3_SWITCH_AT, SWITCH_AT, "ADDSITE3_SWITCH_AT equals SWITCH_AT in checkLearnings.mjs");
  eq(ADDSITE3_SWITCH_AT, null, "no switch recorded yet");
  const sw = cohortBoundsFrom({}, { switchAt: "2026-10-18T10:00:00.000Z" });
  eq(sw.switchAt?.toISOString(), "2026-10-18T10:00:00.000Z", "a recorded switch is the default switchAt");
  eq(sw.freezeAt?.toISOString(), ADDSITE2_FREEZE_AT, "freezeAt keeps its default beside it");
  eq(cohortBoundsFrom({ switchAt: "2026-11-01T00:00:00Z" }, { switchAt: "2026-10-18T10:00:00.000Z" }).switchAt?.toISOString(), "2026-11-01T00:00:00.000Z", "the query still overrides");
  eq(cohortOf(site({ createdAt: D("2026-10-19T00:00:00Z") }), sw), "addsite2_after_switch", "so the dashboard labels an untagged site created after it");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("fixScore: fourteen-day windows, MANUAL items scored, cohorts by tag and creation time");
