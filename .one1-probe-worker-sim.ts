import { chromium } from "playwright";

const URL = "https://www.one1.co.il/careers";
const SETUP_SCRIPT = `(function () {
  try {
    document.querySelectorAll('.accordion_item').forEach(function (el) {
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

function textLen(el: import("playwright").ElementHandle<Element> | null): Promise<number> {
  if (!el) return Promise.resolve(0);
  return el.evaluate((node) =>
    (node.textContent ?? "").replace(/\s+/g, " ").trim().length,
  );
}

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const p = await (await b.newContext({ locale: "he-IL" })).newPage();
  await p.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(1500);
  for (let i = 0; i < 30; i++) {
    const btn = await p.$("#load-more-jobs");
    if (!btn) break;
    const ok = await btn.evaluate((el) => (el as HTMLElement).offsetParent !== null);
    if (!ok) break;
    await btn.click().catch(() => {});
    await p.waitForTimeout(1200);
  }
  await p.evaluate(SETUP_SCRIPT);

  const items = await p.$$(".accordion_item");
  let okBefore = 0;
  let okAfterJobTitle = 0;
  let okAfterAccordionTitle = 0;
  const samples: Array<Record<string, unknown>> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const title = await item
      .$eval(".job_title", (el) => (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60))
      .catch(() => "");

    const descSel = ".accordion_content .content";
    const before = await textLen(await item.$(descSel));
    if (before > 20) okBefore++;

    const jt = await item.$(".job_title");
    if (jt) {
      await jt.click().catch(() => {});
      await p.waitForTimeout(300);
    }
    const afterJT = await textLen(await item.$(descSel));
    if (afterJT > 20) okAfterJobTitle++;

    const at = await item.$("a.accordion_title");
    if (at) {
      await at.click().catch(() => {});
      await p.waitForTimeout(300);
    }
    const afterAT = await textLen(await item.$(descSel));
    if (afterAT > 20) okAfterAccordionTitle++;

    if (samples.length < 8 && before <= 20) {
      samples.push({ idx: i, title, before, afterJT, afterAT });
    }
  }

  console.log(
    JSON.stringify(
      {
        total: items.length,
        okBefore,
        okAfterJobTitle,
        okAfterAccordionTitle,
        samples,
      },
      null,
      2,
    ),
  );
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
