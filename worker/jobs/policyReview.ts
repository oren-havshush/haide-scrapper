/**
 * Policy Review Job Handler
 *
 * Orchestrates the full scraping-policy check for a single site:
 *   1. Fetch robots.txt (secondary signal + sitemap discovery).
 *   2. Navigate to the site homepage with Playwright.
 *   3. Discover candidate policy/terms/legal page URLs.
 *   4. Fetch and extract cleaned text from each discovered page.
 *   5. Classify with the OpenAI LLM.
 *   6. Apply optional robots-nudge (soft downgrade when robots broadly disallows).
 *   7. Persist audit row (ScrapingPolicyReview) and denormalize status onto Site.
 *   8. Emit policy:checked SSE event.
 *
 * CRITICAL: this handler NEVER throws. It returns a result object in all cases
 * (including error paths), so the dispatcher marks the WorkerJob COMPLETED and
 * does NOT flip Site.status to FAILED. Policy failures only set
 * Site.scrapingPolicyStatus = CHECK_FAILED.
 */

import { prisma } from "../../src/lib/prisma";
import type { WorkerJob, Site } from "../../src/generated/prisma/client";
import type { ScrapingPolicyStatus } from "../../src/generated/prisma/client";
import { launchBrowser, createPage, closeBrowser } from "../lib/playwright";
import type { Browser } from "playwright";
import { fetchRobots } from "../policy/robots";
import { discoverPolicyUrls, fetchPolicyPage } from "../policy/discover";
import { extractPolicyText } from "../policy/extract";
import { extractDocumentText } from "../policy/extractDocument";
import { getPolicyDocumentType } from "../policy/keywords";
import { classifyPolicy } from "../policy/classify";
import { emitWorkerEvent } from "../lib/emitEvent";

const MAX_POLICY_PAGES = parseInt(process.env.MAX_POLICY_PAGES_PER_SITE || "4", 10);
const JOB_TIMEOUT_MS = parseInt(process.env.MAX_POLICY_FETCH_SECONDS || "120", 10) * 1_000;

export async function handlePolicyReviewJob(
  job: WorkerJob,
  site: Site,
): Promise<Record<string, unknown>> {
  console.info(`[policy] Starting policy review for site: ${site.siteUrl}`);

  const reviewSource = (job.payload as Record<string, unknown> | null)?.reviewSource as string | undefined;

  return withTimeout(
    runPolicyReview(job, site, reviewSource ?? "direct_discovery"),
    JOB_TIMEOUT_MS,
    site,
  );
}

// ---------------------------------------------------------------------------
// Core review pipeline
// ---------------------------------------------------------------------------

async function runPolicyReview(
  job: WorkerJob,
  site: Site,
  reviewSource: string,
): Promise<Record<string, unknown>> {
  let browser: Browser | null = null;

  try {
    // 1. robots.txt (no browser needed)
    const robots = await fetchRobots(site.siteUrl);
    console.info("[policy] robots.txt:", {
      siteUrl: site.siteUrl,
      checked: robots.checked,
      disallowsAll: robots.disallowsAll,
      relevantRules: robots.relevantRules.length,
      sitemaps: robots.sitemapUrls.length,
    });

    // 2. Launch browser + navigate to site
    browser = await launchBrowser();
    const { page } = await createPage(browser);

    let navError: string | undefined;
    try {
      await page.goto(site.siteUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch (err) {
      navError = err instanceof Error ? err.message : String(err);
      console.warn("[policy] Homepage navigation failed:", { siteUrl: site.siteUrl, error: navError });
    }

    // 3. Discover policy page URLs
    const discovered = navError
      ? []
      : await discoverPolicyUrls(site.siteUrl, page, robots.sitemapUrls, MAX_POLICY_PAGES);

    console.info("[policy] discovered URLs:", {
      siteUrl: site.siteUrl,
      count: discovered.length,
      urls: discovered.map((d) => d.url),
    });

    const discoveredUrls = discovered.map((d) => d.url);

    // 4. Fetch and extract text from each policy page
    const policyTexts: Array<{ url: string; text: string; docType: string }> = [];
    const reviewedUrls: string[] = [];

    for (const candidate of discovered) {
      const documentType = getPolicyDocumentType(candidate.url);

      let cleanedText: string;
      let finalUrl = candidate.url;

      if (documentType) {
        // PDF / Word policy: fetch the file into memory and extract its text
        // (no Playwright navigation — the browser can't read binary docs).
        const doc = await extractDocumentText(candidate.url, documentType);
        if (doc.error || !doc.cleanedText) {
          console.warn("[policy] Failed to extract policy document:", {
            url: candidate.url,
            docType: documentType,
            error: doc.error,
          });
          continue;
        }
        cleanedText = doc.cleanedText;
      } else {
        // Ordinary HTML policy page.
        const { html, finalUrl: fetchedUrl, error } = await fetchPolicyPage(candidate.url, page);
        if (error || !html) {
          console.warn("[policy] Failed to fetch policy page:", { url: candidate.url, error });
          continue;
        }
        finalUrl = fetchedUrl;
        cleanedText = extractPolicyText(html).cleanedText;
      }

      if (cleanedText.trim().length < 100) {
        console.warn("[policy] Policy text too short, skipping:", { url: candidate.url });
        continue;
      }

      reviewedUrls.push(finalUrl);
      policyTexts.push({
        url: finalUrl,
        text: cleanedText,
        docType: inferDocType(candidate.url),
      });
    }

    // 5. LLM classification
    const classification = await classifyPolicy(
      policyTexts.map(({ url, text }) => ({ url, text })),
      site.siteUrl,
    );

    // 6. Apply robots nudge (config-gated, default on)
    const robotsInfluences = process.env.ROBOTS_INFLUENCES_STATUS !== "false";
    let finalStatus = classification.status;
    let shortReason = classification.short_reason;

    if (
      robotsInfluences &&
      robots.checked &&
      robots.disallowsAll &&
      finalStatus === "NO_EXPLICIT_RESTRICTION"
    ) {
      finalStatus = "UNCLEAR_NEEDS_REVIEW";
      shortReason = `${shortReason} (robots.txt broadly disallows crawling)`.trim().slice(0, 300);
      console.info("[policy] robots nudge applied: NO_EXPLICIT_RESTRICTION → UNCLEAR_NEEDS_REVIEW", {
        siteUrl: site.siteUrl,
      });
    }

    const prismaStatus = finalStatus as ScrapingPolicyStatus;

    // 7. Persist audit row + denormalize onto Site
    const storedCleanedText = policyTexts.map((p) => `[${p.url}]\n${p.text}`).join("\n\n---\n\n").slice(0, 20_000);

    await prisma.$transaction([
      prisma.scrapingPolicyReview.create({
        data: {
          siteId: site.id,
          status: prismaStatus,
          isScrapingRestricted: classification.is_scraping_restricted,
          requiresWrittenPermission: classification.requires_written_permission,
          confidence: classification.confidence,
          language: classification.language,
          shortReason,
          matchedTerms: classification.matched_terms,
          evidenceSnippets: classification.evidence_snippets as never,
          reviewedUrls,
          discoveredUrls,
          reviewedDocTypes: policyTexts.map((p) => p.docType),
          cleanedText: storedCleanedText,
          llmResultJson: (classification.raw_json ?? null) as never,
          pagesChecked: policyTexts.length,
          reviewSource,
          robotsChecked: robots.checked,
          robotsDisallowsAll: robots.disallowsAll ?? false,
          robotsRelevantRules: robots.relevantRules,
          errorMessage: classification.error ?? null,
          model: process.env.POLICY_REVIEW_MODEL || "gpt-4o-mini",
        },
      }),
      prisma.site.update({
        where: { id: site.id },
        data: {
          scrapingPolicyStatus: prismaStatus,
          scrapingPolicyCheckedAt: new Date(),
        },
      }),
    ]);

    // 8. Emit SSE
    await emitWorkerEvent({
      type: "policy:checked",
      payload: {
        siteId: site.id,
        status: finalStatus,
        pagesChecked: policyTexts.length,
      },
    });

    console.info("[policy] Review complete:", {
      siteUrl: site.siteUrl,
      status: finalStatus,
      confidence: classification.confidence,
      pagesChecked: policyTexts.length,
    });

    return {
      status: finalStatus,
      confidence: classification.confidence,
      pagesChecked: policyTexts.length,
      reviewedUrls,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[policy] Unexpected error:", { siteUrl: site.siteUrl, error: errorMessage });

    // Record failure without throwing
    await recordFailure(site.id, errorMessage, "direct_discovery");
    await emitWorkerEvent({
      type: "policy:checked",
      payload: { siteId: site.id, status: "CHECK_FAILED" },
    });

    return { status: "CHECK_FAILED", error: errorMessage };
  } finally {
    if (browser) {
      await closeBrowser(browser).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function recordFailure(siteId: string, errorMessage: string, reviewSource: string) {
  try {
    await prisma.$transaction([
      prisma.scrapingPolicyReview.create({
        data: {
          siteId,
          status: "CHECK_FAILED",
          errorMessage: errorMessage.slice(0, 1000),
          reviewSource,
          pagesChecked: 0,
          matchedTerms: [],
          reviewedUrls: [],
          discoveredUrls: [],
          reviewedDocTypes: [],
          robotsRelevantRules: [],
        },
      }),
      prisma.site.update({
        where: { id: siteId },
        data: {
          scrapingPolicyStatus: "CHECK_FAILED",
          scrapingPolicyCheckedAt: new Date(),
        },
      }),
    ]);
  } catch (e) {
    console.error("[policy] Failed to record failure:", e);
  }
}

function inferDocType(url: string): string {
  const lower = url.toLowerCase();
  let base = "unknown";
  if (lower.includes("privacy")) base = "privacy";
  else if (lower.includes("term") || lower.includes("takanon")) base = "terms";
  else if (lower.includes("legal")) base = "legal";

  // Append the file format when the policy is a downloadable document so the
  // audit row distinguishes e.g. "terms_pdf" from an HTML "terms" page.
  const format = getPolicyDocumentType(url);
  return format ? `${base}_${format}` : base;
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  site: Site,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Policy review timed out after ${ms / 1000}s`));
    }, ms);

    promise
      .then((v) => { clearTimeout(timer); resolve(v); })
      .catch((e) => { clearTimeout(timer); reject(e); });
  }).catch(async (err) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn("[policy] Timeout or unhandled error:", { siteUrl: site.siteUrl, error: errorMessage });
    await recordFailure(site.id, errorMessage, "direct_discovery");
    await emitWorkerEvent({
      type: "policy:checked",
      payload: { siteId: site.id, status: "CHECK_FAILED" },
    });
    return { status: "CHECK_FAILED", error: errorMessage } as unknown as T;
  });
}
