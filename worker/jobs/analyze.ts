import { prisma } from "../../src/lib/prisma";
import type { WorkerJob, Site } from "../../src/generated/prisma/client";
import { launchBrowser, createPage, closeBrowser } from "../lib/playwright";
import type { Browser, Page } from "playwright";
import { analyzeWithPatternMatching } from "../analysis/patternMatch";
import { analyzeWithCrawlClassify } from "../analysis/crawlClassify";
import { analyzeWithNetworkIntercept } from "../analysis/networkIntercept";
import { combineAnalysisResults } from "../analysis/combineResults";
import { CONFIDENCE_THRESHOLD } from "../../src/lib/constants";
import { emitWorkerEvent } from "../lib/emitEvent";

async function navigateWithFallback(page: Page, siteUrl: string): Promise<void> {
  try {
    await page.goto(siteUrl, {
      waitUntil: "networkidle",
      timeout: 45_000,
    });
  } catch (error) {
    console.warn("[worker] networkidle navigation failed, retrying with domcontentloaded:", {
      siteUrl,
      error: error instanceof Error ? error.message : String(error),
    });

    await page.goto(siteUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  }

  // Wait for the page to actually render meaningful content (SPAs need this)
  try {
    await page.waitForFunction(
      () => {
        const body = document.body;
        if (!body) return false;
        const textLen = (body.innerText || "").trim().length;
        const childCount = body.querySelectorAll("*").length;
        return textLen > 100 && childCount > 20;
      },
      { timeout: 15_000 },
    );
  } catch {
    console.warn("[worker] Page did not render substantial content within 15s, proceeding anyway:", siteUrl);
  }
}

async function patchEvaluateRuntime(page: Page): Promise<void> {
  // tsx/esbuild can inject __name(...) in function strings used by page.evaluate.
  // Install a no-op helper in page context before any evaluate calls.
  await page.addInitScript(() => {
    (globalThis as { __name?: <T>(fn: T) => T }).__name = <T>(fn: T) => fn;
  });
}

export async function handleAnalysisJob(
  job: WorkerJob,
  site: Site,
): Promise<Record<string, unknown>> {
  console.info(`[worker] Starting analysis for site: ${site.siteUrl}`);

  let browser: Browser | null = null;

  try {
    browser = await launchBrowser();
    const { page } = await createPage(browser);
    await patchEvaluateRuntime(page);

    // Navigate to the site
    let pageTitle = "Navigation failed";
    try {
      await navigateWithFallback(page, site.siteUrl);
      pageTitle = await page.title();
    } catch (navError) {
      console.warn(`[worker] Navigation failed for ${site.siteUrl}:`, navError);
      // Navigation failure -- site may be unreachable
      // Create results with zero confidence for BOTH methods and mark site as FAILED
      await prisma.analysisResult.create({
        data: {
          siteId: site.id,
          method: "PATTERN_MATCH",
          fieldMappings: {},
          confidenceScores: {},
          overallConfidence: 0.0,
        },
      });

      await prisma.analysisResult.create({
        data: {
          siteId: site.id,
          method: "CRAWL_CLASSIFY",
          fieldMappings: {},
          confidenceScores: {},
          overallConfidence: 0.0,
        },
      });

      await prisma.analysisResult.create({
        data: {
          siteId: site.id,
          method: "NETWORK_INTERCEPT",
          fieldMappings: {},
          confidenceScores: {},
          overallConfidence: 0.0,
        },
      });

      await prisma.site.update({
        where: { id: site.id },
        data: {
          status: "FAILED",
          failedAt: new Date(),
          confidenceScore: 0.0,
        },
      });
      await emitWorkerEvent({
        type: "site:status-changed",
        payload: { siteId: site.id, status: "FAILED" },
      });

      return {
        pageTitle: "Navigation failed",
        methods: {
          patternMatch: { confidence: 0.0, fieldsDetected: [], itemCount: 0 },
          crawlClassify: {
            confidence: 0.0,
            fieldsDetected: [],
            crawledPages: [],
            detailPagePattern: null,
          },
          networkIntercept: {
            confidence: 0.0,
            fieldsDetected: [],
            apiEndpoint: null,
            capturedEndpoints: 0,
          },
        },
        combined: {
          overallConfidence: 0.0,
          fieldsDetected: [],
          methodContributions: {},
          listingSelector: null,
          itemSelector: null,
          itemCount: 0,
          apiEndpoint: null,
          detailPagePattern: null,
        },
        error: navError instanceof Error ? navError.message : String(navError),
      };
    }

    console.info(`[worker] Page loaded: "${pageTitle}" for ${site.siteUrl}`);

    // --- Run pattern matching analysis ---
    const patternResult = await analyzeWithPatternMatching(page, site.siteUrl);

    console.info("[worker] Pattern matching complete:", {
      siteUrl: site.siteUrl,
      overallConfidence: patternResult.overallConfidence,
      fieldsDetected: Object.keys(patternResult.fieldMappings),
      itemCount: patternResult.itemCount,
    });

    await prisma.analysisResult.create({
      data: {
        siteId: site.id,
        method: "PATTERN_MATCH",
        fieldMappings: patternResult.fieldMappings,
        confidenceScores: patternResult.confidenceScores,
        overallConfidence: patternResult.overallConfidence,
      },
    });

    // --- Navigate back to original URL before crawl/classify ---
    try {
      await navigateWithFallback(page, site.siteUrl);
    } catch (navError) {
      console.warn("[worker] Failed to navigate back for crawl/classify:", {
        siteUrl: site.siteUrl,
        error: navError instanceof Error ? navError.message : String(navError),
      });
      // Continue anyway -- crawl/classify will handle its own navigation
    }

    // --- Run crawl/classify analysis ---
    const crawlResult = await analyzeWithCrawlClassify(page, site.siteUrl);

    console.info("[worker] Crawl/classify complete:", {
      siteUrl: site.siteUrl,
      overallConfidence: crawlResult.overallConfidence,
      fieldsDetected: Object.keys(crawlResult.fieldMappings),
      crawledPages: crawlResult.crawledPages,
    });

    await prisma.analysisResult.create({
      data: {
        siteId: site.id,
        method: "CRAWL_CLASSIFY",
        fieldMappings: crawlResult.fieldMappings,
        confidenceScores: crawlResult.confidenceScores,
        overallConfidence: crawlResult.overallConfidence,
      },
    });

    // --- Navigate back to original URL for network interception ---
    try {
      await navigateWithFallback(page, site.siteUrl);
    } catch (navError) {
      console.warn("[worker] Failed to navigate back for network interception:", {
        siteUrl: site.siteUrl,
        error: navError instanceof Error ? navError.message : String(navError),
      });
      // Continue anyway -- network interception will handle its own navigation
    }

    // --- Run network interception analysis ---
    const networkResult = await analyzeWithNetworkIntercept(page, site.siteUrl);

    console.info("[worker] Network interception complete:", {
      siteUrl: site.siteUrl,
      overallConfidence: networkResult.overallConfidence,
      fieldsDetected: Object.keys(networkResult.fieldMappings),
      apiEndpoint: networkResult.apiEndpoint,
      capturedEndpoints: networkResult.capturedEndpoints,
    });

    await prisma.analysisResult.create({
      data: {
        siteId: site.id,
        method: "NETWORK_INTERCEPT",
        fieldMappings: networkResult.fieldMappings,
        confidenceScores: networkResult.confidenceScores,
        overallConfidence: networkResult.overallConfidence,
        apiEndpoint: networkResult.apiEndpoint,
      },
    });

    // --- Combine all three analysis results ---
    const combinedResult = combineAnalysisResults([
      { method: "PATTERN_MATCH", ...patternResult },
      { method: "CRAWL_CLASSIFY", ...crawlResult, detailPagePattern: crawlResult.detailPagePattern },
      { method: "NETWORK_INTERCEPT", ...networkResult, apiEndpoint: networkResult.apiEndpoint },
    ]);

    console.info("[worker] Combined analysis result:", {
      siteUrl: site.siteUrl,
      overallConfidence: combinedResult.overallConfidence,
      fieldsDetected: Object.keys(combinedResult.fieldMappings),
      methodContributions: combinedResult.methodContributions,
    });

    // Both high and low confidence sites go to REVIEW status
    // (admin sees them all, sorted by confidence -- story 3-1 handles the review queue view)
    const confidencePercent = combinedResult.overallConfidence * 100;

    if (confidencePercent >= CONFIDENCE_THRESHOLD) {
      console.info("[worker] Site meets confidence threshold, routing to REVIEW:", {
        siteUrl: site.siteUrl,
        confidence: combinedResult.overallConfidence,
        threshold: CONFIDENCE_THRESHOLD,
      });
    } else {
      console.warn("[worker] Site below confidence threshold, routing to REVIEW (low confidence):", {
        siteUrl: site.siteUrl,
        confidence: combinedResult.overallConfidence,
        threshold: CONFIDENCE_THRESHOLD,
      });
    }

    // Both cases route to REVIEW -- the confidence score stored on the Site
    // record allows the review queue to sort/filter by confidence level
    await prisma.site.update({
      where: { id: site.id },
      data: {
        status: "REVIEW",
        reviewAt: new Date(),
        confidenceScore: combinedResult.overallConfidence,
        fieldMappings: combinedResult.fieldMappings,
      },
    });

    // Emit SSE events for analysis completion and status change
    await emitWorkerEvent({
      type: "analysis:completed",
      payload: { siteId: site.id, confidence: combinedResult.overallConfidence },
    });
    await emitWorkerEvent({
      type: "site:status-changed",
      payload: { siteId: site.id, status: "REVIEW" },
    });

    return {
      pageTitle,
      methods: {
        patternMatch: {
          confidence: patternResult.overallConfidence,
          fieldsDetected: Object.keys(patternResult.fieldMappings),
          itemCount: patternResult.itemCount,
        },
        crawlClassify: {
          confidence: crawlResult.overallConfidence,
          fieldsDetected: Object.keys(crawlResult.fieldMappings),
          crawledPages: crawlResult.crawledPages,
          detailPagePattern: crawlResult.detailPagePattern,
        },
        networkIntercept: {
          confidence: networkResult.overallConfidence,
          fieldsDetected: Object.keys(networkResult.fieldMappings),
          apiEndpoint: networkResult.apiEndpoint,
          capturedEndpoints: networkResult.capturedEndpoints,
        },
      },
      combined: {
        overallConfidence: combinedResult.overallConfidence,
        fieldsDetected: Object.keys(combinedResult.fieldMappings),
        methodContributions: combinedResult.methodContributions,
        listingSelector: combinedResult.listingSelector,
        itemSelector: combinedResult.itemSelector,
        itemCount: combinedResult.itemCount,
        apiEndpoint: combinedResult.apiEndpoint,
        detailPagePattern: combinedResult.detailPagePattern,
      },
    };
  } finally {
    await closeBrowser(browser);
  }
}
