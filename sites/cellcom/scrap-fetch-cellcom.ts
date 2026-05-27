import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: {
      'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'sec-ch-ua': '"Chromium";v="123", "Not.A/Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'upgrade-insecure-requests': '1',
    },
  });

  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const p = await ctx.newPage();
  const apiCalls: { url: string; status?: number; size?: number }[] = [];
  p.on('response', async (r) => {
    const u = r.url();
    if (u.includes('cellcom') && (u.includes('/api/') || u.includes('Career') || u.includes('jobs') || u.includes('content'))) {
      try {
        const headers = r.headers();
        const len = headers['content-length'] ? Number(headers['content-length']) : undefined;
        apiCalls.push({ url: u, status: r.status(), size: len });
      } catch {}
    }
  });

  const resp = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => {
    console.error('goto error:', e.message);
    return null;
  });
  const status = resp?.status();
  await p.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  // Wait up to 30s for the epi-page-container to have children (SPA's own readiness signal)
  const renderedAt = await p.waitForFunction(
    () => {
      const c = document.getElementById('epi-page-container');
      return !!(c && c.children.length > 0) ? Date.now() : false;
    },
    null,
    { timeout: 30000, polling: 500 }
  ).then((r) => r.jsonValue()).catch(() => null);

  // Extra settle
  await p.waitForTimeout(3000);

  const html = await p.content();
  const outPath = path.resolve('.scratch', 'scrap-page.html');
  fs.writeFileSync(outPath, html);

  const bodyTextHead = await p.evaluate(() => (document.body?.innerText || '').slice(0, 4000));
  const lower = html.toLowerCase();
  const blocked = ['just a moment', 'cf-challenge', 'cloudflare', 'access denied', 'captcha', 'reblaze', '403 forbidden', 'akamai', 'incapsula challenge']
    .filter((m) => lower.includes(m));

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

  console.log(JSON.stringify({ status, blocked, htmlBytes: html.length, htmlPath: outPath, renderedAt: renderedAt ? 'rendered' : 'TIMEOUT', bodyTextHead, summary, apiCallsSeen: apiCalls.slice(0, 30) }, null, 2));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
