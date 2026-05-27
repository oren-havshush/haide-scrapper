import * as fs from 'fs';
import * as path from 'path';

const file = path.resolve('.scratch', 'elbit-chunks', '116.0cec4a055d72af3f.js');
const src = fs.readFileSync(file, 'utf8');

console.log(`file size: ${src.length}`);

// Find all occurrences of "רחובות" and dump 200 chars around each
const heb = 'רחובות';
let idx = -1;
let hit = 0;
while ((idx = src.indexOf(heb, idx + 1)) !== -1 && hit < 5) {
  hit++;
  const start = Math.max(0, idx - 150);
  const end = Math.min(src.length, idx + 200);
  console.log(`\n=== match ${hit} at offset ${idx} ===`);
  console.log(src.slice(start, end));
}
console.log(`total matches for "${heb}": ${hit}`);

// Find any "992" mentions and check if they correlate with city patterns
let cityHits = 0;
const reCity = /(?:id|cityId|value)[^,{}]{0,5}["']?992["']?[^,{}]{0,5}name/gi;
const m = src.matchAll(reCity);
for (const mm of m) {
  cityHits++;
  console.log('\ncityHit:', mm[0]);
  if (cityHits > 5) break;
}

// Locate the city array — heuristic: a stretch with lots of Hebrew strings and numeric IDs
// Look for a JSON-shaped pattern containing many entries like {Id:NNN,Name:"<hebrew>"} or similar
const reArr = /\[\s*\{[^}]{3,50}"?\d+"?[^}]{3,100}[\u05D0-\u05EA][^}]*\}/;
const am = src.match(reArr);
if (am) {
  console.log('\narray candidate:', am[0].slice(0, 400));
}
