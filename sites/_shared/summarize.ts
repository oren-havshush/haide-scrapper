import * as fs from 'fs';

const data = JSON.parse(fs.readFileSync('.scratch/jobs-sample.json', 'utf8'));
console.log('Total jobs:', data.meta.total);
console.log('Sampled:', data.data.length);
console.log('');
const first = data.data[0];
console.log('--- TOP-LEVEL KEYS ---');
console.log(Object.keys(first));
console.log('');
console.log('--- RAW DATA KEYS (first job) ---');
console.log(Object.keys(first.rawData || {}));
console.log('');
console.log('--- FIRST JOB FULL RAW DATA ---');
console.log(JSON.stringify(first.rawData, null, 2));
