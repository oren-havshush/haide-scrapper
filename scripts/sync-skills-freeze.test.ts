// Run: npx tsx scripts/sync-skills-freeze.test.ts
//
// addsite2 phase two, step 1b: addsite2 is frozen. `pnpm check:skills` (CI)
// fails when addsite2.md or any addsite2-recipes/*.md differs from the sha256
// recorded in the SKILLS freeze note, naming the file and the word "frozen".
// A rule, not a date check: the control cohort is only a control while the
// skill it measures does not move.
//
// Each case runs the real script on a copy of the skills in a temp directory,
// so nothing in the working tree is touched. A one-byte change to addsite2.md
// alone already failed before the freeze (its command copy drifts), so the
// cases change a recipe (never checked before), addsite2.md together with its
// command copy, and add a recipe file.

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ADDSITE2_FREEZE_AT, ADDSITE3_SWITCH_AT } from "../src/lib/fixScore";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const ROOT = join(__dirname, "..");
const SKILL_FILES = ["addsite2.md", "addsite3.md", "company-profile.md"];
const RECIPE_DIRS = ["addsite2-recipes", "addsite3-recipes"];

/** A temp copy of the script and every skill it checks, laid out as in the repo. */
function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "skills-freeze-"));
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, ".claude", "commands"), { recursive: true });
  cpSync(join(ROOT, "scripts", "sync-addsite2.mjs"), join(dir, "scripts", "sync-addsite2.mjs"));
  // The script imports the addsite3 lint (step 4).
  mkdirSync(join(dir, "scripts", "lib"));
  cpSync(join(ROOT, "scripts", "lib", "skillLint.mjs"), join(dir, "scripts", "lib", "skillLint.mjs"));
  // Step 6: --check also runs check-learnings, which reads the learnings archive and its status file.
  cpSync(join(ROOT, "scripts", "check-learnings.mjs"), join(dir, "scripts", "check-learnings.mjs"));
  cpSync(join(ROOT, "scripts", "lib", "checkLearnings.mjs"), join(dir, "scripts", "lib", "checkLearnings.mjs"));
  mkdirSync(join(dir, "docs"));
  for (const f of ["addsite-learnings.md", "learnings-status.tsv"]) cpSync(join(ROOT, "docs", f), join(dir, "docs", f));
  // A CODE row names an enforcing file that must exist; give the sandbox those files.
  for (const line of readFileSync(join(ROOT, "docs", "learnings-status.tsv"), "utf8").split(/\r?\n/).slice(1)) {
    const [, status, ref] = line.split("\t");
    if (status !== "CODE" || !ref || existsSync(join(dir, ref))) continue;
    mkdirSync(dirname(join(dir, ref)), { recursive: true });
    cpSync(join(ROOT, ref), join(dir, ref));
  }
  for (const f of SKILL_FILES) {
    if (!existsSync(join(ROOT, f))) continue;
    cpSync(join(ROOT, f), join(dir, f));
    cpSync(join(ROOT, ".claude", "commands", f), join(dir, ".claude", "commands", f));
  }
  for (const d of RECIPE_DIRS) if (existsSync(join(ROOT, d))) cpSync(join(ROOT, d), join(dir, d), { recursive: true });
  return dir;
}

function check(dir: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [join(dir, "scripts", "sync-addsite2.mjs"), "--check"], { encoding: "utf8", cwd: dir });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Flip one byte (the last) of a file. */
function oneByte(path: string): void {
  const b = readFileSync(path);
  b[b.length - 1] = b[b.length - 1] === 0x0a ? 0x20 : 0x0a;
  writeFileSync(path, b);
}

// --- an untouched copy passes, and addsite3 is checked like the others ------------------
{
  const r = check(sandbox());
  assert(r.status === 0, `an untouched copy passes (exit ${r.status}: ${r.out.trim().split("\n").slice(-2).join(" / ")})`);
  assert(r.out.includes("OK: .claude/commands/addsite3.md"), "and addsite3 is synced and checked like the others");
  assert(/frozen/i.test(r.out) && r.out.includes("addsite2"), "the check says addsite2 is frozen");
}

// --- a one-byte change to a frozen recipe fails, naming it ------------------------------
{
  const dir = sandbox();
  const recipe = readdirSync(join(dir, "addsite2-recipes")).filter((f) => f.endsWith(".md")).sort()[0]!;
  oneByte(join(dir, "addsite2-recipes", recipe));
  const r = check(dir);
  assert(r.status === 1, `a one-byte change to addsite2-recipes/${recipe} fails the check (exit ${r.status})`);
  assert(r.out.includes(`addsite2-recipes/${recipe}`) && /frozen/i.test(r.out), "naming the file and the word frozen");
}

// --- addsite2.md changed together with its command copy: no drift, still frozen -----------
{
  const dir = sandbox();
  oneByte(join(dir, "addsite2.md"));
  cpSync(join(dir, "addsite2.md"), join(dir, ".claude", "commands", "addsite2.md"));
  const r = check(dir);
  assert(r.status === 1, `addsite2.md changed with its copy in step still fails (exit ${r.status})`);
  assert(/FROZEN: addsite2\.md/.test(r.out), "as frozen, naming addsite2.md");
}

// --- a recipe added to the frozen directory fails ----------------------------------------
{
  const dir = sandbox();
  writeFileSync(join(dir, "addsite2-recipes", "new-recipe.md"), "# new\n");
  const r = check(dir);
  assert(r.status === 1 && r.out.includes("addsite2-recipes/new-recipe.md"), "a recipe added to addsite2-recipes fails, naming it");
}

// --- addsite3 is not frozen ----------------------------------------------------------------
{
  const dir = sandbox();
  if (existsSync(join(dir, "addsite3.md"))) {
    oneByte(join(dir, "addsite3.md"));
    cpSync(join(dir, "addsite3.md"), join(dir, ".claude", "commands", "addsite3.md"));
    oneByte(join(dir, "addsite3-recipes", readdirSync(join(dir, "addsite3-recipes")).sort()[0]!));
  }
  const r = check(dir);
  assert(existsSync(join(dir, "addsite3.md")) && r.status === 0, `addsite3.md and its recipes may change (exit ${r.status})`);
}

// --- the freeze note and the fix queue agree on freezeAt -----------------------------------
{
  const script = readFileSync(join(ROOT, "scripts", "sync-addsite2.mjs"), "utf8");
  assert(script.includes(`freezeAt: '${ADDSITE2_FREEZE_AT}'`), `the SKILLS freeze note records freezeAt ${ADDSITE2_FREEZE_AT}`);
  assert(ADDSITE2_FREEZE_AT === "2026-09-30T21:00:00.000Z", "which is 2026-10-01 00:00 Asia/Jerusalem, later than the last addsite2 commit (a1c5672, 2026-09-30 10:05 +03:00)");
  // Step 7: the freeze note records the switch, the same instant as ADDSITE3_SWITCH_AT.
  assert(
    ADDSITE3_SWITCH_AT !== null && script.includes(`switchAt: '${ADDSITE3_SWITCH_AT}'`),
    `the SKILLS freeze note records switchAt ${ADDSITE3_SWITCH_AT}`,
  );
}

// --- CI runs it under its new name ----------------------------------------------------------
{
  const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  assert(/run: pnpm check:skills/.test(ci) && !/run: pnpm check:addsite2/.test(ci), "the CI step runs pnpm check:skills");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("sync-skills-freeze: addsite2 is frozen by sha256; addsite3 is synced and free to change");
