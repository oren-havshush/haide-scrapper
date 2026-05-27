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
      content = document.createElement('motion');
      content.className = 'content';
      ac.appendChild(content);
    }
    var drishot = ac.querySelector('.drishot');
    if (!drishot) {
      drishot = document.createElement('motion');
      drishot.className = 'drishot';
      ac.appendChild(drishot);
    }

    var contentText = (content.textContent || '').replace(/\\s+/g, ' ').trim();
    var drishotText = (drishot.textContent || '').replace(/\\s+/g, ' ').trim();
    if (contentText.length > 20 && drishotText.length > 10) return;

    var clone = ac.cloneNode(true);
    clone.querySelectorAll('.content, .drishot, .accordion_content_img, noscript, img').forEach(function (n) { n.remove(); });

    var descParts = [];
    var reqParts = [];
    var mode = null;

    function isFooter(t) {
      return /המשרה פונה לנשים וגברים/i.test(t);
    }

    function headerType(t) {
      var s = t.replace(/\\s+/g, ' ').trim();
      if (/^(?:🔹\\s*)?(?:תיאור(?:\\s+(?:התפקיד|תפקיד))?|מה\\s+(?:ב|ה)תפקיד|תחומי\\s+אחריות)/i.test(s)) return 'desc';
      if (/^(?:🔹\\s*)?(?:דרישות(?:\\s+(?:התפקיד|המשרה|סף|חובה))?|יתרון)/i.test(s)) return 'req';
      if (/^מה\\s+התפקיד\\s+כולל/i.test(s)) return 'desc';
      return null;
    }

    function pushInline(modeName, t) {
      var rest = t.replace(/^[^:]*:\\s*/, '').trim();
      if (rest.length > 3) {
        if (modeName === 'desc') descParts.push(rest);
        else reqParts.push(rest);
      }
    }

    function handleInlineCombined(t) {
      if (/תיאור/i.test(t) && /דרישות/i.test(t)) {
        var m = t.match(/(?:תיאור[^:]*:|מה[^:]*:)\\s*([\\s\\S]*?)\\s*(?:דרישות[^:]*:|דרישות\\s+סף[^:]*:|דרישות\\s+חובה[^:]*:)\\s*([\\s\\S]*)/i);
        if (m) {
          if (m[1].trim()) descParts.push(m[1].trim());
          if (m[2].trim()) reqParts.push(m[2].trim());
          mode = 'req';
          return true;
        }
      }
      if (/דרישות(?:\\s+(?:המשרה|התפקיד|סף|חובה))?\\s*:/i.test(t) && !/^דרישות/i.test(t)) {
        var parts = t.split(/דרישות(?:\\s+(?:המשרה|התפקיד|סף|חובה))?\\s*:/i);
        var before = parts[0].replace(/^.*?תיאור[^:]*:\\s*/i, '').trim();
        if (before) descParts.push(before);
        if (parts[1] && parts[1].trim()) reqParts.push(parts[1].trim());
        mode = 'req';
        return true;
      }
      return false;
    }

    var nodes = Array.from(clone.querySelectorAll('h3,h4,h5,p,li')).filter(function (node) {
      return !(node.tagName === 'P' && node.closest('li'));
    });

    nodes.forEach(function (node) {
      var t = (node.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!t || isFooter(t)) return;
      if (handleInlineCombined(t)) return;

      var ht = headerType(t);
      if (ht) {
        mode = ht;
        pushInline(ht, t);
        if (t.replace(/[^:]*:\\s*/, '').trim().length < 5) return;
        return;
      }

      if (node.tagName === 'P' && /^תיאור/i.test(t) && t.length < 30) { mode = 'desc'; return; }
      if (node.tagName === 'P' && /^דרישות/i.test(t) && t.length < 40) { mode = 'req'; return; }

      if (mode === 'req') reqParts.push(t);
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
})();`.replace(/createElement\('motion'\)/g, "createElement('div')");

async function stats(page: import("playwright").Page) {
  return page.evaluate(() => {
    const items = document.querySelectorAll(".accordion_item");
    let desc = 0;
    let req = 0;
    for (const item of items) {
      const d = item.querySelector(".accordion_content .content");
      const r = item.querySelector(".accordion_content .drishot");
      if (d && (d.textContent ?? "").replace(/\s+/g, " ").trim().length > 20) desc++;
      if (r && (r.textContent ?? "").replace(/\s+/g, " ").trim().length > 10) req++;
    }
    return { items: items.length, desc, req };
  });
}

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
  console.log("BEFORE:", await stats(p));
  await p.evaluate(SETUP_SCRIPT);
  console.log("AFTER:", await stats(p));
  await b.close();
})();
