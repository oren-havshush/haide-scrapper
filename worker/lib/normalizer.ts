// ---------------------------------------------------------------------------
// Data Normalization Module
// ---------------------------------------------------------------------------
// Transforms raw extracted job data into a consistent normalized format.
// Strips HTML tags, collapses whitespace, maps standard fields, and
// preserves the original rawFields for debugging and re-processing.
// ---------------------------------------------------------------------------

import {
  isAreaLabel,
  isQualifierPlace,
  resolveExactLocation,
  MULTI_WORD_PLACE_NAMES,
} from "./locationNormalize";
import { structureDescription } from "./descriptionStructure";

/** Standard job schema fields that map directly to Job model columns */
const STANDARD_FIELDS = new Set([
  "title",
  "description",
  "requirements",
  "location",
  "department",
  "externalJobId",
  "publishDate",
  "deadline",
  "applicationInfo",
]);

/** Normalized output for a single job record */
export interface NormalizedJobRecord {
  title: string;
  description: string;
  requirements: string;
  location: string;
  department: string;
  externalJobId: string;
  publishDate: string;
  deadline: string;
  applicationInfo: string;
  url: string;
  additionalFields: Record<string, string>;
  rawFields: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Text normalization helpers
// ---------------------------------------------------------------------------

/**
 * Remove all HTML tags from a string, preserving text content.
 * Handles tags with attributes, self-closing tags, and nested tags.
 */
export function stripHtmlTags(text: string): string {
  return text
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]*>/g, "");
}

/**
 * Collapse multiple consecutive whitespace characters (spaces, tabs,
 * newlines, non-breaking spaces) into a single space and trim.
 */
export function normalizeWhitespace(text: string): string {
  return text.replace(/[\s\u00A0]+/g, " ").trim();
}

/**
 * Like normalizeWhitespace but preserves intentional line breaks.
 * Use for multi-line fields (description, requirements).
 */
export function normalizeMultilineWhitespace(text: string): string {
  return text
    .replace(/\u00A0/g, " ")          // nbsp → space
    .replace(/[^\S\n]+/g, " ")        // collapse horizontal whitespace, keep \n
    .replace(/\n{3,}/g, "\n\n")       // max two consecutive newlines
    .replace(/ \n/g, "\n")            // drop space before newline
    .replace(/\n /g, "\n")            // drop space after newline
    .trim();
}

/**
 * Full normalization pipeline for a single field value:
 * 1. Strip HTML tags
 * 2. Normalize whitespace (collapse + trim)
 * Handle empty/null/undefined by returning empty string.
 */
export function normalizeField(rawValue: string | null | undefined): string {
  if (!rawValue) return "";
  return normalizeWhitespace(stripHtmlTags(rawValue));
}

/**
 * Like normalizeField but preserves line breaks — use for description/requirements.
 */
export function normalizeMultilineField(rawValue: string | null | undefined): string {
  if (!rawValue) return "";
  return normalizeMultilineWhitespace(stripHtmlTags(rawValue));
}

/**
 * Heuristic: reject plain-text that is actually CSS rules (no HTML tags).
 */
export function looksLikeCss(text: string): boolean {
  if (!text || text.length < 20) return false;
  const ruleBlocks = text.match(/[.#][\w-]+\s*\{[^}]*\}/g);
  if (ruleBlocks && ruleBlocks.length >= 2) return true;
  if (/@(?:media|keyframes|import|supports|charset)\b/i.test(text)) return true;
  const punct = (text.match(/[{};:]/g) || []).length;
  if (text.length > 0 && punct / text.length > 0.1) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Description-text fallback extraction
// ---------------------------------------------------------------------------
// Many sites embed location / department / job ID / publish date / requirements
// inside the description prose instead of exposing them as separate selectors.
// When the dedicated field selector is missing or empty, we scan the
// description (and requirements) text for label-value patterns and use what
// we find. Conservative by design: every extraction requires an explicit
// label (e.g. "Location:", "מיקום:", "Job ID:") to avoid false positives.
// ---------------------------------------------------------------------------

/** Fields populated by description-text fallback. */
export interface ExtractedFromText {
  location: string | null;
  department: string | null;
  externalJobId: string | null;
  publishDate: string | null;
  requirements: string | null;
  applicationInfo: string | null;
  jobType: string | null;
}

// Known job-listing section labels. A value extracted after one label is
// considered to end when one of these labels (followed by ":" / "-" / "–")
// appears next. This is intentionally a closed set — using "any Hebrew word
// followed by colon" as the terminator was too eager and would cut multi-word
// values like "באר שבע" off at the first whitespace if the next word
// happened to be followed by a colon.
const KNOWN_NEXT_LABELS = String.raw`(?:` +
  // Hebrew
  String.raw`מיקום(?:\s+המשרה)?|אזור\s+(?:גיאוגרפי|גאוגרפי)|אזור|` +
  String.raw`שם\s+המחלקה|מחלקה|אגף|צוות|` +
  String.raw`מספר\s+(?:משרה|דרושים)|קוד\s+משרה|` +
  String.raw`פורסם(?:\s+בתאריך)?|תאריך\s+פרסום|` +
  String.raw`סוג\s+(?:ה)?משרה|היקף\s+(?:ה)?משרה|` +
  String.raw`תיאור(?:\s+המשרה)?|פרטי\s+המשרה|אחריות|יתרון|` +
  String.raw`דרישות(?:\s+(?:המשרה|תפקיד))?|אודות|` +
  // English
  String.raw`Location|Based\s+in|City|` +
  String.raw`Department|Team|Division|` +
  String.raw`Job\s+(?:ID|Number|Type)|Employment\s+Type|Position\s+Type|` +
  String.raw`Requisition(?:\s+ID)?|Position\s+ID|Vacancy\s+(?:ID|Number)|` +
  String.raw`Posted(?:\s+on)?|Published(?:\s+on)?|Date\s+Posted|Publish\s+Date|` +
  String.raw`Description|About\s+(?:us|the\s+role)|Responsibilities|Benefits|` +
  String.raw`Qualifications|Requirements|Nice\s+to\s+have|Bonus` +
  String.raw`)`;

// Apply / "send your CV" call-to-action phrases. These reliably mark the end
// of the structured metadata block on IL job pages — everything after them is
// application instructions, not field values. Used as a value terminator so a
// labeled field (e.g. "מיקום: רחובות") doesn't swallow the trailing apply prose.
const CTA_TERMINATOR =
  String.raw`(?:להגשת\s+מועמדות|לשליחת(?:\s+קורות(?:\s+חיים)?)?|יש\s+לשלוח|` +
  String.raw`להגיש\s+מועמדות|נא\s+לשלוח|Apply(?:\s+now)?|To\s+apply|` +
  String.raw`Send\s+(?:your\s+)?(?:cv|resume|application))`;

// Where to stop the captured value: a known-label terminator, a hard
// separator (| ) (newline), an emoji/pictograph (these are used as visual
// section dividers on IL listings, e.g. "… רחובות 📩 להגשת מועמדות"), an
// apply CTA phrase, a sentence break, or end of string.
const VALUE_TERMINATOR =
  String.raw`(?=\s+` + KNOWN_NEXT_LABELS + String.raw`\s*[:\-–]|` +
  String.raw`\s*[|\n)]|\s*\p{Extended_Pictographic}|\s+` + CTA_TERMINATOR +
  String.raw`|\.\s|$)`;

/**
 * A qualifier, not a value: Hebrew ads close a requirement line with
 * "– חובה" / "– יתרון". When the label word sits mid-sentence
 * ("ניסיון בניהול צוות – יתרון") the separator is real and the capture is a
 * grammatical accident, so the qualifier is the tell that we matched prose.
 */
const QUALIFIER_VALUE =
  /^(?:יתרון|חובה|רצוי|נדרש|מומלץ|לא\s+חובה|not\s+required|advantage|required)\b/iu;

type LabelOpts = {
  /**
   * Only accept a label that opens its own line (a leading bullet/emoji is
   * still fine). A real "Label: value" pair is line-leading; a label word
   * buried in a sentence is prose.
   */
  lineLeading?: boolean;
  /** Reject values longer than this — a long capture is a sentence, not a field. */
  maxLen?: number;
};

function matchLabeled(
  text: string,
  labelAlt: string,
  opts: LabelOpts = {},
): string | null {
  const prefix = opts.lineLeading
    ? String.raw`(?:^|\n)[\s\-•·*✔✓]*`
    : String.raw`(?:^|[\s|.(])`;
  const re = new RegExp(
    prefix +
      String.raw`(?:` + labelAlt + String.raw`)` +
      String.raw`\s*[:\-–]\s*` +
      String.raw`(.+?)` +
      VALUE_TERMINATOR,
    "iu",
  );
  const m = re.exec(text);
  if (!m) return null;
  const v = m[1].trim().replace(/[\s,;|]+$/g, "");
  if (v.length === 0 || v.length > (opts.maxLen ?? 200)) return null;
  if (QUALIFIER_VALUE.test(v)) return null;
  return v;
}

// Per-field label alternations. Order matters: more specific labels first so
// "מיקום המשרה" wins over "מיקום" (which would match a prefix and stop short).
const LABELS = {
  location: String.raw`מיקום\s+המשרה|אזור\s+(?:גיאוגרפי|גאוגרפי)|מיקום|אזור|Location|Based\s+in|City`,
  // `צוות`/`Team` are dropped on purpose: they are the words IL ads use in
  // prose ("ניהול צוות", "חברי הצוות", "אנשי צוות"), and every department they
  // ever recovered fleet-wide was a fragment of a requirement line, never a
  // department. The rest are matched line-leading only (see extractFieldsFromText).
  department: String.raw`שם\s+המחלקה|מחלקה|אגף|Department|Division`,
  externalJobId: String.raw`מספר\s+משרה|מס['׳]?\s*משרה|משרה\s+מס['׳]?|מספר\s+דרושים|קוד\s+משרה|Job\s+ID|Job\s+Number|Requisition(?:\s+ID)?|Req(?:\s*ID)?|Position\s+ID|Vacancy\s+(?:ID|Number)`,
  jobType: String.raw`סוג\s+(?:ה)?משרה|היקף\s+(?:ה)?משרה|Job\s+Type|Employment\s+Type|Position\s+Type`,
};

// Date labels frequently appear without a "Label: value" separator
// (e.g. "פורסם בתאריך 15/01/2026", "Posted on Jan 15, 2026"). We accept any
// of dd/mm/yyyy, yyyy-mm-dd, or Month name + day + year as the value.
const DATE_LABEL =
  String.raw`(?:פורסם(?:\s+בתאריך)?|תאריך\s+פרסום|Posted(?:\s+on)?|Published(?:\s+on)?|Date\s+Posted|Publish\s+Date)`;
const DATE_VALUE =
  String.raw`(?:\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|` +
  String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)` +
  String.raw`\s+\d{1,2},?\s+\d{4})`;

function extractPublishDate(text: string): string | null {
  const re = new RegExp(
    String.raw`(?:^|[\s|.(])` + DATE_LABEL + String.raw`\s*[:\-–]?\s*(` + DATE_VALUE + String.raw`)`,
    "iu",
  );
  const m = re.exec(text);
  return m ? m[1].trim() : null;
}

const ENGLISH_MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

/**
 * Parse a publish-date string to a UTC midnight Date for cutoff comparison.
 * Returns null for empty, relative, or unparseable values (caller keeps the job).
 */
export function parsePublishDateToUtc(dateStr: string): Date | null {
  const s = (dateStr || "").trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]) - 1;
    const d = Number(iso[3]);
    if (m < 0 || m > 11 || d < 1 || d > 31) return null;
    return new Date(Date.UTC(y, m, d));
  }

  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]) - 1;
    let year = Number(dmy[3]);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    return new Date(Date.UTC(year, month, day));
  }

  const eng =
    /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})$/i.exec(
      s,
    );
  if (eng) {
    const month = ENGLISH_MONTHS[eng[1].toLowerCase()];
    const day = Number(eng[2]);
    const year = Number(eng[3]);
    if (month === undefined || day < 1 || day > 31) return null;
    return new Date(Date.UTC(year, month, day));
  }

  return null;
}

/**
 * Classify a publishDate string into an age bucket relative to `now`.
 *
 * Buckets (based on calendar days elapsed since the publish date):
 *   null    — empty or unparseable date (no badge)
 *   "fresh" — < 90 days
 *   "d90"   — 90–179 days
 *   "d180"  — 180–364 days
 *   "d365"  — >= 365 days
 */
export function computeAgeBucket(
  publishDate: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!publishDate) return null;
  const parsed = parsePublishDateToUtc(publishDate);
  if (!parsed) return null;
  const nowUtcMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const diffMs = nowUtcMidnight.getTime() - parsed.getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days < 0) return "fresh"; // future-dated
  if (days < 90) return "fresh";
  if (days < 180) return "d90";
  if (days < 365) return "d180";
  return "d365";
}

/** True when publishDate parses and is strictly before minIso (YYYY-MM-DD). */
export function isPublishDateBeforeCutoff(
  publishDate: string,
  minIso: string,
): boolean {
  const parsed = parsePublishDateToUtc(publishDate);
  if (!parsed) return false;
  const min = parsePublishDateToUtc(minIso);
  if (!min) return false;
  return parsed.getTime() < min.getTime();
}

/**
 * Resolve a publish-date floor (YYYY-MM-DD) from a site config `_meta` block.
 *
 * Precedence (first match wins):
 *   1. minPublishDate — absolute ISO date, frozen (explicit per-site override).
 *   2. minPublishDays — relative window; cutoff = `now` − N days, recomputed on
 *      every call so the window keeps rolling forward.
 *
 * Returns null when neither is present/valid (callers may then fall back to a
 * global env default). This never affects date-less jobs: the consuming filter
 * (`isPublishDateBeforeCutoff`) keeps jobs whose publishDate is empty or
 * unparseable, whatever cutoff this produces.
 */
export function resolveMetaMinPublishDate(
  meta: { minPublishDate?: unknown; minPublishDays?: unknown } | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!meta) return null;

  const abs = meta.minPublishDate;
  if (typeof abs === "string" && /^\d{4}-\d{2}-\d{2}$/.test(abs)) return abs;

  const days = meta.minPublishDays;
  if (typeof days === "number" && Number.isFinite(days) && days >= 1) {
    const cutoff = new Date(now.getTime());
    cutoff.setUTCDate(cutoff.getUTCDate() - Math.floor(days));
    return cutoff.toISOString().slice(0, 10);
  }
  return null;
}

// A printed job-reference code wrapped in parentheses or brackets, e.g.
// "(JB-3138)", "[AB-1234]", "(REQ_99)". This is the common "the req number is
// printed right in the title/body" pattern and is intentionally generic: any
// 1–4 letter prefix + optional separator + 2–8 digits. We require the prefix
// letters (so a bare "(2024)" year or "(50)" is NOT mistaken for an ID) and the
// surrounding brackets (so a stray "AB12" mid-sentence is ignored). Exported so
// both the description fallback and the title scan can reuse it.
export function extractBracketedJobCode(text: string): string | null {
  const m = /[(\[]\s*([A-Za-z]{1,4}[-_]?\d{2,8})\s*[)\]]/.exec(text);
  return m ? m[1].toUpperCase().replace(/_/g, "-") : null;
}

// Standalone patterns that don't require a label.
function extractExternalJobIdFallback(text: string): string | null {
  // Bracketed printed code, e.g. "(JB-3138)" / "[AB-1234]" — most reliable
  // because the brackets disambiguate it from prose numbers.
  const bracketed = extractBracketedJobCode(text);
  if (bracketed) return bracketed;

  // (#ID), [ID], or REQ-1234 / JR-1234 / R-12345 standalone, anywhere.
  const m =
    /(?:[(\[#]|\bID\s+)\s*((?:REQ|JR|R|JOB|POS)[-_]?\d{2,8})\b/i.exec(text) ||
    /\b((?:REQ|JR|JOB)[-_]\d{2,8})\b/i.exec(text);
  if (m) return m[1].toUpperCase().replace(/_/g, "-");

  // Hebrew job-reference phrase: "מס' משרה 674", "מספר משרה: 1234",
  // "מס' משרה אולם ירושלים: 624". Requires an ID-intent word AND the explicit
  // keyword משרה, allows ~40 chars of intervening text (lazy), and captures
  // 2+ digits with no upper cap. The (?!\s*:) guard rejects clock times so a
  // run like "17" in "17:00" is skipped.
  const heb = /(?:מס['׳]?|מספר|קוד|מזהה)\s*משרה[\s\S]{0,40}?(\d{2,})(?!\s*:)/u.exec(text);
  if (heb) return heb[1];

  return null;
}

/**
 * Extract a clean job-ID token from a (possibly noisy) labeled value.
 *
 * Labeled externalJobId capture (matchLabeled) can sweep trailing form text
 * into the value — e.g. "מספר משרה: JB-1234 גודל הקובץ עד: 1MB" yields
 * "JB-1234 גודל הקובץ עד: 1MB". A real job ID is a single, whitespace-free
 * token of [A-Za-z0-9] plus internal separators (-, _, /, .) and carries at
 * least one digit. We return the first such digit-bearing token, with leading
 * non-alphanumerics (#, :, separators) and trailing punctuation stripped. This
 * preserves compound IDs whole ("REQ-2024-00123" is not truncated at internal
 * hyphens) and is idempotent on already-clean IDs ("JB-1234", "769", "12345").
 * Returns null when no digit-bearing token exists, so we never invent an ID.
 */
export function cleanExternalJobId(value: string | null): string | null {
  if (!value) return null;
  for (const rawToken of value.split(/\s+/)) {
    const token = rawToken
      .replace(/^[^A-Za-z0-9]+/, "")
      .replace(/[^A-Za-z0-9]+$/, "");
    if (
      token &&
      /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(token) &&
      /\d/.test(token)
    ) {
      return token;
    }
  }
  return null;
}

function extractApplicationInfoFallback(text: string): string | null {
  // Prefer email; fall back to IL phone (03-..., 050-..., 02-...).
  const email = /([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})/i.exec(text);
  if (email) return email[1];
  const phone = /(\b0\d{1,2}[\s\-]?\d{3}[\s\-]?\d{4}\b)/.exec(text);
  return phone ? phone[1] : null;
}

function extractRequirementsBlock(text: string): string | null {
  // Capture from "Requirements:" / "דרישות:" to the next labeled section,
  // a sentence ending the block, or end of string.
  const re =
    /(?:^|[\s|.])(?:דרישות(?:\s+המשרה)?|דרישות\s+תפקיד|Requirements|Qualifications|What\s+we'?re\s+looking\s+for|What\s+you'?ll\s+bring)\s*[:\-–]\s*(.+?)(?=\s+(?:יתרון|תיאור\s+המשרה|אודות|אחריות|Responsibilities|About\s+(?:us|the\s+role)|Benefits|Nice\s+to\s+have|Bonus)\s*[:\-–]|\.\s+[A-Z\u0590-\u05FF]|\.$|$)/iu;
  const m = re.exec(text);
  if (!m) return null;
  const v = m[1].trim().replace(/[\s,;|.]+$/g, "");
  return v.length >= 10 && v.length <= 4000 ? v : null;
}

// ---------------------------------------------------------------------------
// Unlabeled IL city/area gazetteer fallback
// Used as a LAST resort when no explicit "Location:" label produced a value.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The anchored scan
// ---------------------------------------------------------------------------
//
// What replaced the bare-word scan, and why.
//
// The old matchers looked for a city name anywhere in the ad, optionally with a
// "ב"/"ל" prefix or a nearby cue. Hebrew makes that unwinnable. `\b` does not
// fire after a Hebrew letter, final letters differ (סניף ends in ף, סניפים uses
// פ), and a great many town names are ordinary words: `כנות` sits inside
// `הסוכנות`, `יקום` inside `מיקום`, `משמרות` means "shifts", `שדרות` means
// "boulevard", `אזור` means "the area of". Every one of those is a real
// `CSV files/city.csv` row, so a false match passes every downstream gate and
// ships as a published address. Five of them were measured on tikshoov alone.
//
// So the scan is anchored: a place is read only where the ad is saying that it
// is naming one.
//
//   a LABEL      מיקום המשרה / מיקום / מקום / כתובת, then the value
//   a SITE noun  אתר / סניף / מפעל / משרדי / משרדינו — the employer's own
//                premises — then "ב" and the value
//
// and nowhere else. The value is split on "/" (an employer writing "X/Y" has
// named both places), and every part must resolve EXACTLY: the canonical list,
// the alias table, an abbreviation. No prose scan, and no edit-distance — the
// approximate tail is what reads `חניכה` as the kibbutz `חניתה`.
//
// The cost is deliberate and worth stating: shapes the old scan did recover are
// now missed. `לנמל אשדוד` and `למושב כנות` name a real place after a ל-noun
// that is not one of the five above, and a bare `בתל אביב` names one with no
// anchor at all. Each is the same shape as the false matches, so there is no
// rule that keeps the recoveries and drops the inventions. A missing location
// is a NULL a human can fill; a wrong one is published data nothing repairs.

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Israeli ads write the big cities as abbreviations far more often than in full.
// None of these are in IL_CITIES. Ads use both the ASCII quote and the Hebrew
// gershayim (U+05F4), so both spellings are accepted. Built with
// String.fromCharCode rather than an escape, per CLAUDE.md.
const GERSHAYIM = String.fromCharCode(0x05f4);
const CITY_ABBREVIATIONS: ReadonlyArray<readonly [string, string]> = [
  [`ראשל"צ`, `ראשון לציון`],
  [`ת"א`, `תל אביב-יפו`],
  [`ב"ש`, `באר שבע`],
  [`פ"ת`, `פתח תקווה`],
  [`ר"ג`, `רמת גן`],
  [`כ"ס`, `כפר סבא`],
  [`י-ם`, `ירושלים`],
];
const ABBR_TO_CITY = new Map<string, string>(
  CITY_ABBREVIATIONS.flatMap(([abbr, city]) => [
    [abbr, city] as [string, string],
    [abbr.replace(/"/g, GERSHAYIM), city] as [string, string],
  ]),
);

/**
 * Words naming the EMPLOYER'S OWN premises. An ad using one of these is about
 * to say where that place is.
 *
 * Inflected forms are listed rather than derived: Hebrew final letters mean a
 * suffix rule would either miss `סניפי` or match halfway into an unrelated
 * word, and a written-out list is auditable. Longest first, so `משרדינו` is
 * never read as `משרדי` with a stray `נו`.
 */
const SITE_NOUNS = [
  `משרדינו`,
  `משרדי`,
  `מפעלי`,
  `מפעל`,
  `סניפי`,
  `סניף`,
  `אתרי`,
  `אתר`,
] as const;

/** Labels that introduce a location value outright. Longest first. */
const LOC_LABELS = [
  `מיקום המשרה`,
  `מקום העבודה`,
  `מיקום`,
  `מקום`,
  `כתובת`,
] as const;

// A Hebrew letter on either side means the word is part of a longer one.
const HEB = `\\u0590-\\u05FF`;
const RE_LABEL_ANCHOR = new RegExp(
  `(?:^|[^${HEB}])ה?(?:${LOC_LABELS.map(escapeRe).join("|")})(?![${HEB}])\\s*[:\\-–—]?\\s*`,
  "gu",
);
const RE_SITE_ANCHOR = new RegExp(
  `(?:^|[^${HEB}])[בל]?(?:${SITE_NOUNS.map(escapeRe).join("|")})(?![${HEB}])`,
  "gu",
);

// Where a value ends. A location value is a short noun phrase; the moment the
// sentence turns into anything else, it is over. "," ends it too — an address
// continues past a comma, but this function wants the town, not the street.
// The quote characters are NOT stops: Israeli ads abbreviate the big cities
// with one (ת"א, ב״ש), and cutting there leaves a single letter.
const VALUE_STOP = /[\n\r.;:|!?()[\]{},–—]/;

// A settlement type sitting in front of its own name: "בקיבוץ ניר עוז".
// city.csv stores `ניר עוז`, not `קיבוץ ניר עוז`.
const SETTLEMENT_PREFIX = /^(?:קיבוץ|קבוץ|מושבה|מושב|כפר|העיר|עיר|היישוב|יישוב|ישוב|שכונת)\s+/;

/** The first word in `seg` that begins with "ב", within `limit` characters. */
function firstBetPrefixed(seg: string, limit: number): string | null {
  const re = new RegExp(`(?:^|[^${HEB}])ב([${HEB}].*)$`, "u");
  const head = seg.slice(0, limit);
  const m = re.exec(head);
  if (!m) return null;
  // Everything from that word on, including the part beyond `limit`.
  const at = head.length - (m[1] as string).length;
  return seg.slice(at);
}

/**
 * Resolve ONE candidate value to a canonical place, or null.
 *
 * Exact only. `resolveExactLocation` covers the canonical list, the alias
 * table, the English table and the two spelling variants; the abbreviation map
 * covers `ת"א`. Nothing here scans, and nothing here approximates.
 */
function resolveValuePart(part: string): string | null {
  let p = part.trim().replace(/^[\s־"'`–—-]+|[\s־"'`–—-]+$/g, "");
  if (!p) return null;
  p = p.replace(SETTLEMENT_PREFIX, "").trim();
  if (!p) return null;

  const abbr = ABBR_TO_CITY.get(p);
  if (abbr) return abbr;

  const direct = resolveExactLocation(p);
  if (direct) return direct;

  // A value that carries its own "ב"/"ל" prefix: "מיקום: בתל אביב". Stripped
  // only when the STRIPPED form resolves and the whole one does not, so
  // `בית שמש` is never read as `ית שמש`.
  if (/^[בל]/.test(p) && p.length > 2) {
    const stripped = resolveExactLocation(p.slice(1).trim());
    if (stripped) return stripped;
  }
  return null;
}

/**
 * The longest place name this value part STARTS with, or null.
 *
 * A place name is one to four words, and the ad has just said it is about to
 * name one — so the name is at the front and the rest of the sentence is not
 * searched. Longest first, so "רמת גן" is never read as "רמת".
 *
 * This is what keeps the anchored scan from becoming a prose scan again: a
 * city three words into the tail is not a match, because it is not what the ad
 * put after its own label.
 */
const MAX_PLACE_WORDS = 4;
function leadingPlace(part: string): string | null {
  const cleaned = part
    .trim()
    .replace(/^[\s־'`–—-]+/, "")
    .replace(SETTLEMENT_PREFIX, "")
    .trim();
  if (!cleaned) return null;
  // An area label names a region and several towns at once. It starts with a
  // city name, so prefix matching would collapse it to that city — the 4082
  // defect coming back through a different door.
  if (isAreaLabel(cleaned)) return null;
  const words = cleaned.split(/\s+/);
  for (let n = Math.min(MAX_PLACE_WORDS, words.length); n >= 1; n--) {
    const candidate = words.slice(0, n).join(" ");
    const hit = resolveValuePart(candidate);
    if (!hit) continue;
    // A qualifier word standing in front of other words is qualifying them:
    // `אזור טל שחר` is the area of the moshav, `שדרות רוטשילד 15` is the
    // boulevard. Both are real city.csv rows, so nothing downstream would
    // catch them. Skip past it and look for the place it qualifies — which is
    // how `באזור טל שחר` yields `טל שחר` rather than the town `אזור`.
    //
    // Only when something FOLLOWS it. A value that is only `אזור` has nothing
    // to qualify and is the town.
    if (n === 1 && words.length > 1 && isQualifierPlace(candidate)) {
      return leadingPlace(words.slice(1).join(" "));
    }
    return hit;
  }
  // Nothing matched at the front. If the value opens with a qualifier word,
  // the place may still be behind it: `באזור לטרון` matches nothing at all at
  // word 1, because `אזור לטרון` is not an entry and `אזור` was not reached.
  if (words.length > 1 && isQualifierPlace(words[0] as string)) {
    return leadingPlace(words.slice(1).join(" "));
  }
  return null;
}

/** Split a value segment on "/" and resolve each part. */
function placesInValue(segment: string): string[] {
  const out: string[] = [];
  for (const raw of segment.split("/")) {
    const v = leadingPlace(raw);
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** How far past a site noun the "ב" that introduces the value may sit. */
const SITE_GAP_LIMIT = 30;

// ---------------------------------------------------------------------------
// The multi-word exception
// ---------------------------------------------------------------------------
//
// A place name of two or more words is read from prose with no anchor at all,
// carrying the "ב" an employer writes in front of it: "המחסן שלנו בבאר שבע".
//
// Why this is safe where the one-word scan was not. Every false match measured
// on tikshoov is a SINGLE word that is also an ordinary Hebrew word — שדרות
// ("boulevard"), אזור ("the area of"), משמרות ("shifts"), יקום (inside מיקום),
// חניתה (one letter from חניכה, "mentoring") — and so is כנות, the case
// CLAUDE.md names, hiding inside הסוכנות. Two words do not line up by accident.
//
// The "ב" must sit on the NAME. "בדרום תל אביב" prefixes the direction, not the
// city, and is deliberately not read: the direction patterns went with the rest
// of the bare scan, and reading past one is how "בצפון ת\"א" used to resolve to
// the northern region instead of Tel Aviv.
const RE_BARE_MULTIWORD = new RegExp(
  `(?<![${HEB}])ב(${MULTI_WORD_PLACE_NAMES.map(escapeRe).join("|")})(?![${HEB}])`,
  "gu",
);

/**
 * Places named in prose without an anchor, multi-word names only.
 *
 * Exported so the two halves of the gazetteer can be measured apart. The first
 * attempt at that measurement simulated "anchors only" by disabling every
 * word-initial ב in the text, which disables the anchored path's own ב as well
 * — and mis-attributed a batch of anchored answers to this one. A number that
 * is going to be reported has to be produced by the code it describes.
 */
export function bareMultiWordPlaces(text: string): string[] {
  const out: string[] = [];
  RE_BARE_MULTIWORD.lastIndex = 0;
  for (let m = RE_BARE_MULTIWORD.exec(text); m; m = RE_BARE_MULTIWORD.exec(text)) {
    // Through the same exact resolver as everything else: canonical, alias,
    // English, spelling variants. No edit-distance, so a near-miss on a
    // two-word phrase cannot become a place either.
    const v = resolveValuePart(m[1] as string);
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * Read the places an ad NAMES, from its labels and its own premises only.
 *
 * Returns every place found, in the order the ad gives them — a value of
 * "באר שבע/ניר עוז" is two places, and returning one of them (which is what the
 * old single-value scan did, and it returned the second) publishes a job in
 * half the places its employer stated.
 *
 * Every returned value is on `CSV files/city.csv`. An empty array means the ad
 * named no place this function is willing to swear to.
 */
export function extractLocationFromGazetteer(text: string): string[] {
  const anchored = extractAnchoredPlaces(text);
  // The anchors win outright. A labelled value is the employer answering the
  // question directly, and an ad that answers it does not also need its prose
  // read — "מיקום המשרה: חיפה" plus a head office mentioned in passing is one
  // job in Haifa, not two places.
  return anchored.length > 0 ? anchored : bareMultiWordPlaces(text);
}

/** Places named at one of the ad's own anchors. Exported for measurement. */
export function extractAnchoredPlaces(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const add = (places: string[]) => {
    for (const p of places) if (!out.includes(p)) out.push(p);
  };

  RE_LABEL_ANCHOR.lastIndex = 0;
  for (let m = RE_LABEL_ANCHOR.exec(text); m; m = RE_LABEL_ANCHOR.exec(text)) {
    const tail = text.slice(m.index + m[0].length);
    add(placesInValue(tail.split(VALUE_STOP)[0] ?? ""));
  }

  RE_SITE_ANCHOR.lastIndex = 0;
  for (let m = RE_SITE_ANCHOR.exec(text); m; m = RE_SITE_ANCHOR.exec(text)) {
    const tail = text.slice(m.index + m[0].length);
    const segment = tail.split(VALUE_STOP)[0] ?? "";
    // "ב" marks where the value starts: "לאתר הייצור בבאר שבע". Without one,
    // the value is whatever follows the noun directly: "אתר נתניה".
    const bet = firstBetPrefixed(segment, SITE_GAP_LIMIT);
    add(placesInValue(bet ?? segment));
  }

  return out;
}

/**
 * Scan a chunk of text (typically description, optionally + requirements)
 * for label-value pairs and return any standard fields it can recover.
 * Returns null per field when no confident match was found.
 */
export function extractFieldsFromText(text: string): ExtractedFromText {
  const t = (text ?? "").trim();
  if (!t) {
    return {
      location: null,
      department: null,
      externalJobId: null,
      publishDate: null,
      requirements: null,
      applicationInfo: null,
      jobType: null,
    };
  }

  return {
    location: matchLabeled(t, LABELS.location),
    // Department is the one label whose words also occur in ordinary prose, so it
    // is held to the stricter contract: line-leading label, short value, no
    // "– יתרון"-style qualifier. Measured on the live fleet before this guard:
    // 38 departments came from prose and 37 of them were junk ("יתרון", "חובה",
    // "4 שנים לפחות", "02.07.2026").
    department: matchLabeled(t, LABELS.department, {
      lineLeading: true,
      maxLen: 60,
    }),
    externalJobId:
      // Labeled capture can sweep trailing form text into the value; reduce it
      // to the bare job-ID token. The fallback already returns clean IDs (bare
      // digits / codes), and cleanExternalJobId is idempotent on those.
      cleanExternalJobId(matchLabeled(t, LABELS.externalJobId)) ??
      extractExternalJobIdFallback(t),
    publishDate: extractPublishDate(t),
    requirements: extractRequirementsBlock(t),
    applicationInfo: extractApplicationInfoFallback(t),
    jobType: matchLabeled(t, LABELS.jobType),
  };
}

// ---------------------------------------------------------------------------
// Main normalization function
// ---------------------------------------------------------------------------

/**
 * Transform raw extracted data into a NormalizedJobRecord.
 *
 * - Maps standard fields (title, company, location, salary, description)
 *   through the normalization pipeline
 * - Extracts URL: prefers title_href, falls back to _detailUrl, then ""
 * - Collects non-standard, non-internal fields into additionalFields
 * - Returns rawFields as a shallow copy, optionally extended with
 *   `_cssRejected_description` / `_cssRejected_requirements` when CSS-shaped
 *   content was stripped from long-form fields.
 */
export function normalizeJobRecord(
  rawFields: Record<string, string>,
): NormalizedJobRecord {
  const rawOut: Record<string, string> = { ...rawFields };

  // Map standard fields through normalization
  const title = normalizeField(rawFields["title"]);
  let description = normalizeMultilineField(rawFields["description"]);
  if (looksLikeCss(description)) {
    rawOut["_cssRejected_description"] = "true";
    description = "";
  }
  // Rebuild line structure when the text arrived as one run-on line. No-op for
  // text that already has line breaks; see descriptionStructure.ts for why this
  // is central rather than per-site.
  description = structureDescription(description);

  let requirements = normalizeMultilineField(rawFields["requirements"]);
  if (looksLikeCss(requirements)) {
    rawOut["_cssRejected_requirements"] = "true";
    requirements = "";
  }
  requirements = structureDescription(requirements);
  let location = normalizeField(rawFields["location"]);
  let department = normalizeField(rawFields["department"]);
  let externalJobId = normalizeField(rawFields["externalJobId"]);
  let publishDate = normalizeField(rawFields["publishDate"]);
  const deadline = normalizeField(rawFields["deadline"]);
  // applicationInfo is populated either by:
  //   - an explicit "applicationInfo" field mapping (rare), or
  //   - the worker's form-capture pipeline, which writes a JSON blob to
  //     rawFields._formData (one of formSelector/method/actionUrl/fields).
  // Prefer the explicit mapping; fall back to the form-capture blob, which
  // is already JSON and shouldn't be re-normalized to plain text.
  const explicitAppInfo = normalizeField(rawFields["applicationInfo"]);
  let applicationInfo =
    explicitAppInfo || (rawFields["_formData"] ?? "");

  // Extract URL for the job's detail page. Prefer an explicit detailUrl field
  // mapping (value or its _href), then the title link, then the multi-page
  // _detailUrl the worker records when visiting detail pages. This lets sites
  // that inject a hidden detailUrl anchor (Workday, keshet) surface it as a
  // real column instead of burying it in rawData.
  const url =
    rawFields["detailUrl_href"] ||
    rawFields["title_href"] ||
    rawFields["_detailUrl"] ||
    rawFields["detailUrl"] ||
    "";

  // Collect non-standard fields (keys not in standard set and not prefixed with _)
  const additionalFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawFields)) {
    if (STANDARD_FIELDS.has(key)) continue;
    if (key.startsWith("_")) continue;
    if (key.endsWith("_href") && STANDARD_FIELDS.has(key.replace(/_href$/, ""))) continue;
    additionalFields[key] = normalizeField(value);
  }

  // Description-text fallback: for every standard field still empty, try to
  // recover it from the description (and requirements) prose. See
  // extractFieldsFromText above for the label/regex strategy. We never
  // overwrite a value that the dedicated selector already provided.
  const fallbackSource = [description, requirements].filter(Boolean).join("\n");
  if (fallbackSource) {
    const recovered = extractFieldsFromText(fallbackSource);
    const applyFallback = (
      name: keyof ExtractedFromText,
      current: string,
    ): string => {
      const found = recovered[name];
      if (current && current.trim().length > 0) return current;
      if (!found) return current;
      rawOut[`_enrichedFromDescription_${name}`] = found;
      return found;
    };
    location = applyFallback("location", location);
    department = applyFallback("department", department);
    externalJobId = applyFallback("externalJobId", externalJobId);
    publishDate = applyFallback("publishDate", publishDate);
    if (!requirements && recovered.requirements) {
      requirements = recovered.requirements;
      rawOut["_enrichedFromDescription_requirements"] = recovered.requirements;
    }
    if (!applicationInfo && recovered.applicationInfo) {
      applicationInfo = recovered.applicationInfo;
      rawOut["_enrichedFromDescription_applicationInfo"] =
        recovered.applicationInfo;
    }
    // jobType isn't a standard column — drop it into additionalFields if it
    // wasn't already present from a site-specific selector.
    if (recovered.jobType && !additionalFields["jobType"]) {
      additionalFields["jobType"] = recovered.jobType;
      rawOut["_enrichedFromDescription_jobType"] = recovered.jobType;
    }
  }

  // Title-scan fallback for externalJobId: many listings print the req number
  // right in the title, e.g. "Senior Data Analyst - (JB-3086)". The description
  // fallback above only scans description+requirements, so a code that lives
  // only in the title would be missed. We scan the title for a bracketed printed
  // code (letters+digits in () or []) ONLY when no ID was found anywhere else —
  // this never overrides a dedicated selector or a labeled/description match,
  // and the bracket requirement keeps title prose numbers (e.g. "5+ years",
  // "B2C") from being mistaken for an ID.
  if (!externalJobId || externalJobId.trim().length === 0) {
    const titleCode = extractBracketedJobCode(title);
    if (titleCode) {
      externalJobId = titleCode;
      rawOut["_enrichedFromTitle_externalJobId"] = titleCode;
    }
  }

  // Second-stage gazetteer fallback for location: runs only when neither a
  // dedicated selector nor labeled extraction produced one. Reads the title in
  // addition to description + requirements, and only at its anchors.
  //
  // Joined with a COMMA, never a slash: the block below rewrites "/" to a space
  // before normalizeLocations() splits, which would fuse two cities into one
  // off-vocabulary string and lose both at the gate. A comma survives both.
  if (!location || location.trim().length === 0) {
    const locationSource = [title, description, requirements]
      .filter(Boolean)
      .join("\n");
    if (locationSource) {
      const gazetteered = extractLocationFromGazetteer(locationSource);
      if (gazetteered.length > 0) {
        location = gazetteered.join(", ");
        rawOut["_enrichedFromDescription_location"] = location;
      }
    }
  }

  // Normalize slash-separated multi-city locations (e.g. "ירושלים / מודיעין")
  // into space-separated form. Only applies when the slash separates city names
  // (at least one non-ASCII char on each side), not URL-like strings.
  if (location && location.includes("/")) {
    location = location.replace(/\s*\/\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  }

  return {
    title,
    description,
    requirements,
    location,
    department,
    externalJobId,
    publishDate,
    deadline,
    applicationInfo,
    url,
    additionalFields,
    rawFields: rawOut,
  };
}
