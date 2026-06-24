/**
 * Policy page text extraction and cleanup.
 *
 * Converts raw HTML from a policy/terms/privacy page into clean, deduplicated
 * plain text ready for LLM classification. The goal is to:
 *   - Remove navigation, headers, footers, cookie banners, menus, widgets.
 *   - Preserve the actual policy body text (RTL Hebrew, LTR English, or mixed).
 *   - Deduplicate repeated paragraphs.
 *   - Cap the output to avoid excessive LLM token usage.
 *   - Keep enough for accurate classification and evidence snippets.
 */

import { stripHtmlTags, normalizeWhitespace } from "../lib/normalizer";

/** Maximum characters of cleaned text sent to the LLM. ~4000 chars ≈ ~1000 tokens. */
export const MAX_CLEANED_TEXT_CHARS = 12_000;

/** Maximum characters stored in the audit row (for debugging). */
const MAX_STORED_TEXT_CHARS = 20_000;

/** Noise blocks to strip before LLM (common CMS/cookie/accessibility fragments). */
const NOISE_PATTERNS: RegExp[] = [
  /cookie\s+(consent|banner|notice|policy)/gi,
  /we use cookies/gi,
  /accept\s+cookies/gi,
  /accessibility\s+(statement|widget|toolbar)/gi,
  /skip\s+to\s+(main\s+)?content/gi,
  /©\s*\d{4}/g,
  /all rights reserved/gi,
];

/** HTML tag names whose content should be stripped entirely (navigation/layout). */
const STRIP_TAG_NAMES = new Set([
  "script",
  "style",
  "noscript",
  "svg",
  "img",
  "video",
  "audio",
  "iframe",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "button",
  "input",
  "select",
  "textarea",
]);

/**
 * Clean raw HTML from a policy page into plain text suitable for the LLM.
 *
 * @param html       Raw HTML string from page.content().
 * @param maxChars   Max output length (default MAX_CLEANED_TEXT_CHARS).
 * @returns          `{ cleanedText, storedText, detectedLanguage }`
 */
export function extractPolicyText(
  html: string,
  maxChars = MAX_CLEANED_TEXT_CHARS,
): { cleanedText: string; storedText: string; detectedLanguage: string } {
  // Strip block-level noise elements first (regex-based, no DOM needed)
  let working = stripNoiseTags(html);

  // Strip remaining HTML tags
  working = stripHtmlTags(working);

  // Normalize whitespace
  working = normalizeWhitespace(working);

  // Strip noise patterns
  for (const re of NOISE_PATTERNS) {
    working = working.replace(re, " ");
  }

  // Deduplicate repeated sentences/paragraphs
  working = deduplicateLines(working);

  // Normalize whitespace again after dedup
  working = normalizeWhitespace(working);

  const storedText = working.slice(0, MAX_STORED_TEXT_CHARS);
  const cleanedText = working.slice(0, maxChars);

  return {
    cleanedText,
    storedText,
    detectedLanguage: detectLanguage(cleanedText),
  };
}

/**
 * Split cleaned text into chunks of `chunkSize` characters with `overlap`
 * character overlap so context isn't lost at boundaries.
 * Used when text exceeds token limits and needs multi-chunk classification.
 */
export function chunkText(
  text: string,
  chunkSize = MAX_CLEANED_TEXT_CHARS,
  overlap = 500,
): string[] {
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize));
    start += chunkSize - overlap;
  }
  return chunks;
}

/**
 * Merge multiple chunk classification statuses with "most restrictive wins".
 */
export type PolicyStatusString =
  | "RESTRICTED"
  | "REQUIRES_WRITTEN_PERMISSION"
  | "NO_EXPLICIT_RESTRICTION"
  | "UNCLEAR_NEEDS_REVIEW"
  | "POLICY_NOT_FOUND"
  | "CHECK_FAILED";

const STATUS_SEVERITY: Record<PolicyStatusString, number> = {
  RESTRICTED: 5,
  REQUIRES_WRITTEN_PERMISSION: 4,
  UNCLEAR_NEEDS_REVIEW: 3,
  POLICY_NOT_FOUND: 2,
  NO_EXPLICIT_RESTRICTION: 1,
  CHECK_FAILED: 0,
};

export function mergeStatuses(statuses: PolicyStatusString[]): PolicyStatusString {
  if (statuses.length === 0) return "CHECK_FAILED";
  return statuses.reduce((best, cur) =>
    STATUS_SEVERITY[cur] > STATUS_SEVERITY[best] ? cur : best,
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Remove entire tag blocks for known noise elements using regex.
 * Not a full HTML parser — handles common cases sufficiently.
 */
function stripNoiseTags(html: string): string {
  let out = html;
  for (const tag of STRIP_TAG_NAMES) {
    // Self-closing and block tags with content
    const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    out = out.replace(re, " ");
    // Self-closing
    const reSelf = new RegExp(`<${tag}[^>]*/?>`, "gi");
    out = out.replace(reSelf, " ");
  }
  return out;
}

/**
 * Remove duplicate lines/sentences from the text.
 * Splits on sentence-like boundaries and removes exact duplicates.
 */
function deduplicateLines(text: string): string {
  // Split on newlines and periods followed by spaces or end of string
  const parts = text.split(/(?:\n|\.(?:\s|$))+/).map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase().replace(/\s+/g, " ");
    if (key.length < 10) { unique.push(part); continue; } // keep short fragments
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(part);
    }
  }
  return unique.join(". ");
}

/**
 * Heuristic language detection based on character frequency.
 * Returns "he", "en", "mixed", or "other".
 */
function detectLanguage(text: string): string {
  const hebrewChars = (text.match(/[\u05D0-\u05EA]/g) || []).length;
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  const total = hebrewChars + latinChars;
  if (total === 0) return "other";
  const heRatio = hebrewChars / total;
  if (heRatio > 0.7) return "he";
  if (heRatio < 0.2) return "en";
  return "mixed";
}
