import * as fs from 'fs';

(async () => {
  const token = fs.readFileSync('./.claude/scrap-token', 'utf8').trim();
  const siteId = 'cmpb717o5002c01ls07eazu8j';

  const resp = await fetch(`https://scrapper.haide-jobs.co.il/api/jobs?siteId=${siteId}&limit=12`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await resp.json() as any;
  const jobs = json.data || [];
  console.log('count:', jobs.length);

  for (const j of jobs) {
    console.log('---');
    console.log('externalJobId:', j.externalJobId);
    console.log('title:        ', (j.title || '').slice(0, 80));
    console.log('location:     ', j.location);
    console.log('profession:   ', j.rawData?.profession);
    console.log('detailUrl:    ', j.detailUrl || j.rawData?.detailUrl);
    console.log('descr len:    ', (j.description || '').length, 'chars');
    console.log('descr preview:', (j.description || '').slice(0, 100));
  }
})().catch(e => { console.error(e); process.exit(1); });
