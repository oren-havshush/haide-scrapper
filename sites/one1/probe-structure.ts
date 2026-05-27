import { chromium } from "playwright";

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const p = await (await b.newContext()).newPage();
  await p.goto("https://www.one1.co.il/careers", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(2000);

  const items = await p.$$(".accordion_item");
  const collapsedIdx = 1;
  const expandedIdx = 0;

  async function inspect(item: import("playwright").ElementHandle<Element>, label: string) {
    const out = await item.evaluate((el) => {
      const ac = el.querySelector(".accordion_content");
      return {
        contentDivLen: (ac?.querySelector(".content")?.textContent ?? "")
          .trim().length,
        drishotLen: (ac?.querySelector(".drishot")?.textContent ?? "")
          .trim().length,
        pCount: ac?.querySelectorAll("p").length ?? 0,
        acTextLen: (ac?.textContent ?? "").replace(/\s+/g, " ").trim().length,
        acPreview: (ac?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 250),
      };
    });
    console.log(label, JSON.stringify(out));
  }

  await inspect(items[collapsedIdx], "COLLAPSED before click");
  const at = await items[collapsedIdx].$("a.accordion_title");
  if (at) await at.click();
  await p.waitForTimeout(1500);
  await inspect(items[collapsedIdx], "COLLAPSED after click");

  await inspect(items[expandedIdx], "PRE-EXPANDED item 0");
  await b.close();
})();
