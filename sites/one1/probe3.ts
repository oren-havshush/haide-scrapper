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

async function loadAll(p: import("playwright").Page) {
  for (let i = 0; i < 15; i++) {
    const btn = await p.$("#load-more-jobs");
    if (!btn) break;
    const ok = await btn.evaluate((el) => {
      const e = el as HTMLElement;
      return e.offsetParent !== null && !e.classList.contains("disabled");
    });
    if (!ok) break;
    await btn.click().catch(() => {});
    await p.waitForTimeout(800);
  }
  await p.evaluate(SETUP_SCRIPT);
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

  const strategies = [
    { name: "dom .job_title", sel: ".job_title", pw: false },
    { name: "dom .accordion_title", sel: ".accordion_title", pw: false },
    { name: "dom a.accordion_title", sel: "a.accordion_title", pw: false },
    { name: "pw .job_title", sel: ".job_title", pw: true },
    { name: "pw a.accordion_title", sel: "a.accordion_title", pw: true },
  ];

  for (const strat of strategies) {
    await p.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await loadAll(p);

    let ok = 0;
    let fail = 0;
    const items = await p.$$(".accordion_item");
    for (const item of items) {
      if (strat.pw) {
        const reveal = await item.$(strat.sel);
        if (reveal) await reveal.click({ timeout: 2000 }).catch(() => {});
      } else {
        await item.evaluate((node, sel) => {
          const el = (node as Element).querySelector(sel) as HTMLElement | null;
          el?.click();
        }, strat.sel);
      }
      await p.waitForTimeout(250);
      const len = await item.evaluate((node) => {
        const el = (node as Element).querySelector(".accordion_content .content");
        return (el?.textContent ?? "").trim().length;
      });
      if (len > 20) ok++;
      else fail++;
    }
    console.log(strat.name, JSON.stringify({ total: items.length, ok, fail }));
  }

  await p.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await loadAll(p);
  const collapsedSample = await p.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".accordion_item"));
    const collapsed = items.find((item) => {
      const desc = item.querySelector(".accordion_content .content");
      return !desc || (desc.textContent ?? "").trim().length < 20;
    });
    if (!collapsed) return null;
    return {
      classes: collapsed.className,
      htmlLen: collapsed.innerHTML.length,
      hasContentDiv: !!collapsed.querySelector(".accordion_content"),
      contentDisplay: collapsed.querySelector(".accordion_content")
        ? getComputedStyle(collapsed.querySelector(".accordion_content")!).display
        : null,
      contentChildCount: collapsed.querySelector(".accordion_content")?.children.length ?? 0,
      contentHtmlPreview: (collapsed.querySelector(".accordion_content")?.innerHTML ?? "").slice(
        0,
        500,
      ),
      titleText: (collapsed.querySelector(".job_title")?.textContent ?? "").trim().slice(0, 80),
    };
  });
  console.log("COLLAPSED SAMPLE:", JSON.stringify(collapsedSample, null, 2));

  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
