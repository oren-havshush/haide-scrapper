// Run: npx tsx scripts/skillLint.test.ts
//
// The addsite3 lint (addsite2 phase two, step 4; the rest of it comes with
// step 6). Phrases a rewritten rule has removed must not come back into
// addsite3.md. It runs inside `pnpm check:skills`, which CI runs.
//
// Today it holds one rule: "Prefer `h-<hash>`" — step 4 replaced it with
// "native id first; with no native id the script emits no id and the worker
// synthesises h-<haideHash(title|department|url)>".

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lintAddsite3 } from "./lib/skillLint.mjs";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const ROOT = join(__dirname, "..");

// --- the rule itself ----------------------------------------------------------------
{
  const hits = lintAddsite3("line one\n4. Ids are blockers. Prefer `h-<hash>` synthesis (recipe §3).\n");
  assert(hits.length === 1 && hits[0]!.line === 2, `"Prefer \`h-<hash>\`" is reported with its line (${JSON.stringify(hits)})`);
  assert(lintAddsite3("Prefer h-<hash> synthesis").length === 1, "with or without backticks");
  assert(lintAddsite3("the worker synthesises h-<haideHash(title|department|url)>").length === 0, "the new rule's own wording passes");
}

// --- step 6: the cost goal and the SKIP budget are gone (phase one M7) -------------------
// The owner ranks cost last; addsite3 §0 states the ranking. A run no longer ends on a
// time cap or a fix count.
{
  const caught = (s: string) => lintAddsite3(s).length === 1;
  assert(caught("> Optimize: **correct-verdict rate at low cost.**"), `"at low cost" is caught`);
  assert(caught("routed to human REVIEW — at minimum cost."), `"at minimum cost" is caught`);
  assert(caught("5. **Time cap:** 15 minutes per site maximum."), `"Time cap: 15 minutes" is caught, bold or not`);
  assert(caught("Time cap: 15 min per site"), "and its short form");
  assert(caught("3. **Cap:** ≤ 3 total distinct fix attempts per site."), "the 3-fix cap is caught");
  assert(caught("Pre-reading all recipes defeats the lean-core cost goal."), `"lean-core cost goal" is caught`);
  assert(
    lintAddsite3("> so the 15-minute worker timeout cuts off around **40 jobs**").length === 0,
    "a fact about the worker's 15-minute timeout is not the budget",
  );
  assert(lintAddsite3("cost per site (last)").length === 0, "the ranking's own wording passes");
}

// --- addsite3.md as it stands --------------------------------------------------------
{
  const hits = lintAddsite3(readFileSync(join(ROOT, "addsite3.md"), "utf8"));
  assert(hits.length === 0, `addsite3.md passes the lint (${hits.map((h: { line: number; rule: string }) => `${h.line}: ${h.rule}`).join("; ")})`);
}

// --- it runs inside check:skills --------------------------------------------------------
{
  const sync = readFileSync(join(ROOT, "scripts", "sync-addsite2.mjs"), "utf8");
  assert(/import \{ lintAddsite3 \} from '\.\/lib\/skillLint\.mjs'/.test(sync), "the sync script imports the lint");
  assert(/lintAddsite3\(/.test(sync.slice(sync.indexOf("if (CHECK_MODE)"))), "and --check runs it");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("skillLint: addsite3.md carries no removed rule");
