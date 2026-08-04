/**
 * Re-introduce line structure into a description that arrived as one run-on
 * line (a "blob" — see jobs-quality-audit: >200 chars with zero line breaks).
 *
 * Why this exists as a *post-extraction* step rather than a per-site fix:
 * the blob has several unrelated upstream causes (a setupScript that ran
 * `.replace(/\s+/g,' ')`; a source page whose text node genuinely carries no
 * block markup; a feed that delivers bullets as glyphs on one line). What they
 * share is that the *structure is still recoverable from the text itself* —
 * the ad still says `דרישות :` and still carries its `•` markers. So we rebuild
 * line breaks from those in-text signals once, centrally, instead of 28 times.
 *
 * This never touches text that already has line breaks, and every split is
 * rejected unless it produces a plausible shape (see `isPlausible`). A rejected
 * split returns the input unchanged — a blob is bad, but shredded prose is worse.
 */

/** A description is a "blob" if it is long enough to have needed structure and has none. */
const BLOB_MIN_LENGTH = 200;

/**
 * List-marker glyphs used in Hebrew job ads. Beyond the usual bullets, these
 * ads lean heavily on checkmarks and arrows as item markers (strauss-group).
 */
const BULLET_GLYPHS = "•●▪‣◦·∙※*✔✓☑✅❖➤➔→▶✦★";

/**
 * Section headings that start a new block in Hebrew job ads. Matched only when
 * followed by an optional space and a colon, so prose mentions of the same word
 * ("דרישות התפקיד מפורטות באתר") do not trigger a split.
 */
const SECTION_HEADINGS = [
  "דרישות התפקיד",
  "דרישות המשרה",
  "דרישות",
  "תיאור התפקיד",
  "תיאור המשרה",
  "התפקיד כולל",
  "תחומי אחריות",
  "על המשרה",
  "על התפקיד",
  "תנאי סף",
  "תנאים",
  "כישורים",
  "כישורים נדרשים",
  "מה אנחנו מציעים",
  "היקף המשרה",
  "מיקום המשרה",
  "השכלה",
  "ניסיון נדרש",
];

/** Shortest fragment we will accept as its own line — below this we assume over-splitting. */
const MIN_LINE_LENGTH = 12;

/** Above this many lines, the split has almost certainly shredded prose. */
const MAX_LINES = 60;

export function isBlob(text: string): boolean {
  return text.length >= BLOB_MIN_LENGTH && !text.includes("\n");
}

/**
 * Guard every candidate split: at least two lines, no shredding into fragments,
 * and a line count proportionate to the text length.
 */
function isPlausible(lines: string[], originalLength: number): boolean {
  if (lines.length < 2 || lines.length > MAX_LINES) return false;
  // A split that leaves most lines as fragments is destroying prose, not
  // structuring it. Headings are exempt: `דרישות :` is short *by nature*, and
  // counting it as shredding rejects exactly the splits we most want to keep.
  const isHeading = (l: string) => l.endsWith(":");
  const body = lines.filter((l) => !isHeading(l));
  const shortLines = body.filter((l) => l.length < MIN_LINE_LENGTH).length;
  if (body.length > 0 && shortLines > body.length / 3) return false;
  // Guard against a marker that appears so often it is punctuation, not structure.
  if (originalLength / lines.length < 20) return false;
  return true;
}

function toLines(text: string): string[] {
  return text
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Break at each bullet glyph: `על המשרה • ליווי • תמיכה`. Requires two markers —
 * a lone glyph is decoration, not a list.
 */
function markBullets(text: string): string {
  const re = new RegExp(`\\s*[${BULLET_GLYPHS}]\\s*`, "g");
  const marks = text.match(re);
  if (!marks || marks.length < 2) return text;
  return text.replace(re, "\n");
}

/**
 * Break around a section heading: `... בארץ דרישות : ניסיון קודם`. The heading
 * gets its own line — break both before it and after its colon. The lookahead
 * requires the colon, so prose mentions ("דרישות התפקיד מפורטות באתר") are left
 * alone.
 *
 * Whitespace before the heading is optional on purpose: several sites emit the
 * heading welded to the previous sentence with no separator at all
 * (`...בהקדם!דרישות:`, `תיאור המשרה:מתן שירות`), which is precisely the case
 * where the newline was lost.
 */
function markHeadings(text: string): string {
  const alt = SECTION_HEADINGS.map((h) => h.replace(/ /g, "\\s+")).join("|");
  return text
    // break before the heading, but never at position 0 (needs a preceding char)
    .replace(new RegExp(`(?<=.)\\s*(?=(?:${alt})\\s*:)`, "g"), "\n")
    // break after the heading's colon so its first item starts a line
    .replace(new RegExp(`((?:${alt})\\s*:)\\s*`, "g"), "$1\n");
}

/**
 * Some ads (l-b.co.il) end every item with a spaced `!` where the newline was
 * lost. Only treat it as a separator when it recurs — a single `!` is emphasis.
 */
function markBangSeparator(text: string): string {
  const re = /\s+!\s+/g;
  const marks = text.match(re);
  if (!marks || marks.length < 2) return text;
  return text.replace(re, "\n");
}

/**
 * Some ads (clalbit) mark every item with a bare hyphen welded to the previous
 * item: `מה תעשו?-תבצעו מעקב-תערכו מידע-תכינו דוחות`. Only fires on a Hebrew
 * letter (so date and time ranges like `08:30-17:30` are untouched) and only
 * from three occurrences up, so a hyphenated compound word cannot trigger it.
 */
function markHyphenItems(text: string): string {
  const re = /\s*-(?=[א-ת])/g;
  const marks = text.match(re);
  if (!marks || marks.length < 3) return text;
  return text.replace(re, "\n");
}

/** Break before ` 1. ` / ` 2. ` enumerations, requiring a real sequence. */
function markNumberedItems(text: string): string {
  const re = /\s+(?=\d{1,2}[.)]\s)/g;
  const marks = text.match(re);
  if (!marks || marks.length < 2) return text;
  return text.replace(re, "\n");
}

/**
 * Rebuild line breaks in a run-on description. Returns the input unchanged when
 * the text is not a blob, or when the rebuilt shape fails the plausibility guards.
 *
 * Markers are applied *cumulatively*, not first-match: a single ad routinely
 * carries both `•` items and a `דרישות :` heading, and stopping at the first
 * signal leaves the rest glued together.
 */
export function structureDescription(text: string | null | undefined): string {
  if (!text) return "";
  if (!isBlob(text)) return text;

  const marked = markNumberedItems(
    markHyphenItems(markBangSeparator(markHeadings(markBullets(text)))),
  );
  const lines = toLines(marked);
  return isPlausible(lines, text.length) ? lines.join("\n") : text;
}
