import * as fs from 'fs';
import * as path from 'path';

const SITE_ID = fs.readFileSync(path.resolve('.scratch', '_siteid.txt'), 'utf8').trim();
const TOKEN = fs.readFileSync(path.resolve('.claude', 'scrap-token'), 'utf8').replace(/\s/g, '');

(async () => {
  const r = await fetch(`https://scrapper.haide-jobs.co.il/api/jobs?siteId=${SITE_ID}&pageSize=5`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const j: any = await r.json();
  console.log('total:', j.data.length);
  for (const job of j.data.slice(0, 5)) {
    console.log('---');
    console.log('externalJobId:', job.externalJobId);
    console.log('title:', job.title);
    console.log('location:', job.location);
    console.log('department:', job.department);
    console.log('publishDate:', job.publishDate);
    const desc = job.description || '';
    console.log('description (first 200):', desc.slice(0, 200));
    console.log('description length:', desc.length);
  }
})().catch((e) => { console.error(e); process.exit(1); });
