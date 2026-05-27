import * as fs from 'fs';
import * as path from 'path';

const URL  = 'https://careers.teva/search/?searchby=location&createNewAlert=false&q=&locationsearch=%D7%99%D7%A9%D7%A8%D7%90%D7%9C&geolocation=&optionsFacetsDD_facility=&optionsFacetsDD_department=';
const URL2 = 'https://careers.teva/search/?q=&locationsearch=%D7%99%D7%A9%D7%A8%D7%90%D7%9C&searchby=location&d=10&startrow=25';
const DETAIL = 'https://careers.teva/job/Tel-Aviv-Director-of-IT-Compliance-&-Control-Isra-0000000/1373499900/';

const config = {
  itemSelector: 'tr.data-row',
  fieldMappings: {
    title: {
      selector: 'a.jobTitle-link',
      confidence: 100,
      source: 'MANUAL',
      capturedOnUrl: URL,
    },
    externalJobId: {
      selector: 'td.colShifttype span.jobShifttype',
      confidence: 100,
      source: 'MANUAL',
      capturedOnUrl: URL,
    },
    department: {
      selector: 'td.colFacility span.jobFacility',
      confidence: 100,
      source: 'MANUAL',
      capturedOnUrl: URL,
    },
    location: {
      selector: 'td.colLocation span.jobLocation',
      confidence: 100,
      source: 'MANUAL',
      capturedOnUrl: URL,
    },
    detailUrl: {
      selector: 'a.jobTitle-link',
      extractAttr: 'href',
      confidence: 100,
      source: 'MANUAL',
      capturedOnUrl: URL,
    },
    description: {
      selector: '[itemprop="description"]',
      confidence: 100,
      source: 'MANUAL',
      capturedOnUrl: DETAIL,
    },
    publishDate: {
      selector: 'meta[itemprop="datePosted"]',
      extractAttr: 'content',
      confidence: 100,
      source: 'MANUAL',
      capturedOnUrl: DETAIL,
    },
    applicationInfo: {
      selector: 'a.dialogApplyBtn',
      extractAttr: 'href',
      confidence: 100,
      source: 'MANUAL',
      capturedOnUrl: DETAIL,
    },
  },
  pageFlow: [
    {
      url: URL,
      action: 'navigate',
      pagination: {
        type: 'urlTemplate',
        template: 'https://careers.teva/search/?q=&locationsearch=%D7%99%D7%A9%D7%A8%D7%90%D7%9C&searchby=location&d=10&startrow={offset}',
        startPage: 0,
        step: 25,
        maxPages: 2,
      },
    },
    { url: 'https://careers.teva/job/*', action: 'navigate' },
  ],
  formCapture: null,
};

const outPath = path.resolve('.scratch', 'scrap-config.json');
fs.writeFileSync(outPath, JSON.stringify(config, null, 2), { encoding: 'utf8' });
console.log('Wrote', outPath, 'bytes=', fs.statSync(outPath).size);
console.log('pageFlow entries:', config.pageFlow.length);
