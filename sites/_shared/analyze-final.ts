import * as fs from 'fs';
import * as path from 'path';

const raw = JSON.parse(fs.readFileSync(path.resolve('.scratch', 'unitask-raw6.json'), 'utf8'));
const jobs: any[] = raw.data || [];

const rows = jobs.map((j) => ({
  title: (j.title || '').slice(0, 40),
  jobIdRaw: j.rawData?.externalJobId ?? '',
  jobIdTop: j.externalJobId ?? '',
  enrichedJobId: j.rawData?._enrichedFromDescription_externalJobId ?? '',
  locRaw: j.rawData?.location ?? '',
  locTop: j.location ?? '',
  enrichedLoc: j.rawData?._enrichedFromDescription_location ?? '',
  reqTop: j.requirements ?? '',
  url: j.rawData?.detailUrl ?? '',
  descLen: (j.description || '').length,
}));

console.log(`Total jobs: ${jobs.length}`);
console.log(`externalJobId raw (selector h2) populated:        ${rows.filter((r) => r.jobIdRaw).length}`);
console.log(`externalJobId top-level populated:                ${rows.filter((r) => r.jobIdTop).length}`);
console.log(`location raw populated:                           ${rows.filter((r) => r.locRaw).length}`);
console.log(`location top-level populated (non-Unknown):       ${rows.filter((r) => r.locTop && r.locTop !== 'Unknown').length}`);
console.log(`enrichedFromDescription_location populated:       ${rows.filter((r) => r.enrichedLoc).length}`);
console.log(`requirements top-level populated:                 ${rows.filter((r) => r.reqTop).length}`);
console.log(`min descLen=${Math.min(...rows.map((r) => r.descLen))} median=${rows.map((r) => r.descLen).sort((a, b) => a - b)[Math.floor(rows.length / 2)]}`);
console.log('');
console.log('=== First 4 jobs ===');
rows.slice(0, 4).forEach((r) => {
  console.log(`title: ${r.title}`);
  console.log(`  url:               ${r.url}`);
  console.log(`  externalJobId raw: "${r.jobIdRaw}"`);
  console.log(`  externalJobId top: "${r.jobIdTop}"`);
  console.log(`  location raw:      "${r.locRaw}"`);
  console.log(`  location top:      "${r.locTop}"`);
  console.log(`  enrichedLoc:       "${r.enrichedLoc}"`);
  console.log(`  descLen=${r.descLen}`);
});

// Check all enrichment field names present
const enriched = new Set<string>();
jobs.forEach((j) => {
  if (j.rawData) Object.keys(j.rawData).filter((k) => k.startsWith('_enriched')).forEach((k) => enriched.add(k));
});
console.log('');
console.log('=== Distinct _enriched* keys observed ===');
Array.from(enriched).sort().forEach((k) => console.log(`  ${k}`));
