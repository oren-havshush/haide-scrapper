import { chromium } from "playwright";

const URL = "https://www.one1.co.il/careers";

const SETUP_SCRIPT = `(function () {
  try {
    var items = document.querySelectorAll('.accordion_item');
    items.forEach(function (el) {
      el.querySelectorAll('.career-tag-list noscript').forEach(function (n) { n.remove(); });
      var lis = el.querySelectorAll('.career-tag-list > li');
      if (lis.length >= 1 && !el.querySelector('[data-extracted-jobtype]')) {
        var s1 = document.createElement('span');
        s1.setAttribute('data-extracted-jobtype', '1');
        s1.style.display = 'none';
        s1.textContent = (lis[0].textContent || '').replace(/\\s+/g, ' ').trim();
        el.appendChild(s1);
      }
      if (lis.length >= 2 && !el.querySelector('[data-extracted-location]')) {
        var s2 = document.createElement('span');
        s2.setAttribute('data-extracted-location', '1');
        s2.style.display = 'none';
        s2.textContent = (lis[1].textContent || '').replace(/\\s+/g, ' ').trim();
        el.appendChild(s2);
      }
    });
  } catch (e) {}
})();`;

async function countMatches(page: import("playwright").Page) {
  return page.evaluate(() => {
    const items = document.querySelectorAll(".accordion_item");
    let descMatch = 0;
    let reqMatch = 0;
    for (const item of items) {
      if (item.querySelector(".accordion_content .content")) descMatch++;
      if (item.querySelector(".accordion_content .drishot")) reqMatch++;
    }
    const first = items[0] as HTMLElement | undefined;
    return {
      itemCount: items.length,
      descMatch,
      reqMatch,
      firstDescLen: first
        ? (first.querySelector(".accordion_content .content")?.textContent ?? "")
            .trim().length
        : 0,
      firstReqLen: first
        ? (first.querySelector(".accordion_content .drishot")?.textContent ?? "")
            .trim().length
        : 0,
      firstClasses: first?.className ?? null,
      clickable: first
        ? Array.from(
            first.querySelectorAll(
              "button, [role=button], .accordion_title, .job_title, .accordion_header, [class*='accordion'], [class*='toggle']",
            ),
          )
            .slice(0, 15)
            .map((el) => ({
              tag: el.tagName,
              class: (el as HTMLElement).className,
              text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
            }))
        : [],
    };
  });
}

(async () => {
  const b = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--lang=he-IL"],
  });
  const ctx = await b.newContext({
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
  });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(2000);

  await p.evaluate(SETUP_SCRIPT);
  await p.waitForTimeout(500);

  console.log("BEFORE:", JSON.stringify(await countMatches(p), null, 2));

  const clickTargets = [
    ".job_title",
    ".accordion_title",
    ".accordion_item .job_title",
    ".accordion_header",
    ".accordion_item > div:first-child",
    "button",
  ];

  for (const sel of clickTargets) {
    const el = await p.$(".accordion_item " + sel);
    if (!el) {
      console.log("NO ELEMENT for", sel);
      continue;
    }
    await el.click().catch(() => {});
    await p.waitForTimeout(400);
    const stats = await countMatches(p);
    console.log("AFTER CLICK", sel, JSON.stringify(stats, null, 2));
  }

  // Simulate worker per-item reveal click on all items
  await p.evaluate(async () => {
    const items = document.querySelectorAll(".accordion_item");
    for (const item of items) {
      const title = item.querySelector(".job_title") as HTMLElement | null;
      if (title) {
        title.click();
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  });
  console.log(
    "AFTER ALL .job_title CLICKS:",
    JSON.stringify(await countMatches(p), null, 2),
  );

  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
