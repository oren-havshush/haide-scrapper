import { chromium } from "playwright";

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

    var ac = el.querySelector('.accordion_content');
    if (!ac) return;

    var content = ac.querySelector('.content');
    if (!content) {
      content = document.createElement('div');
      content.className = 'content';
      ac.appendChild(content);
    }
    var drishot = ac.querySelector('.drishot');
    if (!drishot) {
      drishot = document.createElement('div');
      drishot.className = 'drishot';
      ac.appendChild(drishot);
    }

    var contentText = (content.textContent || '').replace(/\\s+/g, ' ').trim();
    var drishotText = (drishot.textContent || '').replace(/\\s+/g, ' ').trim();
    if (contentText && drishotText) return;

    var ps = Array.from(ac.querySelectorAll('p'));
    var descParts = [];
    var reqParts = [];
    var inReq = false;
    ps.forEach(function (p) {
      var t = (p.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!t) return;
      if (/דרישות(?:\\s+התפקיד)?\\s*:/i.test(t)) {
        inReq = true;
        var afterReq = t.split(/דרישות(?:\\s+התפקיד)?\\s*:/i)[1];
        if (afterReq && afterReq.trim()) reqParts.push(afterReq.trim());
        return;
      }
      if (/תיאור(?:\\s+התפקיד)?\\s*:/i.test(t)) {
        var afterDesc = t.split(/תיאור(?:\\s+התפקיד)?\\s*:/i)[1];
        if (afterDesc && afterDesc.trim()) descParts.push(afterDesc.trim());
        return;
      }
      if (/^יתרון/i.test(t)) {
        reqParts.push(t);
        return;
      }
      if (inReq) reqParts.push(t);
      else descParts.push(t);
    });

    if (!contentText && descParts.length) {
      content.textContent = descParts.join('\\n');
    }
    if (!drishotText && reqParts.length) {
      drishot.textContent = reqParts.join('\\n');
    }
  });
  } catch (e) {}
})();`;

(async () => {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const p = await (await b.newContext({ locale: "he-IL" })).newPage();
  await p.goto("https://www.one1.co.il/careers", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(2000);
  for (let i = 0; i < 30; i++) {
    const btn = await p.$("#load-more-jobs");
    if (!btn || !(await btn.evaluate((el) => (el as HTMLElement).offsetParent !== null))) break;
    await btn.click().catch(() => {});
    await p.waitForTimeout(1200);
  }
  await p.evaluate(SETUP_SCRIPT);

  const failures = await p.evaluate(() => {
    const out: Array<{
      title: string;
      descLen: number;
      reqLen: number;
      pCount: number;
      acTextLen: number;
      hasContentEl: boolean;
      hasDrishotEl: boolean;
      firstPs: string[];
      acHtml: string;
    }> = [];
    document.querySelectorAll(".accordion_item").forEach((item) => {
      const title = (item.querySelector(".accordion_title")?.textContent ?? "").trim().slice(0, 60);
      const ac = item.querySelector(".accordion_content");
      const d = item.querySelector(".accordion_content .content");
      const r = item.querySelector(".accordion_content .drishot");
      const descLen = (d?.textContent ?? "").replace(/\s+/g, " ").trim().length;
      const reqLen = (r?.textContent ?? "").replace(/\s+/g, " ").trim().length;
      if (descLen > 20 && reqLen > 10) return;
      const ps = ac ? Array.from(ac.querySelectorAll("p")) : [];
      out.push({
        title,
        descLen,
        reqLen,
        pCount: ps.length,
        acTextLen: (ac?.textContent ?? "").replace(/\s+/g, " ").trim().length,
        hasContentEl: !!ac?.querySelector(".content"),
        hasDrishotEl: !!ac?.querySelector(".drishot"),
        firstPs: ps.slice(0, 5).map((p) => (p.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120)),
        acHtml: (ac?.innerHTML ?? "").slice(0, 400),
      });
    });
    return out;
  });

  console.log("FAILURES:", failures.length);
  for (const f of failures.slice(0, 15)) {
    console.log(JSON.stringify(f, null, 2));
  }
  await b.close();
})();
