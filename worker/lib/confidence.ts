// ---------------------------------------------------------------------------
// Shared confidence scoring -- canonical implementation (Story 2-5, Task 1)
// ---------------------------------------------------------------------------

/** Core field weights for overall confidence calculation. */
export const CORE_FIELD_WEIGHTS: Record<string, number> = {
  title: 0.40,
  company: 0.30,
  location: 0.30,
};

/** Optional field weights (bonus, capped at 1.0 total). */
export const OPTIONAL_FIELD_WEIGHTS: Record<string, number> = {
  salary: 0.05,
  description: 0.05,
};

/** List of core field names. */
export const CORE_FIELDS = Object.keys(CORE_FIELD_WEIGHTS);

/** List of all standard field names (core + optional). */
export const ALL_FIELDS = [...CORE_FIELDS, ...Object.keys(OPTIONAL_FIELD_WEIGHTS)];

/**
 * Calculate the overall confidence score from per-field confidence scores.
 *
 * Uses a weighted average of core fields (title, company, location) plus
 * an optional bonus for salary and description. Result is capped at 1.0
 * and rounded to 2 decimal places.
 *
 * This is the single canonical implementation -- all analysis methods and
 * the combine step use this function.
 */
export function calculateOverallConfidence(scores: Record<string, number>): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [field, weight] of Object.entries(CORE_FIELD_WEIGHTS)) {
    const score = scores[field] || 0;
    weightedSum += score * weight;
    totalWeight += weight;
  }

  let overall = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Bonus for optional fields (up to 0.10 additional)
  const optionalBonus =
    (scores.salary || 0) * 0.05 + (scores.description || 0) * 0.05;
  overall = Math.min(1.0, overall + optionalBonus);

  return Math.round(overall * 100) / 100;
}
