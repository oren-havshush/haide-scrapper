import { chromium } from "playwright";

const URL = "https://www.one1.co.il/careers";

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const p = await (await b.newContext({ locale: "he-IL" })).newPage();
  await p.addInitScript(
    'if(typeof __name==="undefined"){globalThis.__name=function(fn){return fn}}',
  );
  await p.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForTimeout(2000);

  const item = (await p.$$(".accordion_item"))[1];
  const urls: string[] = [];
  p.on("response", (r) => {
    if (/admin-ajax|career|job|wp-json|one1/i.test(r.url())) urls.push(r.url());
  });

  await item.$eval("a.accordion_title", (el) => (el as HTMLElement).click());
  for (let wait of [500, 1000, 2000, 4000]) {
    await p.waitForTimeout(wait);
    const snap = await item.evaluate((el) => {
      const c = el.querySelector(".accordion_content .content");
      return {
        wait,
        classes: el.className,
        contentLen: c ? (c.textContent ?? "").replace(/\s+/g, " ").trim().length : -1,
        drishotLen: (el.querySelector(".accordion_content .drishot")?.textContent ?? "")
          .replace(/\s+/g, " ")
          .trim().length,
        contentHtmlLen: c?.innerHTML.length ?? 0,
        hasContentDiv: !!c,
      };
    });
    console.log(JSON.stringify(snap));
  }
  console.log("XHR URLs:", urls.slice(0, 20));
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
