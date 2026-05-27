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

async function stats(page: import("playwright").Page) {
  return page.evaluate(() => {
    const items = document.querySelectorAll(".accordion_item");
    let desc = 0;
    let req = 0;
    let descText = 0;
    for (const item of items) {
      const d = item.querySelector(".accordion_content .content");
      const r = item.querySelector(".accordion_content .drishot");
      if (d) desc++;
      if (r) req++;
      if (d && (d.textContent ?? "").trim().length > 20) descText++;
    }
    return { items: items.length, descEl: desc, reqEl: req, descWithText: descText };
  });
}

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const p = await (await b.newContext({ locale: "he-IL" })).newPage();
  await p.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(1500);

  // load all jobs
  for (let i = 0; i < 30; i++) {
    const btn = await p.$("#load-more-jobs");
    if (!btn) break;
    const visible = await btn.evaluate((el) => {
      const e = el as HTMLElement;
      return e.offsetParent !== null && !e.classList.contains("disabled");
    });
    if (!visible) break;
    await btn.click().catch(() => {});
    await p.waitForTimeout(1200);
  }

  await p.evaluate(SETUP_SCRIPT);
  console.log("AFTER LOAD MORE:", JSON.stringify(await stats(p)));

  // per-item reveal like worker (.job_title)
  await p.evaluate(async () => {
    const items = document.querySelectorAll(".accordion_item");
    for (const item of items) {
      const reveal =
        item.querySelector(".job_title") ??
        item.querySelector(".accordion_title");
      if (reveal) {
        (reveal as HTMLElement).click();
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  });
  console.log("AFTER PER-ITEM REVEAL:", JSON.stringify(await stats(p)));

  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
