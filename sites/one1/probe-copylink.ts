import { chromium } from "playwright";

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const p = await (await b.newContext({ locale: "he-IL" })).newPage();
  await p.goto("https://www.one1.co.il/careers", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(2000);
  const links = await p.evaluate(() =>
    Array.from(document.querySelectorAll(".copylink"))
      .slice(0, 5)
      .map((el) => ({
        tag: el.tagName,
        href: el.getAttribute("href"),
        dataUrl: el.getAttribute("data-url"),
        class: (el as HTMLElement).className,
      })),
  );
  console.log(JSON.stringify(links, null, 2));
  await b.close();
})();
