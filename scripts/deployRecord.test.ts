// Run: npx tsx scripts/deployRecord.test.ts
//
// After a deploy's sentinel check succeeds, deploy.sh records it twice:
//   1. an annotated git tag named exactly like DEPLOY_TAG on the deployed
//      commit, pushed alone to origin;
//   2. a GitHub deployment for that commit (environment production,
//      auto_merge false, required_contexts empty, description = the tag) with a
//      "success" status whose description is the deploy log's last line.
// A dirty working tree gets a -dirty tag and its paths in the tag message and
// the deployment, because the sync ships the tree, not the commit. No gh, or gh
// not logged in: one warning, no deployment record, and the deploy still
// succeeds. A failed deploy records nothing.
//
// git and gh are injected, so this watches exactly what would be run.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { recordDeploy, type RunResult, type Runner } from "./lib/deployRecord";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
async function check(name: string, body: () => Promise<void> | void) {
  try {
    await body();
  } catch (e) {
    console.error(`FAIL: ${name} threw — ${(e as Error).message}`);
    failures++;
  }
}

const SHA = "d1da72e0a1b2c3d4e5f60718293a4b5c6d7e8f90";
const TAG = "deploy-20260929-221357-d1da72e";
const LAST = "==> Deployment complete: deploy-20260929-221357-d1da72e";
const REPO = "oren-havshush/haide-scrapper";

type Call = { cmd: string; args: string[]; stdin?: string };
function fake(opts: { gh?: "ok" | "missing" | "logged-out"; failTag?: boolean } = {}) {
  const calls: Call[] = [];
  const run: Runner = async (cmd, args, stdin) => {
    calls.push({ cmd, args, stdin });
    const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });
    const bad = (stderr: string): RunResult => ({ code: 1, stdout: "", stderr });
    if (cmd === "git" && args[0] === "tag" && opts.failTag) return bad("fatal: tag exists");
    if (cmd === "git") return ok();
    if (cmd === "gh") {
      if (opts.gh === "missing") return { code: 127, stdout: "", stderr: "gh: command not found" };
      if (args[0] === "auth" && opts.gh === "logged-out") return bad("You are not logged into any GitHub hosts.");
      if (args[0] === "api" && args.some((a) => a.endsWith("/deployments")))
        return ok(JSON.stringify({ id: 4242 }));
      return ok("{}");
    }
    return bad("unknown command");
  };
  const warns: string[] = [];
  const logs: string[] = [];
  return { calls, run, warns, logs, deps: { run, warn: (l: string) => warns.push(l), log: (l: string) => logs.push(l) } };
}
const input = (over: Partial<Parameters<typeof recordDeploy>[0]> = {}) => ({
  deployTag: TAG,
  sha: SHA,
  lastLine: LAST,
  dirtyPaths: [] as string[],
  repo: REPO,
  ...over,
});
const git = (f: ReturnType<typeof fake>, sub: string) => f.calls.filter((c) => c.cmd === "git" && c.args[0] === sub);
const ghApi = (f: ReturnType<typeof fake>) => f.calls.filter((c) => c.cmd === "gh" && c.args[0] === "api");

(async () => {
  await check("a clean tree", async () => {
    const f = fake();
    const r = await recordDeploy(input(), f.deps);
    const tag = git(f, "tag");
    assert(tag.length === 1, `one git tag (${tag.length})`);
    assert(
      tag[0]?.args[0] === "tag" && tag[0]?.args[1] === "-a" && tag[0]?.args[2] === TAG && tag[0]?.args.at(-1) === SHA,
      `annotated, named exactly DEPLOY_TAG, on the deployed commit (${JSON.stringify(tag[0]?.args)})`,
    );
    const push = git(f, "push");
    assert(push.length === 1, "one push");
    assert(
      JSON.stringify(push[0]?.args) === JSON.stringify(["push", "origin", `refs/tags/${TAG}`]),
      `only that tag is pushed — never --tags, never a branch (${JSON.stringify(push[0]?.args)})`,
    );

    const api = ghApi(f);
    assert(api.length === 2, `two gh api calls: the deployment, then its status (${api.length})`);
    const dep = JSON.parse(api[0]?.stdin ?? "{}");
    assert(api[0]?.args.includes(`repos/${REPO}/deployments`), "the deployment goes to the repo's deployments");
    assert(dep.ref === SHA, "for the deployed commit");
    assert(dep.environment === "production", "environment production");
    assert(dep.auto_merge === false, "auto_merge false");
    assert(Array.isArray(dep.required_contexts) && dep.required_contexts.length === 0, "required_contexts empty");
    assert(dep.description === TAG, `description is the tag (${dep.description})`);
    const st = JSON.parse(api[1]?.stdin ?? "{}");
    assert(api[1]?.args.includes(`repos/${REPO}/deployments/4242/statuses`), "the status is set on that deployment");
    assert(st.state === "success", "state success");
    assert(st.description === LAST, `status description is the log's last line (${st.description})`);
    assert(st.environment === "production", "on the production environment");

    assert(r.tagName === TAG && r.tagPushed && r.deploymentId === 4242 && r.skipped === null, "the outcome says all of it");
  });

  await check("a dirty tree", async () => {
    const f = fake();
    const paths = ["worker/jobs/scrape.ts", "sites/_configs/x--abc.json"];
    const r = await recordDeploy(input({ dirtyPaths: paths }), f.deps);
    const tag = git(f, "tag")[0];
    assert(tag?.args[2] === `${TAG}-dirty`, `the tag is suffixed -dirty (${tag?.args[2]})`);
    const msg = tag ? tag.args[tag.args.indexOf("-m") + 1] : "";
    assert(paths.every((p) => msg.includes(p)), `the tag message lists the modified paths (${msg})`);
    assert(
      JSON.stringify(git(f, "push")[0]?.args) === JSON.stringify(["push", "origin", `refs/tags/${TAG}-dirty`]),
      "and that is the tag pushed",
    );
    const dep = JSON.parse(ghApi(f)[0]?.stdin ?? "{}");
    assert(dep.description.startsWith(`${TAG}-dirty`), `the deployment description names the dirty tag (${dep.description})`);
    assert(paths.every((p) => dep.description.includes(p)), `and the modified paths (${dep.description})`);
    assert(dep.description.length <= 140, "within GitHub's 140-character limit");
    assert(JSON.stringify(dep.payload?.dirtyPaths) === JSON.stringify(paths), "the full list travels in the payload");
    assert(r.tagName === `${TAG}-dirty`, "the outcome names the dirty tag");

    const many = Array.from({ length: 30 }, (_, i) => `worker/lib/some-long-module-name-${i}.ts`);
    const f2 = fake();
    await recordDeploy(input({ dirtyPaths: many }), f2.deps);
    const d2 = JSON.parse(ghApi(f2)[0]?.stdin ?? "{}");
    assert(d2.description.length <= 140 && d2.description.includes("30 path"), `a long list is truncated with its count (${d2.description})`);
    assert(d2.payload.dirtyPaths.length === 30, "while the payload keeps all 30");
  });

  await check("gh missing", async () => {
    const f = fake({ gh: "missing" });
    const r = await recordDeploy(input(), f.deps);
    assert(git(f, "tag").length === 1 && git(f, "push").length === 1, "the tag is still made and pushed");
    assert(ghApi(f).length === 0, "no gh api call is attempted");
    assert(f.warns.length === 1, `exactly one warning (${f.warns.length})`);
    assert(r.skipped !== null && r.deploymentId === null, "the outcome says the record was skipped");
  });

  await check("gh not logged in", async () => {
    const f = fake({ gh: "logged-out" });
    const r = await recordDeploy(input(), f.deps);
    assert(ghApi(f).length === 0, "no gh api call");
    assert(f.warns.length === 1, `exactly one warning (${f.warns.length})`);
    assert(r.skipped !== null, "skipped");
  });

  await check("a tag that cannot be made is not pushed, and nothing throws", async () => {
    const f = fake({ failTag: true });
    const r = await recordDeploy(input(), f.deps);
    assert(git(f, "push").length === 0, "no push without a tag");
    assert(r.tagPushed === false, "the outcome says so");
  });

  await check("deploy.sh records only after the sentinel check, and never fails the deploy", () => {
    const sh = readFileSync(join(__dirname, "..", "deploy.sh"), "utf8");
    const calls = sh.split("scripts/deploy-record.ts").length - 1;
    assert(calls === 1, `deploy.sh calls the recorder exactly once (${calls})`);
    const sentinel = sh.indexOf('if ! grep -q "REMOTE_BLOCK_COMPLETE:$DEPLOY_TAG" "$REMOTE_LOG"; then');
    const sentinelExit = sh.indexOf("exit 1", sentinel);
    const record = sh.indexOf("scripts/deploy-record.ts");
    assert(sentinel > 0 && sentinelExit > sentinel, "the sentinel check and its exit exist");
    assert(record > sentinelExit, "the recorder runs after the sentinel check has passed — a failed deploy exits before it");
    const line = sh.slice(record, sh.indexOf("\n", record));
    assert(/\|\| echo/.test(line) || /\|\| true/.test(line), `a failure to record never fails the deploy (${line.trim()})`);
    assert(/DIRTY_PATHS=/.test(sh.slice(0, sh.indexOf("==> Deploying"))), "the dirty paths are captured before the sync ships the tree");
  });

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.info("deployRecord: every successful deploy is a tag and a GitHub deployment, and a failed one is neither");
})();
