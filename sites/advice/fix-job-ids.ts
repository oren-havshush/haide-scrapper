/**
 * Fix advice.co.il externalJobId: advice-<slug> → h-<hash(slug)> per setupscript-patterns §3.
 */
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "https://scrapper.haide-jobs.co.il";
const SITE_ID = "cmqyjj2ys003901nz9neq0sxw";
const TOKEN_PATH = path.join(process.cwd(), ".claude", "scrap-token");

const SETUP_SCRIPT = `function haideHash(s){var h=5381,i=s.length;while(i){h=(h*33)^s.charCodeAt(--i);}return (h>>>0).toString(36);}
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
    if (iframe) {
      const iframeSrc = iframe.getAttribute('src') || '';
      if (iframeSrc) item.appendChild(mk('__ai-applicationInfo', iframeSrc));
    }
  } catch(e) {}
}));`;

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
  const cfg = (await api("GET", `/api/sites/${SITE_ID}/config`)) as {
    data?: { fieldMappings?: Record<string, unknown>; pageFlow?: unknown[] };
  };
  const fieldMappings = cfg.data?.fieldMappings ?? {};
  await api("PUT", `/api/sites/${SITE_ID}/config`, {
    itemSelector: "div.article-card-wrapper",
    fieldMappings: Object.fromEntries(
      Object.entries(fieldMappings).filter(([k]) => k !== "_meta"),
    ),
    pageFlow: cfg.data?.pageFlow ?? [],
    formCapture: null,
    setupScript: SETUP_SCRIPT,
  });
  console.log("PUT config OK — setupScript now uses h-<hash>");

  const scrape = (await api("POST", `/api/sites/${SITE_ID}/scrape`, {
    maxJobs: 20,
  })) as { data?: { id: string } };
  console.log("Scrape queued:", scrape.data?.id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
