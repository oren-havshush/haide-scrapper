// Run: npx tsx scripts/dockerignore.test.ts
//
// The deploy that failed on files production had nothing to do with.
//
// `Dockerfile` does `COPY . .` and then `pnpm build`, so every file in the
// build context is type-checked. A debugging session had left a handful of
// one-off probe scripts at the repo root; one of them imported
// `./lib/playwright`, a path that exists only in a scratch directory. The build
// failed with `Cannot find module './lib/playwright'` — a deploy of correct
// production code, stopped by a file that was never part of it. Nothing was
// broken in the image, and nothing reached production; the cost was the time
// spent reading a build error about code that does not ship.
//
// `.dockerignore` had no scratch patterns at all. This asserts two things about
// the ones now there, and the second is the one that matters:
//
//   1. the shapes a scratch file actually takes are excluded;
//   2. no file the repo TRACKS is excluded by them.
//
// (2) is the guard against an over-eager pattern quietly dropping something the
// build needs — which would fail the deploy just as thoroughly, and much less
// obviously.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const ROOT = join(__dirname, "..");
const lines = readFileSync(join(ROOT, ".dockerignore"), "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

/**
 * Docker's ignore matching, for the subset of syntax this file uses.
 *
 * The rule that matters and is easy to get wrong: a `.dockerignore` pattern is
 * ALWAYS relative to the build-context root. It is not `.gitignore` — a bare
 * `sites` excludes the top-level `sites/` and says nothing about
 * `src/app/api/sites/`. A leading "/" is permitted and means the same thing.
 * `*` stays within one path segment; `**` crosses them.
 */
function matches(pattern: string, path: string): boolean {
  const p = pattern.startsWith("/") ? pattern.slice(1) : pattern;
  const rx = p
    .split("/")
    .map((seg) =>
      seg === "**"
        ? "(?:[^/]+/)*[^/]*"
        : seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]"),
    )
    .join("/");
  return new RegExp(`^${rx}(?:/.*)?$`).test(path);
}

const ignored = (path: string) => lines.some((l) => matches(l, path));

// ---------------------------------------------------------------------------
console.log("# the scratch shapes are excluded from the build context");
// ---------------------------------------------------------------------------
{
  // The first four are the real ones: files of exactly these shapes were at
  // /opt/haide-scrapper when the deploy failed.
  for (const f of [
    "probe-halilit.ts",
    "check-rows.ts",
    "tmp-config.json",
    "scratch.ts",
    "debug-xnes.ts",
    "out.log",
    "normalizer.ts.bak",
    "config.orig",
    "page.har",
    "screenshot.png",
    "dump.sql",
    "rows.out",
    // Real, and present at the root while this was written: eight of these
    // from the onboarding session. `.gitignore` carries the same pattern, so
    // `git status` shows nothing and nobody notices they are in the context.
    "write-alyn-config.js",
    "write-weizmann-config.js",
  ]) {
    assert(ignored(f), `a scratch file at the root is excluded: ${f}`);
  }
}

// ---------------------------------------------------------------------------
console.log("# and nothing the repo tracks is");
// ---------------------------------------------------------------------------
{
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  assert(tracked.length > 100, `git ls-files returned ${tracked.length} files, so this is not vacuous`);

  // The directories .dockerignore excludes ON PURPOSE. Everything else that is
  // tracked has to survive into the image, or the build breaks.
  const DELIBERATE = [
    ".git", ".claude", ".cursor", ".github", "docs", "sites", "scripts",
    "_bmad", "_bmad-output", "extension", "temp-next-scaffold",
    "Dockerfile", "Dockerfile.worker", "docker-compose.yml", "Caddyfile",
    "deploy.sh", "README.md", ".env", ".DS_Store",
  ];
  const deliberate = (f: string) =>
    DELIBERATE.some((d) => f === d || f.startsWith(`${d}/`));

  const casualties = tracked.filter((f) => !deliberate(f) && ignored(f));
  assert(
    casualties.length === 0,
    `no tracked file is caught by a scratch pattern (caught ${casualties.length}: ${casualties.slice(0, 8).join(", ")})`,
  );
}

// ---------------------------------------------------------------------------
console.log("# the deliberate exclusions are still there");
// ---------------------------------------------------------------------------
{
  // The scratch patterns are an addition, not a rewrite. If one of these ever
  // stops being excluded the image grows by hundreds of megabytes, or ships a
  // token.
  for (const f of [
    "node_modules/x", ".git/config", ".claude/scrap-token", ".env",
    "docs/addsite-learnings.md", "sites/_configs/xnes.json", "scripts/addsite-qa.ts",
  ]) {
    assert(ignored(f), `still excluded: ${f}`);
  }
  // And the things the build genuinely needs are not.
  for (const f of [
    "package.json", "tsconfig.json", "next.config.ts", "prisma/schema.prisma",
    "src/lib/validators.ts", "worker/jobs/scrape.ts", "CSV files/city.csv",
  ]) {
    assert(!ignored(f), `still in the build context: ${f}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\ndockerignore: scratch stays out, and nothing tracked goes with it");
