// ---------------------------------------------------------------------------
// Data Normalization Module
// ---------------------------------------------------------------------------
// Transforms raw extracted job data into a consistent normalized format.
// Strips HTML tags, collapses whitespace, maps standard fields, and
// preserves the original rawFields for debugging and re-processing.
// ---------------------------------------------------------------------------

import { IL_CITIES, IL_REGIONS } from "../data/il-places";

/** Standard job schema fields that map directly to Job model columns */
const STANDARD_FIELDS = new Set([
  "title",
  "description",
  "requirements",
  "location",
  "department",
  "externalJobId",
  "publishDate",
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

function matchLabeled(text: string, labelAlt: string): string | null {
  const re = new RegExp(
    String.raw`(?:^|[\s|.(])` +
      String.raw`(?:` + labelAlt + String.raw`)` +
      String.raw`\s*[:\-–]\s*` +
      String.raw`(.+?)` +
      VALUE_TERMINATOR,
    "iu",
  );
  const m = re.exec(text);
  if (!m) return null;
  const v = m[1].trim().replace(/[\s,;|]+$/g, "");
  return v.length > 0 && v.length <= 200 ? v : null;
}

// Per-field label alternations. Order matters: more specific labels first so
// "מיקום המשרה" wins over "מיקום" (which would match a prefix and stop short).
const LABELS = {
  location: String.raw`מיקום\s+המשרה|אזור\s+(?:גיאוגרפי|גאוגרפי)|מיקום|אזור|Location|Based\s+in|City`,
  department: String.raw`שם\s+המחלקה|מחלקה|אגף|צוות|Department|Team|Division`,
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

// Standalone patterns that don't require a label.
function extractExternalJobIdFallback(text: string): string | null {
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
// Used as a LAST resort when no explicit "Location:" / "מיקום:" label exists
// in the text. Only fires when location is still empty after matchLabeled.
//
// The place lists (IL_CITIES / IL_REGIONS) are generated from
// "CSV files/city.csv" into worker/data/il-places.ts (regenerate with
// `npx tsx scripts/build-il-places.ts`). They are large (~1,400 entries), so
// rather than compiling one RegExp per place per call we precompile a handful
// of single-alternation matchers once at module load.
// ---------------------------------------------------------------------------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Build a regex alternation, longest name first so a more specific multi-word
// place wins over a shorter substring at the same position.
const altOf = (names: readonly string[]) =>
  names
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join("|");

// Bare "ב<name>" patterns have no surrounding cue/label, so a short place name
// that is also a common Hebrew word (e.g. "שחר"/"תמר"/"קשת") would false-match.
// Gate those patterns to names of at least this length; cue/label/indicator
// patterns keep the full list because their context makes a match reliable.
const BARE_PREFIX_MIN_LEN = 4;

// Some place names are spelled identically to very common Hebrew job-ad words,
// so the length gate alone isn't enough — the bare "ב<name>" prefix matches the
// word, not the place. The classic case: "במשמרות" = "working in shifts", which
// resolved to the moshav משמרות. Exclude these from the BARE-prefix lists only;
// labeled/cue/indicator matches ("מיקום: …", "📍 …", "לאזור …") keep the full
// list because their surrounding context makes the place reading reliable.
const BARE_PREFIX_DENYLIST = new Set<string>([
  "משמרות", // "במשמרות" = in shifts (shift work), not the moshav משמרות
]);

const passesBarePrefix = (name: string) =>
  name.length >= BARE_PREFIX_MIN_LEN && !BARE_PREFIX_DENYLIST.has(name);

const CITY_ALT = altOf(IL_CITIES);
const REGION_ALT = altOf(IL_REGIONS);
const CITY_ALT_LONG = altOf(IL_CITIES.filter(passesBarePrefix));
const REGION_ALT_LONG = altOf(IL_REGIONS.filter(passesBarePrefix));

// A location CUE: a pin/office emoji or a location noun
// ("מיקום", "כתובת", "סניף", "פארק", "משרדי(נו)", "ממוקם", "עיר").
const LOC_CUE =
  String.raw`(?:\p{Extended_Pictographic}|מיקום|כתובת|סניף|פארק(?:\s+המדע)?|` +
  String.raw`משרדי(?:נו)?|ממוקמ\w*|עיר|אתר)`;

// Hebrew-letter word boundaries. JS `\b` is ASCII-only, so a place followed by
// "!" or preceded by another Hebrew letter wouldn't be bounded correctly. We
// instead require the matched name to not be glued to another Hebrew letter on
// either side (so "אבן יהודה" matches in "...באבן יהודה!" but "תקווה" is not
// matched as a suffix of an unrelated word).
const NOT_HEB_BEFORE = String.raw`(?<![\u0590-\u05FF])`;
const NOT_HEB_AFTER = String.raw`(?![\u0590-\u05FF])`;

// Pattern A: explicit area indicator — "לאזור X" / "באזור X" / "בעיר X".
const RE_REGION_INDICATOR = new RegExp(
  String.raw`(?:ל?אזור|בעיר)\s+(` + REGION_ALT + String.raw`)` + NOT_HEB_AFTER,
  "u",
);
const RE_CITY_INDICATOR = new RegExp(
  String.raw`(?:ל?אזור|בעיר|במשרדי?(?:\s+ה\w+)?\s+ב)\s*(` +
    CITY_ALT +
    String.raw`)` +
    NOT_HEB_AFTER,
  "u",
);
// Pattern A2: a location cue followed within a short window by a known city,
// even without a ":" label or a "ב" prefix (e.g. "📍 פארק המדע רחובות").
const RE_CITY_CUE = new RegExp(
  LOC_CUE +
    String.raw`[\s\S]{0,30}?` +
    NOT_HEB_BEFORE +
    String.raw`(` +
    CITY_ALT +
    String.raw`)` +
    NOT_HEB_AFTER,
  "u",
);
// Pattern B/C: bare "ב<city>" / "ב<region>" prefix (length-gated). The "ב"
// must itself start a word (not be glued to a preceding Hebrew letter).
const RE_CITY_B = new RegExp(
  NOT_HEB_BEFORE + String.raw`ב(` + CITY_ALT_LONG + String.raw`)` + NOT_HEB_AFTER,
  "u",
);
const RE_REGION_B = new RegExp(
  NOT_HEB_BEFORE +
    String.raw`ב(` +
    REGION_ALT_LONG +
    String.raw`)` +
    NOT_HEB_AFTER,
  "u",
);

/**
 * Attempt to extract an unlabeled Israeli city/region from free-form text.
 * Tries, in order of confidence:
 *   (A)  "לאזור/בעיר <region|city>" — explicit preposition + indicator,
 *   (A2) a location cue (📍/"מיקום"/"סניף"/…) within 30 chars of a city,
 *   (B)  bare "ב<city>" / "ב<region>" prefix (length-gated, see above).
 * Returns the matched place name, or null if no reliable match is found.
 */
export function extractLocationFromGazetteer(text: string): string | null {
  if (!text) return null;
  const m =
    RE_REGION_INDICATOR.exec(text) ||
    RE_CITY_INDICATOR.exec(text) ||
    RE_CITY_CUE.exec(text) ||
    RE_CITY_B.exec(text) ||
    RE_REGION_B.exec(text);
  return m ? m[1] : null;
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
    department: matchLabeled(t, LABELS.department),
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

  let requirements = normalizeMultilineField(rawFields["requirements"]);
  if (looksLikeCss(requirements)) {
    rawOut["_cssRejected_requirements"] = "true";
    requirements = "";
  }
  let location = normalizeField(rawFields["location"]);
  let department = normalizeField(rawFields["department"]);
  let externalJobId = normalizeField(rawFields["externalJobId"]);
  let publishDate = normalizeField(rawFields["publishDate"]);
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

  // Second-stage gazetteer fallback for location: runs only when neither a
  // dedicated selector nor labeled extraction produced one. Scans the title in
  // addition to description + requirements — known-place matches only, so a
  // role title without a place won't false-match (e.g. recovers "אבן יהודה"
  // from "...במרלוג החדש באבן יהודה").
  if (!location || location.trim().length === 0) {
    const locationSource = [title, description, requirements]
      .filter(Boolean)
      .join("\n");
    if (locationSource) {
      const gazetteered = extractLocationFromGazetteer(locationSource);
      if (gazetteered) {
        location = gazetteered;
        rawOut["_enrichedFromDescription_location"] = gazetteered;
      }
    }
  }

  return {
    title,
    description,
    requirements,
    location,
    department,
    externalJobId,
    publishDate,
    applicationInfo,
    url,
    additionalFields,
    rawFields: rawOut,
  };
}
