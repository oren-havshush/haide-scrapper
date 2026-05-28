// Bezeq WAF probe — three permutations from the SAME host the worker runs on.
//
// Run from the worker host (Render Frankfurt):
//   pnpm tsx sites/bezeq/probe.ts
//
// Reads navigator.userAgent FROM the bundled Chromium to construct a self-
// consistent UA + Sec-CH-UA pair for permutation 2 (Client-Hints mismatch
// is itself a WAF signal — see worker/lib/playwright.ts lines 70-78).
//
// Outcomes:
//   - "bare" succeeds            → worker is fine on this site today (skip browserOverrides).
//   - "bare" fails, "real-ua" or "windows-chrome" succeeds → UA-fixable.
//                                    Copy the winning {userAgent, extraHeaders}
//                                    into the site config's browserOverrides.
//   - All three fail             → TLS- or IP-level block. Needs proxyUrl (Phase 3).

import { chromium, type BrowserContextOptions } from "playwright";

const URL = "https://www.bezeq.co.il/career_new/";
const WIN_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const WIN_CHROME_HEADERS: Record<string, string> = {
  "accept-language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-encoding": "gzip, deflate, br, zstd",
  "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "upgrade-insecure-requests": "1",
};

interface ProbeResult {
  label: string;
  status: number | null;
  finalUrl: string | null;
  ua: string | null;
  challenged: boolean;
  bodyBytes: number;
  bodyPreview: string;
  navError: string | null;
  elapsedMs: number;
}

async function tryPermutation(
  label: string,
  ctxOpts: BrowserContextOptions,
): Promise<ProbeResult> {
  const t0 = Date.now();
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
      "--lang=he-IL",
    ],
  });

  try {
    const context = await browser.newContext({
      locale: "he-IL",
      timezoneId: "Asia/Jerusalem",
      viewport: { width: 1280, height: 800 },
      ...ctxOpts,
    });
    const page = await context.newPage();

    let resp = null;
    let navError: string | null = null;
    try {
      resp = await page.goto(URL, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page
        .waitForLoadState("networkidle", { timeout: 8_000 })
        .catch(() => {});
    } catch (e) {
      navError = (e as Error).message.split("\n")[0]?.slice(0, 200) ?? "(unknown)";
    }

    const html = navError ? "" : await page.content().catch(() => "");
    const challenged =
      /just a moment|cf-mitigated|reblaze|access denied|attention required|incapsula incident|enable javascript and cookies/i.test(
        html,
      );
    const bodyPreview = navError
      ? ""
      : await page
          .evaluate(() =>
            (document.body?.textContent || "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 200),
          )
          .catch(() => "");
    const ua = await page
      .evaluate(() => navigator.userAgent)
      .catch(() => null);

    return {
      label,
      status: resp?.status() ?? null,
      finalUrl: resp?.url() ?? null,
      ua,
      challenged,
      bodyBytes: html.length,
      bodyPreview,
      navError,
      elapsedMs: Date.now() - t0,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

function deriveSecChUaFromVersion(majorVersion: string): string {
  return `"Chromium";v="${majorVersion}", "Not_A Brand";v="24"`;
}

(async () => {
  // ---- 1. Bare context (mirrors worker default).
  const bare = await tryPermutation("1-bare-worker-parity", {});

  // ---- 2. Bundled Chromium's real UA + matching Sec-CH-UA.
  //   Read the actual UA from a throwaway page, strip "Headless", and
  //   extract the major version so the Client-Hints header matches.
  const inspectBrowser = await chromium.launch({ headless: true });
  const inspectPage = await (await inspectBrowser.newContext()).newPage();
  const realUARaw = await inspectPage.evaluate(() => navigator.userAgent);
  await inspectBrowser.close().catch(() => {});

  const realUA = realUARaw.replace(/HeadlessChrome/i, "Chrome");
  const chromeVersionMatch = realUA.match(/Chrome\/(\d+)/);
  const chromeMajor = chromeVersionMatch?.[1] ?? "131";

  const realUAPerm = await tryPermutation("2-real-bundled-chromium-ua", {
    userAgent: realUA,
    extraHTTPHeaders: {
      "accept-language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
      "sec-ch-ua": deriveSecChUaFromVersion(chromeMajor),
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Linux"', // worker runs on Linux containers
    },
  });

  // ---- 3. The exact UA + headers that worked from Windows during onboarding.
  const winChromePerm = await tryPermutation("3-windows-chrome-131", {
    userAgent: WIN_CHROME_UA,
    extraHTTPHeaders: WIN_CHROME_HEADERS,
  });

  const all = [bare, realUAPerm, winChromePerm];
  console.log(JSON.stringify(all, null, 2));

  const successful = (r: ProbeResult) =>
    !r.navError && (r.status ?? 0) >= 200 && (r.status ?? 0) < 400 && !r.challenged;

  console.log("\n=== SUMMARY ===");
  for (const r of all) {
    console.log(
      `  ${r.label}: status=${r.status ?? "ERR"} challenged=${r.challenged} bodyBytes=${r.bodyBytes} ${successful(r) ? "OK" : "FAIL"} (${r.elapsedMs}ms)${r.navError ? "  err=" + r.navError : ""}`,
    );
  }

  if (successful(bare)) {
    console.log(
      "\nVERDICT: Worker default already works on bezeq. No browserOverrides needed.",
    );
    return;
  }

  const winner = successful(realUAPerm)
    ? realUAPerm
    : successful(winChromePerm)
      ? winChromePerm
      : null;

  if (!winner) {
    console.log(
      "\nVERDICT: All three permutations failed. NOT UA-fixable — needs Phase 3 (per-site proxyUrl) with an IL-egress proxy.",
    );
    process.exit(2);
  }

  console.log(
    `\nVERDICT: UA-fixable. Use the "${winner.label}" UA + headers as the site's browserOverrides.`,
  );
  console.log("Recommended browserOverrides payload:");
  const recommended =
    winner === realUAPerm
      ? {
          userAgent: realUA,
          extraHeaders: {
            "sec-ch-ua": deriveSecChUaFromVersion(chromeMajor),
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Linux"',
          },
        }
      : { userAgent: WIN_CHROME_UA, extraHeaders: WIN_CHROME_HEADERS };
  console.log(JSON.stringify(recommended, null, 2));
})().catch((e) => {
  console.error("PROBE ERROR:", e);
  process.exit(1);
});
