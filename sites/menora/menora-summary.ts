import { chromium } from 'playwright';
import * as path from 'path';

(async () => {
  // Re-use the persistent context that already has the bypass cookies.
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
  await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await p.waitForTimeout(2000);

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
      .filter(([_, v]) => v.count >= 3 && v.count <= 500)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 25)
      .map(([sig, v]) => ({ sig, ...v }));
  });
  console.log(JSON.stringify({ summary, title: await p.title() }, null, 2));
  await ctx.close();
})().catch(e => { console.error(e); process.exit(1); });
