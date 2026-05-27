import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8' },
  });
  const p = await ctx.newPage();

  const xhrs: { url: string; status: number; size?: number }[] = [];
  p.on('response', async (r) => {
    const u = r.url();
    if (u.includes('cellcom') && (u.includes('api') || u.includes('jobs') || u.includes('career') || u.includes('content'))) {
      try {
        const len = r.headers()['content-length'];
        xhrs.push({ url: u, status: r.status(), size: len ? Number(len) : undefined });
      } catch {}
    }
  });

  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await p.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  // Wait until SPA hydrates
  await p.waitForFunction(() => (window as any).prerenderReady === true, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(4000);

  // Auto-scroll to surface any lazy-loaded items
  for (let i = 0; i < 6; i++) {
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p.waitForTimeout(1200);
  }

  const html = await p.content();
  fs.writeFileSync(path.resolve('.scratch', 'scrap-page.html'), html);

  const bodyTextHead = await p.evaluate(() => (document.body?.innerText || '').slice(0, 6000));

  const summary = await p.evaluate(() => {
    const stats: Record<string, { count: number; sampleClass: string; parentTag: string }> = {};
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (!el.parentElement || !el.classList.length) continue;
      const sig = el.tagName + '|' + Array.from(el.classList).sort().join('.');
      const key = el.parentElement.tagName + ' > ' + sig;
      if (!stats[key]) stats[key] = { count: 0, sampleClass: Array.from(el.classList).join(' '), parentTag: el.parentElement.tagName };
      stats[key].count++;
    }
    return Object.entries(stats)
      .filter(([_, v]) => v.count >= 3 && v.count <= 500)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 25)
      .map(([sig, v]) => ({ sig, ...v }));
  });

  console.log(JSON.stringify({ htmlBytes: html.length, bodyTextHead, summary, cellcomXhrs: xhrs.slice(0, 30) }, null, 2));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
