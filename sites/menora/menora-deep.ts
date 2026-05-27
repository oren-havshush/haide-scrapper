import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const userDataDir = path.resolve('.scratch', 'menora-userdata');
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    viewport: { width: 1366, height: 820 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  await ctx.addInitScript(() => {
    try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch (e) {}
  });
  const p = await ctx.newPage();

  // Capture XHR/fetch URLs to spot the jobs API if one exists.
  const xhrs: { url: string; status: number; ctype: string }[] = [];
  p.on('response', async (r) => {
    try {
      const u = r.url();
      const rt = r.request().resourceType();
      if (rt === 'xhr' || rt === 'fetch') {
        xhrs.push({ url: u, status: r.status(), ctype: r.headers()['content-type'] || '' });
      }
    } catch {}
  });

  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await p.mouse.move(300, 400);
  await p.mouse.move(600, 500, { steps: 12 });
  await p.waitForTimeout(3000);

  const title1 = await p.title();
  console.log('after first wait, title:', title1);

  // Try to dismiss the Adoric overlay if present.
  await p.evaluate(() => {
    document.querySelectorAll('.__ADORIC__').forEach(el => (el as HTMLElement).remove());
  });

  // Scroll a bit to trigger lazy loaders.
  await p.evaluate(() => window.scrollTo(0, 600));
  await p.waitForTimeout(2000);
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(3000);

  const html = await p.content();
  const outPath = path.resolve('.scratch', 'menora-page-deep.html');
  fs.writeFileSync(outPath, html);

  // Try a few likely item selectors and report counts so we can pick one.
  const probes = await p.evaluate(() => {
    const cands = [
      '[data-cy*="job"]',
      '[class*="job-item"]',
      '[class*="JobItem"]',
      '[class*="position"]',
      '[class*="Position"]',
      '[class*="vacancy"]',
      '[class*="Vacancy"]',
      'article',
      '.card',
      'li > a[href*="/job"]',
      'a[href*="/job-posting/"]',
      'a[href*="/position"]',
      '[role="article"]',
      '[role="listitem"]',
    ];
    return cands.map(s => ({ sel: s, n: document.querySelectorAll(s).length }))
      .filter(r => r.n >= 1)
      .sort((a, b) => b.n - a.n);
  });

  // Structural summary on what's currently rendered.
  const summary = await p.evaluate(() => {
    const stats: Record<string, { count: number; sampleClass: string; parentTag: string }> = {};
    const all = document.querySelectorAll('*');
    for (const el of Array.from(all)) {
      if (!el.parentElement || !el.classList.length) continue;
      const sig = el.tagName + '|' + Array.from(el.classList).sort().join('.');
      const key = el.parentElement.tagName + ' > ' + sig;
      if (!stats[key]) stats[key] = { count: 0, sampleClass: Array.from(el.classList).join(' '), parentTag: el.parentElement.tagName };
      stats[key].count++;
    }
    return Object.entries(stats)
      .filter(([_, v]) => v.count >= 5 && v.count <= 300)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 25)
      .map(([sig, v]) => ({ sig, ...v }));
  });

  console.log(JSON.stringify({
    title: await p.title(),
    htmlBytes: html.length,
    outPath,
    xhrPreview: xhrs.slice(0, 25),
    probes,
    summary,
  }, null, 2));
  await ctx.close();
})().catch(e => { console.error(e); process.exit(1); });
