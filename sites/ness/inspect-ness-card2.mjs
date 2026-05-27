import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = 'https://www.ness-tech.co.il/careers/';

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await p.waitForSelector('.card-job-container', { timeout: 15000 });
  await p.waitForTimeout(1500);

  const out = await p.evaluate(() => {
    const cards = document.querySelectorAll('.card-job-container');
    const samples = [];
    for (let i = 0; i < Math.min(3, cards.length); i++) {
      const c = cards[i];
      const liList = Array.from(c.querySelectorAll(':scope > ul > li'));
      const liInfo = liList.map((li, idx) => ({
        idx,
        tag: li.tagName,
        roleAttr: li.getAttribute('role'),
        childrenTags: Array.from(li.children).map(ch => ch.tagName + (ch.className ? '.' + String(ch.className).split(/\s+/).slice(0,2).join('.') : '')),
        text: (li.textContent || '').replace(/\s+/g, ' ').trim(),
      }));
      const buttons = Array.from(c.querySelectorAll('button')).map(btn => ({
        text: (btn.textContent || '').replace(/\s+/g, ' ').trim(),
        aria: btn.getAttribute('aria-label'),
        data: Array.from(btn.attributes).filter(a => a.name.startsWith('data-')).map(a => `${a.name}=${a.value}`),
        outerHTML: btn.outerHTML.slice(0, 400),
      }));
      const anchors = Array.from(c.querySelectorAll('a')).map(a => ({
        href: a.getAttribute('href'),
        text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      }));
      const dataAttrs = Array.from(c.attributes).filter(a => a.name.startsWith('data-')).map(a => `${a.name}=${a.value}`);
      const appLocation = c.querySelector('app-location');
      samples.push({
        idx: i,
        liInfo,
        buttons,
        anchors,
        dataAttrs,
        appLocationHTML: appLocation ? appLocation.outerHTML.slice(0, 500) : null,
        cardId: c.getAttribute('id'),
        cardOuterHTMLLen: c.outerHTML.length,
        cardInnerText: (c.innerText || '').slice(0, 300),
      });
    }
    return { total: cards.length, samples };
  });

  const outPath = path.join(os.tmpdir(), 'ness-card2.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log('wrote: ' + outPath + ' (' + fs.statSync(outPath).size + ' bytes)');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
