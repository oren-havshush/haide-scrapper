// Did the listing walk see the whole listing?
//
// 2026-09-24: ashtrom's scheduled run paged 15 + 15 cards, clicked "next" on a
// button the site still offered, and the page did not change inside the 6s
// window. advanceToNextPage returned false, the walk ended, and 30 rows
// replaced 57 — deleting 21 listings that were still live. The undersize guard
// let it through because 30/57 clears half.
//
// The walk knew. A next control that was present, enabled and clicked, and a
// page that then did not move, is not the end of a listing — the site said
// there was more. Measured from the box the same week: a transition that took
// 17.8s, and one that never came inside 40s, while the site throttled the host.
// No settle window fixes that; refusing to persist the partial walk does.

/** How one attempt to move to the next listing page ended. */
export type AdvanceOutcome =
  /** The next page loaded and its content differs. */
  | "advanced"
  /** The listing says it has no more pages: no next control, a disabled one,
   *  a URL page with no items, or a URL page identical to the last. */
  | "end"
  /** The listing offered a next page and did not deliver it: the click
   *  threw, the content did not change inside the window, or the URL page
   *  failed to load. */
  | "stalled";

/** What one paginated walk saw, recorded as it runs. */
export type PaginationWalk = {
  /** Items (or detail URLs) gained on each page, in order. */
  pageCounts: number[];
  /** Why the walk stopped. `maxPages` is the config's own bound; `aborted` is
   *  the run's deadline, which already refuses persistence on its own. */
  stoppedBy: AdvanceOutcome | "maxPages" | "aborted" | null;
};

export function newPaginationWalk(): PaginationWalk {
  return { pageCounts: [], stoppedBy: null };
}

/**
 * The walk stopped short of a listing that had more to give.
 *
 * Truncated means: the walk ended on a stall, AND the page it stalled on was
 * full — at least as many items as the first page, which is the listing's page
 * size. Both halves are needed:
 *
 * - A stall alone is not enough. Some listings keep an enabled next button on
 *   their real last page and clicking it does nothing; that is a stall too, but
 *   the last page is partial. Refusing it would freeze such a site forever.
 * - With one page there is no page size to compare against, so a first-page
 *   stall is not judged here. The undersize guard covers that case.
 *
 * `maxPages` and `aborted` are not truncation for this rule: the first is the
 * config's own bound, and the deadline already refuses persistence.
 */
export function isTruncatedWalk(walk: PaginationWalk | null | undefined): boolean {
  if (!walk || walk.stoppedBy !== "stalled") return false;
  const pages = walk.pageCounts;
  if (pages.length < 2) return false;
  const pageSize = pages[0]!;
  const last = pages[pages.length - 1]!;
  return pageSize > 0 && last >= pageSize;
}
