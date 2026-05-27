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
    let descMatch = 0;
    let reqMatch = 0;
    let collapsedNoDesc = 0;
    for (const item of items) {
      const hasDesc = !!item.querySelector(".accordion_content .content");
      const hasReq = !!item.querySelector(".accordion_content .drishot");
      if (hasDesc) descMatch++;
      if (hasReq) reqMatch++;
      const open =
        item.classList.contains("item_active") ||
        item.classList.contains("open") ||
        !!item.querySelector(".open");
      if (!open && !hasDesc) collapsedNoDesc++;
    }
    return { itemCount: items.length, descMatch, reqMatch, collapsedNoDesc };
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
  await p.waitForTimeout(1500);

  // load more like worker
  for (let i = 0; i < 15; i++) {
    const btn = await p.$("#load-more-jobs");
    if (!btn) break;
    const visible = await btn.evaluate((el) => {
      const e = el as HTMLElement;
      return e.offsetParent !== null && !e.classList.contains("disabled");
    });
    if (!visible) break;
    await btn.click().catch(() => {});
    await p.waitForTimeout(800);
  }

  await p.evaluate(SETUP_SCRIPT);
  console.log("AFTER LOAD MORE:", JSON.stringify(await stats(p), null, 2));

  // simulate worker: per item click .job_title then check THAT item only
  const perItem = await p.evaluate(async () => {
    const items = document.querySelectorAll(".accordion_item");
    let ok = 0;
    let fail = 0;
    for (const item of items) {
      const title = item.querySelector(".job_title") as HTMLElement | null;
      if (title) title.click();
      await new Promise((r) => setTimeout(r, 250));
      const desc = item.querySelector(".accordion_content .content");
      const textLen = (desc?.textContent ?? "").trim().length;
      if (textLen > 20) ok++;
      else fail++;
    }
    return { total: items.length, ok, fail };
  });
  console.log("PER-ITEM REVEAL .job_title:", JSON.stringify(perItem, null, 2));

  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
