// How one site's check findings for a run meet its open fix items (addsite2
// phase two, step 1a). Pure; step 2's value checks (worker/lib/valueChecks.ts)
// feed it, and the caller writes what it returns.
//
//   - A code already open as a CHECK item opens nothing new: the same warning
//     on two nights is one item, and its openedAt stays the first night's.
//   - An open CHECK item whose code did not fire this run is closed,
//     resolvedBy CHECK.
//   - A MANUAL item is an operator's; no check opens, matches or closes it.

export type FixFieldName =
  | "JOB_ID"
  | "APPLY"
  | "TITLE"
  | "DESCRIPTION"
  | "DATE"
  | "LOCATION"
  | "COVERAGE"
  | "COMPANY"
  | "OTHER";

/** One check's finding on one site for one run. */
export type CheckFinding = { code: string; field: FixFieldName; detail?: string; jobIds?: string[] };

/** A site's open (unresolved) fix item. */
export type OpenFixItem = { id: string; source: "MANUAL" | "CHECK"; code: string; field: string };

export type FixQueuePlan = {
  /** Findings to open as new CHECK items. */
  open: CheckFinding[];
  /** Open CHECK items whose code no longer fires. */
  close: Array<{ id: string; resolvedBy: "CHECK" }>;
  /** Open items left as they are. */
  keep: string[];
};

export function planFixItems(findings: CheckFinding[], openItems: OpenFixItem[]): FixQueuePlan {
  const firing = new Map<string, CheckFinding>();
  for (const f of findings) if (!firing.has(f.code)) firing.set(f.code, f);

  const openChecks = new Set(openItems.filter((i) => i.source === "CHECK").map((i) => i.code));
  const plan: FixQueuePlan = { open: [], close: [], keep: [] };

  for (const [code, f] of firing) if (!openChecks.has(code)) plan.open.push(f);
  for (const i of openItems) {
    if (i.source === "CHECK" && !firing.has(i.code)) plan.close.push({ id: i.id, resolvedBy: "CHECK" });
    else plan.keep.push(i.id);
  }
  return plan;
}
