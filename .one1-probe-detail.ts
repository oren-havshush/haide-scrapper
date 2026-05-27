import { chromium } from "playwright";

const DETAIL = "https://www.one1.co.il/careers/?job_id=2394"; // empty on listing scrape

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const p = await (await b.newContext({ locale: "he-IL" })).newPage();
  await p.addInitScript(
    'if(typeof __name==="undefined"){globalThis.__name=function(fn){return fn}}',
  );
  await p.goto(DETAIL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForTimeout(2500);

  const probe = await p.evaluate(() => {
    const sel = (s: string) => {
      const el = document.querySelector(s);
      if (!el) return { matched: false };
      return {
        matched: true,
        textLen: (el.textContent ?? "").replace(/\s+/g, " ").trim().length,
        preview: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      };
    };
    return {
      url: location.href,
      title: document.title,
      desc: sel(".accordion_content .content"),
      req: sel(".accordion_content .drishot"),
      activeItems: document.querySelectorAll(".accordion_item.item_active").length,
      jobTitle: sel(".job_title"),
      allContentDivs: Array.from(document.querySelectorAll(".content"))
        .slice(0, 5)
        .map((el) => ({
          class: (el as HTMLElement).className,
          len: (el.textContent ?? "").replace(/\s+/g, " ").trim().length,
          parent: el.parentElement?.className ?? null,
        })),
    };
  });
  console.log(JSON.stringify(probe, null, 2));
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
