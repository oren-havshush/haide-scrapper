/**
 * Policy document (PDF / Word) text extraction.
 *
 * Some sites publish their terms/privacy policy as a downloadable PDF or Word
 * document instead of an HTML page (e.g. chayuta.com/assets/terms.pdf). This
 * module fetches such a file into an in-memory buffer (never written to disk),
 * extracts its plain text, and runs it through the same cleanup pipeline used
 * for HTML pages so the LLM classifier receives a consistent input shape.
 *
 * Supported types:
 *   - pdf  → pdf-parse (pdfjs-based, text layer only — no OCR)
 *   - docx → mammoth
 *   - doc  → not supported (legacy binary format); returns a clear error so the
 *            caller can flag the site for manual review rather than mis-report
 *            "policy not found".
 */

import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { cleanExtractedText, MAX_CLEANED_TEXT_CHARS } from "./extract";
import type { PolicyDocType } from "./keywords";

/** Skip downloads larger than this — a policy doc is virtually never this big. */
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB
/** Abort the download if it stalls past this. */
const DOWNLOAD_TIMEOUT_MS = 15_000;

const USER_AGENT = "Mozilla/5.0 (compatible; HaidePolicyBot/1.0)";

export interface DocumentExtractResult {
  cleanedText: string;
  storedText: string;
  detectedLanguage: string;
  error?: string;
}

/**
 * Fetch a policy document URL into memory and extract its cleaned text.
 *
 * Never throws — returns `{ ..., error }` with empty text on any failure so the
 * job handler can decide how to record it.
 *
 * @param url      Absolute URL to a .pdf / .docx file.
 * @param docType  Document type as detected by getPolicyDocumentType().
 * @param maxChars Max cleaned-text length (default MAX_CLEANED_TEXT_CHARS).
 */
export async function extractDocumentText(
  url: string,
  docType: PolicyDocType,
  maxChars = MAX_CLEANED_TEXT_CHARS,
): Promise<DocumentExtractResult> {
  if (docType === "doc") {
    return emptyResult("Legacy .doc format is not supported (needs manual review)");
  }

  const { buffer, error: dlError } = await downloadToBuffer(url);
  if (dlError || !buffer) {
    return emptyResult(dlError || "Empty download");
  }

  let rawText = "";
  try {
    if (docType === "pdf") {
      rawText = await extractPdfText(buffer);
    } else {
      rawText = await extractDocxText(buffer);
    }
  } catch (err) {
    return emptyResult(
      `Failed to parse ${docType}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!rawText || rawText.trim().length === 0) {
    return emptyResult(
      `No extractable text in ${docType} (likely a scanned/image-only document)`,
    );
  }

  return cleanExtractedText(rawText, maxChars);
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

async function downloadToBuffer(
  url: string,
): Promise<{ buffer?: Uint8Array; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT },
    });

    if (!res.ok) {
      return { error: `HTTP ${res.status} fetching document` };
    }

    // Reject obviously-too-large files up front when the server reports size.
    const lenHeader = res.headers.get("content-length");
    if (lenHeader && Number(lenHeader) > MAX_DOCUMENT_BYTES) {
      return { error: `Document too large (${lenHeader} bytes)` };
    }

    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_DOCUMENT_BYTES) {
      return { error: `Document too large (${arrayBuffer.byteLength} bytes)` };
    }

    return { buffer: new Uint8Array(arrayBuffer) };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Per-format extractors
// ---------------------------------------------------------------------------

async function extractPdfText(buffer: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text || "";
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractDocxText(buffer: Uint8Array): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
  return value || "";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyResult(error: string): DocumentExtractResult {
  return { cleanedText: "", storedText: "", detectedLanguage: "other", error };
}
