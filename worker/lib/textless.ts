// A job with no text (owner, 2026-10-14). A job is text-less when it carries
// neither a description nor requirements, or when its only description repeats
// its title. On every site a text-less job is stored as today and is a signal
// (the text_less value check, worker/lib/valueChecks.ts): the page may carry
// text the config misses (freesbe, egged, j-t on 2026-10-14).
//
// partitionTextless is for a site flagged text-less by nature
// (_meta.textlessByNature, an agency board like Maof). Only there is a
// text-less record not stored. It is not wired yet: the flag is built only when
// such a site is onboarded.

import { DETAIL_UNAVAILABLE_STATUS } from "./detailPlan";

/** Whitespace, plus the invisible characters a page leaves behind: no-break space and zero-width ones. */
const INVISIBLE = new RegExp(
  "[\\s" + [0xa0, 0x200b, 0x200c, 0x200d, 0xfeff].map((c) => String.fromCharCode(c)).join("") + "]+",
  "g",
);

/** The value with every run of whitespace or invisible characters collapsed to one space, trimmed. */
export function collapseText(v: string | null | undefined): string {
  return typeof v === "string" ? v.replace(INVISIBLE, " ").trim() : "";
}

export type TextlessView = {
  title: string | null | undefined;
  description: string | null | undefined;
  requirements: string | null | undefined;
};

/**
 * True when the job has no text: description and requirements both empty, or
 * requirements empty and the description only repeats the title (point 4).
 */
export function isTextless(j: TextlessView): boolean {
  const description = collapseText(j.description);
  const requirements = collapseText(j.requirements);
  if (requirements) return false;
  if (!description) return true;
  const title = collapseText(j.title);
  return !!title && description.toLowerCase() === title.toLowerCase();
}

/** The run's warning (worker/lib/valueChecks.ts textLess): N text-less of M saved. */
export function textlessWarning(n: number, m: number): string {
  return `text_less: ${n} of ${m} cards`;
}

/** N and M back from a run's warnings, or null when the run had none. */
export function readTextlessWarning(warnings: readonly unknown[] | null | undefined): { n: number; m: number } | null {
  for (const w of warnings ?? []) {
    const hit = /^text_less: (\d+) of (\d+) cards$/.exec(String(w));
    if (hit) return { n: Number(hit[1]), m: Number(hit[2]) };
  }
  return null;
}

/** Needs attention: more than 20% of the site's jobs have no text, and at least 3. */
export const TEXTLESS_ATTENTION_SHARE = 0.2;
export const TEXTLESS_ATTENTION_MIN = 3;
export function isTextlessAttention(n: number, m: number): boolean {
  return m > 0 && n >= TEXTLESS_ATTENTION_MIN && n / m > TEXTLESS_ATTENTION_SHARE;
}

/** Detail visits that found no page: the same set countDeadDetailPages counts in worker/jobs/scrape.ts. */
const DEAD_NAV_STATUSES: ReadonlySet<string> = new Set(["http_error", "timeout", "skipped_no_url", DETAIL_UNAVAILABLE_STATUS]);

export type TextlessPartition<T> = {
  kept: T[];
  /** Text-less, and the detail page was read (or there is none to read): counted as text_less_dropped. */
  dropped: T[];
  /** Text-less because the detail visit failed: already counted once as a dead page, not again. */
  deadDropped: T[];
};

/**
 * The flagged site's split: what is stored, what is dropped as text-less, and
 * what is dropped as a dead page. Order within each part is kept.
 */
export function partitionTextless<T>(
  records: T[],
  view: (r: T) => TextlessView & { detailNavStatus?: string | null },
): TextlessPartition<T> {
  const out: TextlessPartition<T> = { kept: [], dropped: [], deadDropped: [] };
  for (const r of records) {
    const v = view(r);
    if (!isTextless(v)) out.kept.push(r);
    else if (v.detailNavStatus && DEAD_NAV_STATUSES.has(v.detailNavStatus)) out.deadDropped.push(r);
    else out.dropped.push(r);
  }
  return out;
}
