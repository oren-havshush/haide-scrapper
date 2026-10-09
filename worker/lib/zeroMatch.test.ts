// Run: npx tsx worker/lib/zeroMatch.test.ts
//
// 2026-09-29, night one: biopharmax's configured item selector
// (.jet-listing-grid__item) matched nothing — the site shows JetEngine's
// "no listings" block — and the worker fell back to auto-detect, which built a
// "job" titled EN out of the language switcher and published it. A wrong value
// is worse than a missing one.
//
// On a scheduled run a configured item selector that matches zero elements is
// now a listing refusal: category structure_changed, nothing stored, the
// previous rows kept, and never a fallback to auto-detect. The manual path is
// unchanged until the owner decides.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BLOCKED,
  BLOCKED_WARNING,
  WRONG_SCOPE_WARNING,
  ZERO_MATCH_WARNING,
  challengeVendor,
  isChallengeTitle,
  newExtractGuard,
  onExplicitZeroMatch,
  onLikelyWrongScope,
  scopeSuspectWarnings,
  zeroMatchRefusal,
} from "./zeroMatch";
import * as zeroMatchModule from "./zeroMatch";

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
  } catch (e) {
    console.error(`FAIL: ${name} threw — ${(e as Error).message}`);
    failures++;
  }
}

const SEL = "body .jet-listing-grid__item";

check("the decision", () => {
  const scheduled = newExtractGuard(true);
  assert(scheduled.noAutoDetect === true, "a scheduled run never falls back to auto-detect");
  assert(onExplicitZeroMatch(scheduled, SEL) === "refuse", "a zero match on a scheduled run refuses");
  assert(scheduled.zeroMatch === SEL, "and records which selector matched nothing");

  // The manual path refuses too (2026-09-30, owner's decision): a configured
  // selector that matches nothing means the page changed or emptied, and the
  // fallback's cards are guesswork an operator would then publish.
  const manual = newExtractGuard(false);
  assert(manual.noAutoDetect === true, "the manual path no longer falls back to auto-detect");
  assert(onExplicitZeroMatch(manual, SEL) === "refuse", "a manual zero match refuses");
  assert(manual.zeroMatch === SEL, "and records the selector");
  assert(onExplicitZeroMatch(null, SEL) === "auto-detect", "no guard (other callers) is today's behaviour");
});

check("the refusal", () => {
  const g = newExtractGuard(true);
  onExplicitZeroMatch(g, SEL);
  const r = zeroMatchRefusal(g, 0);
  assert(!!r, "a scheduled zero match with no rows is refused");
  assert(r?.failureCategory === "structure_changed", `category structure_changed (${r?.failureCategory})`);
  assert(!!r && r.error.includes("item selector matched nothing") && r.error.includes(SEL), `the error says so (${r?.error})`);
  assert(
    !!r && r.warnings.length === 1 && r.warnings[0] === `${ZERO_MATCH_WARNING}: ${SEL}`,
    `one warning the report can name (${JSON.stringify(r?.warnings)})`,
  );

  assert(zeroMatchRefusal(g, 5) === null, "rows from another page or listing URL: not this refusal's call");
  assert(zeroMatchRefusal(newExtractGuard(true), 0) === null, "no zero match recorded: the ordinary empty path");
  assert(r?.runStatus === "COMPLETED", "a scheduled refusal closes the run COMPLETED, like every listing refusal");
  const m = newExtractGuard(false);
  onExplicitZeroMatch(m, SEL);
  const mr = zeroMatchRefusal(m, 0);
  assert(!!mr, "the manual path is refused too");
  assert(mr?.runStatus === "FAILED", `and its run closes FAILED, so the operator sees it failed (${mr?.runStatus})`);
  assert(mr?.error === r?.error && mr?.failureCategory === "structure_changed", "with the same message and category");
  assert(zeroMatchRefusal(null, 0) === null, "no guard (the read-only rehearsal) is not judged here");
});

check("scrape.ts wires it where it counts", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const src = strip(readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8"));
  const body = (name: string) => {
    const lines = src.split("\n");
    const start = lines.findIndex((l) => new RegExp(`^(export )?(async )?function ${name}\\(`).test(l));
    const end = lines.findIndex((l, i) => i > start && l === "}");
    return start < 0 || end < 0 ? "" : lines.slice(start, end + 1).join("\n");
  };

  // 1. The fallback is not reached on a refusal.
  const once = body("extractRawFieldsFromListingPageOnce");
  assert(once.length > 500, `extractRawFieldsFromListingPageOnce extracted (${once.length})`);
  const decide = once.indexOf("onExplicitZeroMatch(");
  const fallback = once.lastIndexOf("extractWithAutoItemDetection(");
  assert(decide > 0 && decide < fallback, "the zero-match decision comes before the auto-detect fallback");
  assert(
    /onExplicitZeroMatch\([^)]*\)\s*===\s*"refuse"\)\s*\{?\s*return \[\];/.test(once.replace(/\s+/g, " ")),
    "and on refuse it returns no rows — the fallback is never called",
  );

  // 2. The guard is the run's own, and only a scheduled run's refuses.
  assert(/extract:\s*newExtractGuard\(scheduled\)/.test(src), "RunMode.extract = newExtractGuard(scheduled)");

  // 3. A zero match on a scheduled run stores no rows and keeps the previous ones.
  const exec = body("executeScrape");
  const refusalAt = exec.indexOf("zeroMatchRefusal(runMode.extract");
  const listing = exec.indexOf("decideListingOutcome(");
  const persist = exec.indexOf("buildJobRows(");
  // The detail phase starts here (the pending-seed check inside extractOneTarget
  // is earlier in the text but is the listing walk, not a detail visit).
  const pending = exec.indexOf("const pendingSeeds =");
  assert(refusalAt > listing, "the refusal is decided after the listing outcome");
  assert(refusalAt > 0 && refusalAt < persist && refusalAt < pending, "and before any detail page or any row is built");
  const flat = exec.replace(/\s+/g, " ");
  assert(
    /const zeroMatch = zeroMatchRefusal\(runMode\.extract, rawFieldsList\.length\); if \(zeroMatch\) \{ return scheduled \? await refuseListingRun\(scrapeRunId, zeroMatch\) : await failZeroMatchRun\(scrapeRunId, zeroMatch\); \}/.test(flat),
    "a scheduled run returns through refuseListingRun, a manual one through failZeroMatchRun",
  );
  // The manual close: FAILED, and not failScrapeRun — whose manual branch
  // DELETES the site's listings (scheduledRun.planScrapeFailure).
  const failZero = body("failZeroMatchRun");
  assert(failZero.length > 150, `failZeroMatchRun extracted (${failZero.length})`);
  assert(/status: "FAILED"/.test(failZero), "failZeroMatchRun closes the run FAILED");
  for (const w of ["failScrapeRun(", "planScrapeFailure(", "job.delete", "job.deleteMany", "job.create", "job.update", "site.update", "$transaction"]) {
    assert(!failZero.includes(w), `failZeroMatchRun neither deletes nor writes rows or the site (${w})`);
  }
  const refuse = body("refuseListingRun");
  assert(refuse.length > 200, "refuseListingRun extracted");
  for (const w of ["job.create", "job.createMany", "job.delete", "job.deleteMany", "job.update", "$transaction"]) {
    assert(!refuse.includes(w), `refuseListingRun writes no Job row (${w}) — previous rows are kept, none stored`);
  }
});

check("the report says what happened", () => {
  const report = readFileSync(join(__dirname, "sweepReport.ts"), "utf8");
  assert(report.includes("item selector matched nothing"), "Needs attention names it");
});

// ---------------------------------------------------------------------------
// A selector that looks wrongly scoped: never substituted on a scheduled run
// ---------------------------------------------------------------------------
//
// When the configured item selector matches one node, or yields fewer rows than
// nodes, the extractor runs auto-detect and — if auto-detect has more rows —
// publishes auto-detect's rows instead. That is a guess, and unattended a guess
// is not published: a scheduled run keeps the configured selector's rows and
// warns with both counts. The manual path, with an operator watching, still
// substitutes.

const SCOPE = { selector: "body .cvs_wrapper", matched: 1, explicit: 1, auto: 12 };

check("wrongly scoped: the decision", () => {
  const sched = newExtractGuard(true);
  assert(onLikelyWrongScope(sched, SCOPE) === "keep", "a scheduled run keeps the configured selector's rows");
  const w = scopeSuspectWarnings(sched);
  assert(w.length === 1, `and records one warning (${w.length})`);
  assert(
    w[0] ===
      `${WRONG_SCOPE_WARNING}: body .cvs_wrapper matched 1 node(s); kept 1 configured row(s), auto-detect found 12 — not substituted`,
    `carrying both counts (${w[0]})`,
  );
  onLikelyWrongScope(sched, SCOPE);
  onLikelyWrongScope(sched, { ...SCOPE, explicit: 3, auto: 9 });
  assert(scopeSuspectWarnings(sched).length === 1, "one warning per selector, however many pages repeat it");

  const manual = newExtractGuard(false);
  assert(onLikelyWrongScope(manual, SCOPE) === "substitute", "a manual run still substitutes");
  assert(scopeSuspectWarnings(manual).length === 0, "and warns nothing");
  assert(onLikelyWrongScope(null, SCOPE) === "substitute", "no guard (other callers) substitutes, as before");
  assert(scopeSuspectWarnings(null).length === 0, "and has no warnings to give");
});

check("wrongly scoped: scrape.ts asks before substituting, and persists the warning", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const src = strip(readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8"));
  const lines = src.split("\n");
  const start = lines.findIndex((l) => /^(async )?function extractRawFieldsFromListingPageOnce\(/.test(l));
  const end = lines.findIndex((l, i) => i > start && l === "}");
  const once = start < 0 || end < 0 ? "" : lines.slice(start, end + 1).join("\n");
  const flat = once.replace(/\s+/g, " ");
  assert(
    /if \(onLikelyWrongScope\(guard, scope\) === "substitute"\) \{ console\.info\(.*?\); return autoDeduped; \}/.test(flat),
    "auto-detect's rows are returned only when onLikelyWrongScope says substitute",
  );
  const returns = flat.split("return autoDeduped;").length - 1;
  assert(returns === 1, `and there is no other way out with them (${returns})`);
  assert(
    /scrapeWarnings\.push\(\.\.\.scopeSuspectWarnings\(runMode\.extract\)\)/.test(src),
    "the warning is written to the run's warnings, where the sweep reads it",
  );
});

// The report behaviour itself, on the item a refusal leaves behind.
void (async () => {
  const { needsAttention } = await import("./sweepReport");
  const g = newExtractGuard(true);
  onExplicitZeroMatch(g, SEL);
  const r = zeroMatchRefusal(g, 0)!;
  const lines = needsAttention(
    { id: "s", kind: "SCRAPE", status: "COMPLETED", trigger: "timer", startedAt: new Date(), finishedAt: new Date(), selectedCount: 1, haltReason: null },
    [{
      siteId: "b", siteUrl: "https://www.biopharmax.com/he/careers/", phase: "scrape", outcome: "soft_failure",
      failureCategory: r.failureCategory, jobsBefore: 4, jobsAfter: 4, newestJobAt: null, siteStatus: "ACTIVE",
      wouldDemoteTo: null, wouldPromoteTo: null, warnings: r.warnings,
    }],
    { timeZone: "Asia/Jerusalem" },
  );
  const why = lines[0]?.why ?? "";
  if (!why.includes(`item selector matched nothing (${SEL})`) || !why.includes("4 listing(s) kept") || why.includes("silent drift")) {
    console.error(`FAIL: the Needs-attention line names the zero match, not drift (${why})`);
    process.exitCode = 1;
  }
})();

// The blocked label (owner, 2026-10-04). fritz, 2026-10-02: `body .job_row`
// matched nothing because the page was Cloudflare's challenge ("Just a
// moment..."), not the listing; the next night it scraped 9 jobs. That is not
// a site change, so it is not structure_changed. Nothing tries to pass the
// challenge: the title is read, that is all.
check("a Cloudflare challenge page is blocked, not structure_changed", () => {
  assert(isChallengeTitle("Just a moment..."), "Cloudflare's title is a challenge");
  assert(isChallengeTitle("  just a moment"), "whatever the case and spacing");
  assert(!isChallengeTitle("משרות פתוחות - www.fritz.co.il"), "the listing's own title is not");
  assert(!isChallengeTitle(""), "no title is not");
  assert(!isChallengeTitle(null), "an unread title is not");

  const g = newExtractGuard(true);
  onExplicitZeroMatch(g, SEL, "Just a moment...");
  const r = zeroMatchRefusal(g, 0);
  assert(r?.failureCategory === BLOCKED && BLOCKED === "blocked", `category blocked (${r?.failureCategory})`);
  assert(r?.runStatus === "COMPLETED", "a scheduled run closes COMPLETED, rows kept as before");
  assert(!!r && r.error.includes("Cloudflare challenge") && r.error.includes("previous listings kept"), `the error says what it was (${r?.error})`);
  assert(
    !!r && r.warnings.includes(`${ZERO_MATCH_WARNING}: ${SEL}`) && r.warnings.includes(`${BLOCKED_WARNING}: Just a moment...`),
    `the warnings name the selector and the title (${JSON.stringify(r?.warnings)})`,
  );

  const plain = newExtractGuard(true);
  onExplicitZeroMatch(plain, SEL, "משרות פתוחות - www.fritz.co.il");
  assert(zeroMatchRefusal(plain, 0)?.failureCategory === "structure_changed", "a real page that lost its cards is still structure_changed");

  // The first zero match's title is the one kept, like its selector.
  const first = newExtractGuard(true);
  onExplicitZeroMatch(first, SEL, "Listing");
  onExplicitZeroMatch(first, "body .other", "Just a moment...");
  assert(zeroMatchRefusal(first, 0)?.failureCategory === "structure_changed", "the first zero match decides");

  const src = readFileSync(join(__dirname, "../jobs/scrape.ts"), "utf8");
  assert(
    /const zeroMatchTitle = await pageTitle\(page\);\s*if \(onExplicitZeroMatch\(guard, `\$\{listingSelector \?\? "body"\} \$\{itemSelector\}`, zeroMatchTitle\)/.test(src),
    "scrape.ts passes the page's title at the zero match",
  );
  assert(!/challenge.*(click|solve|bypass)/i.test(src.slice(src.indexOf("async function pageTitle"), src.indexOf("async function pageTitle") + 600)), "and only reads it");
});

// --- SiteGround's challenge is blocked too (owner, 2026-10-08) ------------------------------
// eso-group, gazit and sinaistore are hosted on SiteGround, which on 2026-10-08
// answered the box with its bot challenge. eso-group's response, as captured
// from the box: HTTP 202, 208 bytes, a meta refresh to /.well-known/sgcaptcha/.
{
  const zm = zeroMatchModule as Record<string, unknown>;
  const detect = zm.detectChallengeResponse as ((url: string, headers: Record<string, string>) => string | null) | undefined;
  const note = zm.noteChallengeResponse as ((g: unknown, url: string, headers: Record<string, string>) => void) | undefined;
  assert(typeof detect === "function" && typeof note === "function", "detectChallengeResponse and noteChallengeResponse exist");

  const ESO_URL = "https://eso-group.co.il/%d7%a7%d7%a8%d7%99%d7%99%d7%a8%d7%94/";
  const ESO_HEADERS = {
    server: "nginx",
    "content-type": "text/html",
    "content-length": "208",
    "sg-captcha": "challenge",
    "x-robots-tag": "noindex",
    "cache-control": "no-store,no-cache,max-age=0",
    "host-header": "8441280b0c35cbc1147f8ba998a563a7",
  };
  if (detect && note) {
    assert(/SiteGround/.test(detect(ESO_URL, ESO_HEADERS) ?? ""), "eso-group's 202 with sg-captcha: challenge is a SiteGround challenge");
    assert(
      /SiteGround/.test(detect("https://eso-group.co.il/.well-known/sgcaptcha/?r=%2F&y=ipr:1.2.3.4:1", { "content-type": "text/html" }) ?? ""),
      "so is the page it refreshes to, under /.well-known/sgcaptcha/",
    );
    assert(detect(ESO_URL, { server: "nginx", "host-header": "8441280b0c35cbc1147f8ba998a563a7" }) === null, "the real page from the same host is not");
    assert(detect("https://x.test/.well-known/other", {}) === null, "nor another .well-known path");

    // The zero-match route (eso-group, last night): blocked, not structure_changed.
    const g = newExtractGuard(true);
    note(g, ESO_URL, ESO_HEADERS);
    onExplicitZeroMatch(g, "body article.ecs-post-loop", "");
    const r = zeroMatchRefusal(g, 0);
    assert(r?.failureCategory === BLOCKED, `eso-group's zero match behind the challenge is labelled blocked (got ${r?.failureCategory})`);
    assert(r?.runStatus === "COMPLETED", "a scheduled refusal still closes COMPLETED, listings kept");
    assert((r?.warnings ?? []).some((w) => w.startsWith(`${BLOCKED_WARNING}: `) && /SiteGround/.test(w)), "with a blocked_challenge warning naming SiteGround");
    assert(/SiteGround/.test(r?.error ?? "") && /previous listings kept/.test(r?.error ?? ""), "and an error that says so");
    const manual = newExtractGuard(false);
    note(manual, ESO_URL, ESO_HEADERS);
    onExplicitZeroMatch(manual, "body article.ecs-post-loop", "");
    assert(zeroMatchRefusal(manual, 0)?.failureCategory === BLOCKED, "the manual path labels it blocked too");

    // Without the challenge, the same zero match is structure_changed, as before.
    const plain = newExtractGuard(true);
    onExplicitZeroMatch(plain, "body article.ecs-post-loop", "");
    assert(zeroMatchRefusal(plain, 0)?.failureCategory === "structure_changed", "no challenge: structure_changed, unchanged");
  }

  // --- Cloudflare's challenge, in any language (owner, 2026-10-09) ---------------------------
  // one1.co.il, the night of 2026-10-09: the worker browses in he-IL, so
  // Cloudflare's interstitial came back titled in Hebrew, and its navigation
  // response was 403 with cf-mitigated: challenge. Neither was recognised, so
  // the run read as structure_changed. The response as captured from the box.
  const ONE1_URL = "https://www.one1.co.il/careers/";
  const ONE1_HEADERS = {
    server: "cloudflare",
    "content-type": "text/html; charset=UTF-8",
    "cf-mitigated": "challenge",
    "cf-ray": "a47cdb940b0a3d7c-TLV",
  };
  // "Just a moment..." in Hebrew, built from its code points.
  const HE_TITLE = String.fromCharCode(0x5e8, 0x5e7, 0x20, 0x5e8, 0x5d2, 0x5e2) + "...";
  if (detect && note) {
    assert(/Cloudflare/.test(detect(ONE1_URL, ONE1_HEADERS) ?? ""), "a response with cf-mitigated: challenge is a Cloudflare challenge");
    assert(
      detect(ONE1_URL, { server: "cloudflare", "content-type": "text/html; charset=UTF-8", "cf-ray": "a47cdb940b0a3d7c-TLV" }) === null,
      "a plain 403 from Cloudflare without the header is not a challenge",
    );
    assert(isChallengeTitle(HE_TITLE), "Cloudflare's Hebrew title is a challenge");
    assert(isChallengeTitle("Just a moment..."), "and the English one still is");
    assert(!isChallengeTitle("One Technologies | " + String.fromCharCode(0x5d5, 0x5d5, 0x5d0, 0x5df)), "one1's own title is not");

    // one1-shaped: the header and the Hebrew title together.
    const g = newExtractGuard(true);
    note(g, ONE1_URL, ONE1_HEADERS);
    onExplicitZeroMatch(g, "body #haide-jobs-root [data-haide-job]", HE_TITLE);
    const r = zeroMatchRefusal(g, 0);
    assert(r?.failureCategory === BLOCKED, `one1's zero match behind the challenge is blocked, not structure_changed (got ${r?.failureCategory})`);
    assert(r?.runStatus === "COMPLETED", "a scheduled refusal closes COMPLETED, listings kept");
    const detail = (r?.warnings ?? []).find((w) => w.startsWith(`${BLOCKED_WARNING}: `))?.slice(BLOCKED_WARNING.length + 2) ?? "";
    assert(challengeVendor(detail) === "a Cloudflare challenge", `and the report names Cloudflare (detail "${detail}")`);

    // Either signal alone is enough.
    const byTitle = newExtractGuard(true);
    onExplicitZeroMatch(byTitle, "body .x", HE_TITLE);
    assert(zeroMatchRefusal(byTitle, 0)?.failureCategory === BLOCKED, "the Hebrew title alone: blocked");
    const byHeader = newExtractGuard(true);
    note(byHeader, ONE1_URL, ONE1_HEADERS);
    onExplicitZeroMatch(byHeader, "body .x", "");
    const rh = zeroMatchRefusal(byHeader, 0);
    assert(rh?.failureCategory === BLOCKED, "the header alone: blocked");
    const hd = (rh?.warnings ?? []).find((w) => w.startsWith(`${BLOCKED_WARNING}: `))?.slice(BLOCKED_WARNING.length + 2) ?? "";
    assert(challengeVendor(hd) === "a Cloudflare challenge", `named Cloudflare from the header's verdict (detail "${hd}")`);
    const english = newExtractGuard(true);
    onExplicitZeroMatch(english, "body .x", "Just a moment...");
    assert(zeroMatchRefusal(english, 0)?.failureCategory === BLOCKED, "the English title: still blocked");
    const plain403 = newExtractGuard(true);
    note(plain403, ONE1_URL, { server: "cloudflare", "content-type": "text/html" });
    onExplicitZeroMatch(plain403, "body .x", "Forbidden");
    assert(zeroMatchRefusal(plain403, 0)?.failureCategory === "structure_changed", "a plain 403 page, no header, no challenge title: not a challenge");
  }

  // The crash route (gazit, sinaistore): categorizeError reads the run's guard.
  const scrape = readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8");
  const cat = scrape.slice(scrape.indexOf("function categorizeError("), scrape.indexOf("function categorizeError(") + 900);
  assert(/guard\?\.challenge/.test(cat) && cat.indexOf("guard?.challenge") < cat.indexOf('"timeout"'), "categorizeError labels a run that met a challenge blocked, before anything else");
  assert(/categorizeError\([\s\S]{0,200}runMode\.extract,?\s*\)/.test(scrape), "and the failure path passes it the run's guard");
  const exec = scrape.slice(scrape.indexOf("async function executeScrape("), scrape.indexOf("async function executeScrape(") + 3000);
  assert(/page\.on\("response"[\s\S]{0,400}noteChallengeResponse\(runMode\.extract/.test(exec), "executeScrape notes challenge responses on the main frame's navigations");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("zeroMatch: a scheduled run never publishes auto-detected cards for a selector that matched nothing");
