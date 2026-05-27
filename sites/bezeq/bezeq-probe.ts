import { chromium } from 'playwright';
import * as fs from 'fs';

(async () => {
  const url = 'https://www.bezeq.co.il/career_new/';
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const p = await ctx.newPage();

  const reqs: { method: string; url: string; type: string; status?: number }[] = [];
  p.on('response', async (r) => {
    const u = r.url();
    if (/\/api\/|\/wp-json\/|\/_next\/data\/|graphql|positions|careers|jobs?\.json|admin-ajax|search|filter|job/i.test(u) &&
        !/google|gtm|facebook|hcaptcha|hotjar|doubleclick|gstatic|analytics|cdn\.|fonts|youtube|onetrust|cookie|pixel/i.test(u)) {
      try { reqs.push({ method: r.request().method(), url: u.slice(0, 220), type: r.request().resourceType(), status: r.status() }); } catch {}
    }
  });

  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(2000);

  const title = await p.title();
  const html = await p.content();
  fs.writeFileSync('.scratch/bezeq-page.html', html);

  // Look for top job-item candidates (clusters of same-class siblings)
  const summary = await p.evaluate(() => {
    const stats: Record<string, { count: number; sampleText: string }> = {};
    document.querySelectorAll('*').forEach((el) => {
      if (!el.parentElement || !el.classList.length) return;
      const sig = el.tagName + '|' + Array.from(el.classList).sort().join('.');
      const key = el.parentElement.tagName + ' > ' + sig;
      if (!stats[key]) stats[key] = { count: 0, sampleText: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) };
      stats[key].count++;
    });
    return Object.entries(stats)
      .filter(([_, v]) => v.count >= 3 && v.count <= 1000)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 15)
      .map(([sig, v]) => ({ sig, count: v.count, sample: v.sampleText }));
  });

  // Find any "X jobs" or "total" text on the page
  const totals = await p.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll('h1,h2,h3,h4,p,span,div,strong,b').forEach((el) => {
      const t = (el.textContent || '').trim();
      if (/^\d{1,4}\s*(משרות|jobs|positions|תוצאות)/i.test(t) || /נמצאו\s*\d+/i.test(t) || /^\d+\s+מתוך/.test(t) || /\d+\s+תפקידים/.test(t)) {
        out.push(t.slice(0, 100));
      }
    });
    return Array.from(new Set(out));
  });

  // Look for filter selects (region, profession) — what options exist?
  const filters = await p.evaluate(() => {
    const out: any[] = [];
    document.querySelectorAll('select').forEach((s) => {
      const opts = Array.from(s.querySelectorAll('option')).map((o) => ({ value: (o as HTMLOptionElement).value, text: (o.textContent || '').trim() }));
      out.push({ name: s.getAttribute('name') || s.id || '(no-name)', count: opts.length, opts: opts.slice(0, 10) });
    });
    return out;
  });

  // Look for "load more" buttons or pagination links
  const paginationHints = await p.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll('a, button').forEach((el) => {
      const t = (el.textContent || '').trim();
      const h = (el as HTMLAnchorElement).getAttribute?.('href') || '';
      if (/הצג עוד|עוד|טען|load more|next|הבא|»|עמוד הבא/i.test(t) || /page=|\/page\/|paged=/.test(h)) {
        out.push(`[${t.slice(0, 30)}] ${h.slice(0, 80)}`);
      }
    });
    return Array.from(new Set(out)).slice(0, 15);
  });

  console.log('PAGE TITLE:', title);
  console.log('\nTOP CLUSTERS:');
  for (const s of summary) console.log(`  ${s.count.toString().padStart(4)}  ${s.sig}  // ${s.sample}`);
  console.log('\nTOTAL-COUNT TEXT:', totals);
  console.log('\nFILTER SELECTS:');
  for (const f of filters) console.log(`  ${f.name} (${f.count} options): ${JSON.stringify(f.opts.slice(0, 5))}`);
  console.log('\nPAGINATION HINTS:', paginationHints);
  console.log('\n--- Interesting network calls during load ---');
  for (const r of reqs.slice(0, 30)) console.log(`  ${r.status} ${r.method} ${r.type} ${r.url}`);

  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
