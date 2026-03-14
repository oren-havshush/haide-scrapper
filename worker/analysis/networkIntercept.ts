import type { Page } from "playwright";
import { calculateOverallConfidence } from "../lib/confidence";

// ---------------------------------------------------------------------------
// Types (Task 6)
// ---------------------------------------------------------------------------

/** Final result returned by the network interception analysis method. */
export interface NetworkInterceptResult {
  fieldMappings: Record<string, { selector: string; sample: string }>;
  confidenceScores: Record<string, number>;
  overallConfidence: number;
  listingSelector: string | null; // null for API-based mappings
  itemSelector: string | null; // null for API-based mappings
  itemCount: number;
  apiEndpoint: string | null;
  apiResponse: Record<string, unknown> | null; // sample first item
  capturedEndpoints: number; // total number of JSON endpoints captured
}

/** Raw captured network response. */
interface CapturedRequest {
  url: string;
  method: string;
  status: number;
  contentType: string;
  body: unknown;
  bodySize: number;
}

/** Scored endpoint analysis result. */
interface AnalyzedEndpoint {
  url: string;
  method: string;
  itemCount: number;
  fieldMatches: Record<string, FieldMatch>;
  overallScore: number;
  arrayPath: string; // JSON path to the array of items (e.g., "data", "results", "jobs")
  sampleItem: Record<string, unknown>;
}

/** A single field match within an analyzed endpoint. */
interface FieldMatch {
  key: string; // The actual key name in the API response
  confidence: number; // How confident we are this maps to the job field
  sample: string; // Sample value from first item
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANALYSIS_TIMEOUT_MS = 60_000;
const MAX_CAPTURED_RESPONSES = 50;
const MAX_RESPONSE_BODY_SIZE = 500_000; // 500KB

/** URL patterns to skip during network capture. */
const SKIP_URL_PATTERNS = [
  /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)(\?|$)/i,
  /\/static\//i,
  /\/assets\//i,
  /\/_next\//i,
  /\/webpack/i,
  /google-analytics|gtag|googletagmanager|facebook|pixel|hotjar|analytics|tracking|beacon/i,
  /cdn\.|cloudflare|cloudfront|googleapis|gstatic/i,
  /recaptcha|captcha/i,
  /socket\.io|ws:\/\//i,
];

// ---------------------------------------------------------------------------
// Zero-confidence fallback
// ---------------------------------------------------------------------------

function zeroResult(): NetworkInterceptResult {
  return {
    fieldMappings: {},
    confidenceScores: {},
    overallConfidence: 0.0,
    listingSelector: null,
    itemSelector: null,
    itemCount: 0,
    apiEndpoint: null,
    apiResponse: null,
    capturedEndpoints: 0,
  };
}

// ---------------------------------------------------------------------------
// Public entry point (Task 1.2 + Task 5)
// ---------------------------------------------------------------------------

/**
 * Analyse a page using network interception to discover API endpoints
 * containing job data and map their fields to the standard job schema.
 *
 * NEVER throws -- always returns a NetworkInterceptResult (NFR10).
 */
export async function analyzeWithNetworkIntercept(
  page: Page,
  siteUrl: string,
): Promise<NetworkInterceptResult> {
  try {
    const result = await Promise.race<NetworkInterceptResult>([
      runNetworkInterceptAnalysis(page, siteUrl),
      new Promise<NetworkInterceptResult>((_, reject) =>
        setTimeout(
          () => reject(new Error("Network interception timed out after 60s")),
          ANALYSIS_TIMEOUT_MS,
        ),
      ),
    ]);
    return result;
  } catch (error) {
    console.error("[worker] Network interception failed:", {
      siteUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return zeroResult();
  }
}

// ---------------------------------------------------------------------------
// Internal pipeline (Task 1.3)
// ---------------------------------------------------------------------------

async function runNetworkInterceptAnalysis(
  page: Page,
  siteUrl: string,
): Promise<NetworkInterceptResult> {
  // Step 1: Capture network requests during page load
  const captured = await captureNetworkRequests(page, siteUrl);

  if (captured.length === 0) {
    console.info("[worker] No JSON API responses captured during page load");
    return zeroResult();
  }

  // Step 2: Analyze captured responses for job data
  const endpoints = analyzeResponses(captured);

  if (endpoints.length === 0) {
    console.info("[worker] No job-like API endpoints detected in captured responses");
    return { ...zeroResult(), capturedEndpoints: captured.length };
  }

  // Step 3: Build field mappings from the best endpoint
  const bestEndpoint = endpoints[0]; // already sorted by score desc
  const result = buildNetworkInterceptMappings(bestEndpoint);

  return {
    ...result,
    capturedEndpoints: captured.length,
  };
}

// ---------------------------------------------------------------------------
// Step 1: Network capture (Task 2)
// ---------------------------------------------------------------------------

/** Check if a URL should be skipped (static assets, analytics, etc.). */
function shouldSkipUrl(url: string): boolean {
  return SKIP_URL_PATTERNS.some((pattern) => pattern.test(url));
}

/** Set up a response handler to capture JSON responses. */
function setupNetworkCapture(page: Page): { requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];

  page.on("response", async (response) => {
    // Only capture successful responses
    const status = response.status();
    if (status < 200 || status >= 400) return;

    const contentType = response.headers()["content-type"] || "";
    if (!contentType.includes("json") && !contentType.includes("text/plain")) return;

    // Skip static assets and analytics
    const url = response.url();
    if (shouldSkipUrl(url)) return;

    // Enforce capture count limit
    if (requests.length >= MAX_CAPTURED_RESPONSES) return;

    try {
      const body = await response.json();
      const bodyStr = JSON.stringify(body);

      // Skip if response is too large
      if (bodyStr.length > MAX_RESPONSE_BODY_SIZE) return;

      requests.push({
        url,
        method: response.request().method(),
        status,
        contentType,
        body,
        bodySize: bodyStr.length,
      });
    } catch {
      // Not valid JSON -- skip silently (Task 5.5)
    }
  });

  return { requests };
}

/** Navigate to the page and capture network requests during load + scroll. */
async function captureNetworkRequests(
  page: Page,
  siteUrl: string,
): Promise<CapturedRequest[]> {
  const { requests } = setupNetworkCapture(page);

  // Navigate to the page (fresh load to capture all initial API calls)
  await page.goto(siteUrl, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });

  // Scroll to trigger lazy-loaded content
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight / 2);
  });
  await page.waitForTimeout(1_500);

  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(1_500);

  return requests;
}

// ---------------------------------------------------------------------------
// Step 2: Analyze captured responses for job data (Task 3)
// ---------------------------------------------------------------------------

/** Find arrays in a JSON response at any nesting depth (up to 5 levels). */
function findArraysInResponse(body: unknown): Array<{ path: string; items: unknown[] }> {
  const results: Array<{ path: string; items: unknown[] }> = [];

  function walk(obj: unknown, currentPath: string, depth: number): void {
    if (depth > 5) return; // Don't recurse too deep

    if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === "object" && obj[0] !== null) {
      results.push({ path: currentPath || "$", items: obj });
    }

    if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        walk(value, currentPath ? `${currentPath}.${key}` : key, depth + 1);
      }
    }
  }

  walk(body, "", 0);
  return results;
}

/** Analyze all captured responses and identify job-like API endpoints. */
function analyzeResponses(captured: CapturedRequest[]): AnalyzedEndpoint[] {
  const endpoints: AnalyzedEndpoint[] = [];

  for (const req of captured) {
    // Find arrays in the response (may be at root or nested)
    const arrays = findArraysInResponse(req.body);

    for (const { path, items } of arrays) {
      if (items.length < 3) continue; // Need at least 3 items to be a listing

      // Check if array items look like job objects
      const analysis = analyzeArrayItems(items);
      if (analysis.matchCount >= 2) {
        endpoints.push({
          url: req.url,
          method: req.method,
          itemCount: items.length,
          fieldMatches: analysis.fieldMatches,
          overallScore: analysis.overallScore,
          arrayPath: path,
          sampleItem: items[0] as Record<string, unknown>,
        });
      }
    }
  }

  // Sort by overall score descending
  endpoints.sort((a, b) => b.overallScore - a.overallScore);
  return endpoints;
}

/** Analyze array items for job-like fields and return scored matches. */
function analyzeArrayItems(
  items: unknown[],
): { matchCount: number; fieldMatches: Record<string, FieldMatch>; overallScore: number } {
  // Sample first 5 items
  const sample = items.slice(0, 5) as Array<Record<string, unknown>>;

  // Collect all keys across sample items
  const allKeys = new Set<string>();
  for (const item of sample) {
    if (typeof item === "object" && item !== null) {
      for (const key of Object.keys(item)) {
        allKeys.add(key);
      }
    }
  }

  const fieldMatches: Record<string, FieldMatch> = {};
  const firstItem = (sample[0] || {}) as Record<string, unknown>;

  // --- Title detection (Task 3.3) ---
  for (const key of allKeys) {
    const lowerKey = key.toLowerCase();
    let conf = 0;

    // Exact/close key name matches
    if (/^(title|jobTitle|job_title|position|positionName|position_name|name|jobName|job_name)$/i.test(key)) {
      conf = 0.90;
    } else if (/title|position|job.*name/i.test(lowerKey)) {
      conf = 0.70;
    }
    // Hebrew key hints
    else if (/כותרת|שם_משרה|שםמשרה|תפקיד|שם.*משרה/u.test(key)) {
      conf = 0.85;
    }

    // Value-based confirmation (Task 3.4)
    if (conf > 0) {
      const val = String(firstItem[key] ?? "");
      if (val.length >= 5 && val.length <= 100) conf = Math.min(1.0, conf + 0.05);
      if (val.length < 3 || val.length > 200) conf *= 0.5;
    }

    if (conf > (fieldMatches.title?.confidence ?? 0)) {
      fieldMatches.title = {
        key,
        confidence: Math.round(conf * 100) / 100,
        sample: String(firstItem[key] ?? "").substring(0, 100),
      };
    }
  }

  // --- Company detection ---
  for (const key of allKeys) {
    const lowerKey = key.toLowerCase();
    let conf = 0;

    if (/^(company|companyName|company_name|employer|organization|org|orgName|org_name)$/i.test(key)) {
      conf = 0.90;
    } else if (/company|employer|org/i.test(lowerKey)) {
      conf = 0.70;
    }
    // Hebrew key hints
    else if (/חברה|מעסיק|שם_חברה|שםחברה|ארגון/u.test(key)) {
      conf = 0.85;
    }

    // Value-based confirmation
    if (conf > 0) {
      const val = String(firstItem[key] ?? "");
      if (val.length >= 2 && val.length <= 80) conf = Math.min(1.0, conf + 0.05);
      if (val.length < 1 || val.length > 150) conf *= 0.5;
    }

    if (conf > (fieldMatches.company?.confidence ?? 0)) {
      fieldMatches.company = {
        key,
        confidence: Math.round(conf * 100) / 100,
        sample: String(firstItem[key] ?? "").substring(0, 100),
      };
    }
  }

  // --- Location detection ---
  for (const key of allKeys) {
    const lowerKey = key.toLowerCase();
    let conf = 0;

    if (/^(location|city|area|address|region|place)$/i.test(key)) {
      conf = 0.90;
    } else if (/location|city|area|address|region|place/i.test(lowerKey)) {
      conf = 0.70;
    }
    // Hebrew key hints
    else if (/מיקום|עיר|אזור|כתובת/u.test(key)) {
      conf = 0.85;
    }

    // Value-based confirmation
    if (conf > 0) {
      const val = String(firstItem[key] ?? "");
      // Check for known location values
      if (/\b(tel\s*aviv|jerusalem|haifa|israel|remote|hybrid)\b/i.test(val)) {
        conf = Math.min(1.0, conf + 0.05);
      }
      const hebrewCities = ["תל אביב", "ירושלים", "חיפה", "באר שבע", "רמת גן", "פתח תקווה", "נתניה", "הרצליה"];
      for (const city of hebrewCities) {
        if (val.includes(city)) {
          conf = Math.min(1.0, conf + 0.05);
          break;
        }
      }
      if (val.length < 1 || val.length > 100) conf *= 0.5;
    }

    if (conf > (fieldMatches.location?.confidence ?? 0)) {
      fieldMatches.location = {
        key,
        confidence: Math.round(conf * 100) / 100,
        sample: String(firstItem[key] ?? "").substring(0, 100),
      };
    }
  }

  // --- Salary detection ---
  for (const key of allKeys) {
    const lowerKey = key.toLowerCase();
    let conf = 0;

    if (/^(salary|pay|wage|compensation|minSalary|maxSalary|salaryRange|salary_range|min_salary|max_salary)$/i.test(key)) {
      conf = 0.90;
    } else if (/salary|pay|wage|compensation/i.test(lowerKey)) {
      conf = 0.70;
    }
    // Hebrew key hints
    else if (/שכר|משכורת|שכר_ברוטו/u.test(key)) {
      conf = 0.85;
    }

    // Value-based confirmation
    if (conf > 0) {
      const val = String(firstItem[key] ?? "");
      // Check for currency/number patterns
      if (/[\u20AA$\u20AC\u00A3]/.test(val)) conf = Math.min(1.0, conf + 0.05);
      if (/\b(nis|ils|shekel)\b/i.test(val)) conf = Math.min(1.0, conf + 0.05);
      if (/ש"ח|שקל/.test(val)) conf = Math.min(1.0, conf + 0.05);
      if (/\d/.test(val)) conf = Math.min(1.0, conf + 0.03);
    }

    if (conf > (fieldMatches.salary?.confidence ?? 0)) {
      fieldMatches.salary = {
        key,
        confidence: Math.round(conf * 100) / 100,
        sample: String(firstItem[key] ?? "").substring(0, 100),
      };
    }
  }

  // --- Description detection ---
  for (const key of allKeys) {
    const lowerKey = key.toLowerCase();
    let conf = 0;

    if (/^(description|desc|summary|details|about|content|body)$/i.test(key)) {
      conf = 0.90;
    } else if (/description|desc|summary|details|about|content|body/i.test(lowerKey)) {
      conf = 0.70;
    }
    // Hebrew key hints
    else if (/תיאור|פירוט|תיאור_המשרה/u.test(key)) {
      conf = 0.85;
    }

    // Value-based confirmation: descriptions tend to be long strings
    if (conf > 0) {
      const val = String(firstItem[key] ?? "");
      if (val.length > 50) conf = Math.min(1.0, conf + 0.05);
      if (val.length < 10) conf *= 0.5;
    }

    if (conf > (fieldMatches.description?.confidence ?? 0)) {
      fieldMatches.description = {
        key,
        confidence: Math.round(conf * 100) / 100,
        sample: String(firstItem[key] ?? "").substring(0, 150),
      };
    }
  }

  // Calculate overall score (Task 3.5)
  const matchCount = Object.keys(fieldMatches).length;
  let overallScore = 0;
  for (const match of Object.values(fieldMatches)) {
    overallScore += match.confidence;
  }
  overallScore = matchCount > 0 ? overallScore / matchCount : 0;
  overallScore *= Math.min(1.0, items.length / 5); // bonus for more items

  return { matchCount, fieldMatches, overallScore };
}

// ---------------------------------------------------------------------------
// Step 3: Build field mappings (Task 4)
// ---------------------------------------------------------------------------

/** Convert the best-scoring endpoint into the standard field mapping format. */
function buildNetworkInterceptMappings(endpoint: AnalyzedEndpoint): NetworkInterceptResult {
  const fieldMappings: Record<string, { selector: string; sample: string }> = {};
  const confidenceScores: Record<string, number> = {};

  for (const [field, match] of Object.entries(endpoint.fieldMatches)) {
    // Build JSON path selector: $.{arrayPath}[*].{fieldKey}
    const arrayPathPrefix = endpoint.arrayPath === "$" ? "$" : `$.${endpoint.arrayPath}`;
    const selector = `${arrayPathPrefix}[*].${match.key}`;

    fieldMappings[field] = {
      selector,
      sample: match.sample,
    };
    confidenceScores[field] = match.confidence;
  }

  const overallConfidence = calculateOverallConfidence(confidenceScores);

  return {
    fieldMappings,
    confidenceScores,
    overallConfidence,
    listingSelector: null, // null for API-based mappings
    itemSelector: null, // null for API-based mappings
    itemCount: endpoint.itemCount,
    apiEndpoint: endpoint.url,
    apiResponse: endpoint.sampleItem,
    capturedEndpoints: 0, // will be overridden by caller
  };
}

