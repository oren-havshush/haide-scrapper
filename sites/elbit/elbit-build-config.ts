import * as fs from 'fs';
import * as path from 'path';

const URL = 'https://elbitsystemscareer.com/jobs/';
const setupScript = fs.readFileSync(path.resolve('.scratch', 'elbit-setup.js'), 'utf8');

const config = {
  listingSelector: '#haide-jobs-container',
  itemSelector: '.haide-job-card',
  setupScript,
  fieldMappings: {
    title: {
      selector: '[data-haide-title]',
      confidence: 100,
      source: 'MANUAL',
      capturedOnUrl: URL,
    },
    externalJobId: {
      selector: '[data-haide-jobcode]',
      confidence: 100,
      source: 'MANUAL',
      capturedOnUrl: URL,
    },
    description: {
      selector: '[data-haide-description]',
      confidence: 100,
      source: 'MANUAL',
      capturedOnUrl: URL,
    },
    location: {
      selector: '[data-haide-location]',
      confidence: 100,
      source: 'MANUAL',
      capturedOnUrl: URL,
    },
    department: {
      selector: '[data-haide-department]',
      confidence: 100,
      source: 'MANUAL',
      capturedOnUrl: URL,
    },
    publishDate: {
      selector: '[data-haide-publishdate]',
      confidence: 100,
      source: 'MANUAL',
      capturedOnUrl: URL,
    },
  },
  pageFlow: [],
  formCapture: null,
};

fs.writeFileSync(path.resolve('.scratch', 'elbit-config.json'), JSON.stringify(config, null, 2), 'utf8');
console.log('wrote .scratch/elbit-config.json',
  'fields:', Object.keys(config.fieldMappings).length,
  'setupScriptBytes:', setupScript.length);
