/**
 * scriptCutOff.ts — a scheduled run whose setup script hit its limit is
 * refused (owner, 2026-10-13).
 *
 * The 90-s limit (worker/lib/setupScriptRun.ts) cut horizontech's script after
 * ~233 of the 265 detail pages it reads, and the run went on "as if the script
 * had returned nothing": 32 rows were written with no description, and the
 * public site took them. A script cut off part-way leaves a partial read in
 * the page, so a scheduled run treats it like a truncated walk: nothing is
 * written and the previous listings are kept. A manual run is not refused; it
 * carries setup_script_timeout on its warnings, as before.
 *
 * The site's own limit is limits.setupScriptSeconds (worker/lib/siteLimits.ts).
 */

import { challengeWarnings } from "./challengeWait";
import { SETUP_SCRIPT_CUT_OFF } from "./sweepSelection";
import type { ExtractGuard } from "./zeroMatch";

/** The run's refusal, or null when the run may go on. */
export function scriptCutOffRefusal(
  guard: ExtractGuard | null | undefined,
): { failureCategory: string; error: string; warnings: string[] } | null {
  if (!guard || !guard.scheduled || guard.scriptTimeouts.length === 0) return null;
  const seconds = Math.round(guard.scriptLimitMs / 1000);
  return {
    failureCategory: SETUP_SCRIPT_CUT_OFF,
    error: `setup script cut off at ${seconds} s on a scheduled run; nothing written, previous listings kept`,
    // The first names the limit for the morning line; the script's own warning
    // (challengeWarnings carries it) names the page it was cut off on.
    warnings: [`${SETUP_SCRIPT_CUT_OFF}: ${seconds} s`, ...challengeWarnings(guard)],
  };
}
