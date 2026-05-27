import * as fs from 'fs';
import * as path from 'path';

const raw = JSON.parse(fs.readFileSync(path.resolve('.scratch', 'unitask-raw2.json'), 'utf8'));
const jobs: any[] = raw.data || [];

console.log(`Total jobs: ${jobs.length}`);
console.log('');

const summary = jobs.map((j) => ({
  title: (j.title || '').slice(0, 50),
  externalJobId: j.externalJobId,
  rawExternalJobId: j.rawData?.externalJobId,
  detailUrl: j.rawData?.detailUrl || j.detailUrl,
  descLen: (j.description || '').length,
}));

const withJobId = summary.filter((s) => s.rawExternalJobId && s.rawExternalJobId.length > 0);
const empty = summary.filter((s) => !s.rawExternalJobId || s.rawExternalJobId.length === 0);

console.log(`=== With externalJobId: ${withJobId.length} ===`);
withJobId.forEach((s) => console.log(`  ${s.detailUrl} -> "${s.rawExternalJobId}"`));
console.log('');
console.log(`=== Empty externalJobId: ${empty.length} ===`);
empty.forEach((s) => console.log(`  ${s.detailUrl} -> empty`));

// Description analysis
const descLens = summary.map((s) => s.descLen).sort((a, b) => a - b);
console.log('');
console.log(`=== Description lengths === min=${descLens[0]} max=${descLens[descLens.length - 1]} median=${descLens[Math.floor(descLens.length / 2)]}`);
const short = summary.filter((s) => s.descLen < 200);
console.log(`Short descriptions (< 200 chars): ${short.length}`);
short.forEach((s) => console.log(`  ${s.detailUrl}: ${s.descLen} chars: "${(jobs.find((j) => (j.rawData?.detailUrl || j.detailUrl) === s.detailUrl)?.description || '').slice(0, 100)}..."`));
