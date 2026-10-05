// Run: npx tsx scripts/checkLearnings.test.ts
//
// addsite2 phase two, step 6: the learnings stop growing unchecked. Every
// learning in docs/addsite-learnings.md has one row in docs/learnings-status.tsv
// saying what carries it now — CODE (the enforcing test or file), RECIPE (the
// addsite3 line) or RETIRED (why) — and `pnpm check:skills` fails when:
//   - addsite3.md or addsite3-recipes/ cites an LRN- id the learnings file lacks;
//   - two headings carry the same id;
//   - a learning has no status row (or a row names no learning, or is malformed).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { checkLearnings, learningIds } from "./lib/checkLearnings.mjs";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
const ROOT = join(__dirname, "..");
type Problem = { kind: string; id?: string; where?: string; detail: string };

const LEARNINGS = [
  "# Learnings",
  "### LRN-A-1 — one",
  "text",
  "### LRN-A-2 — two",
  "## LRN-B-1 — three",
  "",
].join("\n");
const HEADER = "id\tstatus\treference\taliases\tevidence";
const TSV = [
  HEADER,
  "LRN-A-1\tCODE\tworker/lib/x.test.ts\t\tpinned",
  "LRN-A-2\tRECIPE\taddsite3-recipes/r.md:2\t\tline 2",
  "LRN-B-1\tRETIRED\tsuperseded by LRN-A-1\t\tsame rule",
].join("\n");
const files = new Set(["worker/lib/x.test.ts", "addsite3-recipes/r.md"]);
const lines: Record<string, number> = { "addsite3-recipes/r.md": 10 };
const env = {
  fileExists: (p: string) => files.has(p),
  lineCount: (p: string) => lines[p] ?? 0,
};
const run = (over: { learnings?: string; tsv?: string; cited?: Array<{ file: string; text: string }> } = {}): Problem[] =>
  checkLearnings({
    learningsText: over.learnings ?? LEARNINGS,
    tsvText: over.tsv ?? TSV,
    cited: over.cited ?? [{ file: "addsite3.md", text: "Cite: `LRN-A-1` and LRN-B-1." }],
    ...env,
  });
const kinds = (ps: Problem[]) => ps.map((p) => `${p.kind}:${p.id ?? ""}`).sort();

// --- the ids ---------------------------------------------------------------------------
assert(JSON.stringify(learningIds(LEARNINGS).map((h: { id: string }) => h.id)) === JSON.stringify(["LRN-A-1", "LRN-A-2", "LRN-B-1"]), "headings at ## to #### are learnings");

// --- a clean set passes ----------------------------------------------------------------
assert(run().length === 0, `a clean set has no problems (${JSON.stringify(run())})`);

// --- 1. cited but missing ----------------------------------------------------------------
{
  const p = run({ cited: [{ file: "addsite3-recipes/form-capture.md", text: "see `LRN-FORM-3` and LRN-A-2" }] });
  assert(JSON.stringify(kinds(p)) === JSON.stringify(["cited-missing:LRN-FORM-3"]), `an id cited in addsite3 but absent from the learnings fails (${JSON.stringify(p)})`);
  assert(p[0]?.where === "addsite3-recipes/form-capture.md", "naming the file that cites it");
}

// --- 2. duplicate ids ------------------------------------------------------------------
{
  const p = run({ learnings: LEARNINGS + "### LRN-A-2 — a different lesson\n" });
  assert(kinds(p).includes("duplicate:LRN-A-2"), `a duplicated id fails (${JSON.stringify(p)})`);
}

// --- 3. a learning with no row; a row with no learning; a malformed row -------------
{
  const noRow = run({ tsv: TSV.split("\n").filter((l) => !l.startsWith("LRN-A-2")).join("\n") });
  assert(JSON.stringify(kinds(noRow)) === JSON.stringify(["no-status:LRN-A-2"]), `a learning with no status row fails (${JSON.stringify(noRow)})`);
  const stale = run({ tsv: TSV + "\nLRN-Z-9\tRETIRED\tgone\t\tx" });
  assert(kinds(stale).includes("unknown-row:LRN-Z-9"), "a row naming no learning fails");
  const twice = run({ tsv: TSV + "\nLRN-A-1\tRETIRED\tx\t\tx" });
  assert(kinds(twice).includes("duplicate-row:LRN-A-1"), "two rows for one learning fail");
  const badStatus = run({ tsv: TSV.replace("LRN-A-1\tCODE", "LRN-A-1\tRECIPE-MISSING") });
  assert(kinds(badStatus).includes("bad-status:LRN-A-1"), "a status other than CODE, RECIPE or RETIRED fails");
  const noFile = run({ tsv: TSV.replace("worker/lib/x.test.ts", "worker/lib/gone.test.ts") });
  assert(kinds(noFile).includes("bad-reference:LRN-A-1"), "a CODE row whose file does not exist fails");
  const pastEnd = run({ tsv: TSV.replace("addsite3-recipes/r.md:2", "addsite3-recipes/r.md:11") });
  assert(kinds(pastEnd).includes("bad-reference:LRN-A-2"), "a RECIPE row past the end of its file fails");
  const notAddsite3 = run({ tsv: TSV.replace("addsite3-recipes/r.md:2", "addsite2-recipes/r.md:2") });
  assert(kinds(notAddsite3).includes("bad-reference:LRN-A-2"), "a RECIPE row must point into addsite3, never frozen addsite2");
  // The company lessons (LRN-HQ-*, LRN-LOGO-*) are carried by company-profile.md, the
  // canonical skill addsite3 §14 runs; it is checked by check:skills like addsite3.
  lines["company-profile.md"] = 300;
  const company = run({ tsv: TSV.replace("addsite3-recipes/r.md:2", "company-profile.md:209") });
  assert(company.length === 0, `a RECIPE row may point into company-profile.md (${JSON.stringify(company)})`);
  delete lines["company-profile.md"];
  const emptyWhy = run({ tsv: TSV.replace("superseded by LRN-A-1", "") });
  assert(kinds(emptyWhy).includes("bad-reference:LRN-B-1"), "a RETIRED row must say why");
}

// --- aliases: the old id of a renumbered learning ------------------------------------
{
  const tsv = TSV.replace("LRN-A-2\tRECIPE\taddsite3-recipes/r.md:2\t\t", "LRN-A-2\tRECIPE\taddsite3-recipes/r.md:2\tLRN-A-1 (second)\t");
  assert(run({ tsv }).length === 0, "an alias column is accepted");
}

// --- the repo as it stands -----------------------------------------------------------------
{
  const cited = [join(ROOT, "addsite3.md"), ...readdirSync(join(ROOT, "addsite3-recipes")).map((f) => join(ROOT, "addsite3-recipes", f))]
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ file: f.slice(ROOT.length + 1).replace(/\\/g, "/"), text: readFileSync(f, "utf8") }));
  const tsvPath = join(ROOT, "docs", "learnings-status.tsv");
  const p = checkLearnings({
    learningsText: readFileSync(join(ROOT, "docs", "addsite-learnings.md"), "utf8"),
    tsvText: existsSync(tsvPath) ? readFileSync(tsvPath, "utf8") : "",
    cited,
    fileExists: (rel: string) => existsSync(join(ROOT, rel)),
    lineCount: (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8").split(/\r?\n/).length : 0),
  });
  assert(p.length === 0, `the repo passes check-learnings (${p.length} problem(s): ${kinds(p).slice(0, 25).join(", ")}${p.length > 25 ? ", …" : ""})`);
}

// --- it runs inside check:skills -----------------------------------------------------------
{
  const sync = readFileSync(join(ROOT, "scripts", "sync-addsite2.mjs"), "utf8");
  assert(/from '\.\/check-learnings\.mjs'|from '\.\/lib\/checkLearnings\.mjs'/.test(sync), "the sync script imports the check");
  assert(/runCheckLearnings\(/.test(sync.slice(sync.indexOf("if (CHECK_MODE)"))), "and --check runs it");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("checkLearnings: cited ids exist, ids are unique, every learning has one status row");
