// Smoke test: load the patched worker playwright module and confirm
// tikshoov listing returns 200 + 120 items.

import { launchBrowser, createPage, closeBrowser } from "./worker/lib/playwright";

const URL =
  "https://www.tikshoov.co.il/come-work-with-us/careers-list/?areaID=&jobType=";

(async () => {
  // Ensure no leftover env is forcing a UA
  delete process.env.SCRAPE_USER_AGENT;

  const browser = await launchBrowser();
  try {
    const { page } = await createPage(browser);
    const resp = await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log("http status:", resp?.status());
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const probe = await page.evaluate(`(function(){
      var hasIncap = /Incapsula incident/i.test(document.documentElement.outerHTML || '');
      return {
        jobBoxes: document.querySelectorAll('.jobBox-wrapper').length,
        bodyPreview: ((document.body || document.documentElement).textContent || '').replace(/\\s+/g,' ').trim().slice(0, 140),
        hasIncap: hasIncap,
        ua: navigator.userAgent
      };
    })()`);
    console.log(JSON.stringify(probe, null, 2));

    if ((probe as { hasIncap: boolean }).hasIncap || (probe as { jobBoxes: number }).jobBoxes === 0) {
      console.error("SMOKE FAIL: still blocked or no items");
      process.exit(1);
    }
    console.log("SMOKE OK");
  } finally {
    await closeBrowser(browser);
  }
})().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
