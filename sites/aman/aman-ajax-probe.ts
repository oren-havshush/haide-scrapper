import { chromium } from 'playwright';

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  await p.goto('https://www.aman.co.il/careers/all/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

  const ctx1 = await p.evaluate(() => ({
    ajax_url: (window as any).AMAN_CATEGORIES?.ajax_url || null,
    category: (window as any).AMAN_CATEGORIES?.category || null,
  }));
  console.log('AMAN_CATEGORIES:', JSON.stringify(ctx1));

  const ajaxResult = await p.evaluate(async (cfg) => {
    const body = new URLSearchParams();
    body.append('action', 'data_fetch');
    body.append('s', '');
    if (cfg.category) body.append('category', String(cfg.category));
    const r = await fetch(cfg.ajax_url || '/wp-admin/admin-ajax.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
      body: body.toString(),
    });
    const ct = r.headers.get('content-type') || '';
    const text = await r.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch {}
    let articleCount = 0;
    let firstTitles: string[] = [];
    if (parsed && typeof parsed.applications === 'string') {
      const m = parsed.applications.match(/<article[^>]*class="[^"]*positions_page__application/g);
      articleCount = m ? m.length : 0;
      const titles = parsed.applications.match(/positions_page__application-header-title[^>]*>([^<]+)/g);
      if (titles) firstTitles = titles.slice(0, 5).map((t: string) => t.replace(/.*>/, '').trim());
    }
    return { status: r.status, ct, len: text.length, head: text.slice(0, 600), articleCount, applicationsLen: parsed?.applications?.length || 0, firstTitles };
  }, ctx1);
  console.log('AJAX response:');
  console.log('  status:', ajaxResult.status, 'ct:', ajaxResult.ct, 'len:', ajaxResult.len);
  console.log('  applications-html length:', ajaxResult.applicationsLen);
  console.log('  article count in returned HTML:', ajaxResult.articleCount);
  console.log('  first titles:', ajaxResult.firstTitles);
  console.log('  raw head:', ajaxResult.head.slice(0, 300));

  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
