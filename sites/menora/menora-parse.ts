import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const inputPath = process.argv[2];
  const html = fs.readFileSync(inputPath, 'utf8');
  // Wrap as a full document so Playwright is happy.
  const fullHtml = `<!doctype html><html><head><meta charset="utf-8"></head>${html}</html>`;

  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  await p.setContent(fullHtml, { waitUntil: 'domcontentloaded' });

  // Count data-mnr-bo distinct values and their tag names.
  const boReport = await p.evaluate(() => {
    const counts: Record<string, { count: number; tags: Record<string, number> }> = {};
    document.querySelectorAll('[data-mnr-bo]').forEach(el => {
      const v = el.getAttribute('data-mnr-bo') || '';
      if (!counts[v]) counts[v] = { count: 0, tags: {} };
      counts[v].count++;
      counts[v].tags[el.tagName] = (counts[v].tags[el.tagName] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 50)
      .map(([bo, v]) => ({ bo, count: v.count, tags: v.tags }));
  });

  // Generic structural summary by tag+class signature.
  const summary = await p.evaluate(() => {
    const stats: Record<string, { count: number; sample: string; parentTag: string }> = {};
    document.querySelectorAll('*').forEach(el => {
      if (!el.parentElement || !el.classList.length) return;
      const sig = el.tagName + '|' + Array.from(el.classList).sort().join('.');
      const key = el.parentElement.tagName + ' > ' + sig;
      if (!stats[key]) stats[key] = { count: 0, sample: Array.from(el.classList).join(' '), parentTag: el.parentElement.tagName };
      stats[key].count++;
    });
    return Object.entries(stats)
      .filter(([_, v]) => v.count >= 3 && v.count <= 200)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 25)
      .map(([sig, v]) => ({ sig, ...v }));
  });

  // Anchors whose href contains a job-ish path — likely the detail links.
  const linkSample = await p.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    const buckets: Record<string, number> = {};
    anchors.forEach(a => {
      const h = a.getAttribute('href') || '';
      const m = h.match(/^(?:https?:\/\/[^/]+)?(\/[^?#]+)/);
      if (!m) return;
      const seg = m[1].split('/').slice(0, 3).join('/');
      buckets[seg] = (buckets[seg] || 0) + 1;
    });
    return Object.entries(buckets).sort((a, b) => b[1] - a[1]).slice(0, 20);
  });

  console.log(JSON.stringify({ boReport, linkSample, summary }, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
