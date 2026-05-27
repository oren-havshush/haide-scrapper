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
    extraHTTPHeaders: {
      'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8',
    },
  });

  const p = await ctx.newPage();
  const consoleMsgs: { type: string; text: string }[] = [];
  const pageErrors: string[] = [];
  const failedReqs: { url: string; failure: string }[] = [];
  const allReqs: { url: string; status: number; type: string }[] = [];

  p.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text().slice(0, 300) }));
  p.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 400)));
  p.on('requestfailed', (r) => failedReqs.push({ url: r.url(), failure: r.failure()?.errorText || 'unknown' }));
  p.on('response', (r) => {
    const u = r.url();
    if (u.includes('cellcom') || u.includes('episerver') || u.includes('incapsula') || u.includes('glassbox') || u.includes('gbqofs')) {
      allReqs.push({ url: u, status: r.status(), type: r.request().resourceType() });
    }
  });

  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await p.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(8000);

  const containerStatus = await p.evaluate(() => {
    const c = document.getElementById('epi-page-container');
    return {
      exists: !!c,
      childCount: c ? c.children.length : -1,
      title: document.title,
      prerenderReady: (window as any).prerenderReady,
      readyState: document.readyState,
      scriptsLoaded: Array.from(document.querySelectorAll('script[src]')).map(s => (s as HTMLScriptElement).src).filter(s => s.includes('Spa') || s.includes('cellcom')).slice(0, 10),
    };
  });

  console.log(JSON.stringify({
    containerStatus,
    pageErrors,
    consoleMsgs: consoleMsgs.slice(0, 50),
    failedReqs: failedReqs.slice(0, 20),
    requestsByStatus: allReqs.slice(0, 40),
  }, null, 2));

  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
