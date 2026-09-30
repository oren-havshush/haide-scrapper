// Backfill git tags and GitHub deployment records for deploys made before
// deploy.sh recorded them, from the image tags left on the box.
//
//   npx tsx scripts/deploy-backfill.ts <deploy-tag> [<deploy-tag> ...]            # DRY: prints the plan
//   npx tsx scripts/deploy-backfill.ts <deploy-tag> [<deploy-tag> ...] --apply    # tags, pushes, records
//
// One annotated tag and one deployment per deploy, on the commit the tag's hash
// names, with the message "backfilled from image tag". Whether those trees were
// dirty is not recoverable, so none is suffixed -dirty. --apply pushes tags to
// origin and writes to GitHub: it needs the owner's word.

import { spawn } from "node:child_process";
import { recordDeploy, type Runner } from "./lib/deployRecord";

const REPO = "oren-havshush/haide-scrapper";
const MESSAGE = "backfilled from image tag";

const exec: Runner = (cmd, args, stdin) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => resolve({ code: 127, stdout, stderr: stderr + e.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    if (stdin !== undefined) child.stdin.write(stdin);
    child.stdin.end();
  });

/** Prints what would run; answers gh like a logged-in client so the whole plan shows. */
const dryRun: Runner = async (cmd, args, stdin) => {
  if (cmd === "gh" && (args[0] === "--version" || args[0] === "auth")) return { code: 0, stdout: "", stderr: "" };
  const shown = args.map((a) => (a.includes("\n") ? JSON.stringify(a) : a)).join(" ");
  console.log(`    would run: ${cmd} ${shown}${stdin ? `  <<< ${stdin}` : ""}`);
  if (cmd === "gh" && args.some((a) => a.endsWith("/deployments"))) return { code: 0, stdout: '{"id":0}', stderr: "" };
  return { code: 0, stdout: "", stderr: "" };
};

(async () => {
  const apply = process.argv.includes("--apply");
  const tags = process.argv.slice(2).filter((a) => a.startsWith("deploy-"));
  if (tags.length === 0) throw new Error("give one or more deploy-YYYYMMDD-HHMMSS-<sha> tags");
  console.log(apply ? "=== APPLYING backfill ===" : "=== DRY RUN (nothing tagged, pushed or recorded; add --apply) ===");
  for (const deployTag of tags) {
    const short = /-([0-9a-f]{7,40})$/.exec(deployTag)?.[1];
    if (!short) {
      console.log(`${deployTag}: no commit hash in the name — skipped`);
      continue;
    }
    const full = await exec("git", ["rev-parse", "--verify", `${short}^{commit}`]);
    const sha = full.stdout.trim();
    if (full.code !== 0 || !sha) {
      console.log(`${deployTag}: commit ${short} not found locally — skipped`);
      continue;
    }
    const exists = await exec("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${deployTag}`]);
    if (exists.code === 0) {
      console.log(`${deployTag}: tag already exists — skipped`);
      continue;
    }
    console.log(`${deployTag}  ->  ${sha}`);
    await recordDeploy(
      { deployTag, sha, lastLine: `${MESSAGE}: ${deployTag}`, dirtyPaths: [], repo: REPO, message: MESSAGE },
      { run: apply ? exec : dryRun, log: (l) => console.log(`    ${l}`), warn: (l) => console.log(`    ${l}`) },
    );
  }
})();
