import fs from 'node:fs';
import path from 'node:path';

const URL = 'https://www.egged.co.il/career/headquarters';
const setupScript = fs.readFileSync(path.resolve('.scratch', 'egged-setup.js'), 'utf8');

const mk = (selector, extra = {}) => ({
  selector,
  ...extra,
  confidence: 100,
  source: 'MANUAL',
  capturedOnUrl: URL,
});

const config = {
  itemSelector: '.haide-egged-job',
  setupScript,
  fieldMappings: {
    title:         mk('.haide-title'),
    department:    mk('.haide-category'),
    externalJobId: mk('.haide-jobid'),
    detailUrl:     mk('.haide-url', { extractAttr: 'href' }),
    description:   mk('.haide-description'),
    requirements:  mk('.haide-requirements'),
    skills:        mk('.haide-skills'),
  },
  pageFlow: [],
  formCapture: null,
};

const outPath = path.resolve('.scratch', 'scrap-config.json');
fs.writeFileSync(outPath, JSON.stringify(config, null, 2), 'utf8');
console.log('config written:', outPath, fs.statSync(outPath).size, 'bytes');
