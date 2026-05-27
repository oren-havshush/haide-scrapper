import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = 'https://www.ness-tech.co.il/careers/';

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();

  const xhrCalls = [];
  p.on('response', async (resp) => {
    const u = resp.url();
    const ct = resp.headers()['content-type'] || '';
    if ((ct.includes('json') || u.includes('api') || u.includes('jobs') || u.includes('careers')) && resp.status() === 200) {
      let bodyPreview = null;
      try {
        const body = await resp.text();
        bodyPreview = body.slice(0, 800);
      } catch {}
      xhrCalls.push({ status: resp.status(), url: u, contentType: ct, bodyPreview });
    }
  });

  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await p.waitForSelector('.card-job-container', { timeout: 15000 });
  await p.waitForTimeout(2000);

  console.log('=== xhr calls captured before click ===');
  console.log(JSON.stringify(xhrCalls, null, 2).slice(0, 6000));

  // Click first card's button to see where it navigates
  console.log('\n=== Clicking first card button ===');
  const startUrl = p.url();
  console.log('Before click URL:', startUrl);

  const xhrBeforeClick = xhrCalls.length;
  try {
    await p.evaluate(() => {
      const btn = document.querySelector('.card-job-container button');
      if (btn) btn.click();
    });
    await p.waitForTimeout(2500);
  } catch (e) {
    console.log('click error:', e.message);
  }
  const afterUrl = p.url();
  console.log('After click URL:', afterUrl);
  console.log('XHR calls during click:', xhrCalls.length - xhrBeforeClick);
  const newCalls = xhrCalls.slice(xhrBeforeClick);
  console.log(JSON.stringify(newCalls, null, 2).slice(0, 4000));

  // Save final page (potentially detail page) HTML for inspection
  const detailHtml = await p.content();
  const outPath = path.join(os.tmpdir(), 'ness-detail.html');
  fs.writeFileSync(outPath, detailHtml);
  console.log('\nDetail page HTML written to:', outPath, '(', detailHtml.length, 'bytes)');

  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
