// ---------------------------------------------------------------------------
// Job Record Validation Module
// ---------------------------------------------------------------------------
// Validates normalized job records against the required schema.
// Produces a validation result with status string, missing fields list,
// and quality warnings for abnormally long field values.
// ---------------------------------------------------------------------------

import type { NormalizedJobRecord } from "./normalizer";

/** Required fields that must be present and non-empty.
 *  Only title is truly required — many career pages are single-company
 *  and location may come from a separate detail page. */
const REQUIRED_FIELDS = ["title"] as const;

/** Quality thresholds -- values exceeding these likely indicate extraction errors */
const QUALITY_THRESHOLDS: Record<string, number> = {
  title: 200,
  location: 150,
  department: 150,
  externalJobId: 100,
};

const NON_JOB_VALUE_PATTERNS = [
  /about us|about|home|contact|privacy|terms/i,
  // NOTE: match the footer phrase "תנאי שימוש" (terms of use), NOT the bare
  // word "תנאים" — "תנאים" ("conditions") is extremely common in legitimate IL
  // job ads (e.g. "תנאים מצויינים" = "excellent conditions") and was silently
  // dropping valid postings as non-job content.
  /על החברה|אודות|עמוד הבית|צור קשר|מדיניות פרטיות|תנאי שימוש|תקנון/u,
  /לחצו עם העכבר|press esc/i,
];

/** Result of validating a single job record */
export interface ValidationResult {
  isValid: boolean;
  status: string;
  missingFields: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Main validation function
// ---------------------------------------------------------------------------

/**
 * Validate a normalized job record against the required schema.
 *
 * - Checks that title, company, and location are present and non-empty.
 * - Generates quality warnings for abnormally long field values (non-blocking).
 * - Returns a status string: "valid" or "invalid:missing_title,missing_company,..."
 */
export function validateJobRecord(
  record: NormalizedJobRecord,
): ValidationResult {
  const missingFields: string[] = [];
  const warnings: string[] = [];

  // Check required fields for presence and non-empty values
  for (const field of REQUIRED_FIELDS) {
    const value = record[field];
    if (!value || value.trim().length === 0) {
      missingFields.push(`missing_${field}`);
    }
  }

  // URL is useful for deduplication but not a hard requirement —
  // many listings derive the URL from the title link href automatically.
  if (!record.url || record.url.trim().length === 0) {
    warnings.push("missing_url");
  }

  // Raw description present but normalized empty (e.g. CSS stripped by normalizer).
  const rawDesc = record.rawFields["description"] ?? "";
  if (rawDesc.trim().length > 0 && (!record.description || record.description.trim().length === 0)) {
    warnings.push("description_empty_or_invalid");
  }

  // Possible truncation: short normalized text vs long raw scrape.
  const rawDescLen = rawDesc.trim().length;
  const descLen = record.description.trim().length;
  if (rawDescLen > 100 && descLen >= 1 && descLen <= 20) {
    warnings.push("description_truncated");
  }

  // Reject obvious non-job/navigation/footer snippets frequently captured by broad selectors.
  for (const pattern of NON_JOB_VALUE_PATTERNS) {
    if (pattern.test(record.location) || pattern.test(record.title)) {
      missingFields.push("non_job_content");
      break;
    }
  }

  // Check field quality warnings (non-blocking)
  for (const [field, maxLength] of Object.entries(QUALITY_THRESHOLDS)) {
    const value = record[field as keyof NormalizedJobRecord];
    if (typeof value === "string" && value.length > maxLength) {
      warnings.push(
        `${field} exceeds ${maxLength} characters (${value.length} chars) -- possible extraction error`,
      );
    }
  }

  // Build status string
  const isValid = missingFields.length === 0;
  const status = isValid
    ? "valid"
    : `invalid:${missingFields.join(",")}`;

  return {
    isValid,
    status,
    missingFields,
    warnings,
  };
}
