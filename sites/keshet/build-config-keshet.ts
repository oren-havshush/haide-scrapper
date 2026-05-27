import * as fs from 'fs';
import * as path from 'path';

const setupScript = fs.readFileSync(path.resolve('.scratch', 'setup-script-keshet.js'), 'utf8');

const LISTING = 'https://jobs.keshet-mediagroup.com/';
const DETAIL_EXAMPLE = 'https://jobs.keshet-mediagroup.com/jobs/A5.467';

const cfg: any = {
  itemSelector: '.job-container',
  revealSelector: '.job-container',
  setupScript,
  fieldMappings: {
    title: {
      selector: '.job-title',
      confidence: 100,
      source: 'MANUAL',
      capturedOnUrl: LISTING,
    },
    externalJobId: {
      selector: '[data-extracted-jobid]',
      extractAttr: 'data-extracted-jobid',
      confidence: 100,
      source: 'MANUAL',
      capturedOnUrl: LISTING,
    },
    detailUrl: {
      selector: '[data-extracted-detailurl]',
      extractAttr: 'href',
      confidence: 100,
      source: 'MANUAL',
      capturedOnUrl: LISTING,
    },
    publishDate: {
      selector: '.job-subtitle span:last-child',
      confidence: 100,
      source: 'MANUAL',
      capturedOnUrl: LISTING,
    },
    description: {
      selector: '#pos-description',
      confidence: 100,
      source: 'MANUAL',
      capturedOnUrl: DETAIL_EXAMPLE,
    },
    requirements: {
      selector: '#pos-requirements',
      confidence: 100,
      source: 'MANUAL',
      capturedOnUrl: DETAIL_EXAMPLE,
    },
  },
  pageFlow: [
    { url: LISTING, action: 'navigate' },
    { url: 'https://jobs.keshet-mediagroup.com/jobs/*', action: 'navigate' },
  ],
  formCapture: null,
};

const outPath = path.resolve('.scratch', 'scrap-config-keshet.json');
fs.writeFileSync(outPath, JSON.stringify(cfg, null, 2), 'utf8');
console.log(`Wrote ${outPath} (${fs.statSync(outPath).size} bytes)`);
