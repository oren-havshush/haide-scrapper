// The row data a fix-item PATCH writes (src/services/fixQueueService.ts
// updateFixItem). Pure, so it can be tested without a database.
//
// Minutes set by hand are not an estimate (owner, 2026-10-08): a patch that
// carries minutes, a number or null, also clears minutesEstimated. A patch
// without minutes leaves both as they are.

export type FixItemPatch = {
  minutes?: number | null;
  note?: string | null;
  operator?: string;
  resolved?: boolean;
  resolvedBy?: "MANUAL" | "CHECK";
};

export function fixItemUpdateData(patch: FixItemPatch, now: Date) {
  return {
    ...(patch.minutes !== undefined ? { minutes: patch.minutes, minutesEstimated: false } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    ...(patch.operator !== undefined ? { operator: patch.operator } : {}),
    ...(patch.resolved === true ? { resolvedAt: now, resolvedBy: patch.resolvedBy ?? "MANUAL" } : {}),
    ...(patch.resolved === false ? { resolvedAt: null, resolvedBy: null } : {}),
  };
}
