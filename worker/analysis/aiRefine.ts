import type { Page } from "playwright";
import { calculateOverallConfidence } from "../lib/confidence";

// openai is loaded lazily so the worker keeps building when the optional
// dependency isn't installed. The AI refine stage silently no-ops unless
// both OPENAI_API_KEY is set AND the `openai` package is available.
type OpenAIClient = {
  chat: {
    completions: {
      create: (args: unknown) => Promise<{
        choices: Array<{ message?: { content?: string | null } }>;
      }>;
    };
  };
};

async function loadOpenAIClient(apiKey: string): Promise<OpenAIClient | null> {
  try {
    // Use an indirect import so TypeScript doesn't require `openai` at build
    // time; it's a runtime-optional dependency.
    const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<unknown>;
    const mod = (await dynamicImport("openai")) as {
      default: new (opts: { apiKey: string; timeout?: number }) => OpenAIClient;
    };
    return new mod.default({ apiKey, timeout: MODEL_TIMEOUT_MS });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result shape matching `MethodResult` (combineResults.ts) so this can be fed
 * straight into the combine step as a 4th analysis method.
 */
export interface AiRefineResult {
  fieldMappings: Record<string, { selector: string; sample: string }>;
  confidenceScores: Record<string, number>;
  overallConfidence: number;
  listingSelector: string | null;
  itemSelector: string | null;
  itemCount: number;
  /** Whether the stage was skipped (no API key, no candidates, or model error). */
  skipped: boolean;
  skipReason?: string;
}

interface AiRefineInput {
  /** Best listing selector from heuristics so far (may be null). */
  listingSelector: string | null;
  /** Best item selector from heuristics so far (may be null). */
  itemSelector: string | null;
  /** Fields the heuristics already detected — we only ask AI for the rest. */
  alreadyDetected: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_ITEMS_IN_PROMPT = 4;
const MAX_HTML_PER_ITEM = 2_500;
const MODEL_TIMEOUT_MS = 30_000;

const TARGET_FIELDS = [
  "title",
  "company",
  "location",
  "department",
  "description",
  "publishDate",
  "externalJobId",
  "applyUrl",
] as const;

function zero(skipReason: string): AiRefineResult {
  return {
    fieldMappings: {},
    confidenceScores: {},
    overallConfidence: 0.0,
    listingSelector: null,
    itemSelector: null,
    itemCount: 0,
    skipped: true,
    skipReason,
  };
}

// ---------------------------------------------------------------------------
// Candidate extraction from the page
// ---------------------------------------------------------------------------

async function extractSamples(
  page: Page,
  itemSelector: string | null,
): Promise<{ samples: string[]; matched: number }> {
  if (itemSelector) {
    const result = await page
      .evaluate(
        ({ sel, max, maxHtml }) => {
          const out: string[] = [];
          const nodes = document.querySelectorAll(sel);
          for (let i = 0; i < Math.min(nodes.length, max); i++) {
            const html = (nodes[i] as Element).outerHTML || "";
            out.push(html.slice(0, maxHtml));
          }
          return { samples: out, matched: nodes.length };
        },
        { sel: itemSelector, max: MAX_ITEMS_IN_PROMPT, maxHtml: MAX_HTML_PER_ITEM },
      )
      .catch(() => ({ samples: [], matched: 0 }));

    if (result.samples.length > 0) return result;
  }

  // Fallback: find repeating sibling blocks heuristically
  const fallback = await page
    .evaluate(
      ({ max, maxHtml }) => {
        const candidates: Element[] = [];
        const all = document.querySelectorAll("body *");
        for (const el of Array.from(all)) {
          const children = Array.from(el.children);
          if (children.length < 3) continue;
          // Are children structurally similar (same tag + same top class set)?
          const first = children[0] as Element;
          const sig = (e: Element) =>
            `${e.tagName}|${Array.from(e.classList).slice(0, 3).sort().join(".")}`;
          const firstSig = sig(first);
          const matching = children.filter((c) => sig(c as Element) === firstSig);
          if (matching.length >= 3 && matching.length <= 50) {
            candidates.push(...(matching.slice(0, max) as Element[]));
            break;
          }
        }
        return {
          samples: candidates.map((c) => (c.outerHTML || "").slice(0, maxHtml)),
          matched: candidates.length,
        };
      },
      { max: MAX_ITEMS_IN_PROMPT, maxHtml: MAX_HTML_PER_ITEM },
    )
    .catch(() => ({ samples: [], matched: 0 }));

  return fallback;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildPrompt(samples: string[], input: AiRefineInput): string {
  const wantedFields = TARGET_FIELDS.filter((f) => !input.alreadyDetected.includes(f));
  const fieldsList = wantedFields.length > 0 ? wantedFields : [...TARGET_FIELDS];

  const fieldDescriptions: Record<(typeof TARGET_FIELDS)[number], string> = {
    title: "The job title / position name",
    company: "The hiring company or employer name",
    location: "The job location (city, region, country, or 'Remote')",
    department: "The business unit, team, or department",
    description: "The full job description or summary blurb",
    publishDate: "The date the listing was published",
    externalJobId: "An external / source-system job identifier (number or code)",
    applyUrl: "The URL used to view or apply to this specific job listing",
  };

  const wantedList = fieldsList
    .map((f) => `  - ${f}: ${fieldDescriptions[f]}`)
    .join("\n");

  const itemsBlock = samples
    .map((s, i) => `<ITEM_${i + 1}>\n${s}\n</ITEM_${i + 1}>`)
    .join("\n\n");

  return `You are a CSS selector generator for job-board scraping.

I will give you the OUTER HTML of several repeating job listing items from the same page. For EACH requested field, return a CSS selector that:
  - is scoped WITHIN a single job item (so it selects exactly one element per item)
  - works across ALL the sample items
  - uses ONLY stable attributes: classes, tag names, data-* attributes, or :nth-of-type
  - NEVER uses generated/hash-like classes (e.g. "css-abc123", "sc-f9d4a2")
  - NEVER uses pseudo-classes like :hover / :focus / :checked
  - NEVER uses #ids (they usually change per item)

Requested fields:
${wantedList}

For each field include:
  - "selector": CSS selector (scoped inside a single item)
  - "sample":   the text you'd expect to extract from ITEM_1 using that selector (trim whitespace, max 200 chars)
  - "confidence": 0.0-1.0 — how sure you are the selector is correct

If a field is clearly NOT present in these items, OMIT it from the output (do not guess).

Respond with ONLY valid JSON matching this schema (no markdown, no commentary):

{
  "fields": {
    "title":       { "selector": "h2.job-title", "sample": "Senior Engineer", "confidence": 0.9 },
    "company":     { "selector": ".company",     "sample": "Acme",           "confidence": 0.8 }
  }
}

Job item samples:

${itemsBlock}`;
}

// ---------------------------------------------------------------------------
// Response parsing + validation
// ---------------------------------------------------------------------------

interface AiFieldDecision {
  selector: string;
  sample: string;
  confidence: number;
}

function parseModelJson(raw: string): Record<string, AiFieldDecision> {
  // Strip accidental markdown fences
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
  const fieldsRaw = (parsed as { fields?: unknown }).fields;
  if (!fieldsRaw || typeof fieldsRaw !== "object") return {};

  const out: Record<string, AiFieldDecision> = {};
  for (const [field, val] of Object.entries(fieldsRaw as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const v = val as Record<string, unknown>;
    const selector = typeof v.selector === "string" ? v.selector.trim() : "";
    const sample = typeof v.sample === "string" ? v.sample.trim().slice(0, 200) : "";
    const confRaw = v.confidence;
    const confidence =
      typeof confRaw === "number" ? Math.max(0, Math.min(1, confRaw)) : 0.5;
    if (!selector) continue;
    out[field] = { selector, sample, confidence };
  }
  return out;
}

/**
 * Verify a selector actually resolves inside the item scope. We test against
 * the same item selector the model was shown; if at least one item yields a
 * non-empty match, we keep the selector. We also prepend the item selector to
 * produce a page-absolute selector ready for consumption downstream.
 */
async function validateSelectors(
  page: Page,
  itemSelector: string | null,
  decisions: Record<string, AiFieldDecision>,
): Promise<Record<string, AiFieldDecision>> {
  if (Object.keys(decisions).length === 0) return {};
  const entries = Object.entries(decisions);

  const validated = await page
    .evaluate(
      ({ itemSel, pairs }) => {
        const items = itemSel
          ? Array.from(document.querySelectorAll(itemSel))
          : [document.body];
        if (items.length === 0) return [];

        const results: Array<{ field: string; selector: string; sample: string; ok: boolean }> = [];
        for (const [field, dec] of pairs) {
          let hits = 0;
          let firstText = "";
          for (const it of items.slice(0, 10)) {
            let match: Element | null = null;
            try {
              match = (it as Element).querySelector(dec.selector);
            } catch {
              match = null;
            }
            if (match) {
              hits++;
              if (!firstText) {
                firstText = (match.textContent || "").trim().slice(0, 200);
              }
            }
          }
          results.push({
            field,
            selector: dec.selector,
            sample: firstText || dec.sample,
            ok: hits > 0 && hits >= Math.ceil(items.length * 0.5),
          });
        }
        return results;
      },
      {
        itemSel: itemSelector,
        pairs: entries.map(([f, d]) => [f, d] as [string, AiFieldDecision]),
      },
    )
    .catch(() => [] as Array<{ field: string; selector: string; sample: string; ok: boolean }>);

  const out: Record<string, AiFieldDecision> = {};
  for (const v of validated) {
    if (!v.ok) continue;
    const original = decisions[v.field];
    if (!original) continue;
    // Produce a page-absolute selector: `${itemSelector} ${fieldSelector}`
    const absolute = itemSelector ? `${itemSelector} ${original.selector}` : original.selector;
    out[v.field] = {
      selector: absolute,
      sample: v.sample || original.sample,
      confidence: original.confidence,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Optional AI-powered refinement stage. Does nothing unless `OPENAI_API_KEY`
 * is configured. Intended as a fallback when heuristic confidence is low.
 */
export async function analyzeWithAiRefine(
  page: Page,
  siteUrl: string,
  input: AiRefineInput,
): Promise<AiRefineResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return zero("OPENAI_API_KEY not set");
  }

  const { samples, matched } = await extractSamples(page, input.itemSelector);
  if (samples.length === 0) {
    return zero("No candidate item samples extractable from page");
  }

  console.info("[ai-refine] running:", {
    siteUrl,
    itemSelector: input.itemSelector,
    samplesUsed: samples.length,
    itemsMatched: matched,
    alreadyDetected: input.alreadyDetected,
  });

  const client = await loadOpenAIClient(apiKey);
  if (!client) {
    return zero("openai package not installed (run: npm i openai)");
  }
  const model = process.env.AI_REFINE_MODEL || DEFAULT_MODEL;

  let rawContent: string;
  try {
    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You generate stable CSS selectors for structured job-listing data. Respond with JSON only.",
        },
        { role: "user", content: buildPrompt(samples, input) },
      ],
    });
    rawContent = completion.choices[0]?.message?.content || "";
  } catch (err) {
    console.warn("[ai-refine] OpenAI call failed:", {
      siteUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    return zero("OpenAI call failed");
  }

  const decisions = parseModelJson(rawContent);
  if (Object.keys(decisions).length === 0) {
    console.warn("[ai-refine] Model returned no usable decisions:", { siteUrl });
    return zero("Model returned no usable decisions");
  }

  const validated = await validateSelectors(page, input.itemSelector, decisions);
  if (Object.keys(validated).length === 0) {
    console.warn("[ai-refine] No selectors validated against live DOM:", { siteUrl });
    return zero("No selectors validated against live DOM");
  }

  const fieldMappings: Record<string, { selector: string; sample: string }> = {};
  const confidenceScores: Record<string, number> = {};
  for (const [field, dec] of Object.entries(validated)) {
    fieldMappings[field] = { selector: dec.selector, sample: dec.sample };
    confidenceScores[field] = dec.confidence;
  }

  const overallConfidence = calculateOverallConfidence(confidenceScores);

  console.info("[ai-refine] complete:", {
    siteUrl,
    fields: Object.keys(fieldMappings),
    overallConfidence,
  });

  return {
    fieldMappings,
    confidenceScores,
    overallConfidence,
    listingSelector: input.listingSelector,
    itemSelector: input.itemSelector,
    itemCount: matched,
    skipped: false,
  };
}
