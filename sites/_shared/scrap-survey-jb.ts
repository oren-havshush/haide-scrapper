import { chromium } from 'playwright';

(async () => {
  const urls = [
    'https://www.unitask-inc.com/%d7%9e%d7%a4%d7%aa%d7%97-oracle-applications/',
    'https://www.unitask-inc.com/%d7%91%d7%95%d7%93%d7%a7-%d7%aa-%d7%aa%d7%95%d7%9b%d7%a0%d7%94/',
    'https://www.unitask-inc.com/%d7%9e%d7%aa%d7%9b%d7%a0%d7%aa-%d7%aa-node-js/',
    'https://www.unitask-inc.com/%d7%9e%d7%a4%d7%aa%d7%97-%d7%aa-ios/',
    'https://www.unitask-inc.com/dba-%d7%aa%d7%a9%d7%aa%d7%99%d7%95%d7%aa-big-data/',
    'https://www.unitask-inc.com/jb-1314/',
    'https://www.unitask-inc.com/jb-1506/',
    'https://www.unitask-inc.com/jb-1385/',
  ];
  const b = await chromium.launch({ headless: true });
  const p = await (await b.newContext({ locale: 'he-IL' })).newPage();

  const out: any[] = [];
  for (const url of urls) {
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const info = await p.evaluate(`(() => {
      const headings = Array.from(document.querySelectorAll('article h1, article h2, article h3, article h4'))
        .map(function(h){return (h.textContent || '').trim();})
        .filter(function(t){return t && t.length;});
      const allText = (document.querySelector('article') || document.body).textContent || '';
      const m = allText.match(/JB-(\\d+)/i);
      const jbInText = m ? ('JB-' + m[1]) : null;
      // Location: find <strong>מיקום ג*אוגרפי
      var locVal = null;
      var paras = document.querySelectorAll('article p');
      for (var i = 0; i < paras.length; i++) {
        var pp = paras[i];
        var strong = pp.querySelector('strong');
        if (!strong) continue;
        if (/\\u05de\\u05d9\\u05e7\\u05d5\\u05dd\\s*\\u05d2\\u05d9?\\u05d0\\u05d5\\u05d2\\u05e8\\u05e4\\u05d9/.test(strong.textContent || '')) {
          var clone = pp.cloneNode(true);
          var s = clone.querySelector('strong');
          if (s) s.remove();
          locVal = (clone.textContent || '').replace(/[:\\s\\u00A0]+/g, ' ').trim().replace(/^["'\\s]+|["'\\s]+$/g, '');
          break;
        }
      }
      return { headings: headings, jbInText: jbInText, locVal: locVal };
    })()`);
    out.push({ url, ...(info as any) });
  }
  console.log(JSON.stringify(out, null, 2));
  await b.close();
})();
