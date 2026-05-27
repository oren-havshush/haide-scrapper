import * as fs from 'fs';
import * as path from 'path';

const file = path.resolve('.scratch', 'elbit-chunks', '116.0cec4a055d72af3f.js');
const src = fs.readFileSync(file, 'utf8');

// Find the city dict by locating "רחובות" and walking backwards to the opening `{`
// then forwards to the matching `}`.
const anchor = src.indexOf('992:"רחובות"');
if (anchor < 0) {
  console.error('anchor not found');
  process.exit(1);
}

// Walk back to find the opening `{` of the object literal.
let depth = 0;
let openIdx = -1;
for (let i = anchor; i >= 0; i--) {
  const c = src[i];
  if (c === '}') depth++;
  else if (c === '{') {
    if (depth === 0) { openIdx = i; break; }
    depth--;
  }
}
if (openIdx < 0) { console.error('open brace not found'); process.exit(1); }

// Walk forward from openIdx to find the matching `}`.
let depth2 = 0;
let closeIdx = -1;
let inStr = false;
let strCh = '';
for (let i = openIdx; i < src.length; i++) {
  const c = src[i];
  if (inStr) {
    if (c === '\\') { i++; continue; }
    if (c === strCh) inStr = false;
    continue;
  }
  if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
  if (c === '{') depth2++;
  else if (c === '}') {
    depth2--;
    if (depth2 === 0) { closeIdx = i; break; }
  }
}
if (closeIdx < 0) { console.error('close brace not found'); process.exit(1); }

const dictSrc = src.slice(openIdx, closeIdx + 1);
console.log(`dict source: ${dictSrc.length} chars, from ${openIdx} to ${closeIdx}`);
console.log('first 200 chars:', dictSrc.slice(0, 200));
console.log('last 200 chars:', dictSrc.slice(-200));

// Eval the dict in a safe way to verify it parses, and count entries.
// Wrap in parens so JS treats it as an expression.
let parsed: Record<string | number, string>;
try {
  // eslint-disable-next-line no-eval
  parsed = eval('(' + dictSrc + ')');
} catch (e) {
  console.error('eval failed:', e);
  // Try as JSON5-ish: replace bare numeric keys "966:" with "\"966\":"
  const json = dictSrc.replace(/([{,])(\w+):/g, '$1"$2":');
  parsed = JSON.parse(json);
}

const entries = Object.entries(parsed);
console.log(`parsed ok, ${entries.length} entries`);
console.log('sample entries:');
for (const [k, v] of entries.slice(0, 10)) console.log(`  ${k} -> ${v}`);
console.log(`992 -> ${parsed[992]}`);

// Write a clean JSON dict for inlining
const cleanJson = JSON.stringify(parsed);
fs.writeFileSync(path.resolve('.scratch', 'elbit-city-dict.json'), cleanJson, 'utf8');
console.log(`wrote .scratch/elbit-city-dict.json (${cleanJson.length} chars)`);
