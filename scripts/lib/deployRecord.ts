// A deploy's git tag and GitHub deployment record (called by deploy.sh).
//
// Runs only after deploy.sh's sentinel check has passed, so a failed deploy is
// neither tagged nor recorded. Two records of the same thing:
//
//   1. an annotated git tag named exactly like DEPLOY_TAG on the deployed commit,
//      pushed ALONE to origin (refs/tags/<name> — never --tags, never a branch);
//   2. a GitHub deployment for that commit — environment production, auto_merge
//      false, required_contexts empty, description = the tag — with a "success"
//      status whose description is the deploy log's last line, so the deploy
//      shows at github.com/<repo>/deployments.
//
// A dirty working tree gets "<tag>-dirty", and its modified paths go in the tag
// message and the deployment: the sync ships the TREE, not the commit, so the
// commit alone does not say what is running.
//
// Nothing here fails the deploy. No gh, or gh not logged in: one warning and no
// deployment record. git and gh are injected so the test can watch every call.

export type RunResult = { code: number; stdout: string; stderr: string };
export type Runner = (cmd: string, args: string[], stdin?: string) => Promise<RunResult>;

export type DeployRecordInput = {
  /** DEPLOY_TAG from deploy.sh, e.g. deploy-20260929-221357-d1da72e. */
  deployTag: string;
  /** The full commit SHA that was checked out when the deploy started. */
  sha: string;
  /** The deploy log's last line, for the deployment status. */
  lastLine: string;
  /** `git status --porcelain` paths captured before the sync. Empty = clean. */
  dirtyPaths: string[];
  /** owner/name on GitHub. */
  repo: string;
  /** Tag message override (the backfill uses "backfilled from image tag"). */
  message?: string;
};

export type DeployRecordOutcome = {
  tagName: string;
  tagPushed: boolean;
  deploymentId: number | null;
  /** Why the deployment record was skipped; null when it was made. */
  skipped: string | null;
};

/** GitHub's limit on deployment and status descriptions. */
const GH_DESCRIPTION_MAX = 140;

function clip(s: string, max = GH_DESCRIPTION_MAX): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

/** "<tag> — dirty: a, b" within 140 chars; a long list becomes "N paths: a, b, …". */
function dirtyDescription(tagName: string, paths: string[]): string {
  const full = `${tagName} — dirty: ${paths.join(", ")}`;
  if (full.length <= GH_DESCRIPTION_MAX) return full;
  const head = `${tagName} — dirty, ${paths.length} paths: `;
  const out: string[] = [];
  for (const p of paths) {
    const next = head + [...out, p].join(", ") + ", …";
    if (next.length > GH_DESCRIPTION_MAX) break;
    out.push(p);
  }
  return clip(head + out.join(", ") + (out.length < paths.length ? ", …" : ""));
}

export async function recordDeploy(
  input: DeployRecordInput,
  deps: { run: Runner; log?: (l: string) => void; warn?: (l: string) => void },
): Promise<DeployRecordOutcome> {
  const log = deps.log ?? ((l: string) => console.info(l));
  const warn = deps.warn ?? ((l: string) => console.warn(l));
  const dirty = input.dirtyPaths.length > 0;
  const tagName = dirty ? `${input.deployTag}-dirty` : input.deployTag;
  const outcome: DeployRecordOutcome = { tagName, tagPushed: false, deploymentId: null, skipped: null };

  // ---- 1. the tag ----------------------------------------------------------
  const message =
    input.message ??
    (dirty
      ? `${input.deployTag} deployed from a dirty working tree. The sync ships the tree, not the commit; modified paths:\n${input.dirtyPaths.map((p) => `  ${p}`).join("\n")}`
      : `${input.deployTag} deployed`);
  const tag = await deps.run("git", ["tag", "-a", tagName, "-m", message, input.sha]);
  if (tag.code !== 0) {
    warn(`[deploy-record] could not create tag ${tagName}: ${tag.stderr.trim()} — not pushed`);
  } else {
    const push = await deps.run("git", ["push", "origin", `refs/tags/${tagName}`]);
    if (push.code !== 0) warn(`[deploy-record] could not push tag ${tagName}: ${push.stderr.trim()}`);
    else {
      outcome.tagPushed = true;
      log(`[deploy-record] tag ${tagName} pushed to origin`);
    }
  }

  // ---- 2. the GitHub deployment -------------------------------------------
  const version = await deps.run("gh", ["--version"]);
  const auth = version.code === 0 ? await deps.run("gh", ["auth", "status"]) : null;
  if (version.code !== 0 || !auth || auth.code !== 0) {
    outcome.skipped = version.code !== 0 ? "gh is not installed" : "gh is not logged in";
    warn(`[deploy-record] WARNING: ${outcome.skipped} — no GitHub deployment record for ${tagName}; the deploy itself succeeded`);
    return outcome;
  }

  const deployment = {
    ref: input.sha,
    environment: "production",
    auto_merge: false,
    required_contexts: [] as string[],
    description: dirty ? dirtyDescription(tagName, input.dirtyPaths) : clip(tagName),
    payload: { deployTag: input.deployTag, tagName, dirtyPaths: input.dirtyPaths },
  };
  const created = await deps.run(
    "gh",
    ["api", "--method", "POST", `repos/${input.repo}/deployments`, "--input", "-"],
    JSON.stringify(deployment),
  );
  let id: number | null = null;
  try {
    id = created.code === 0 ? (JSON.parse(created.stdout).id ?? null) : null;
  } catch {
    id = null;
  }
  if (id === null) {
    warn(`[deploy-record] could not create the GitHub deployment: ${created.stderr.trim() || created.stdout.trim()}`);
    return outcome;
  }
  outcome.deploymentId = id;

  const status = await deps.run(
    "gh",
    ["api", "--method", "POST", `repos/${input.repo}/deployments/${id}/statuses`, "--input", "-"],
    JSON.stringify({ state: "success", environment: "production", description: clip(input.lastLine) }),
  );
  if (status.code !== 0) warn(`[deploy-record] deployment ${id} created, but its status could not be set: ${status.stderr.trim()}`);
  else log(`[deploy-record] GitHub deployment ${id} recorded (production, success)`);
  return outcome;
}
