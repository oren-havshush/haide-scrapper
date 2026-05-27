import { chromium } from "playwright";

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const p = await (await b.newContext()).newPage();
  await p.goto("https://www.one1.co.il/careers", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(2000);
  for (let i = 0; i < 30; i++) {
    const btn = await p.$("#load-more-jobs");
    if (!btn || !(await btn.evaluate((el) => (el as HTMLElement).offsetParent !== null))) break;
    await btn.click().catch(() => {});
    await p.waitForTimeout(1200);
  }
  const out = await p.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".accordion_item"));
    let hasContentEl = 0;
    let hasDrishotEl = 0;
    let contentEmpty = 0;
    let bothMissing = 0;
    for (const item of items) {
      const c = item.querySelector(".accordion_content .content");
      const d = item.querySelector(".accordion_content .drishot");
      if (c) hasContentEl++;
      else bothMissing++;
      if (d) hasDrishotEl++;
      if (c && !(c.textContent || "").trim()) contentEmpty++;
    }
    const sample = items.find((it) => !(it.querySelector(".accordion_content .content")?.textContent || "").trim());
    return {
      total: items.length,
      hasContentEl,
      hasDrishotEl,
      contentEmpty,
      bothMissing,
      sampleHtml: sample?.querySelector(".accordion_content")?.innerHTML.slice(0, 1500) ?? null,
    };
  });
  console.log(JSON.stringify(out, null, 2));
  await b.close();
})();
