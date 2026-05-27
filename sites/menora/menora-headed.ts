import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const url = process.argv[2];
  // Use a real persistent context with a normal-looking user agent and channel.
  // Many anti-bot stacks (Radware/ShieldSquare included) check for navigator.webdriver,
  // viewport sizes, and language/timezone consistency. Headed mode + persistent context
  // sets webdriver=undefined and looks much more legitimate.
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
  // Strip the webdriver flag just in case Chromium leaks it.
  await ctx.addInitScript(() => {
    try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch (e) {}
  });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  // Mimic human dwell, then nudge mouse, then wait more — gives Radware time to clear.
  await p.waitForTimeout(2500);
  await p.mouse.move(300, 400);
  await p.mouse.move(600, 500, { steps: 12 });
  await p.waitForTimeout(3500);

  const html = await p.content();
  const isCaptcha = /Radware\s+Captcha|PerfDrive|shieldsquare|hcaptcha/i.test(html) && html.length < 60000;
  const outPath = path.resolve('.scratch', 'menora-page.html');
  fs.writeFileSync(outPath, html);
  console.log(JSON.stringify({ outPath, htmlBytes: html.length, looksLikeCaptcha: isCaptcha, title: await p.title() }, null, 2));
  await ctx.close();
})().catch(e => { console.error(e); process.exit(1); });
