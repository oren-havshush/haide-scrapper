/**
 * Fix unioncareer.co.il לקס מוטורס department site (cmqyizf3s003301nzvot8l7ut).
 */
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "https://scrapper.haide-jobs.co.il";
const SITE_ID = "cmqyizf3s003301nzvot8l7ut";
const TOKEN_PATH = path.join(process.cwd(), ".claude", "scrap-token");

const SETUP_SCRIPT = `function structuredText(el){
  if (!el) return '';
  const c = el.cloneNode(true);
  c.querySelectorAll('style,script,link,meta').forEach(n => n.remove());
  c.querySelectorAll('p,div,ul,ol,li,br,h2,h3,h4').forEach(e => e.insertAdjacentText('afterend','\\n'));
  return c.textContent.replace(/[ \\t]+/g,' ').replace(/[ \\t]+\\n/g,'\\n').replace(/\\n{3,}/g,'\\n\\n').trim();
}
function extractLocation(content){
  for (const p of content.querySelectorAll('p')) {
    if (!/מיקום/i.test(p.textContent || '')) continue;
    const t = structuredText(p).replace(/^.*?מיקום\\s*:?\\s*/i,'').trim();
    if (t) return t;
  }
  return '';
}
function buildAppInfo(jobId, postUrl){
  return JSON.stringify({
    actionUrl: 'https://unioncareer.co.il/wp-json/contact-form-7/v1/contact-forms/958/feedback',
    method: 'POST',
    jobNumber: jobId,
    postUrl,
    fields: [
      {name:'full-name',label:'שם מלא',tagName:'INPUT',required:true,fieldType:'text'},
      {name:'the-phone',label:'טלפון',tagName:'INPUT',required:true,fieldType:'tel'},
      {name:'the-email',label:'אימייל',tagName:'INPUT',required:true,fieldType:'email'},
      {name:'the-file',label:'קובץ קו\\"ח',tagName:'INPUT',required:true,fieldType:'file'},
      {name:'here-by-friend',label:'הגעתי דרך חבר',tagName:'INPUT',required:false,fieldType:'checkbox'},
      {name:'friend-name',label:'נא לציין את שם החבר',tagName:'INPUT',required:false,fieldType:'text'},
      {name:'job-number',label:'',tagName:'INPUT',required:false,fieldType:'hidden'},
      {name:'post-url',label:'',tagName:'INPUT',required:false,fieldType:'hidden'}
    ]
  });
}
const mk = (item, cls, val) => {
  if (!val) return;
  const s = document.createElement('span');
  s.className = cls; s.style.display = 'none'; s.textContent = val;
  item.appendChild(s);
};
await Promise.all([...document.querySelectorAll('section.jobs-section ul.jobs-list li.jobs-item')].map(async item => {
  if (item.querySelector('.__ai-externalJobId')) return;
  const link = item.querySelector('a.jobs-item-a');
  if (!link) return;
  const detailUrl = link.href;
  const jobId = link.getAttribute('data-jobid') || item.querySelector('.job-orderid')?.textContent?.trim() || '';
  if (jobId) mk(item, '__ai-externalJobId', jobId);
  try {
    const html = await fetch(detailUrl).then(r => r.text());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const content = doc.querySelector('.single-job-content');
    if (content) {
      const loc = extractLocation(content);
      mk(item, '__ai-location', loc);
      const desc = [], req = [];
      let inReq = false;
      for (const el of content.querySelectorAll('h2,h3,h4,p,ul,ol')) {
        if (el.parentElement?.closest('ul,ol') && el.tagName !== 'LI') continue;
        const raw = (el.textContent || '').trim();
        if (!raw || /מיקום/i.test(raw)) continue;
        if (/^H[2-4]$/.test(el.tagName) && /דרישות/i.test(raw)) { inReq = true; continue; }
        const t = structuredText(el);
        if (!t) continue;
        (inReq ? req : desc).push(t);
      }
      mk(item, '__ai-description', desc.join('\\n').trim());
      mk(item, '__ai-requirements', req.join('\\n').trim());
    }
    const app = buildAppInfo(jobId, detailUrl);
    mk(item, '__ai-applicationInfo', app);
  } catch(e) {}
}));`;

const FORM_CAPTURE = {
  formSelector: "form.wpcf7-form",
  actionUrl:
    "https://unioncareer.co.il/wp-json/contact-form-7/v1/contact-forms/958/feedback",
  method: "POST",
  fields: [
    { name: "full-name", label: "שם מלא", tagName: "INPUT", required: true, fieldType: "text" },
    { name: "the-phone", label: "טלפון", tagName: "INPUT", required: true, fieldType: "tel" },
    { name: "the-email", label: "אימייל", tagName: "INPUT", required: true, fieldType: "email" },
    { name: "the-file", label: 'קובץ קו"ח', tagName: "INPUT", required: true, fieldType: "file" },
    { name: "here-by-friend", label: "הגעתי דרך חבר", tagName: "INPUT", required: false, fieldType: "checkbox" },
    { name: "friend-name", label: "נא לציין את שם החבר", tagName: "INPUT", required: false, fieldType: "text" },
    { name: "job-number", label: "", tagName: "INPUT", required: false, fieldType: "hidden" },
    { name: "post-url", label: "", tagName: "INPUT", required: false, fieldType: "hidden" },
  ],
};

const FIELD_MAPPINGS = {
  title: { source: "auto", selector: "h3.job-item-title", confidence: 0.9 },
  location: { source: "auto", selector: ".__ai-location", confidence: 0.9 },
  detailUrl: {
    source: "auto",
    selector: "a.jobs-item-a",
    confidence: 0.9,
    extractAttr: "href",
  },
  department: { source: "auto", selector: ".job-prof-name", confidence: 0.8 },
  description: { source: "auto", selector: ".__ai-description", confidence: 0.85 },
  requirements: { source: "auto", selector: ".__ai-requirements", confidence: 0.85 },
  externalJobId: { source: "auto", selector: ".__ai-externalJobId", confidence: 0.9 },
  applicationInfo: { source: "auto", selector: ".__ai-applicationInfo", confidence: 0.85 },
};

function readToken(): string {
  return fs.readFileSync(TOKEN_PATH, "utf8").trim();
}

async function api(method: string, route: string, body?: unknown) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${readToken()}`,
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json; charset=utf-8";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${route}`, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  await api("PATCH", `/api/sites/${SITE_ID}`, {
    companyName: "לקס מוטורס",
  });
  console.log("companyName → לקס מוטורס");

  await api("PUT", `/api/sites/${SITE_ID}/config`, {
    listingSelector: "section.jobs-section",
    itemSelector: "section.jobs-section ul.jobs-list li.jobs-item",
    fieldMappings: FIELD_MAPPINGS,
    pageFlow: [],
    formCapture: FORM_CAPTURE,
    setupScript: SETUP_SCRIPT,
  });
  console.log("config PUT OK");

  const scrape = (await api("POST", `/api/sites/${SITE_ID}/scrape`, {
    maxJobs: 20,
  })) as { data?: { id: string } };
  console.log("scrape queued:", scrape.data?.id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
