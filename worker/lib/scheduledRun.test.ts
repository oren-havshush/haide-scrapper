// Run: npx tsx worker/lib/scheduledRun.test.ts
//
// Two properties, and every case below belongs to one of them:
//
//   1. A scheduled run changes no site. Not its status, not its adminNote, not
//      its listings — no matter which of the seven write sites is reached.
//   2. A manual run behaves exactly as it does today.
//
// The second is load-bearing. The easy way to write this change is to make
// everything non-destructive, which would silently alter the path an operator
// uses all day. Half of these assertions exist to catch that.

import {
  ACTIVATION_GATE_NOTE_PREFIX,
  DEFAULT_DROP_THRESHOLDS,
  FIELD_FILL_THRESHOLD,
  INSERT_BATCH,
  MAX_ROWS,
  chunkRows,
  describedJobsLost,
  isFieldFillDrop,
  isSuspiciousDrop,
  mayOverwriteAdminNote,
  planActivationGate,
  planApplyLoginSkip,
  planScheduledPersist,
  planScrapeFailure,
  readDetailMode,
  readScheduledFlag,
} from "./scheduledRun";
import { sweepConfig } from "../../src/lib/config";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

/** A block that throws is a failure of that block, not the end of the run. */
function check(name: string, body: () => void) {
  try {
    body();
  } catch (err) {
    console.error(`FAIL: ${name} threw: ${(err as Error).message}`);
    failures++;
  }
}

// ---------------------------------------------------------------------------
// 1. A scheduled run changes no site (R4, R5, R13)
// ---------------------------------------------------------------------------

// Every gated write, asked the same question. If any of these ever returns
// applySiteWrite or deleteListings, an unattended night can publish a wrong
// answer to the public jobs site.
const scheduledDecisions = {
  "apply-login skip": planApplyLoginSkip({ scheduled: true, note: "login-gated" }),
  "scrape failure": planScrapeFailure({ scheduled: true }),
  "gate promote": planActivationGate({
    scheduled: true,
    gateStatus: "ACTIVE",
    gateReason: "Tier-A complete",
    currentStatus: "REVIEW",
  }),
  "gate demote": planActivationGate({
    scheduled: true,
    gateStatus: "REVIEW",
    gateReason: "title fill 40% < 90%",
    currentStatus: "ACTIVE",
  }),
};

for (const [name, d] of Object.entries(scheduledDecisions)) {
  assert(!d.applySiteWrite, `scheduled ${name}: writes nothing to the Site row`);
  assert(!d.deleteListings, `scheduled ${name}: deletes no listings`);
  assert(!d.emitStatusChange, `scheduled ${name}: announces no status change that did not happen`);
}

// ...and each records what it withheld, or the report is useless.
assert(
  scheduledDecisions["apply-login skip"].withheld.wouldSkip === "login-gated",
  "a withheld SKIP is reported with its note",
);
assert(
  scheduledDecisions["gate promote"].withheld.wouldPromoteTo === "ACTIVE",
  "a withheld promotion is reported — a human promotes, never the nightly (R5)",
);
assert(
  scheduledDecisions["gate demote"].withheld.wouldDemoteTo === "REVIEW",
  "a withheld demotion is reported",
);
assert(
  scheduledDecisions["gate demote"].withheld.gateReason === "title fill 40% < 90%",
  "the gate's reason travels with the verdict",
);

// A failed scrape reports through the ScrapeRun, not the Site — there is
// nothing withheld to name, and inventing a field here would put a "would"
// line in the report for every ordinary failure.
assert(
  Object.keys(planScrapeFailure({ scheduled: true }).withheld).length === 0,
  "a scheduled failure withholds no site verdict",
);

// A verdict matching where the site already sits is not news. Without this the
// nightly report is 145 lines of "would leave ACTIVE as ACTIVE" and nobody
// reads the four that matter.
{
  const same = planActivationGate({
    scheduled: true,
    gateStatus: "ACTIVE",
    gateReason: "Tier-A complete",
    currentStatus: "ACTIVE",
  });
  assert(same.withheld.wouldPromoteTo === undefined, "no promotion is reported for an ACTIVE site");
  assert(same.withheld.gateReason === undefined, "and no reason either");
}

// ---------------------------------------------------------------------------
// 2. The manual path is unchanged (B)
// ---------------------------------------------------------------------------

{
  const d = planApplyLoginSkip({ scheduled: false, note: "login-gated" });
  assert(d.applySiteWrite, "manual apply-login skip still moves the site to SKIPPED");
  assert(d.emitStatusChange, "manual skip still announces the change");
  assert(Object.keys(d.withheld).length === 0, "a manual run withholds nothing");
}

{
  // Today's manual failure path deletes the listings. That is destructive, and
  // it is deliberately left alone: the plan scopes this change to the
  // unattended path, and an operator watching a failure can act on it. If this
  // assertion ever has to change, that is a decision, not a refactor.
  const d = planScrapeFailure({ scheduled: false });
  assert(d.applySiteWrite, "manual failure still sets the site FAILED");
  assert(d.deleteListings, "manual failure still deletes listings — unchanged, on purpose");
}

{
  const d = planActivationGate({
    scheduled: false,
    gateStatus: "ACTIVE",
    gateReason: "Tier-A complete",
    currentStatus: "REVIEW",
  });
  assert(d.applySiteWrite, "manual runs still promote");
  assert(Object.keys(d.withheld).length === 0, "a manual promotion is applied, not reported");
}

// ---------------------------------------------------------------------------
// The adminNote guard — the one deliberate manual-path change
// ---------------------------------------------------------------------------

assert(mayOverwriteAdminNote(null), "an absent note may be written");
assert(mayOverwriteAdminNote(""), "an empty note carries nothing to protect");
assert(mayOverwriteAdminNote("   "), "nor does whitespace");
assert(
  mayOverwriteAdminNote(`${ACTIVATION_GATE_NOTE_PREFIX}title fill 40% < 90%`),
  "the gate may replace its own note",
);
assert(
  !mayOverwriteAdminNote("Contacted HR 2026-08-14, they are fixing the feed"),
  "an operator's note is never overwritten — this is the bug the guard fixes",
);
assert(
  !mayOverwriteAdminNote("see [activation-gate] note below"),
  "the prefix must be at the START; matching anywhere would let prose through",
);

// ---------------------------------------------------------------------------
// Atomic persistence (R1, A)
// ---------------------------------------------------------------------------

assert(planScheduledPersist(0, 0).mode === "empty", "nothing extracted writes nothing");
assert(planScheduledPersist(-1, 0).mode === "empty", "and a negative count cannot reach a delete");
assert(
  planScheduledPersist(0, 433).mode === "empty",
  "an empty extraction over a full site is still `empty`, which writes nothing either",
);

{
  // The largest real site in the fleet (אלביט מערכות, 675 listings).
  const p = planScheduledPersist(675, 675);
  assert(p.mode === "commit", "the largest real site commits");
  assert(p.mode === "commit" && p.batches === 2, "in two batches, inside one transaction");
}

{
  const p = planScheduledPersist(MAX_ROWS + 1, 0);
  assert(p.mode === "oversize", "an implausible row count refuses");
  assert(
    p.mode === "oversize" && p.rowCount === MAX_ROWS + 1 && p.limit === MAX_ROWS,
    "and reports both numbers so the report says how far out it was",
  );
}
assert(planScheduledPersist(MAX_ROWS, MAX_ROWS).mode === "commit", "the cap itself still commits");

// ---------------------------------------------------------------------------
// The undersize guard — a site made worse is not committed
// ---------------------------------------------------------------------------
//
// 2026-09-15: maccabi4u's scheduled run extracted 8 listings where the site had
// 433, committed them as `success`, and published 8. A scrape that returns a
// fraction of what the site had is far likelier to be a broken page than 425
// jobs filled overnight; unattended, the run must refuse. An operator who knows
// the drop is real accepts it by scraping by hand.

check("the undersize guard", () => {
  assert(
    DEFAULT_DROP_THRESHOLDS.minPrevious === 10 && DEFAULT_DROP_THRESHOLDS.keepRatio === 0.5,
    "the defaults are 10 previous listings and half of them (3 for one night refused real churn on small sites)",
  );

  const p = planScheduledPersist(8, 433);
  assert(p.mode === "suspicious_drop", `maccabi4u's night — 433 to 8 — refuses (got ${p.mode})`);
  assert(
    p.mode === "suspicious_drop" && p.rowCount === 8 && p.previousCount === 433,
    "and carries both counts, so the item and the report can say what was refused",
  );

  // The boundaries, both sides of each threshold.
  assert(planScheduledPersist(4, 10).mode === "suspicious_drop", "10 -> 4 is below half of 10");
  assert(planScheduledPersist(5, 10).mode === "commit", "10 -> 5 is exactly half, and commits");
  assert(planScheduledPersist(1, 9).mode === "commit", "9 previous is under the minimum; any drop commits");
  assert(planScheduledPersist(4, 10).mode === "suspicious_drop", "10 is the smallest site the guard judges");
  // Night two (2026-09-30), under the one-night floor of 3: both drops were
  // real, and both were refused. Under 10 they commit, as ordinary churn on a
  // small site should. The case the lower floor was meant for — a selector
  // matching nothing — is refused by worker/lib/zeroMatch.ts instead.
  assert(planScheduledPersist(2, 5).mode === "commit", "pac, night two: 5 -> 2 commits");
  assert(planScheduledPersist(2, 6).mode === "commit", "bankhapoalim, night two: 6 -> 2 commits");
  assert(planScheduledPersist(216, 433).mode === "suspicious_drop", "433 -> 216 is below half");
  assert(planScheduledPersist(217, 433).mode === "commit", "433 -> 217 is not");
  assert(planScheduledPersist(900, 433).mode === "commit", "growth is never a drop");
  assert(planScheduledPersist(3, 0).mode === "commit", "a site with nothing before commits its first listings");

  // Oversize is checked first; the two cannot both apply, but the order is fixed.
  assert(planScheduledPersist(MAX_ROWS + 1, 20_000).mode === "oversize", "oversize wins over a drop");

  // Thresholds are parameters, so the env override reaches the same rule.
  assert(
    planScheduledPersist(8, 12, { minPrevious: 20, keepRatio: 0.5 }).mode === "commit",
    "a raised minimum lets a small site's drop through",
  );
  assert(
    planScheduledPersist(80, 100, { minPrevious: 10, keepRatio: 0.9 }).mode === "suspicious_drop",
    "a raised ratio refuses a smaller drop",
  );

  assert(isSuspiciousDrop(433, 8), "isSuspiciousDrop is the same rule the plan applies");
  assert(!isSuspiciousDrop(433, 217), "on both sides");
  assert(!isSuspiciousDrop(9, 0), "including the minimum");
  assert(isSuspiciousDrop(10, 0), "which is 10");
});

check("SWEEP_DROP_* from the environment", () => {
  const saved = {
    min: process.env.SWEEP_DROP_MIN_PREVIOUS,
    ratio: process.env.SWEEP_DROP_KEEP_RATIO,
  };
  const set = (min: string | undefined, ratio: string | undefined) => {
    if (min === undefined) delete process.env.SWEEP_DROP_MIN_PREVIOUS;
    else process.env.SWEEP_DROP_MIN_PREVIOUS = min;
    if (ratio === undefined) delete process.env.SWEEP_DROP_KEEP_RATIO;
    else process.env.SWEEP_DROP_KEEP_RATIO = ratio;
  };
  try {
    set(undefined, undefined);
    assert(sweepConfig.dropMinPrevious === 10, `unset minimum is 10 (got ${sweepConfig.dropMinPrevious})`);
    assert(sweepConfig.dropKeepRatio === 0.5, "unset ratio is 0.5");

    set("25", "0.7");
    assert(sweepConfig.dropMinPrevious === 25, "a valid minimum is read");
    assert(sweepConfig.dropKeepRatio === 0.7, "a valid ratio is read");

    // A malformed value must never switch the guard off. NaN compares false
    // with everything, so a NaN ratio would let every drop through silently.
    for (const bad of ["", "abc", "0.5abc", "0", "-0.2", "1.5", "NaN"]) {
      set("10", bad);
      assert(sweepConfig.dropKeepRatio === 0.5, `ratio "${bad}" falls back to 0.5 (got ${sweepConfig.dropKeepRatio})`);
    }
    for (const bad of ["", "abc", "0", "-3", "2.5", "10x"]) {
      set(bad, "0.5");
      assert(sweepConfig.dropMinPrevious === 10, `minimum "${bad}" falls back to 10 (got ${sweepConfig.dropMinPrevious})`);
    }
  } finally {
    set(saved.min, saved.ratio);
  }
});

{
  // 500 rows x ~19 columns is ~9,500 bind parameters, against Postgres's 65,535
  // cap. A batch big enough to trip that limit would fail only on the biggest
  // sites, in production, at night.
  assert(INSERT_BATCH * 19 < 65_535, "a batch stays well inside the bind-parameter cap");
}

{
  const rows = Array.from({ length: 1201 }, (_, i) => i);
  const batches = chunkRows(rows, INSERT_BATCH);
  assert(batches.length === 3, "1201 rows split into three batches");
  assert(batches.flat().length === rows.length, "no row is dropped");
  assert(
    batches.flat().every((v, i) => v === rows[i]),
    "and order is preserved — the primary location is locations[0] of the same row",
  );
  assert(batches[batches.length - 1]!.length === 201, "the final batch holds the remainder");
}

assert(chunkRows([], INSERT_BATCH).length === 0, "no rows, no batches");

{
  let threw = false;
  try {
    chunkRows([1, 2, 3], 0);
  } catch {
    threw = true;
  }
  assert(threw, "a zero batch size throws rather than looping forever");
}

// ---------------------------------------------------------------------------
// The flag itself
// ---------------------------------------------------------------------------

assert(readScheduledFlag({ scheduled: true }), "the flag is read from the payload");
assert(!readScheduledFlag({ scheduled: false }), "false is manual");
assert(!readScheduledFlag({}), "absent is manual — every existing job in the queue");
assert(!readScheduledFlag(null), "a null payload is manual");
assert(!readScheduledFlag(undefined), "so is no payload at all");
assert(
  !readScheduledFlag({ scheduled: "true" }),
  "only a real boolean counts; a string would let JSON round-tripping decide site writes",
);
assert(!readScheduledFlag([{ scheduled: true }]), "an array payload is not a payload");

// ---------------------------------------------------------------------------
// The detail mode — incremental only when the driver says so
// ---------------------------------------------------------------------------
//
// Carrying stored text forward is a scheduled-only behaviour. The manual path
// always fetches everything, so the only payload that may read "incremental"
// is one that is also scheduled — which only worker/sweep/nightly.ts writes.

check("readDetailMode", () => {
  assert(
    readDetailMode({ scheduled: true, detailMode: "incremental" }) === "incremental",
    "the driver's incremental payload is incremental",
  );
  assert(readDetailMode({ scheduled: true, detailMode: "full" }) === "full", "its full payload is full");
  assert(readDetailMode({ scheduled: true }) === "full", "a scheduled payload that says nothing is full");
  assert(
    readDetailMode({ scheduled: false, detailMode: "incremental" }) === "full",
    "a manual payload is full whatever it says — the dashboard always fetches everything",
  );
  assert(readDetailMode({ detailMode: "incremental" }) === "full", "so is one with no scheduled flag");
  assert(
    readDetailMode({ scheduled: "true", detailMode: "incremental" }) === "full",
    "a string flag is not the flag",
  );
  assert(
    readDetailMode({ scheduled: true, detailMode: "INCREMENTAL" }) === "full",
    "only the exact value counts",
  );
  assert(readDetailMode(null) === "full", "no payload is full");
  assert(readDetailMode(undefined) === "full", "nor is an absent one");
  assert(readDetailMode([{ scheduled: true, detailMode: "incremental" }]) === "full", "an array is not a payload");
});

// ---------------------------------------------------------------------------
// field_fill_drop — the count holds but the text is gone
// ---------------------------------------------------------------------------
//
// 2026-09-30: personetics' 12 per-job fetches all failed with
// ERR_HTTP2_PROTOCOL_ERROR, and the scheduled run committed 12 rows with no
// description over 12 that had one. The count guard cannot see that — 12 -> 12.
// Description fill falling from at or above the activation gate's 60% to below
// it is refused, and the stored rows are kept.

check("field_fill_drop", () => {
  assert(FIELD_FILL_THRESHOLD === 0.6, `the threshold is the activation gate's 60% (got ${FIELD_FILL_THRESHOLD})`);

  const fill = (pf: number, pt: number, nf: number, nt: number) => ({
    description: { previous: { filled: pf, total: pt }, next: { filled: nf, total: nt } },
  });
  const plan = (rows: number, prev: number, f?: ReturnType<typeof fill>) =>
    planScheduledPersist(rows, prev, DEFAULT_DROP_THRESHOLDS, { paginationTruncated: false }, f);

  const pers = plan(12, 12, fill(12, 12, 0, 12));
  assert(pers.mode === "field_fill_drop", `personetics, 12/12 -> 0/12, is refused (got ${pers.mode})`);
  if (pers.mode === "field_fill_drop") {
    assert(pers.field === "description", "naming the field");
    assert(pers.previousFill === 1 && pers.newFill === 0, `with both fills (${pers.previousFill} -> ${pers.newFill})`);
    assert(pers.rowCount === 12 && pers.previousCount === 12, "and both counts");
  }

  assert(plan(10, 10, fill(6, 10, 5, 10)).mode === "field_fill_drop", "60% -> 50% crosses the bar and is refused");
  assert(plan(10, 10, fill(6, 10, 6, 10)).mode === "commit", "60% -> 60% stays on it and commits");
  // Since rule A (owner, 2026-10-10) a fall of 25 points or more is refused
  // whether or not it crosses the bar (worker/lib/fillFallGuard.test.ts); a
  // smaller fall that does not cross it still commits.
  assert(plan(10, 10, fill(10, 10, 6, 10)).mode === "field_fill_drop", "100% -> 60% does not cross the bar, but falls 40 points: refused");
  assert(plan(10, 10, fill(10, 10, 8, 10)).mode === "commit", "100% -> 80% (20 points, above the bar) commits");
  assert(plan(10, 10, fill(5, 10, 0, 10)).mode === "field_fill_drop", "a site already below 60% that falls 50 points is refused");
  assert(plan(10, 10, fill(5, 10, 3, 10)).mode === "commit", "a site already below 60% that falls 20 points commits");
  assert(plan(5, 0, fill(0, 0, 0, 5)).mode === "commit", "nothing stored, nothing to protect: commits");
  assert(plan(12, 12).mode === "commit", "no fill given (the manual shape) commits as before");
  assert(plan(12, 12, fill(12, 12, 0, 0)).mode === "commit", "no new rows to measure is not a fill verdict");

  assert(
    plan(8, 433, fill(433, 433, 0, 8)).mode === "suspicious_drop",
    "a count refusal comes first — the report names the bigger fault",
  );
  assert(plan(MAX_ROWS + 1, 12, fill(12, 12, 0, MAX_ROWS + 1)).mode === "oversize", "so does the cap");

  assert(isFieldFillDrop({ filled: 12, total: 12 }, { filled: 0, total: 12 }), "isFieldFillDrop: the personetics shape");
  assert(!isFieldFillDrop({ filled: 0, total: 0 }, { filled: 0, total: 12 }), "isFieldFillDrop: nothing stored");
  assert(!isFieldFillDrop({ filled: 12, total: 12 }, { filled: 0, total: 0 }), "isFieldFillDrop: nothing new");
});

// ---------------------------------------------------------------------------
// field_fill_drop, per job — a described job written bare (owner, 2026-10-07)
// ---------------------------------------------------------------------------
//
// The threshold rule above cannot see a site that was already below 60%
// (allegronet 3/6 -> 0/6 commits), a fall that stays above it, or a loss offset
// by new described jobs. Matched by externalJobId: a stored job with a
// description that would be written without one is lost. Refused when at least
// one is lost and the lost are at least 20% of the stored described jobs.

check("field_fill_drop per job", () => {
  const row = (id: string | null, description: string | null) => ({ externalJobId: id, description });
  const plan = (stored: ReturnType<typeof row>[], next: ReturnType<typeof row>[]) => {
    const filled = (rows: ReturnType<typeof row>[]) => rows.filter((r) => (r.description ?? "").trim().length > 0).length;
    return planScheduledPersist(next.length, stored.length, DEFAULT_DROP_THRESHOLDS, { paginationTruncated: false }, {
      description: {
        previous: { filled: filled(stored), total: stored.length },
        next: { filled: filled(next), total: next.length },
        lost: describedJobsLost(stored, next),
      },
    });
  };

  // 1. allegronet, already below 60%: 3/6 -> 0/6 with the same ids.
  const allegroStored = [
    row("allegronet-JB-4", "תיאור"), row("allegronet-JB-5", null), row("allegronet-JB-6", null),
    row("allegronet-JB-7", "תיאור"), row("allegronet-JB-8", null), row("allegronet-JB-9", "תיאור"),
  ];
  const allegroNext = allegroStored.map((r) => row(r.externalJobId, null));
  const a = plan(allegroStored, allegroNext);
  assert(a.mode === "field_fill_drop", `1. allegronet 3/6 -> 0/6 is refused (got ${a.mode})`);
  if (a.mode === "field_fill_drop") {
    assert(JSON.stringify(a.lost) === JSON.stringify(["allegronet-JB-4", "allegronet-JB-7", "allegronet-JB-9"]), `naming the lost ids (got ${JSON.stringify(a.lost)})`);
  }

  // 2. mor: 4/7 -> 3/7, mor-1385 loses its description: 1 of 4 = 25%.
  const morStored = [
    row("mor-1101", null), row("mor-1232", "x"), row("mor-1326", "x"), row("mor-1338-a1x2lg", null),
    row("mor-1338-q2ofyj", null), row("mor-1353", "x"), row("mor-1385", "x"),
  ];
  const morNext = morStored.map((r) => (r.externalJobId === "mor-1385" ? row("mor-1385", "  ") : r));
  const m = plan(morStored, morNext);
  assert(m.mode === "field_fill_drop", `2. mor 4/7 -> 3/7, one of four lost (25%), is refused (got ${m.mode})`);
  if (m.mode === "field_fill_drop") assert(JSON.stringify(m.lost) === JSON.stringify(["mor-1385"]), "naming mor-1385");

  // 3. ten described, one loses it: 10% < 20%, an employer edit, commits.
  const ten = Array.from({ length: 10 }, (_, i) => row(`j${i}`, "x"));
  const tenNext = ten.map((r) => (r.externalJobId === "j3" ? row("j3", "") : r));
  assert(plan(ten, tenNext).mode === "commit", "3. one of ten described jobs losing it (10%) commits");

  // 4. never described, still empty: not a loss.
  const four = [row("a", null), row("b", "x"), row("c", "x"), row("d", "x"), row("e", "x")];
  assert(plan(four, four.map((r) => r)).mode === "commit", "4. a job that was never described is not a loss");
  assert(describedJobsLost(four, four).lost.length === 0, "4. describedJobsLost finds nothing");

  // 5. a stored described job that is no longer listed is the count guards' business.
  const five = [row("a", "x"), row("b", "x"), row("c", "x"), row("d", "x"), row("e", "x")];
  const fiveNext = [row("b", "x"), row("c", "x"), row("d", "x"), row("e", "x")];
  assert(describedJobsLost(five, fiveNext).lost.length === 0, "5. a job no longer listed is not a loss");
  assert(plan(five, fiveNext).mode === "commit", "5. and commits (4 of 5 clears the count guard)");

  // 6. offsetting: two lose their description while two new described jobs arrive.
  const six = [row("a", "x"), row("b", "x"), row("c", "x"), row("d", "x")];
  const sixNext = [row("a", ""), row("b", null), row("c", "x"), row("d", "x"), row("e", "x"), row("f", "x")];
  const o = plan(six, sixNext);
  assert(o.mode === "field_fill_drop", `6. two lost, offset by two new described jobs (fill 100% -> 67%), is refused (got ${o.mode})`);
  if (o.mode === "field_fill_drop") assert(JSON.stringify(o.lost) === JSON.stringify(["a", "b"]), "naming a and b");

  // 7. personetics 12/12 -> 0/12 is still refused, now by both rules.
  const twelve = Array.from({ length: 12 }, (_, i) => row(`p${i}`, "x"));
  const p = plan(twelve, twelve.map((r) => row(r.externalJobId, null)));
  assert(p.mode === "field_fill_drop", `7. personetics 12/12 -> 0/12 is still refused (got ${p.mode})`);
  if (p.mode === "field_fill_drop") assert((p.lost ?? []).length === 12, "and names all twelve");
  const pl = describedJobsLost(twelve, twelve.map((r) => row(r.externalJobId, null)));
  assert(pl.lost.length === 12 && pl.storedDescribed === 12, "7. describedJobsLost: 12 of 12");

  // Rows without an id cannot be matched and are not counted either way.
  assert(describedJobsLost([row(null, "x")], [row(null, "")]).lost.length === 0, "an unmatched row without an id is not a loss");
});

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("scheduledRun: a scheduled run changes no site, and the manual path is unchanged");
