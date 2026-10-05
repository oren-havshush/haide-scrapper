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
import { SWITCH_AT, checkLearnings, learningIds } from "./lib/checkLearnings.mjs";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
const ROOT = join(__dirname, "..");
type Problem = { kind: string; id?: string; where?: string; detail: string; severity: "error" | "warning" };

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
// r.md: 10 lines; line 4 carries LRN-A-2, line 9 cites LRN-A-20 (a different id).
const texts: Record<string, string[]> = {
  "addsite3-recipes/r.md": ["# r", "intro", "the lesson, in a sentence that runs", "onto a line citing (`LRN-A-2`)", "", "", "", "", "see LRN-A-20", "end"],
};
const env = {
  fileExists: (p: string) => files.has(p),
  readLines: (p: string) => texts[p] ?? null,
};
const run = (
  over: { learnings?: string; tsv?: string; cited?: Array<{ file: string; text: string }>; switchAt?: Date | null; now?: Date } = {},
): Problem[] =>
  checkLearnings({
    learningsText: over.learnings ?? LEARNINGS,
    tsvText: over.tsv ?? TSV,
    cited: over.cited ?? [{ file: "addsite3.md", text: "Cite: `LRN-A-1` and LRN-B-1." }],
    switchAt: over.switchAt === undefined ? null : over.switchAt,
    now: over.now ?? new Date("2026-10-05T12:00:00Z"),
    ...env,
  });
const severity = (ps: Problem[], kind: string) => ps.find((p) => p.kind === kind)?.severity;
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
  texts["company-profile.md"] = Array.from({ length: 300 }, (_, i) => (i === 208 ? "the HQ rule (`LRN-A-2`)" : "x"));
  const company = run({ tsv: TSV.replace("addsite3-recipes/r.md:2", "company-profile.md:209") });
  assert(company.length === 0, `a RECIPE row may point into company-profile.md (${JSON.stringify(company)})`);
  delete texts["company-profile.md"];
  const emptyWhy = run({ tsv: TSV.replace("superseded by LRN-A-1", "") });
  assert(kinds(emptyWhy).includes("bad-reference:LRN-B-1"), "a RETIRED row must say why");
}

// --- (b) a RECIPE line must cite its id, on the line or the three after it (owner, 2026-10-05)
{
  const at = (n: number) => run({ tsv: TSV.replace("addsite3-recipes/r.md:2", `addsite3-recipes/r.md:${n}`) });
  assert(at(4).length === 0, "the citing line itself passes");
  assert(at(1).length === 0, "three lines above the citation passes (a sentence that runs on)");
  assert(kinds(at(5)).includes("bad-reference:LRN-A-2"), `a line with no citation in reach fails (${JSON.stringify(at(5))})`);
  assert(kinds(at(9)).includes("bad-reference:LRN-A-2"), "LRN-A-20 is not a citation of LRN-A-2");
  assert(severity(at(5), "bad-reference") === "error", "and it is an error");
}

// --- (a) a learning with no row: a warning until the switch, an error from it -------
{
  const tsv = TSV.split("\n").filter((l) => !l.startsWith("LRN-A-2")).join("\n");
  const switchAt = new Date("2026-11-01T00:00:00Z");
  assert(severity(run({ tsv, switchAt: null }), "no-status") === "warning", "no switch date yet: a warning");
  assert(severity(run({ tsv, switchAt, now: new Date("2026-10-31T23:59:59Z") }), "no-status") === "warning", "before the switch: a warning");
  assert(severity(run({ tsv, switchAt, now: new Date("2026-11-01T00:00:00Z") }), "no-status") === "error", "at the switch: an error");
  assert(severity(run({ tsv, switchAt, now: new Date("2026-12-01T00:00:00Z") }), "no-status") === "error", "after it: an error");
  assert(severity(run({ learnings: LEARNINGS + "### LRN-A-2 — again\n" }), "duplicate") === "error", "a duplicate is an error either side");
  assert(severity(run({ cited: [{ file: "addsite3.md", text: "LRN-Q-1" }] }), "cited-missing") === "error", "so is a cited-but-missing id");
  assert(SWITCH_AT === null, "SWITCH_AT stays null until step 7 records the switch");
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
    readLines: (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8").split(/\r?\n/) : null),
    switchAt: SWITCH_AT ? new Date(SWITCH_AT) : null,
    now: new Date(),
  });
  const errors = p.filter((x) => x.severity === "error");
  assert(errors.length === 0, `the repo has no check-learnings errors (${errors.length}: ${kinds(errors).slice(0, 25).join(", ")}${errors.length > 25 ? ", …" : ""})`);
}

// --- it runs inside check:skills -----------------------------------------------------------
{
  const sync = readFileSync(join(ROOT, "scripts", "sync-addsite2.mjs"), "utf8");
  assert(/from '\.\/check-learnings\.mjs'|from '\.\/lib\/checkLearnings\.mjs'/.test(sync), "the sync script imports the check");
  assert(/runCheckLearnings\(/.test(sync.slice(sync.indexOf("if (CHECK_MODE)"))), "and --check runs it");
  assert(/learningProblems\.errors\.length > 0\) drift = true/.test(sync), "only its errors fail the check; warnings are printed");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("checkLearnings: cited ids exist, ids are unique, every learning has one status row");
