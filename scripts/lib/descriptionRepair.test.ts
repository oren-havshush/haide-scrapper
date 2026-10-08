// Run: npx tsx scripts/lib/descriptionRepair.test.ts
//
// scripts/backfill-description-structure.ts rewrites run-on descriptions in
// place. Job.contentHash covers the title and description (owner, 2026-10-08),
// so a row whose description it rewrites must carry the hash of the new text;
// a row whose description it leaves keeps its hash untouched.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jobContentHash } from "../../worker/lib/contentHash";
import { planDescriptionRepair } from "./descriptionRepair";

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

const BULLET = String.fromCharCode(0x2022);
const RUN_ON = [
  "We are hiring an experienced sales manager to lead our northern region team",
  "At least three years of experience in B2B sales",
  "Fluent English at a high level",
  "A valid driving licence and willingness to travel",
  "Experience leading a team of five or more people",
].join(` ${BULLET} `);
const TITLE = "Sales Manager";
const STRUCTURED = "Leads the northern region team.\nThree years of B2B sales.";

{
  const data = planDescriptionRepair({ title: TITLE, description: RUN_ON, requirements: null });
  assert(!!data?.description && data.description !== RUN_ON && data.description.includes("\n"), "a run-on description is rewritten with line breaks");
  eq(data?.contentHash, jobContentHash(TITLE, data?.description ?? null), "a rewritten row carries the hash of its new text");
  assert(data?.contentHash !== jobContentHash(TITLE, RUN_ON), "not the hash of the old text");
}
{
  const data = planDescriptionRepair({ title: TITLE, description: STRUCTURED, requirements: RUN_ON });
  assert(!!data?.requirements && data.description === undefined, "requirements alone are rewritten");
  assert(data !== null && !("contentHash" in data), "and the hash, which does not cover requirements, is not written");
}
eq(planDescriptionRepair({ title: TITLE, description: STRUCTURED, requirements: null }), null, "a row with nothing to repair: no write");

// The wiring: the script writes exactly what the plan returns, and selects the title.
{
  const src = readFileSync(join(__dirname, "..", "backfill-description-structure.ts"), "utf8");
  assert(/planDescriptionRepair\(job\)/.test(src), "the backfill script decides each row with planDescriptionRepair");
  assert(/select: \{[^}]*title: true/.test(src), "and selects the title the hash needs");
  assert(/prisma\.job\.update\(\{ where: \{ id: job\.id \}, data \}\)/.test(src), "and writes that plan's data");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("descriptionRepair: all assertions passed");
