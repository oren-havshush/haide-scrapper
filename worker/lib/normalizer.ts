// ---------------------------------------------------------------------------
// Data Normalization Module
// ---------------------------------------------------------------------------
// Transforms raw extracted job data into a consistent normalized format.
// Strips HTML tags, collapses whitespace, maps standard fields, and
// preserves the original rawFields for debugging and re-processing.
// ---------------------------------------------------------------------------

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
  externalJobId: String.raw`מספר\s+משרה|מספר\s+דרושים|קוד\s+משרה|Job\s+ID|Job\s+Number|Requisition(?:\s+ID)?|Req(?:\s*ID)?|Position\s+ID|Vacancy\s+(?:ID|Number)`,
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

// Standalone patterns that don't require a label.
function extractExternalJobIdFallback(text: string): string | null {
  // (#ID), [ID], or REQ-1234 / JR-1234 / R-12345 standalone, anywhere.
  const m =
    /(?:[(\[#]|\bID\s+)\s*((?:REQ|JR|R|JOB|POS)[-_]?\d{2,8})\b/i.exec(text) ||
    /\b((?:REQ|JR|JOB)[-_]\d{2,8})\b/i.exec(text);
  return m ? m[1].toUpperCase().replace(/_/g, "-") : null;
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
// ---------------------------------------------------------------------------

const IL_REGIONS = [
  "השפלה", "השרון", "הצפון", "הדרום", "המרכז", "הגליל", "הנגב", "הכרמל",
];

const IL_CITIES = [
  "פתח תקווה", "פתח-תקווה",
  "קריית אריה", "קרית אריה",
  "תל אביב", "ת\"א",
  "ירושלים",
  "חיפה",
  "באר שבע",
  "ראשון לציון",
  "נתניה",
  "רמת גן",
  "חולון",
  "רחובות",
  "הרצליה",
  "כפר סבא",
  "רעננה",
  "מודיעין",
  "אשדוד",
  "אשקלון",
  "בת ים",
  "לוד",
  "רמלה",
  "רעננה",
  "הוד השרון",
  "כפר יונה",
  "יבנה",
  "קרית שמונה", "קריית שמונה",
  "טבריה",
  "נהריה",
  "עכו",
  "קרית ביאליק", "קריית ביאליק",
  "קרית מוצקין", "קריית מוצקין",
  "קרית ים", "קריית ים",
  "אילת",
  "אריאל",
  "מעלה אדומים",
  "בני ברק",
  "גבעתיים",
  "כפר סבא",
  "הרצלייה",
  "גדרה",
  "יהוד",
  "אור יהודה",
  "אלעד",
  "ראש העין",
  "חדרה",
  "זכרון יעקב",
  "עפולה",
  "נצרת",
  "טירת כרמל",
  "דימונה",
  "ערד",
  "קרית גת", "קריית גת",
];

/**
 * Attempt to extract an unlabeled Israeli city/region from free-form text.
 * Prefers the most specific hit (a city over a region) and requires either:
 *   (a) "לאזור/לעיר <name>" or "באזור <name>" — explicit preposition+indicator,
 *   (b) "ב<city>" — "at / in <city>" Hebrew prefix with a city name.
 * Returns null if no reliable match is found.
 */
export function extractLocationFromGazetteer(text: string): string | null {
  if (!text) return null;

  // Pattern A: explicit area indicator — "לאזור X" / "באזור X" / "בעיר X"
  for (const region of IL_REGIONS) {
    const re = new RegExp(
      String.raw`(?:ל?אזור|בעיר)\s+` + region.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "u",
    );
    if (re.test(text)) return region;
  }
  for (const city of IL_CITIES) {
    const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      String.raw`(?:ל?אזור|בעיר|במשרדי?(?:\s+ה\w+)?\s+ב)\s*` + escaped,
      "u",
    );
    if (re.test(text)) return city;
  }

  // Pattern A2: a location CUE — a pin/office emoji or a location noun
  // ("מיקום", "כתובת", "סניף", "פארק", "משרדי(נו)", "ממוקם", "עיר") — followed
  // within a short window by a known city, even without a ":" label or a "ב"
  // prefix. Handles patterns like "📍 פארק המדע רחובות" / "סניף ראשי - חיפה".
  const LOC_CUE =
    String.raw`(?:\p{Extended_Pictographic}|מיקום|כתובת|סניף|פארק(?:\s+המדע)?|` +
    String.raw`משרדי(?:נו)?|ממוקמ\w*|ממוקם|עיר|אתר)`;
  for (const city of IL_CITIES) {
    const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      LOC_CUE + String.raw`[\s\S]{0,30}?` + escaped + String.raw`(?:\b|[\s,.()\n]|$)`,
      "u",
    );
    if (re.test(text)) return city;
  }

  // Pattern B: "ב<city>" prepended — e.g. "בפתח תקווה", "בחיפה"
  for (const city of IL_CITIES) {
    const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(String.raw`ב` + escaped + String.raw`(?:\b|[\s,.()\n])`, "u");
    if (re.test(text)) return city;
  }

  // Pattern C: region name on its own after a preposition, e.g. "לאזור השפלה"
  for (const region of IL_REGIONS) {
    const escaped = region.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(String.raw`ב` + escaped + String.raw`(?:\b|[\s,.()\n])`, "u");
    if (re.test(text)) return region;
  }

  return null;
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
      matchLabeled(t, LABELS.externalJobId) ?? extractExternalJobIdFallback(t),
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
  let description = normalizeField(rawFields["description"]);
  if (looksLikeCss(description)) {
    rawOut["_cssRejected_description"] = "true";
    description = "";
  }

  let requirements = normalizeField(rawFields["requirements"]);
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
    // Second-stage gazetteer fallback: only when labeled extraction found nothing.
    if (!location || location.trim().length === 0) {
      const gazetteered = extractLocationFromGazetteer(fallbackSource);
      if (gazetteered) {
        location = gazetteered;
        rawOut["_enrichedFromDescription_location"] = gazetteered;
      }
    }
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
