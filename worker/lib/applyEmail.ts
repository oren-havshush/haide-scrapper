/**
 * applyEmail.ts — which email in a job's text may become its apply address
 * (developer's report 2026-10-18, item 1; owner, 2026-10-18).
 *
 * The description fallback used to take the first email anywhere in the text.
 * An ad that ends with a privacy or inquiries paragraph then published that
 * mailbox as the apply address of every job (albar: pniyot@albar.co.il).
 *
 * One rule decides: an email is taken only from a line that carries an apply
 * cue. The run's view only reports: a fallback email on more than half of the
 * run's rows is named in one warning (buildJobRows in worker/jobs/scrape.ts)
 * and kept. A cue line repeated on every ad is a small employer's one HR
 * mailbox, which is the apply address (tl-care: ilanitD@ on all 16 jobs); the
 * inquiries paragraph that started this has no cue (albar).
 */

/** קו"ח with each quote a site uses: ASCII ", gershayim (U+05F4), and U+201D. */
const KUFVAVHET = ["\"", String.fromCharCode(0x05f4), String.fromCharCode(0x201d)].map((q) => "קו" + q + "ח");

/** Hebrew cues, matched as substrings: \b does not fire after a Hebrew letter. */
const HEBREW_CUES = [...KUFVAVHET, "קורות חיים", "להגשת", "להגיש", "שלחו"];
const LATIN_CUES = /\b(?:cv|resume|apply)\b/i;

/** The local part opens with a letter or digit: "ל-jobs@x.co.il" is jobs@x.co.il, not -jobs@. */
const EMAIL_RE = /([A-Z0-9][A-Z0-9._%+\-]*@[A-Z0-9.\-]+\.[A-Z]{2,})/i;

export function hasApplyCue(line: string): boolean {
  return HEBREW_CUES.some((c) => line.includes(c)) || LATIN_CUES.test(line);
}

/** The first email on a line that carries an apply cue; null when there is none. */
export function cueLineEmail(text: string): string | null {
  for (const line of (text ?? "").split(/\r?\n/)) {
    if (!hasApplyCue(line)) continue;
    const m = EMAIL_RE.exec(line);
    if (m) return m[1];
  }
  return null;
}

/** Below this many rows a run says nothing about what repeats across the site. */
export const SITE_WIDE_MIN_ROWS = 3;

/**
 * The fallback emails on more than half of the run's rows, lower-cased, with
 * their counts. `fallbackEmails` has one entry per row: the email the
 * description fallback gave that row, or null.
 */
export function siteWideApplyEmails(fallbackEmails: Array<string | null>): Map<string, number> {
  const total = fallbackEmails.length;
  const counts = new Map<string, number>();
  for (const e of fallbackEmails) {
    if (!e) continue;
    const k = e.trim().toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out = new Map<string, number>();
  if (total < SITE_WIDE_MIN_ROWS) return out;
  for (const [k, n] of counts) if (n * 2 > total) out.set(k, n);
  return out;
}

export function siteWideApplyEmailWarnings(siteWide: Map<string, number>, total: number): string[] {
  return [...siteWide].map(([address, n]) => `apply_email_site_wide: ${address} on ${n} of ${total}`);
}

/**
 * The email a row's applicationInfo took from the description fallback, or
 * null: the normalizer marks such a value in _enrichedFromDescription_applicationInfo.
 */
export function fallbackApplyEmailOf(rawFields: Record<string, string>, applicationInfo: string | null | undefined): string | null {
  const marked = rawFields["_enrichedFromDescription_applicationInfo"];
  if (!marked || !marked.includes("@") || !applicationInfo) return null;
  return marked.trim().toLowerCase() === applicationInfo.trim().toLowerCase() ? marked : null;
}
