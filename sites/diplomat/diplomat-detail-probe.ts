import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  const html = await p.content();
  fs.writeFileSync(path.resolve('.scratch', 'diplomat-detail.html'), html);

  // Pass evaluation as a string to bypass tsx's __name helper injection.
  const probeFn = `(() => {
    var txt = function(el) { return el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : null; };
    var candidates = {
      h1: txt(document.querySelector('h1')),
      h2: txt(document.querySelector('h2')),
      jobTitle: txt(document.querySelector('.job-title, [data-field="jobTitleText"]')),
      jobLocation: txt(document.querySelector('.job-location, [data-field="location"]')),
      jobId: txt(document.querySelector('.job-id, [data-field="compPositionID"]')),
      activationDate: txt(document.querySelector('.job-activationDate, [data-field="activationDate"]')),
      shortDescription_field: txt(document.querySelector('[data-field="shortDescription"]')),
      jobDescription_field: txt(document.querySelector('[data-field="jobDescription"]')),
      description_field: txt(document.querySelector('[data-field="description"]')),
      requirements_field: txt(document.querySelector('[data-field="requirements"]')),
      job_description_div: txt(document.querySelector('.job-description, .job-content, .description')),
      mainBytes: (document.querySelector('main, #main, .main, .content, .container') || document.body).innerHTML.length,
    };
    var dataFields = [];
    document.querySelectorAll('[data-field]').forEach(function(el) {
      var k = el.getAttribute('data-field') || '';
      if (dataFields.indexOf(k) === -1) dataFields.push(k);
    });
    return { candidates: candidates, dataFields: dataFields, htmlBytes: document.documentElement.outerHTML.length };
  })()`;
  const probe = await p.evaluate(probeFn);
  console.log(JSON.stringify(probe, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
