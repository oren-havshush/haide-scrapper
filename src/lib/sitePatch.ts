// Which action a PATCH /api/sites/[id] body asks for (addsite2 phase two,
// step 5, landmine a). The route honours exactly one of companyName,
// adminNote and status per call; it used to pick the first key present and
// silently drop the rest (LRN-WRK-7). A body naming more than one is now a 400
// that names them. A body naming none goes down the status path as before,
// whose schema reports the missing key.

import { ValidationError } from "./errors";

export type SitePatchAction = "companyName" | "adminNote" | "status";

const ACTIONS: readonly SitePatchAction[] = ["companyName", "adminNote", "status"];

export function pickSitePatchAction(body: Record<string, unknown>): SitePatchAction {
  const present = ACTIONS.filter((k) => body !== null && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, k));
  if (present.length > 1) {
    throw new ValidationError(
      `PATCH /api/sites/:id takes exactly one of companyName, adminNote, status per call; this body has ${present.join(", ")}. Send them as separate calls.`,
    );
  }
  return present[0] ?? "status";
}
