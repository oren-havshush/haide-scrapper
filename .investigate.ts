import { chromium } from 'playwright';
import * as fs from 'fs';

const URL = 'https://www.tikshoov.co.il/come-work-with-us/careers-list/?areaID=&jobType=';

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  const p = await ctx.newPage();

  const fetches: { url: string; status: number }[] = [];
  p.on('response', (r) => {
    const u = r.url();
    if (u.includes('tikshoov') || /\/api\/|\.json|jobs|positions|careers/.test(u)) {
      fetches.push({ url: u, status: r.status() });
    }
  });

  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});

  // Wait a moment longer for any lazy XHR-driven render
  await p.waitForTimeout(2000);

  const html = await p.content();
  fs.writeFileSync('/tmp/scrap-tikshoov.html', html);

  const probe = await p.evaluate(() => {
    const out: any = {};

    // Existing config selectors
    out.itemSelector_jobBoxWrapper_count = document.querySelectorAll('.jobBox-wrapper').length;
    out.listingSelector_ResultsView_present = !!document.querySelector('#ResultsView');
    out.titleProbe_count = document.querySelectorAll('h3.job-title').length;

    // ResultsView content
    const rv = document.querySelector('#ResultsView');
    if (rv) {
      out.ResultsView_innerHTML_first1k = (rv.innerHTML || '').slice(0, 1000);
      out.ResultsView_childCount = rv.children.length;
      out.ResultsView_childTags = Array.from(rv.children).slice(0, 5).map(c => `${c.tagName}.${c.className}`);
    }

    // Cluster heuristic
    const stats: Record<string, { count: number; sampleClass: string; parentTag: string }> = {};
    const all = document.querySelectorAll('*');
    for (const el of Array.from(all)) {
      if (!el.parentElement || !el.classList.length) continue;
      const sig = el.tagName + '|' + Array.from(el.classList).sort().join('.');
      const key = el.parentElement.tagName + ' > ' + sig;
      if (!stats[key]) stats[key] = { count: 0, sampleClass: Array.from(el.classList).join(' '), parentTag: el.parentElement.tagName };
      stats[key].count++;
    }
    out.topClusters = Object.entries(stats)
      .filter(([_, v]) => v.count >= 3 && v.count <= 500)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 25)
      .map(([sig, v]) => ({ sig, ...v }));

    // Look for anchors that look like job links
    const allAnchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    out.jobIdLinks_count = allAnchors.filter(a => /jobID=\d+/.test(a.href)).length;
    out.jobIdLinks_sample = allAnchors.filter(a => /jobID=\d+/.test(a.href)).slice(0, 5).map(a => ({
      href: a.href,
      text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      parentTag: a.parentElement?.tagName,
      parentClass: a.parentElement?.className,
      closestKnownBox: a.closest('[class*="job"], [class*="vacanc"], [class*="position"], [class*="career"]')?.outerHTML?.slice(0, 200),
    }));

    // Anything with "job" in its class
    const jobLike = Array.from(document.querySelectorAll('[class*="job"], [class*="vacanc"], [class*="position"]')) as HTMLElement[];
    const jobLikeBuckets: Record<string, number> = {};
    for (const el of jobLike) {
      const sig = el.tagName + '.' + Array.from(el.classList).join('.');
      jobLikeBuckets[sig] = (jobLikeBuckets[sig] || 0) + 1;
    }
    out.jobLike_buckets = Object.entries(jobLikeBuckets).sort((a,b)=>b[1]-a[1]).slice(0, 30);

    return out;
  });

  console.log(JSON.stringify({ url: URL, htmlBytes: html.length, fetches: fetches.slice(0, 25), probe }, null, 2));
  await b.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
