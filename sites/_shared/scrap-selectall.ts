import { chromium } from 'playwright';
import * as fs from 'fs';
(async () => {
  const url = fs.readFileSync('.scratch/ikea-select-all-url.txt', 'utf8').trim();
  console.log('Testing URL:', url.slice(0, 120) + '...');
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  const p = await ctx.newPage();
  const resp = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const status = resp?.status();
  const finalUrl = p.url();
  const title = await p.title();
  const html = await p.content();
  fs.writeFileSync('.scratch/ikea-selectall-page.html', html);
  const jobCount = await p.evaluate(() => document.querySelectorAll('.job-wrapper').length);
  const firstJob = await p.evaluate(() => {
    const a = document.querySelector('.job-wrapper a');
    const h = document.querySelector('.job-wrapper .card-title h2');
    return { href: a?.getAttribute('href') || null, title: (h?.textContent || '').trim() };
  });
  console.log(JSON.stringify({ status, finalUrl, title, bodyLen: html.length, jobCount, firstJob }, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
