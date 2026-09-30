// Record a successful deploy: annotated git tag + GitHub deployment. Called by
// deploy.sh after its sentinel check; see scripts/lib/deployRecord.ts.
//
//   npx tsx scripts/deploy-record.ts --tag <DEPLOY_TAG> --sha <full sha> \
//     --last-line "<the log's last line>" [--dirty-file <file of porcelain paths>]
//
// Exits 0 whatever happens: recording is never allowed to fail a deploy that
// has already succeeded.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { recordDeploy, type Runner } from "./lib/deployRecord";

const REPO = "oren-havshush/haide-scrapper";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const run: Runner = (cmd, args, stdin) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => resolve({ code: 127, stdout, stderr: stderr + e.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    if (stdin !== undefined) child.stdin.write(stdin);
    child.stdin.end();
  });

(async () => {
  try {
    const deployTag = arg("--tag");
    const sha = arg("--sha");
    const lastLine = arg("--last-line") ?? "";
    const dirtyFile = arg("--dirty-file");
    if (!deployTag || !sha) {
      console.warn("[deploy-record] --tag and --sha are required — nothing recorded");
      return;
    }
    const dirtyPaths = dirtyFile
      ? readFileSync(dirtyFile, "utf8")
          .split(/\r?\n/)
          .map((l) => l.slice(3).trim()) // porcelain: "XY path"
          .filter(Boolean)
      : [];
    await recordDeploy({ deployTag, sha, lastLine, dirtyPaths, repo: REPO }, { run });
  } catch (e) {
    console.warn(`[deploy-record] recording failed: ${(e as Error).message} — the deploy itself succeeded`);
  }
})();
