import { chromium } from "playwright";

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const p = await (await b.newContext({ locale: "he-IL" })).newPage();
  const hits: Array<{ url: string; method: string; status: number; body?: string }> = [];
  p.on("response", async (r) => {
    const url = r.url();
    if (!/one1|admin-ajax|wp-json|career|job/i.test(url)) return;
    let body = "";
    try {
      const ct = r.headers()["content-type"] || "";
      if (ct.includes("json") || ct.includes("text")) {
        body = (await r.text()).slice(0, 500);
      }
    } catch {
      /* ignore */
    }
    hits.push({ url, method: r.request().method(), status: r.status(), body });
  });

  await p.goto("https://www.one1.co.il/careers", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(2000);
  const item = (await p.$$(".accordion_item"))[1];
  await item.$eval("a.accordion_title", (el) => (el as HTMLElement).click());
  await p.waitForTimeout(5000);

  const after = await item.evaluate((el) => ({
    classes: el.className,
    descLen: (el.querySelector(".accordion_content .content")?.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim().length,
    drishotLen: (el.querySelector(".accordion_content .drishot")?.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim().length,
    htmlSnippet: el.querySelector(".accordion_content")?.innerHTML.slice(0, 800) ?? null,
  }));

  console.log("AFTER:", JSON.stringify(after, null, 2));
  console.log("NETWORK:", JSON.stringify(hits, null, 2));
  await b.close();
})();
