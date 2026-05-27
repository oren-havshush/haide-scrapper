import * as fs from 'fs';
import * as path from 'path';

const raw = JSON.parse(fs.readFileSync(path.resolve('.scratch', 'unitask-raw4.json'), 'utf8'));
const jobs: any[] = raw.data || [];

const rows = jobs.map((j) => ({
  title: (j.title || '').slice(0, 50),
  jobIdRaw: j.rawData?.externalJobId ?? '',
  jobIdTop: j.externalJobId ?? '',
  locRaw: j.rawData?.location ?? '',
  locTop: j.location ?? '',
  url: j.rawData?.detailUrl ?? '',
  descLen: (j.description || '').length,
}));

console.log(`Total jobs: ${jobs.length}`);
console.log(`externalJobId raw populated: ${rows.filter((r) => r.jobIdRaw).length}`);
console.log(`externalJobId top populated:  ${rows.filter((r) => r.jobIdTop).length}`);
console.log(`location raw populated:       ${rows.filter((r) => r.locRaw).length}`);
console.log(`location top populated (non-Unknown): ${rows.filter((r) => r.locTop && r.locTop !== 'Unknown').length}`);
console.log(`min descLen=${Math.min(...rows.map((r) => r.descLen))} median=${rows.map((r) => r.descLen).sort((a, b) => a - b)[Math.floor(rows.length / 2)]}`);
console.log('');
console.log('=== First 10 rows ===');
rows.slice(0, 10).forEach((r) => {
  console.log(`title=${r.title}`);
  console.log(`  url=${r.url}`);
  console.log(`  jobId raw="${r.jobIdRaw}" top="${r.jobIdTop}"`);
  console.log(`  location raw="${r.locRaw}" top="${r.locTop}"`);
  console.log(`  descLen=${r.descLen}`);
});
console.log('');
console.log('=== Distinct locations ===');
const locs = Array.from(new Set(rows.map((r) => r.locRaw))).sort();
locs.forEach((l) => console.log(`  "${l}" count=${rows.filter((r) => r.locRaw === l).length}`));
