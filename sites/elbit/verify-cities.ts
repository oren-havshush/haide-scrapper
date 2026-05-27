import * as fs from 'fs';
import * as path from 'path';

const SITE_ID = fs.readFileSync(path.resolve('.scratch', '_siteid.txt'), 'utf8').trim();
const TOKEN = fs.readFileSync(path.resolve('.claude', 'scrap-token'), 'utf8').replace(/\s/g, '');

(async () => {
  // Pull all 500 across pages
  const all: any[] = [];
  for (let pg = 1; pg <= 5; pg++) {
    const r = await fetch(`https://scrapper.haide-jobs.co.il/api/jobs?siteId=${SITE_ID}&pageSize=100&page=${pg}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const j: any = await r.json();
    all.push(...j.data);
  }
  console.log(`fetched ${all.length}`);

  // Location bucket
  const buckets: Record<string, number> = {};
  for (const job of all) {
    const loc = job.location || '(empty)';
    buckets[loc] = (buckets[loc] || 0) + 1;
  }
  const sorted = Object.entries(buckets).sort((a, b) => b[1] - a[1]);
  console.log('--- location distribution (top 25) ---');
  for (const [k, v] of sorted.slice(0, 25)) console.log(`  ${v.toString().padStart(4, ' ')}  ${k}`);
  console.log(`unique locations: ${sorted.length}`);

  // Hebrew vs non-Hebrew
  const isHebrew = (s: string) => /[\u05D0-\u05EA]/.test(s);
  let hebCount = 0;
  for (const [k, v] of sorted) {
    if (isHebrew(k)) hebCount += v;
  }
  console.log(`jobs with Hebrew city: ${hebCount} / ${all.length}`);

  // Sample 5 jobs end-to-end
  console.log('\n--- 5 sample jobs ---');
  for (const job of all.slice(0, 5)) {
    console.log(`  ${job.externalJobId}  ${job.title}  |  ${job.location}  |  ${job.department}  |  ${job.publishDate}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
