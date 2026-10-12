// The item cap, said out loud (owner, 2026-10-13, LRN-WRK-30). Pure, so the rule
// is tested without a browser (itemCap.test.ts); scrape.ts's dedupe calls it.
//
// MAX_EXTRACTED_ITEMS (scrape.ts) used to stop the dedupe loop at 2,000 with no
// trace: a scheduled run wrote the first 2,000 and the rest of the site simply
// vanished (Maof lists 2,524). Now the cap records how many distinct cards there
// were on the run's guard; a scheduled run refuses the write (item_cap, rows
// kept), and a manual run writes the first 2,000 carrying the warning.

import type { ExtractGuard } from "./zeroMatch";

export const ITEM_CAP_WARNING = "item_cap_reached";

/** The first `max` items. When there were more, the guard records the largest count seen this run. */
export function capItems<T>(items: T[], max: number, guard: ExtractGuard | null): T[] {
  if (items.length <= max) return items;
  if (guard) guard.itemCap = Math.max(guard.itemCap ?? 0, items.length);
  return items.slice(0, max);
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** The run warning, when the cap bit: "item_cap_reached: 2,000 of 2,524 cards". */
export function itemCapWarnings(guard: ExtractGuard | null, max: number): string[] {
  if (!guard || guard.itemCap === null) return [];
  return [`${ITEM_CAP_WARNING}: ${fmt(max)} of ${fmt(guard.itemCap)} cards`];
}

/** Items one run may write (was a local constant in scrape.ts). */
export const MAX_EXTRACTED_ITEMS = 2000;
