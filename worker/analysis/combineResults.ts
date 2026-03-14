import { calculateOverallConfidence } from "../lib/confidence";

// ---------------------------------------------------------------------------
// Types (Task 2)
// ---------------------------------------------------------------------------

/** Input from a single analysis method, fed into the combine step. */
export interface MethodResult {
  method: string; // "PATTERN_MATCH" | "CRAWL_CLASSIFY" | "NETWORK_INTERCEPT"
  fieldMappings: Record<string, { selector: string; sample: string }>;
  confidenceScores: Record<string, number>;
  overallConfidence: number;
  listingSelector: string | null;
  itemSelector: string | null;
  itemCount: number;
  apiEndpoint?: string | null;
  detailPagePattern?: string | null;
}

/** Unified result after combining all analysis methods. */
export interface CombinedAnalysisResult {
  /** Unified field mappings: for each field, the winning mapping + source method */
  fieldMappings: Record<string, {
    selector: string;
    sample: string;
    sourceMethod: string;    // "PATTERN_MATCH" | "CRAWL_CLASSIFY" | "NETWORK_INTERCEPT"
    methodsDetected: number; // how many methods detected this field (1, 2, or 3)
  }>;
  /** Per-field confidence scores (after cross-method agreement bonus) */
  confidenceScores: Record<string, number>;
  /** Overall site confidence (weighted average of core fields + optional bonus) */
  overallConfidence: number;
  /** Best listing/item selectors from any DOM-based method */
  listingSelector: string | null;
  itemSelector: string | null;
  itemCount: number;
  /** API endpoint discovered by network interception (if any) */
  apiEndpoint: string | null;
  /** Detail page URL pattern discovered by crawl/classify (if any) */
  detailPagePattern: string | null;
  /** Summary of which method contributed each field */
  methodContributions: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Cross-method agreement bonus constants (Task 3)
// ---------------------------------------------------------------------------

const AGREEMENT_BONUS_TWO = 0.10;   // 2 methods agree
const AGREEMENT_BONUS_THREE = 0.15; // 3 methods agree

/**
 * Apply a cross-method agreement bonus to a per-field confidence score.
 * If multiple independent methods detected the same field, we increase trust.
 */
function applyAgreementBonus(
  baseConfidence: number,
  methodsDetected: number,
): number {
  let bonus = 0;
  if (methodsDetected === 2) bonus = AGREEMENT_BONUS_TWO;
  else if (methodsDetected >= 3) bonus = AGREEMENT_BONUS_THREE;
  return Math.min(1.0, Math.round((baseConfidence + bonus) * 100) / 100);
}

// ---------------------------------------------------------------------------
// Main public function (Task 2.4)
// ---------------------------------------------------------------------------

/**
 * Combine results from all analysis methods into a single unified result.
 *
 * For each standard field, the method with the highest per-field confidence
 * wins. On ties, DOM-based selectors (CSS) are preferred over API-based
 * selectors (JSON path starting with `$.`). A cross-method agreement bonus
 * is applied when multiple methods detected the same field.
 *
 * NEVER throws -- if inputs are empty, returns a zero-confidence result.
 */
export function combineAnalysisResults(results: MethodResult[]): CombinedAnalysisResult {
  // Handle empty input gracefully
  if (results.length === 0) {
    return {
      fieldMappings: {},
      confidenceScores: {},
      overallConfidence: 0.0,
      listingSelector: null,
      itemSelector: null,
      itemCount: 0,
      apiEndpoint: null,
      detailPagePattern: null,
      methodContributions: {},
    };
  }

  // 1. Collect all detected fields across all methods
  const allFields = new Set<string>();
  for (const r of results) {
    for (const field of Object.keys(r.fieldMappings)) {
      allFields.add(field);
    }
  }

  // 2. For each field, pick the winner and apply agreement bonus (Task 3)
  const unifiedMappings: CombinedAnalysisResult["fieldMappings"] = {};
  const unifiedScores: Record<string, number> = {};
  const contributions: Record<string, string> = {};

  for (const field of allFields) {
    // Collect all methods that detected this field
    const detections = results
      .filter(r => r.fieldMappings[field] && (r.confidenceScores[field] ?? 0) > 0)
      .map(r => ({
        method: r.method,
        selector: r.fieldMappings[field].selector,
        sample: r.fieldMappings[field].sample,
        confidence: r.confidenceScores[field] ?? 0,
        overallConfidence: r.overallConfidence,
        isApiSelector: r.fieldMappings[field].selector.startsWith("$."),
      }));

    if (detections.length === 0) continue;

    // Sort by: confidence DESC, then prefer DOM over API, then by overall method confidence DESC
    detections.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      if (a.isApiSelector !== b.isApiSelector) return a.isApiSelector ? 1 : -1;
      return b.overallConfidence - a.overallConfidence;
    });

    const winner = detections[0];
    const methodsDetected = detections.length;

    // Apply cross-method agreement bonus
    const boostedConfidence = applyAgreementBonus(winner.confidence, methodsDetected);

    unifiedMappings[field] = {
      selector: winner.selector,
      sample: winner.sample,
      sourceMethod: winner.method,
      methodsDetected,
    };
    unifiedScores[field] = boostedConfidence;
    contributions[field] = winner.method;
  }

  // 3. Calculate overall confidence from the unified (boosted) per-field scores
  const overallConfidence = calculateOverallConfidence(unifiedScores);

  // 4. Select best listing/item selectors from DOM-based methods (Task 4.1)
  const domMethods = results
    .filter(r => r.listingSelector !== null)
    .sort((a, b) => b.overallConfidence - a.overallConfidence);
  const bestDom = domMethods[0] || null;

  // 5. Get highest item count (Task 4.2)
  const maxItemCount = Math.max(...results.map(r => r.itemCount), 0);

  // 6. Extract metadata from specific methods (Task 4.3, 4.4)
  const networkResult = results.find(r => r.method === "NETWORK_INTERCEPT");
  const crawlResult = results.find(r => r.method === "CRAWL_CLASSIFY");

  return {
    fieldMappings: unifiedMappings,
    confidenceScores: unifiedScores,
    overallConfidence,
    listingSelector: bestDom?.listingSelector ?? null,
    itemSelector: bestDom?.itemSelector ?? null,
    itemCount: maxItemCount,
    apiEndpoint: networkResult?.apiEndpoint ?? null,
    detailPagePattern: crawlResult?.detailPagePattern ?? null,
    methodContributions: contributions,
  };
}
