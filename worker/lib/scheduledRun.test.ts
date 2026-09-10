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
  INSERT_BATCH,
  MAX_ROWS,
  chunkRows,
  mayOverwriteAdminNote,
  planActivationGate,
  planApplyLoginSkip,
  planScheduledPersist,
  planScrapeFailure,
  readScheduledFlag,
} from "./scheduledRun";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
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

assert(planScheduledPersist(0).mode === "empty", "nothing extracted writes nothing");
assert(planScheduledPersist(-1).mode === "empty", "and a negative count cannot reach a delete");

{
  // The largest real site in the fleet (אלביט מערכות, 675 listings).
  const p = planScheduledPersist(675);
  assert(p.mode === "commit", "the largest real site commits");
  assert(p.mode === "commit" && p.batches === 2, "in two batches, inside one transaction");
}

{
  const p = planScheduledPersist(MAX_ROWS + 1);
  assert(p.mode === "oversize", "an implausible row count refuses");
  assert(
    p.mode === "oversize" && p.rowCount === MAX_ROWS + 1 && p.limit === MAX_ROWS,
    "and reports both numbers so the report says how far out it was",
  );
}
assert(planScheduledPersist(MAX_ROWS).mode === "commit", "the cap itself still commits");

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

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("scheduledRun: a scheduled run changes no site, and the manual path is unchanged");
