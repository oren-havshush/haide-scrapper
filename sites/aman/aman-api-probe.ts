import { chromium } from 'playwright';

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  await p.goto('https://www.aman.co.il/careers/all/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

  // Probe candidate endpoints from the page context (so cookies/CSRF if any are present)
  const candidates = [
    '/wp-json/',
    '/wp-json/wp/v2/types',
    '/wp-json/wp/v2/positions?per_page=200',
    '/wp-json/wp/v2/position?per_page=200',
    '/wp-json/wp/v2/jobs?per_page=200',
    '/wp-json/wp/v2/careers?per_page=200',
    '/wp-json/wp/v2/career?per_page=200',
    '/wp-json/wp/v2/aman-position?per_page=200',
    '/wp-admin/admin-ajax.php?action=positions',
    '/wp-admin/admin-ajax.php?action=get_positions',
    '/wp-admin/admin-ajax.php?action=aman_positions',
  ];

  for (const path of candidates) {
    const out = await p.evaluate(async (url) => {
      try {
        const r = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        const ct = r.headers.get('content-type') || '';
        const txt = await r.text();
        return { status: r.status, ct, len: txt.length, head: txt.slice(0, 400) };
      } catch (e: any) {
        return { status: -1, ct: '', len: 0, head: String(e?.message || e) };
      }
    }, path);
    console.log(`${out.status} ${path}  ct=${out.ct} len=${out.len}`);
    if (out.status === 200 && out.len > 50 && !out.head.includes('<html')) {
      console.log('   sample:', out.head.replace(/\n/g, ' ').slice(0, 240));
    }
  }

  // Inspect what aman-careers--positions.js does — does it call any AJAX?
  console.log('\n--- contents of aman-careers--positions.js (first 4000 chars) ---');
  const js = await p.evaluate(async () => {
    const r = await fetch('/wp-content/themes/aman-careers/assets/scripts/aman-careers--positions.js?ver=1.0.40-22');
    return await r.text();
  });
  console.log(js.slice(0, 4000));

  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
