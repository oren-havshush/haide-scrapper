import { chromium } from 'playwright';
import * as fs from 'fs';

async function probe(label: string, opts: any) {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  try {
    const r = await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 20000 });
    const status = r?.status();
    const html = await p.content().catch(() => '');
    const title = await p.title().catch(() => '');
    const headers = r ? await r.allHeaders() : {};
    fs.writeFileSync(`.scratch/probe-${label}.html`, html);
    console.log(`\n=== ${label} ===`);
    console.log(`status=${status} title="${title}" htmlBytes=${html.length}`);
    console.log('server=' + (headers['server'] || ''));
    console.log('content-type=' + (headers['content-type'] || ''));
    console.log('via=' + (headers['via'] || ''));
    console.log('x-* headers:', Object.keys(headers).filter(k => k.startsWith('x-')).map(k => `${k}=${headers[k]}`).join(' | '));
    console.log('first 400 chars:', html.slice(0, 400).replace(/\s+/g, ' '));
  } catch (e: any) {
    console.log(`${label}: FAIL ${e.message?.split('\n')[0]}`);
  } finally {
    await b.close();
  }
}

(async () => {
  // 1) Bare
  await probe('bare', {});
  // 2) Chrome UA + accept-language
  await probe('chrome-ua', {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  // 3) Chrome UA + sec-fetch + referer (mimics a real navigation from google)
  await probe('chrome-full-headers', {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: {
      'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'accept-encoding': 'gzip, deflate, br, zstd',
      'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
      'referer': 'https://www.google.com/',
    },
  });
  // 4) Headful (use real chrome channel)
  await probe('headful', { /* nothing special, but headless will be false via launch override */ });
})();
