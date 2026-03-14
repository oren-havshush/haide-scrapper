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
 * - Preserves the original rawFields without modification
 */
export function normalizeJobRecord(
  rawFields: Record<string, string>,
): NormalizedJobRecord {
  // Map standard fields through normalization
  const title = normalizeField(rawFields["title"]);
  const description = normalizeField(rawFields["description"]);
  const requirements = normalizeField(rawFields["requirements"]);
  const location = normalizeField(rawFields["location"]);
  const department = normalizeField(rawFields["department"]);
  const externalJobId = normalizeField(rawFields["externalJobId"]);
  const publishDate = normalizeField(rawFields["publishDate"]);
  const applicationInfo = normalizeField(rawFields["applicationInfo"]);

  // Extract URL: prefer title_href, fall back to _detailUrl, then ""
  const url = rawFields["title_href"] ?? rawFields["_detailUrl"] ?? "";

  // Collect non-standard fields (keys not in standard set and not prefixed with _)
  const additionalFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawFields)) {
    if (STANDARD_FIELDS.has(key)) continue;
    if (key.startsWith("_")) continue;
    // Skip href variants of standard fields
    if (key.endsWith("_href") && STANDARD_FIELDS.has(key.replace(/_href$/, ""))) continue;
    additionalFields[key] = normalizeField(value);
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
    rawFields, // Preserve original untouched (FR27)
  };
}
