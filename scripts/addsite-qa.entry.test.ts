// Run: npx tsx scripts/addsite-qa.entry.test.ts
//
// addsite-qa.ts called main() at module load (owner, 2026-10-09), so a program
// importing it for runQa or its check functions started a full QA run and
// failed on "--site-id is required". main() now runs only when the file is the
// entry point. Both sides are checked in child processes:
//   - importing the module with no arguments exits 0, quickly, printing nothing;
//   - running the file itself, as before, still runs main (here: its usage error).

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const ROOT = resolve(__dirname, "..");
const QA = join(ROOT, "scripts", "addsite-qa.ts");
const TSX = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

// An importer outside the repo that only loads the module.
const dir = mkdtempSync(join(tmpdir(), "qa-entry-"));
const importer = join(dir, "import-qa.ts");
writeFileSync(importer, `import * as qa from ${JSON.stringify(pathToFileURL(QA).href)};\nvoid qa;\n`);
try {
  const t0 = Date.now();
  const imp = spawnSync(process.execPath, [TSX, importer], { cwd: ROOT, encoding: "utf8", timeout: 30_000 });
  const ms = Date.now() - t0;
  assert(imp.status === 0, `importing addsite-qa.ts exits 0 (got ${imp.status}; stderr: ${(imp.stderr ?? "").trim().slice(0, 200)})`);
  assert((imp.stdout ?? "") === "" && (imp.stderr ?? "") === "", `and prints nothing (stdout ${JSON.stringify((imp.stdout ?? "").slice(0, 120))}, stderr ${JSON.stringify((imp.stderr ?? "").slice(0, 120))})`);
  assert(ms < 15_000, `within a few seconds (${ms} ms)`);

  // The command line is unchanged: run as the entry point, main() runs.
  const cli = spawnSync(process.execPath, [TSX, QA], { cwd: ROOT, encoding: "utf8", timeout: 30_000 });
  assert(cli.status === 1, `the CLI with no arguments still runs main and exits 1 (got ${cli.status})`);
  assert(/--site-id is required/.test(cli.stderr ?? ""), `with its usage error (stderr: ${(cli.stderr ?? "").trim().slice(0, 200)})`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("addsite-qa entry: all assertions passed");
