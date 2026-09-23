// Run: npx tsx src/lib/statusTransitions.test.ts
//
// One transition in this table deletes data, and one that was missing cost a
// working config.
//
// SKIPPED could not reach REVIEW. A site is SKIPPED for a reason OUTSIDE its
// config — a WAF block, a login-gated apply flow, a policy decision — so when
// that reason lifts the config is usually intact and wants checking, not
// rebuilding. Both routes that existed cost something: ANALYZING clears
// configLocked and re-derives the config from scratch, and FAILED deletes every
// listing the site has. gazit and sinaistore both came back on 2026-09-22 with
// their configs byte-intact, and both had to be walked round this by hand.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canTransition,
  isDestructiveStatus,
  SITE_STATUSES,
  VALID_STATUS_TRANSITIONS,
  DESTRUCTIVE_STATUSES,
} from "./statusTransitions";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

// ---------------------------------------------------------------------------
console.log("# the new one: a block lifting does not cost the config");
// ---------------------------------------------------------------------------
{
  assert(canTransition("SKIPPED", "REVIEW"), "SKIPPED -> REVIEW is allowed");

  // Said as a comparison, because the point is what it REPLACES.
  assert(
    canTransition("SKIPPED", "ANALYZING"),
    "ANALYZING is still reachable — a site whose config really is wrong still goes there",
  );
  assert(
    canTransition("SKIPPED", "FAILED"),
    "and so is FAILED — but that one deletes the listings, which is the detour this avoids",
  );
  assert(isDestructiveStatus("FAILED"), "FAILED is the destructive one");
  assert(!isDestructiveStatus("REVIEW"), "REVIEW is not");
  assert(!isDestructiveStatus("ANALYZING"), "nor is ANALYZING — it costs the config, not the rows");

  // Not a general loosening: SKIPPED still cannot jump straight to ACTIVE.
  // Publishing a site nobody has looked at is exactly what REVIEW exists for.
  assert(
    !canTransition("SKIPPED", "ACTIVE"),
    "SKIPPED -> ACTIVE stays forbidden — a returning site is reviewed, not published",
  );
}

// ---------------------------------------------------------------------------
console.log("# the rest of the table is unchanged");
// ---------------------------------------------------------------------------
{
  const expected: Record<string, string[]> = {
    ANALYZING: ["REVIEW", "ACTIVE", "FAILED"],
    REVIEW: ["SKIPPED", "ACTIVE", "FAILED", "ANALYZING"],
    ACTIVE: ["SKIPPED", "FAILED", "REVIEW", "ANALYZING"],
    FAILED: ["SKIPPED", "ANALYZING", "ACTIVE"],
    SKIPPED: ["ANALYZING", "FAILED", "REVIEW"],
  };
  for (const [from, tos] of Object.entries(expected)) {
    const got = VALID_STATUS_TRANSITIONS[from] ?? [];
    assert(
      JSON.stringify([...got].sort()) === JSON.stringify([...tos].sort()),
      `${from}: ${JSON.stringify(got)} (want ${JSON.stringify(tos)})`,
    );
  }
}

// ---------------------------------------------------------------------------
console.log("# structural rules that must keep holding");
// ---------------------------------------------------------------------------
{
  for (const s of SITE_STATUSES) {
    assert(Array.isArray(VALID_STATUS_TRANSITIONS[s]), `${s} has a row`);
    assert(!canTransition(s, s), `${s} cannot transition to itself`);
    for (const to of VALID_STATUS_TRANSITIONS[s] ?? []) {
      assert(
        (SITE_STATUSES as readonly string[]).includes(to),
        `${s} -> ${to} names a real status`,
      );
    }
  }
  assert(
    DESTRUCTIVE_STATUSES.length === 1,
    `exactly one status deletes data (got ${JSON.stringify(DESTRUCTIVE_STATUSES)})`,
  );
  // Every status is reachable from somewhere, or it is a state nothing can
  // enter — including the one we just added a route to.
  for (const s of SITE_STATUSES) {
    if (s === "ANALYZING") continue; // where a site starts
    assert(
      SITE_STATUSES.some((from) => canTransition(from, s)),
      `${s} is reachable from at least one status`,
    );
  }
}

// ---------------------------------------------------------------------------
console.log("# and siteService uses this table, not a copy");
// ---------------------------------------------------------------------------
{
  const src = readFileSync(join(__dirname, "..", "services", "siteService.ts"), "utf8");
  assert(
    /VALID_STATUS_TRANSITIONS.*from "@\/lib\/statusTransitions"/.test(src),
    "siteService imports the table",
  );
  assert(
    !/const VALID_STATUS_TRANSITIONS/.test(src),
    "and does not define a second one",
  );
  // The destructive transition is real, and it is the one FAILED performs.
  assert(
    /newStatus === "FAILED"[\s\S]{0,400}prisma\.job\.deleteMany/.test(src),
    "moving a site to FAILED really does delete its jobs — which is what the dialog warns about",
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nstatusTransitions: a lifted block costs neither the config nor the listings");
