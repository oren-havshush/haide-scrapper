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
    // Per-job apply/detail URL injected by setupScript as
    // https://elbitsystemscareer.com/job/?jid=<API jobId>. NOTE: this uses the
    // niloo API's numeric jobId, NOT the jobCode we store as externalJobId.
    applicationInfo: {
      selector: '[data-haide-applyurl]',
      confidence: 100,
      source: 'MANUAL',
      capturedOnUrl: URL,
    },
    detailUrl: {
      selector: '[data-haide-applyurl]',
      confidence: 100,
      source: 'MANUAL',
      capturedOnUrl: URL,
    },
  },
  pageFlow: [],
  // The apply form is a Next.js/React form on the per-job page (/job/?jid=…).
  // Its inputs have NO name attributes; on submit React builds a multipart
  // FormData and POSTs it to the niloo API (reverse-engineered from the page
  // bundle page-cb5ed2831cabe8d8.js). jobId/jobCode vary per job, like Natali's
  // per-job queried_id, so they are empty hidden placeholders in this
  // site-level schema. formSelector is a sentinel that never matches the
  // scraped listing page, so the worker attaches this static fields[] blob to
  // every job (extractFormDataOrFallback → staticBlob).
  formCapture: {
    formSelector: '.haide-apply-form',
    actionUrl: 'https://niloo-server.herokuapp.com/actions-elbit',
    method: 'POST',
    fields: [
      { name: 'cmd', label: 'command (submit-application)', fieldType: 'hidden', required: true, tagName: 'input' },
      { name: 'jobId', label: 'job id', fieldType: 'hidden', required: true, tagName: 'input' },
      { name: 'jobCode', label: 'job code', fieldType: 'hidden', required: false, tagName: 'input' },
      { name: 'fullName', label: 'שם מלא', fieldType: 'text', required: true, tagName: 'input' },
      { name: 'phoneNumber', label: 'מספר טלפון', fieldType: 'tel', required: true, tagName: 'input' },
      { name: 'email', label: 'אימייל', fieldType: 'email', required: true, tagName: 'input' },
      { name: 'resumeFile', label: 'העלאת קורות חיים (PDF, DOC, DOCX)', fieldType: 'file', required: true, tagName: 'input' },
    ],
  },
};

fs.writeFileSync(path.resolve('.scratch', 'elbit-config.json'), JSON.stringify(config, null, 2), 'utf8');
console.log('wrote .scratch/elbit-config.json',
  'fields:', Object.keys(config.fieldMappings).length,
  'setupScriptBytes:', setupScript.length);
