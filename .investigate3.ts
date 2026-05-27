import { chromium } from 'playwright';

const URL = 'https://www.tikshoov.co.il/come-work-with-us/careers-list/?areaID=&jobType=';

const UAs: { label: string; ua: string }[] = [
  {
    label: 'worker default (Win Chrome 120)',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
  {
    label: 'modern Win Chrome 137',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  },
  {
    label: 'modern macOS Chrome 137',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  },
  {
    label: 'default playwright headless (works)',
    ua: '',
  },
];

(async () => {
  const b = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
      '--disable-blink-features=AutomationControlled', '--lang=he-IL',
    ],
  });

  const out: any[] = [];
  for (const variant of UAs) {
    const ctx = await b.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: variant.ua || undefined,
      locale: 'he-IL',
      timezoneId: 'Asia/Jerusalem',
      extraHTTPHeaders: { 'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'languages', { get: () => ['he-IL', 'he', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });
    const p = await ctx.newPage();
    let status: number | undefined;
    try {
      const resp = await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      status = resp?.status();
    } catch (e) {
      status = -1;
    }
    await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(1500);
    const stats: { jobBoxes: number; bodySnippet: string; hasIncap: boolean } = await p.evaluate(() => ({
      jobBoxes: document.querySelectorAll('.jobBox-wrapper').length,
      bodySnippet: ((document.body || document.documentElement).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140),
      hasIncap: /Incapsula incident/i.test(document.documentElement.outerHTML || ''),
    }));
    out.push({ ...variant, status, ...stats });
    await ctx.close();
  }
  console.log(JSON.stringify(out, null, 2));
  await b.close();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
