// Run: npx tsx scripts/lib/cohortScore.test.ts
//
// scripts/cohort-score.ts (addsite2 phase two, step 7) reads the sites and the
// fix queue through the API and scores control against test with fixScore.
// These cases pin what the script adds: API rows become score rows, the
// medians and means, the CHECK items only on codes live across both windows
// (checkCodeLiveFrom), and the switch forecast — how many control windows
// have completed and the date the tenth will.

import type { SiteScore } from "../../src/lib/fixScore";
import { VALUE_CHECK_QUEUE_CODES } from "../../worker/lib/valueChecks";
import * as cohortScoreModule from "./cohortScore";
import {
  CHECK_CODES_LIVE_FROM,
  buildCohortReport,
  checkCodeLiveFrom,
  cohortStats,
  formatCohortReport,
  switchForecast,
  toScoreItem,
  toScoreSite,
  type ApiItem,
  type ApiSite,
} from "./cohortScore";

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

const site = (id: string, firstActiveAt: string | null, over: Partial<ApiSite> = {}): ApiSite => ({
  id,
  siteUrl: `https://${id}.co.il`,
  status: "ACTIVE",
  createdAt: "2026-10-01T06:00:00.000Z",
  activeAt: firstActiveAt,
  firstActiveAt,
  onboardingSkill: null,
  ...over,
});

// Eight control windows close 10-15, one 10-16, one 10-18; one control site
// never went ACTIVE; one addsite3 site; one site from before the freeze.
const SITES: ApiSite[] = [
  ...["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => site(id, "2026-10-01T10:00:00.000Z")),
  site("i", "2026-10-02T10:00:00.000Z"),
  site("j", "2026-10-04T10:00:00.000Z"),
  site("never", null, { status: "REVIEW" }),
  site("t1", "2026-10-06T10:00:00.000Z", { onboardingSkill: "addsite3", createdAt: "2026-10-06T08:00:00.000Z" }),
  site("old", "2026-09-20T10:00:00.000Z", { createdAt: "2026-09-20T08:00:00.000Z" }),
];

const ITEMS: ApiItem[] = [
  { siteId: "a", field: "APPLY", source: "MANUAL", code: "manual", openedAt: "2026-10-02T09:00:00.000Z", minutes: 12 },
  { siteId: "a", field: "LOCATION", source: "CHECK", code: "auto:config", openedAt: "2026-10-03T09:00:00.000Z", minutes: 30, minutesEstimated: true },
  { siteId: "a", field: "APPLY", source: "CHECK", code: "auto:status", openedAt: "2026-10-03T11:00:00.000Z", minutes: 30, minutesEstimated: true },
  { siteId: "a", field: "LOCATION", source: "CHECK", code: "region_over_city", openedAt: "2026-10-04T20:00:00.000Z", minutes: null },
];

const NOW = new Date("2026-10-05T12:00:00.000Z");

// ---- API rows become score rows ------------------------------------------
{
  const s = toScoreSite(site("a", "2026-10-01T10:00:00.000Z"));
  eq(s.id, "a", "site id kept");
  eq(s.createdAt.toISOString(), "2026-10-01T06:00:00.000Z", "createdAt parsed");
  eq(s.firstActiveAt?.toISOString(), "2026-10-01T10:00:00.000Z", "firstActiveAt parsed (the window anchor)");
  eq(toScoreSite(site("n", null)).activeAt, null, "a never-active site keeps activeAt null");
  const i = toScoreItem(ITEMS[1]);
  eq([i.siteId, i.field, i.source, i.code, i.openedAt.toISOString(), i.minutes, i.minutesEstimated], ["a", "LOCATION", "CHECK", "auto:config", "2026-10-03T09:00:00.000Z", 30, true], "item fields kept, estimate flag carried");
}

// ---- checkCodeLiveFrom: the twelve queue codes from the 2b deploy; a later code from its own ----
{
  const m = checkCodeLiveFrom();
  const later = (cohortScoreModule as Record<string, unknown>).CHECK_CODE_LIVE_FROM as Record<string, string | null> | undefined;
  assert(later !== undefined && "apply_endpoint_mismatch" in later, "a per-code live-from map names apply_endpoint_mismatch (owner, 2026-10-08)");
  const twelve = [...VALUE_CHECK_QUEUE_CODES].filter((c) => !(later && c in later));
  eq(twelve.length, 12, "twelve queue codes go live with the 2b deploy");
  for (const c of twelve) {
    assert(m[c]?.toISOString() === new Date(CHECK_CODES_LIVE_FROM).toISOString(), `${c} is live from 2026-10-04T13:42:25Z`);
  }
  // A later code is scored only from its own deploy's worker start; until that
  // date is recorded it is not scored at all (fixScore never scores a code with none).
  const own = later?.apply_endpoint_mismatch ?? null;
  if (own === null) assert(!("apply_endpoint_mismatch" in m), "apply_endpoint_mismatch has no live date yet, so it is not scored");
  else assert(m.apply_endpoint_mismatch?.toISOString() === new Date(own).toISOString(), `apply_endpoint_mismatch is live from ${own}`);
  assert(!("apply_replay_token" in m), "apply_replay_token is a warning, not a queue code");
}

// ---- medians and means ---------------------------------------------------
{
  const s = (items: number, fields: number, minutes: number, checkItems: number) =>
    ({ items, fields, minutes, checkItems }) as SiteScore;
  const odd = cohortStats([s(1, 1, 0, 0), s(2, 1, 30, 1), s(10, 3, 40, 5)]);
  eq([odd.sites, odd.medianItems, odd.medianFields, odd.medianMinutes, odd.medianCheckItems], [3, 2, 1, 30, 1], "odd count: middle values");
  eq(Math.round(odd.meanItems * 1000), 4333, "mean items 13/3");
  eq([odd.meanFields, Math.round(odd.meanMinutes * 1000) / 1000, odd.meanCheckItems], [5 / 3, 23.333, 2], "means of fields, minutes, check items");
  const even = cohortStats([s(0, 0, 0, 0), s(1, 1, 30, 0), s(2, 2, 40, 0), s(3, 3, 50, 0)]);
  eq([even.medianItems, even.medianMinutes, even.meanMinutes], [1.5, 35, 30], "even count: mean of the two middle values");
  eq(cohortStats([]).sites, 0, "an empty cohort is zeros, not NaN");
  assert(!Number.isNaN(cohortStats([]).meanItems), "empty mean is 0");
}

// ---- the report: cohorts, CHECK restricted to codes live across both windows --
{
  const r = buildCohortReport({ sites: SITES, items: ITEMS, now: NOW });
  const a = r.score.sites.find((x) => x.siteId === "a");
  eq([a?.cohort, a?.items, a?.fields, a?.minutes], ["control", 3, 2, 42], "site a: 3 items, 2 fields, 12 typed + 30 estimated once that day");
  eq(r.score.checkCodeSites.region_over_city, { control: 0, test: 1 }, "per site: no control window opened after 10-04 13:42Z, the test window (10-06) did");
  eq(Object.keys(r.score.checkCodeSites).length, 12, "every queue code is accounted for");
  eq(a?.checkItems, 0, "so a's region_over_city item is not scored");
  eq(r.allCheckItems.get("a"), 1, "but is listed for information");
  eq(r.score.sites.filter((x) => x.cohort === "control").length, 11, "eleven control sites (incl. never-active)");
  eq(r.score.sites.filter((x) => x.cohort === "test").map((x) => x.siteId), ["t1"], "the addsite3 site is test");
  assert(!r.score.sites.some((x) => x.siteId === "old"), "a site from before the freeze is in neither cohort");

  const early = Object.fromEntries([...VALUE_CHECK_QUEUE_CODES].map((c) => [c, new Date("2026-09-01T00:00:00Z")]));
  const r2 = buildCohortReport({ sites: SITES, items: ITEMS, now: NOW, liveFrom: early });
  eq(r2.score.sites.find((x) => x.siteId === "a")?.checkItems, 1, "a code live before every window is scored");
  eq(r2.stats.control.soFar.meanCheckItems, 1 / 11, "and counts in the control cohort's means");
}

// ---- switchAt: the one recorded in checkLearnings.mjs SWITCH_AT -----------
{
  const before = buildCohortReport({ sites: SITES, items: ITEMS, now: NOW });
  eq(before.switchAt?.toISOString() ?? null, "2026-10-07T09:31:51.000Z", "with no switchAt given, the recorded SWITCH_AT (2026-10-07T09:31:51Z) is used");
  const late = site("late", "2026-10-21T10:00:00.000Z", { createdAt: "2026-10-21T08:00:00.000Z" });
  const r = buildCohortReport({ sites: [...SITES, late], items: ITEMS, now: NOW, switchAt: "2026-10-18T10:00:00.000Z" });
  eq(r.switchAt?.toISOString(), "2026-10-18T10:00:00.000Z", "a given switchAt is used");
  assert(!r.score.sites.some((x) => x.siteId === "late"), "an untagged site created after the switch is not control");
  eq(r.score.excluded.map((x) => x.siteId), ["late"], "it is listed as addsite2 after switch");
  const text = formatCohortReport(r).join("\n");
  assert(text.includes("switchAt 2026-10-18T10:00:00.000Z"), "the header prints the switchAt");
  assert(text.includes("addsite2 after switch (listed, not scored): https://late.co.il"), "and the excluded site");
}

// ---- the switch forecast -------------------------------------------------
{
  const scores = buildCohortReport({ sites: SITES, items: ITEMS, now: NOW }).score.sites;
  const f = switchForecast(scores, NOW);
  eq([f.needed, f.controlSites, f.completed, f.withoutWindow], [10, 11, 0, 1], "today: none complete, one control site has no window");
  eq(f.tenthCompletesAt?.toISOString(), "2026-10-18T10:00:00.000Z", "the tenth window closes 10-18");
  eq(f.tenthWithMinutesCompletesAt, null, "only a has minutes so far: no tenth window with minutes logged yet");
  const withMinutes: ApiItem[] = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((id) => ({
    siteId: id, field: "APPLY", source: "MANUAL", code: "manual", openedAt: "2026-10-04T12:00:00.000Z", minutes: id === "b" ? 0 : 5,
  }));
  const fm = switchForecast(buildCohortReport({ sites: [...SITES, site("k", "2026-10-05T10:00:00.000Z")], items: [...withMinutes, { ...withMinutes[0], siteId: "k", openedAt: "2026-10-05T12:00:00.000Z" }], now: NOW }).score.sites, NOW);
  eq(fm.tenthCompletesAt?.toISOString(), "2026-10-18T10:00:00.000Z", "by windows alone the tenth is still j's");
  eq(fm.tenthWithMinutesCompletesAt?.toISOString(), "2026-10-19T10:00:00.000Z", "b has no minutes, so the tenth with minutes logged is k's, a day later");

  const later = new Date("2026-10-16T12:00:00.000Z");
  const lateScores = buildCohortReport({ sites: SITES, items: ITEMS, now: later }).score.sites;
  const f2 = switchForecast(lateScores, later);
  eq([f2.completed, f2.completedWithMinutes], [9, 1], "10-16: nine complete, one with minutes");

  const nine = SITES.filter((s) => s.id !== "j");
  const f3 = switchForecast(buildCohortReport({ sites: nine, items: ITEMS, now: NOW }).score.sites, NOW);
  eq(f3.tenthCompletesAt, null, "nine control windows: the tenth date is not known yet");
  assert(!switchForecast(scores.filter((s) => s.cohort === "test"), NOW).tenthCompletesAt, "test sites never count toward the switch");
}

// ---- the printed report --------------------------------------------------
{
  const text = formatCohortReport(buildCohortReport({ sites: SITES, items: ITEMS, now: NOW })).join("\n");
  assert(text.includes("0 of 11 control sites have completed their 14-day windows as of 2026-10-05"), "the completed line");
  assert(text.includes("the tenth completes on 2026-10-18 (13:00 Jerusalem)"), "the tenth's date, Jerusalem time");
  assert(text.includes("counting only sites with minutes logged so far: 1 control site(s) have minutes; the tenth is not known yet"), "the minutes-logged reading is printed too");
  assert(text.includes("https://t1.co.il"), "the test site is listed");
  assert(text.includes("https://a.co.il"), "a control site is listed");
  assert(text.includes("region_over_city: comparable on 0 control and 1 test site(s)"), "each code's comparable site counts are printed");
  assert(!text.includes("comparable CHECK codes: none"), "the cross-cohort line is gone");
  assert(/median minutes/.test(text) && /mean items/.test(text), "medians and means printed");
  const nineText = formatCohortReport(buildCohortReport({ sites: SITES.filter((s) => s.id !== "j"), items: ITEMS, now: NOW })).join("\n");
  assert(nineText.includes("the tenth is not known yet"), "fewer than ten windows says so");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("cohortScore: API rows scored by fixScore, medians and means, comparable CHECK codes, the switch forecast");
