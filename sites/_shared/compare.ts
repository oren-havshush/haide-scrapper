import * as fs from 'fs';

const data = JSON.parse(fs.readFileSync('.scratch/jobs-all.json', 'utf8'));
console.log('Total jobs scraped:', data.meta.total);
const fromScrape = data.data.map((j: any) => j.externalJobId).filter(Boolean).sort();
console.log('externalJobIds:', fromScrape.join(', '));

const page1Ids = [
  '43822','66778','66437','66437','67012','66287','66437','66669','67254','67896',
  '67464','67013','67475','63595','67235','67347','67769','67639','67399','67462',
  '66169','65091','66685','67680','67680',
];
const page2NotOnPage1 = new Set<string>();
const onPage1 = new Set(page1Ids);

for (const id of fromScrape) {
  if (!onPage1.has(id)) page2NotOnPage1.add(id);
}
console.log('');
console.log('Of', fromScrape.length, 'scraped jobs:');
console.log('  on page 1:', fromScrape.filter((id: string) => onPage1.has(id)).length);
console.log('  NOT on page 1 (must be from page 2):', page2NotOnPage1.size, '->', [...page2NotOnPage1].join(', '));
