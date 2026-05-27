import * as fs from 'fs';
import * as path from 'path';

const raw = fs.readFileSync(path.resolve('.scratch', 'niloo-response.bin'), 'utf8');
const arr = JSON.parse(raw) as any[];
console.log('total jobs:', arr.length);
console.log('--- first job (full) ---');
console.log(JSON.stringify(arr[0], null, 2));
console.log('--- second job (full) ---');
console.log(JSON.stringify(arr[1], null, 2));

// Look at distribution of locationAddress, area, employerName
let withLocAddr = 0, withArea = 0, withEmployer = 0, withOpenDate = 0;
const areaSet = new Set<string>();
const empSet = new Set<string>();
const extKeyCount: Record<string, number> = {};
for (const j of arr) {
  if (j.locationAddress) withLocAddr++;
  if (j.area) { withArea++; areaSet.add(j.area); }
  if (j.employerName) { withEmployer++; empSet.add(j.employerName); }
  if (j.openDate) withOpenDate++;
  if (Array.isArray(j.extendedProperties)) {
    for (const ep of j.extendedProperties) {
      const k = String(ep.PropertyName).slice(0, 40);
      extKeyCount[k] = (extKeyCount[k] || 0) + 1;
    }
  }
}
console.log('--- coverage ---');
console.log({ total: arr.length, withLocAddr, withArea, withEmployer, withOpenDate });
console.log('areas (top 10):', Array.from(areaSet).slice(0, 10));
console.log('employers (top 10):', Array.from(empSet).slice(0, 10));
console.log('--- extendedProperties keys (top 20 by frequency) ---');
console.log(Object.entries(extKeyCount).sort((a, b) => b[1] - a[1]).slice(0, 20));
