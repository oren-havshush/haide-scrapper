/**
 * advice.co.il — refresh setupScript:
 * - externalJobId: h-<hash(slug)>
 * - applicationInfo + _formData: MagicNet CV uploader as POST multipart form JSON
 */
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "https://scrapper.haide-jobs.co.il";
const SITE_ID = "cmqyjj2ys003901nz9neq0sxw";
const TOKEN_PATH = path.join(process.cwd(), ".claude", "scrap-token");

const SETUP_SCRIPT = `function haideHash(s){var h=5381,i=s.length;while(i){h=(h*33)^s.charCodeAt(--i);}return (h>>>0).toString(36);}
function buildAppInfo(iframeSrc){
  var actionUrl = iframeSrc.startsWith('http') ? iframeSrc : new URL(iframeSrc, 'https://cv.magicnet.co.il').href;
  return JSON.stringify({
    actionUrl: actionUrl,
    method: 'POST',
    enctype: 'multipart/form-data',
    fields: [
      { name: 'FileUpload1', label: 'קורות חיים', tagName: 'INPUT', required: true, fieldType: 'file' },
      { name: '__VIEWSTATE', label: '', tagName: 'INPUT', required: false, fieldType: 'hidden' },
      { name: '__VIEWSTATEGENERATOR', label: '', tagName: 'INPUT', required: false, fieldType: 'hidden' },
      { name: '__EVENTVALIDATION', label: '', tagName: 'INPUT', required: false, fieldType: 'hidden' }
    ]
  });
}
await Promise.all([...document.querySelectorAll('div.article-card-wrapper')].map(async item => {
  if (item.querySelector('.__ai-externalJobId')) return;
  const link = item.querySelector('a.article-card__title');
  if (!link) return;
  const href = link.getAttribute('href') || '';
  const slug = href.split('/').filter(Boolean).pop() || '';
  const title = (link.textContent || link.innerText || '').trim();
  const key = slug || title.toLowerCase().replace(/\\s+/g, ' ').trim();
  const fullUrl = href.startsWith('http') ? href : (location.origin + href);

  const mk = (cls, val) => { const s = document.createElement('span'); s.className = cls; s.textContent = val; return s; };
  item.appendChild(mk('__ai-externalJobId', 'h-' + haideHash(key)));

  try {
    const resp = await fetch(fullUrl);
    const html = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const contentEl = doc.querySelector('.article-template__content');
    if (contentEl) {
      const text = (contentEl.innerText || contentEl.textContent || '').trim();
      if (text) item.appendChild(mk('__ai-description', text));
    }

    const iframe = doc.querySelector('iframe[src*="cv.magicnet.co.il"]');
    const iframeSrc = iframe ? (iframe.getAttribute('src') || '') : '';
    if (!iframeSrc) return;
    const appJson = buildAppInfo(iframeSrc);
    item.appendChild(mk('__ai-applicationInfo', appJson));
    item.appendChild(mk('__ai-formData', appJson));
  } catch(e) {}
}));`;

const FIELD_MAPPINGS = {
  title: { source: "auto", selector: "a.article-card__title", confidence: 0.9 },
  detailUrl: {
    source: "auto",
    selector: "a.article-card__title",
    confidence: 0.9,
    extractAttr: "href",
  },
  description: { source: "auto", selector: ".__ai-description", confidence: 0.85 },
  externalJobId: { source: "auto", selector: ".__ai-externalJobId", confidence: 0.9 },
  applicationInfo: {
    source: "auto",
    selector: ".__ai-applicationInfo",
    confidence: 0.85,
  },
  _formData: { source: "auto", selector: ".__ai-formData", confidence: 0.85 },
};

function readToken(): string {
  return fs.readFileSync(TOKEN_PATH, "utf8").trim();
}

async function api(
  method: string,
  route: string,
  body?: unknown,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${readToken()}`,
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${route}`, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  await api("PUT", `/api/sites/${SITE_ID}/config`, {
    itemSelector: "div.article-card-wrapper",
    fieldMappings: FIELD_MAPPINGS,
    pageFlow: [],
    formCapture: null,
    locationFallback: "כפר סבא",
    setupScript: SETUP_SCRIPT,
  });
  console.log("PUT config OK — applicationInfo is POST form JSON");

  const scrape = (await api("POST", `/api/sites/${SITE_ID}/scrape`, {
    maxJobs: 20,
  })) as { data?: { id: string } };
  console.log("Scrape queued:", scrape.data?.id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
