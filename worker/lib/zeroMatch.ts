// A configured item selector that matches nothing.
//
// When the explicit itemSelector matches zero elements, the single-page
// extractor falls back to auto-detecting "repeating item containers" from the
// field selectors (extractWithAutoItemDetection) — built in 5c1c324
// (2026-05-11) for extension-recorded configs whose field selectors are
// absolute nth-child paths with no item container. On a config that HAS an
// item selector, a zero match means the page changed or emptied, and the
// fallback builds cards out of whatever the field selectors happen to hit.
// 2026-09-29, night one: biopharmax's listing showed JetEngine's "no listings"
// block, the fallback took the language switcher's <h2> as a title, and "EN"
// was published as a job.
//
// On a scheduled run that is now a listing refusal: category
// structure_changed, nothing stored, the previous rows kept, no fallback.
// Since 2026-09-30 the manual path refuses too (the owner's decision): the same
// message and category, but its run closes FAILED so the operator sees it did
// not work — and nothing is written or deleted either way.

export const ZERO_MATCH_WARNING = "item_selector_zero_match";

/** Per run. `zeroMatch` records the selector that matched nothing, when refused. */
export type ExtractGuard = {
  noAutoDetect: boolean;
  /** A scheduled run closes a refusal COMPLETED; a manual one FAILED. */
  scheduled: boolean;
  zeroMatch: string | null;
};

export function newExtractGuard(scheduled: boolean): ExtractGuard {
  return { noAutoDetect: true, scheduled, zeroMatch: null };
}

/**
 * The explicit item selector matched zero elements. "refuse" (and remember the
 * selector) for any run with a guard; "auto-detect" only for a caller with none.
 */
export function onExplicitZeroMatch(guard: ExtractGuard | null, selector: string): "refuse" | "auto-detect" {
  if (!guard || !guard.noAutoDetect) return "auto-detect";
  guard.zeroMatch = guard.zeroMatch ?? selector;
  return "refuse";
}

/**
 * The listing refusal for a run whose item selector matched nothing and that
 * ended with no rows; null otherwise. Rows from another page or listing URL
 * leave it to the listing and pagination guards, which judge partial sets.
 */
export function zeroMatchRefusal(
  guard: ExtractGuard | null,
  rowCount: number,
): { failureCategory: "structure_changed"; runStatus: "COMPLETED" | "FAILED"; error: string; warnings: string[] } | null {
  if (!guard || !guard.noAutoDetect || !guard.zeroMatch || rowCount > 0) return null;
  return {
    failureCategory: "structure_changed",
    runStatus: guard.scheduled ? "COMPLETED" : "FAILED",
    error: `item selector matched nothing: ${guard.zeroMatch} — no auto-detect fallback; previous listings kept`,
    warnings: [`${ZERO_MATCH_WARNING}: ${guard.zeroMatch}`],
  };
}
