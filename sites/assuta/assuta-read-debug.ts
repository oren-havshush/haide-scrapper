import * as fs from 'fs';

(async () => {
  const token = fs.readFileSync('./.claude/scrap-token', 'utf8').trim();
  const siteId = 'cmpb94j0l002i01lseubfd6g9';
  const resp = await fetch(`https://scrapper.haide-jobs.co.il/api/jobs?siteId=${siteId}&limit=5`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await resp.json() as any;
  const jobs = json.data || [];
  console.log('count:', jobs.length);
  for (const j of jobs) {
    console.log('--- job', j.id);
    console.log('externalJobId:', j.externalJobId);
    console.log('title:        ', j.title);
    console.log('location:     ', j.location);
    console.log('detailUrl:    ', j.detailUrl);
    console.log('description:  ', (j.description || '').slice(0, 400));
  }
})().catch(e => { console.error(e); process.exit(1); });
