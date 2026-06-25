const fs = require('fs');

const setupScript = `const items = document.querySelectorAll('div.job-item');
for (const item of items) {
  if (item.querySelector('.__ai-externalJobId')) continue;

  // externalJobId from TenderPageId hidden input
  const tid = item.querySelector('input[name="TenderPageId"]');
  if (tid && tid.value) {
    const s = document.createElement('span');
    s.className = '__ai-externalJobId';
    s.textContent = 'mey7-' + tid.value;
    item.appendChild(s);
  }

  // Location (single office: Beer Sheva)
  if (!item.querySelector('.__ai-location')) {
    const loc = document.createElement('span');
    loc.className = '__ai-location';
    loc.textContent = 'באר שבע';
    item.appendChild(loc);
  }

  // Full description: short summary + full requirements block
  if (!item.querySelector('.__ai-description')) {
    const summary = item.querySelector('.job-item__text');
    const reqBlock = item.querySelector('.requirements-block');
    let text = '';
    if (summary) text += summary.innerText.trim();
    if (reqBlock) text += '\\n\\n' + reqBlock.innerText.trim();
    if (text) {
      const d = document.createElement('span');
      d.className = '__ai-description';
      d.textContent = text.substring(0, 3000);
      item.appendChild(d);
    }
  }

  // Application deadline from <time> element inside the button
  if (!item.querySelector('.__ai-deadline')) {
    const timeEl = item.querySelector('button.job-button time[datetime]');
    if (timeEl) {
      const dt = timeEl.getAttribute('datetime');
      const dl = document.createElement('span');
      dl.className = '__ai-deadline';
      dl.textContent = dt;
      item.appendChild(dl);
    }
  }
}`;

const config = {
  itemSelector: "div.job-item",
  fieldMappings: {
    title: { selector: "h3", confidence: 0.95, source: "manual" },
    description: { selector: ".__ai-description", confidence: 0.9, source: "manual" },
    externalJobId: { selector: ".__ai-externalJobId", confidence: 0.95, source: "manual" },
    location: { selector: ".__ai-location", confidence: 0.8, source: "manual" },
    deadline: { selector: ".__ai-deadline", confidence: 0.85, source: "manual" }
  },
  setupScript,
  formCapture: {
    capturedOnUrl: "https://www.mey7.co.il/jobs/tenders/",
    formSelector: "form.form",
    method: "POST",
    actionUrl: "https://www.mey7.co.il/jobs/tenders/",
    fields: [
      { name: "inLink", fieldType: "text", label: "קישור LinkedIn", required: false, tagName: "input" },
      { name: "ContactJobCVFile", fieldType: "file", label: "קורות חיים", required: false, tagName: "input" }
    ]
  },
  pageFlow: []
};

fs.writeFileSync('tmp-config-mey7.json', JSON.stringify(config, null, 2), 'utf8');
console.log('Written tmp-config-mey7.json');
