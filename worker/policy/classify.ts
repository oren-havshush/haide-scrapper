/**
 * LLM-based scraping policy classification.
 *
 * Sends cleaned policy text to the configured OpenAI model and returns a
 * structured classification result. Classification is based ONLY on the
 * supplied source text — the model must never infer or assume restrictions
 * without textual evidence.
 *
 * IMPORTANT wording rules (enforced in the system prompt):
 *   - Never output "allowed", "legal", or "approved".
 *   - Every evidence snippet quote must be verbatim from the supplied text.
 *   - If no relevant policy text is supplied, classify as POLICY_NOT_FOUND.
 */

import OpenAI from "openai";
import { chunkText, mergeStatuses, type PolicyStatusString } from "./extract";
import { findRestrictiveTerms } from "./keywords";

const DEFAULT_MODEL = "gpt-4o-mini";
const MODEL_TIMEOUT_MS = 60_000;
const MAX_EVIDENCE_SNIPPETS = 5;

export interface EvidenceSnippet {
  source_url: string;
  quote: string;
  interpretation: string;
}

export interface ClassificationResult {
  status: PolicyStatusString;
  is_scraping_restricted: boolean | null;
  requires_written_permission: boolean | null;
  confidence: number;
  language: string;
  matched_terms: string[];
  short_reason: string;
  evidence_snippets: EvidenceSnippet[];
  reviewed_urls: string[];
  /** Whether the LLM was actually called (false if text was empty / no key). */
  llm_called: boolean;
  raw_json?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// System and user prompts
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a policy classification assistant for a job-scraping platform.

Your task: analyze the provided policy/terms/legal text and determine whether it contains explicit restrictions on automated web scraping, crawling, bots, data mining, or similar automated access.

STRICT RULES:
1. Base your classification ONLY on the text provided. Do not infer restrictions that are not explicitly stated.
2. NEVER use words like "allowed", "legal", "permitted", or "approved" in any field.
3. Every evidence snippet "quote" must be a verbatim excerpt from the provided text.
4. If no policy text is provided or it is clearly not a terms/legal/privacy page, output status: POLICY_NOT_FOUND.
5. If you cannot determine the status from the text, output status: UNCLEAR_NEEDS_REVIEW.

Classification rules:
- "RESTRICTED": text explicitly prohibits scraping, crawling, bots, automated access, data mining, harvesting, or automated copying/extraction.
- "REQUIRES_WRITTEN_PERMISSION": text states that use requires prior written permission or written consent.
- "NO_EXPLICIT_RESTRICTION": the policy text exists and was reviewed, but contains no explicit restriction related to scraping or automated access.
- "UNCLEAR_NEEDS_REVIEW": the text discusses content use but the restriction is ambiguous, or only a privacy policy is present without relevant content-usage terms.
- "POLICY_NOT_FOUND": no relevant policy text was provided or the text is clearly not a policy document.
- "CHECK_FAILED": do not output this — it is reserved for system errors.

Respond with ONLY a valid JSON object, no markdown fences. Schema:
{
  "status": "RESTRICTED | REQUIRES_WRITTEN_PERMISSION | NO_EXPLICIT_RESTRICTION | UNCLEAR_NEEDS_REVIEW | POLICY_NOT_FOUND",
  "is_scraping_restricted": true | false | null,
  "requires_written_permission": true | false | null,
  "confidence": 0-100,
  "language": "he | en | mixed | other",
  "matched_terms": ["exact term from text..."],
  "short_reason": "One sentence, max 300 chars, no legal conclusion, no 'allowed/legal'.",
  "evidence_snippets": [
    { "source_url": "https://...", "quote": "verbatim excerpt", "interpretation": "neutral observation" }
  ],
  "reviewed_urls": ["https://..."]
}`;

function buildUserPrompt(
  policyTexts: Array<{ url: string; text: string }>,
): string {
  if (policyTexts.length === 0) {
    return "No policy text was provided.";
  }

  const blocks = policyTexts.map(({ url, text }, i) =>
    `<POLICY_DOC_${i + 1} url="${url}">\n${text}\n</POLICY_DOC_${i + 1}>`,
  );

  return `Please classify the following policy document(s) for scraping restrictions.

${blocks.join("\n\n")}`;
}

// ---------------------------------------------------------------------------
// JSON parsing
// ---------------------------------------------------------------------------

function parseClassificationJson(raw: string): Partial<ClassificationResult> {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== "object") return {};
  const p = parsed as Record<string, unknown>;

  const VALID_STATUSES: PolicyStatusString[] = [
    "RESTRICTED",
    "REQUIRES_WRITTEN_PERMISSION",
    "NO_EXPLICIT_RESTRICTION",
    "UNCLEAR_NEEDS_REVIEW",
    "POLICY_NOT_FOUND",
    "CHECK_FAILED",
  ];

  const status = VALID_STATUSES.includes(p.status as PolicyStatusString)
    ? (p.status as PolicyStatusString)
    : "UNCLEAR_NEEDS_REVIEW";

  const evidence: EvidenceSnippet[] = [];
  if (Array.isArray(p.evidence_snippets)) {
    for (const s of p.evidence_snippets.slice(0, MAX_EVIDENCE_SNIPPETS)) {
      if (s && typeof s === "object") {
        const sn = s as Record<string, unknown>;
        evidence.push({
          source_url: typeof sn.source_url === "string" ? sn.source_url : "",
          quote: typeof sn.quote === "string" ? sn.quote.slice(0, 500) : "",
          interpretation: typeof sn.interpretation === "string" ? sn.interpretation.slice(0, 300) : "",
        });
      }
    }
  }

  return {
    status,
    is_scraping_restricted: typeof p.is_scraping_restricted === "boolean" ? p.is_scraping_restricted : null,
    requires_written_permission: typeof p.requires_written_permission === "boolean" ? p.requires_written_permission : null,
    confidence: typeof p.confidence === "number" ? Math.min(100, Math.max(0, Math.round(p.confidence))) : 50,
    language: typeof p.language === "string" ? p.language : "other",
    matched_terms: Array.isArray(p.matched_terms) ? (p.matched_terms as string[]).slice(0, 20) : [],
    short_reason: typeof p.short_reason === "string" ? p.short_reason.slice(0, 300) : "",
    evidence_snippets: evidence,
    reviewed_urls: Array.isArray(p.reviewed_urls) ? (p.reviewed_urls as string[]).slice(0, 10) : [],
    raw_json: parsed,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Classify policy text using the configured OpenAI model.
 *
 * Handles chunking: if a document's text is longer than one chunk, each chunk
 * is classified separately and results are merged with "most restrictive wins".
 *
 * @param policyTexts  Array of { url, text } for each fetched policy page.
 * @param siteUrl      Used for logging.
 */
export async function classifyPolicy(
  policyTexts: Array<{ url: string; text: string }>,
  siteUrl: string,
): Promise<ClassificationResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return failResult("OPENAI_API_KEY not set", policyTexts);
  }

  if (policyTexts.length === 0) {
    return {
      status: "POLICY_NOT_FOUND",
      is_scraping_restricted: null,
      requires_written_permission: null,
      confidence: 90,
      language: "other",
      matched_terms: [],
      short_reason: "No policy pages discovered for this site.",
      evidence_snippets: [],
      reviewed_urls: [],
      llm_called: false,
    };
  }

  // Collect all matched terms from text before sending to LLM
  const allMatchedTerms = new Set<string>();
  for (const { text } of policyTexts) {
    for (const t of findRestrictiveTerms(text)) allMatchedTerms.add(t);
  }

  const model = process.env.POLICY_REVIEW_MODEL || DEFAULT_MODEL;
  const client = new OpenAI({ apiKey, timeout: MODEL_TIMEOUT_MS });

  // If total text is within one chunk, classify in one call.
  // Otherwise chunk per document.
  const allText = policyTexts.map((p) => p.text).join("\n\n");
  const MAX_CHARS = 12_000;

  let finalResult: ClassificationResult;

  if (allText.length <= MAX_CHARS) {
    finalResult = await callLlm(client, model, policyTexts, siteUrl, allMatchedTerms);
  } else {
    // Chunk-per-document then merge
    const chunkResults: ClassificationResult[] = [];
    for (const doc of policyTexts) {
      const chunks = chunkText(doc.text, MAX_CHARS);
      for (const chunk of chunks) {
        const res = await callLlm(client, model, [{ url: doc.url, text: chunk }], siteUrl, allMatchedTerms);
        chunkResults.push(res);
      }
    }
    finalResult = mergeChunkResults(chunkResults, allMatchedTerms);
  }

  return finalResult;
}

async function callLlm(
  client: OpenAI,
  model: string,
  policyTexts: Array<{ url: string; text: string }>,
  siteUrl: string,
  allMatchedTerms: Set<string>,
): Promise<ClassificationResult> {
  console.info("[policy] classifying:", {
    siteUrl,
    pages: policyTexts.length,
    model,
    chars: policyTexts.reduce((s, p) => s + p.text.length, 0),
  });

  let rawContent: string;
  try {
    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(policyTexts) },
      ],
    });
    rawContent = completion.choices[0]?.message?.content || "";
  } catch (err) {
    console.warn("[policy] OpenAI call failed:", {
      siteUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    return failResult(
      `OpenAI call failed: ${err instanceof Error ? err.message : String(err)}`,
      policyTexts,
    );
  }

  const parsed = parseClassificationJson(rawContent);

  // Merge matched terms: LLM-found + pre-scan keyword matches
  const mergedTerms = Array.from(
    new Set([...(parsed.matched_terms || []), ...Array.from(allMatchedTerms)]),
  ).slice(0, 20);

  return {
    status: parsed.status || "UNCLEAR_NEEDS_REVIEW",
    is_scraping_restricted: parsed.is_scraping_restricted ?? null,
    requires_written_permission: parsed.requires_written_permission ?? null,
    confidence: parsed.confidence ?? 50,
    language: parsed.language || "other",
    matched_terms: mergedTerms,
    short_reason: parsed.short_reason || "",
    evidence_snippets: parsed.evidence_snippets || [],
    reviewed_urls: parsed.reviewed_urls || policyTexts.map((p) => p.url),
    llm_called: true,
    raw_json: parsed.raw_json,
  };
}

function mergeChunkResults(
  results: ClassificationResult[],
  allMatchedTerms: Set<string>,
): ClassificationResult {
  if (results.length === 0) {
    return failResult("No chunks to merge", []);
  }
  const statuses = results.map((r) => r.status);
  const mergedStatus = mergeStatuses(statuses);
  const best = results.find((r) => r.status === mergedStatus) || results[0];

  const mergedTerms = Array.from(
    new Set([
      ...results.flatMap((r) => r.matched_terms),
      ...Array.from(allMatchedTerms),
    ]),
  ).slice(0, 20);

  const allSnippets = results.flatMap((r) => r.evidence_snippets).slice(0, MAX_EVIDENCE_SNIPPETS);
  const allUrls = Array.from(new Set(results.flatMap((r) => r.reviewed_urls)));

  return {
    ...best,
    status: mergedStatus,
    matched_terms: mergedTerms,
    evidence_snippets: allSnippets,
    reviewed_urls: allUrls,
    confidence: Math.round(results.reduce((s, r) => s + r.confidence, 0) / results.length),
  };
}

function failResult(
  error: string,
  policyTexts: Array<{ url: string; text: string }>,
): ClassificationResult {
  return {
    status: "CHECK_FAILED",
    is_scraping_restricted: null,
    requires_written_permission: null,
    confidence: 0,
    language: "other",
    matched_terms: [],
    short_reason: error.slice(0, 300),
    evidence_snippets: [],
    reviewed_urls: policyTexts.map((p) => p.url),
    llm_called: false,
    error,
  };
}
