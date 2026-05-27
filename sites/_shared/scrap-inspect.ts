import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  const p = await ctx.newPage();

  let nilooRequestBody: string | null = null;
  p.on('request', (req) => {
    if (req.url().includes('niloo-server.herokuapp.com')) {
      nilooRequestBody = req.postData();
    }
  });

  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForSelector('.MuiCard-root', { timeout: 25000 });
  await p.waitForTimeout(3000);

  // Dump the first card's outerHTML
  const firstCard = await p.evaluate(() => {
    const c = document.querySelector('.MuiCard-root');
    return c ? c.outerHTML : null;
  });
  fs.writeFileSync(path.resolve('.scratch', 'card-first.html'), firstCard || '');

  // Total cards count
  const cardCount = await p.locator('.MuiCard-root').count();

  // Find an anchor pointing to a detail page
  const links = await p.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.MuiCard-root')).slice(0, 5);
    return cards.map((c, i) => {
      const anchors = Array.from(c.querySelectorAll('a')).map((a) => ({
        href: (a as HTMLAnchorElement).href,
        text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      }));
      const title = c.querySelector('h3')?.textContent?.trim() || null;
      const dataAttrs: Record<string, string> = {};
      for (const attr of (c as HTMLElement).attributes) {
        dataAttrs[attr.name] = attr.value;
      }
      return { i, title, anchors, dataAttrs };
    });
  });

  console.log('cardCount:', cardCount);
  console.log('nilooRequestBody:', nilooRequestBody);
  console.log('links sample:', JSON.stringify(links, null, 2));

  // Look at pagination controls
  const pagination = await p.evaluate(() => {
    const pgEls = Array.from(document.querySelectorAll('[class*=Pagin], nav[aria-label*=pagination], nav[aria-label*=page]'));
    return pgEls.map((e) => ({
      tag: e.tagName,
      cls: (e as HTMLElement).className,
      text: ((e as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    }));
  });
  console.log('pagination controls:', JSON.stringify(pagination, null, 2));

  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
