// scripts/enrich-csv.ts
//
// Reads career_pages_israel_updated.csv (in the parent of this project),
// fetches each Career Page with Playwright, runs a battery of detectors
// (ATS / CMS, anti-bot, pagination, structured data, language, rendering,
// IL-filter, approx job count) and writes career_pages_israel_enriched.csv.
//
// Usage from the newscraper project root:
//   npx tsx scripts/enrich-csv.ts                      # full run, defaults
//   npx tsx scripts/enrich-csv.ts -- --limit 3         # first 3 rows only
//   npx tsx scripts/enrich-csv.ts -- --start 50        # skip first 50
//   npx tsx scripts/enrich-csv.ts -- --concurrency 3
//   npx tsx scripts/enrich-csv.ts -- --input <path> --output <path>
//
// Conservative by design: when a detector is not confident it writes
// 'unknown' rather than guessing.

import { chromium, type BrowserContext, type Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

type Row = Record<string, string>;

interface CliArgs {
  input: string;
  output: string;
  limit: number;
  start: number;
  concurrency: number;
  urlColumn: string;
}

interface FetchResult {
  finalUrl: string;
  status: number;
  rawHtml: string;     // pre-JS HTML from response body
  finalHtml: string;   // post-networkidle DOM
  visibleText: string; // body.innerText (post-render)
  responseHeaders: Record<string, string>;
  error?: string;
}

// --------------------------------------------------------------------------
// CSV parse / stringify (handles quoted fields and embedded commas)
// --------------------------------------------------------------------------

function parseCsv(text: string): { header: string[]; rows: Row[] } {
  // Strip BOM and skip blank leading lines until we hit the header.
  const clean = text.replace(/^\uFEFF/, '');
  const lines = splitCsvLines(clean);
  while (lines.length && lines[0].trim() === '') lines.shift();
  if (!lines.length) return { header: [], rows: [] };
  const header = parseCsvLine(lines[0]);
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const fields = parseCsvLine(lines[i]);
    const row: Row = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]] = fields[j] ?? '';
    }
    rows.push(row);
  }
  return { header, rows };
}

// Split a CSV body into logical lines, respecting quoted newlines.
function splitCsvLines(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      cur += c;
    } else if ((c === '\n' || c === '\r') && !inQuotes) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"') inQuotes = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function stringifyCsv(header: string[], rows: Row[]): string {
  const esc = (v: string) => {
    if (v == null) return '';
    if (/[",\r\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  };
  const lines = [header.map(esc).join(',')];
  for (const r of rows) lines.push(header.map(h => esc(r[h] ?? '')).join(','));
  return lines.join('\r\n') + '\r\n';
}

// --------------------------------------------------------------------------
// URL normalization & known multinational IL-filter overrides
// --------------------------------------------------------------------------

function normalizeUrl(u: string): string {
  if (!u) return '';
  let t = u.trim();
  // Collapse embedded whitespace ("guardi core" -> "guardicore").
  t = t.replace(/\s+/g, '');
  // Some "Career Page" values were typed without a TLD ("https://careers.teva").
  // Don't auto-fix those here - leave to the verifier so we know they're broken.
  return t;
}

function isIlMarkedUrl(u: string): boolean {
  const s = u.toLowerCase();
  if (/\bisrael\b/.test(s)) return true;
  if (/[?&](location|locations|country|region)=(israel|il)\b/.test(s)) return true;
  if (/\/(locations?|regions?|countries)\/israel\b/.test(s)) return true;
  if (/israelhome/.test(s)) return true;
  if (/\.co\.il(\/|$)/.test(s)) return true;
  return false;
}

// --------------------------------------------------------------------------
// Detection helpers (pure)
// --------------------------------------------------------------------------

const ATS_SIGNATURES: Array<[RegExp, string]> = [
  // Hosted ATS (most reliable - usually in URL or embed script src)
  [/myworkdayjobs\.com|workday\.com\/staffing/i,            'Workday'],
  [/boards\.greenhouse\.io|embed\.greenhouse\.io|js\.greenhouse\.io|greenhouse-iframe/i, 'Greenhouse'],
  [/jobs\.lever\.co|lever-jobs-embed|jobs-app\.lever\.co/i, 'Lever'],
  [/jobs\.smartrecruiters\.com|api\.smartrecruiters\.com/i, 'SmartRecruiters'],
  [/apply\.workable\.com|workable-iframe|workable\.com\/embed/i, 'Workable'],
  [/\.bamboohr\.com\/(jobs|careers)/i,                       'BambooHR'],
  [/jobs\.jobvite\.com|recruit\.jobvite\.com/i,              'Jobvite'],
  [/career\.successfactors\.com|successfactors\.eu|sapsf\.com/i, 'SuccessFactors'],
  [/taleo\.net/i,                                            'Oracle Taleo'],
  [/\.icims\.com/i,                                          'iCIMS'],
  [/workforcenow\.adp\.com/i,                                'ADP Recruiting'],
  [/comeet\.co|comeet-job-iframe|comeet\.com\/embed/i,       'Comeet'],
  [/niloosoft|hunterhrms|niloo-jobs/i,                       'Niloosoft / HunterHRM'],
  [/breezy\.hr/i,                                            'Breezy HR'],
  [/personio\.com|personio\.de\/embed/i,                     'Personio'],
  [/teamtailor\.com/i,                                       'Teamtailor'],
  [/recruitee\.com/i,                                        'Recruitee'],
  [/ashbyhq\.com|jobs\.ashbyhq\.com/i,                       'Ashby'],
  [/rippling\.com\/recruiting/i,                             'Rippling'],
  [/hire\.withgoogle\.com/i,                                 'Hire by Google'],
  // Aggregator widgets embedded in customer sites
  [/alljobs\.co\.il\/(embed|widget)/i,                       'AllJobs widget'],
  [/drushim\.co\.il\/(embed|widget)/i,                       'Drushim widget'],
  // CMS (fallback - usually means hand-rolled markup on top)
  [/<meta[^>]+name=["']generator["'][^>]+content=["']WordPress/i, 'WordPress'],
  [/wp-content\/(plugins|themes|uploads)|wp-includes\//i,    'WordPress'],
  [/wix\.com\/_partials|static\.wixstatic\.com|x-wix-/i,     'Wix'],
  [/(squarespace\.com|sqsp\.net|squarespace-cdn\.com)/i,     'Squarespace'],
  [/cdn\.shopify\.com|Shopify\.theme/i,                      'Shopify'],
  [/<meta[^>]+name=["']generator["'][^>]+content=["']Drupal/i,'Drupal'],
];

function detectAts(html: string, finalUrl: string): string {
  const haystack = finalUrl + '\n' + html;
  for (const [re, name] of ATS_SIGNATURES) {
    if (re.test(haystack)) return name;
  }
  return 'Custom / unknown';
}

function detectAntiBot(html: string, headers: Record<string, string>): string {
  const h = Object.entries(headers).map(([k, v]) => `${k}:${v}`).join('\n').toLowerCase();
  const ht = html.toLowerCase();
  if (h.includes('cf-ray') || h.includes('cf-mitigated') || /just a moment\.\.\.|cf_chl_|challenge-platform|cloudflare/.test(ht)) return 'Cloudflare';
  if (/x-rbz-|rbzns\.|rbz-/.test(h) || /rbzid|rbzsessionid/.test(ht)) return 'Reblaze';
  if (h.includes('x-akamai') || /_abck|akamaihd\.net|akam-/.test(ht)) return 'Akamai';
  if (h.includes('x-datadome') || /datadome\.js|dd_cookie_test/.test(ht)) return 'DataDome';
  if (h.includes('x-iinfo') || /incapsula|_incap_/.test(ht)) return 'Imperva Incapsula';
  if (/perimeterx|_pxhd/.test(ht)) return 'PerimeterX';
  return 'none';
}

function detectPagination(html: string): string {
  // Order matters: load-more wins over numbered because they often coexist
  // in the page's footer markup.
  if (/\b(load[\s-]?more|show[\s-]?more|view[\s-]?more)\b/i.test(html)) return 'load-more-button';
  if (/(טען[\s-]?עוד|הצג[\s-]?עוד|טעינת[\s-]?עוד)/.test(html))         return 'load-more-button';
  if (/class=["'][^"']*\b(pagination|page-numbers|paginator|pager)\b/i.test(html)) return 'numbered';
  if (/<nav[^>]+(aria-label=["'][^"']*pag|class=["'][^"']*pag)/i.test(html))       return 'numbered';
  if (/IntersectionObserver|infinite[\s-]?scroll|data-infinite/i.test(html))       return 'infinite-scroll';
  return 'unknown';
}

function detectStructuredData(html: string): string {
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const b of blocks) {
    if (/@type["']?\s*:\s*["']?JobPosting/i.test(b)) return 'JobPosting JSON-LD';
  }
  return 'none';
}

function detectLanguageRtl(html: string): string {
  const m1 = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
  const m2 = html.match(/<html[^>]+dir=["']([^"']+)["']/i);
  const lang = (m1?.[1] || '').toLowerCase();
  const dir  = (m2?.[1] || '').toLowerCase();
  if (lang.startsWith('he') || dir === 'rtl') return 'he-IL';
  if (lang.startsWith('en')) return 'en';
  return lang || 'unknown';
}

function detectRendering(rawHtml: string, finalHtml: string): string {
  // Strip <script> and <style> contents so payload size comparison is meaningful.
  const strip = (s: string) =>
    s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
     .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
     .replace(/<!--[\s\S]*?-->/g, '');
  const r = strip(rawHtml).length;
  const f = strip(finalHtml).length;
  // Count plausible job-listing markers in raw (pre-JS) HTML.
  const jobMarkersRaw = (rawHtml.match(/job|position|career|משרה|תפקיד|opening/gi) || []).length;
  if (r < 5000 || (f > r * 2 && r < 30000)) return 'CSR-SPA';
  if (jobMarkersRaw >= 15) return 'SSR';
  return 'Hybrid';
}

function detectAuthRequired(html: string): string {
  // A login form right on the careers page is the hint. We need both a
  // password input AND career-page-ish copy nearby.
  if (/<input[^>]+type=["']password["']/i.test(html)) {
    if (/(sign in to view|please log in to see (open )?(jobs|positions))/i.test(html)) return 'yes';
  }
  return 'no';
}

function extractJobCount(visibleText: string): string {
  const patterns: Array<RegExp> = [
    /showing\s+(\d+)\s+of\s+(\d+)/i,
    /(\d+)\s*(?:-|–)\s*\d+\s+of\s+(\d+)\s+jobs?/i,
    /(\d+)\s+(?:open\s+)?(?:jobs?|positions?|roles?|openings?|vacancies)/i,
    /(\d{1,4})\s+(?:משרות|תפקידים|הזדמנויות|משרות פתוחות)/,
    /found\s+(\d+)\s+(?:jobs?|results)/i,
    /(\d+)\s+results/i,
  ];
  for (const p of patterns) {
    const m = visibleText.match(p);
    if (m) {
      if (m[2]) return `${m[1]} of ${m[2]} (extracted)`;
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > 0 && n < 10000) return `${n} (extracted)`;
    }
  }
  return '';
}

// --------------------------------------------------------------------------
// Per-row fetch + enrichment
// --------------------------------------------------------------------------

async function fetchPage(ctx: BrowserContext, url: string): Promise<FetchResult> {
  const page: Page = await ctx.newPage();
  const result: FetchResult = {
    finalUrl: url,
    status: 0,
    rawHtml: '',
    finalHtml: '',
    visibleText: '',
    responseHeaders: {},
  };
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!resp) {
      result.error = 'no-response';
      return result;
    }
    result.status = resp.status();
    result.finalUrl = page.url();
    result.responseHeaders = resp.headers();
    try { result.rawHtml = await resp.text(); } catch { /* binary or already consumed */ }
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    result.finalHtml = await page.content();
    result.visibleText = await page.evaluate(() => (document.body?.innerText || '').slice(0, 20000)).catch(() => '');
  } catch (e: any) {
    const raw = (e?.message || String(e));
    // Playwright shoves a multi-line "Call log:" block into errors; chop it off
    // and collapse whitespace so we get a single-line note in the CSV.
    result.error = raw
      .split(/\r?\nCall log/i)[0]
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  } finally {
    await page.close().catch(() => {});
  }
  return result;
}

function classifyVerified(orig: string, normalized: string, r: FetchResult): string {
  if (r.error) {
    if (/timeout/i.test(r.error)) return 'no_timeout';
    if (/ERR_NAME_NOT_RESOLVED|getaddrinfo|ENOTFOUND/i.test(r.error)) return 'no_dns';
    return `no_error:${r.error.slice(0, 60)}`;
  }
  if (!r.status) return 'no_no_status';
  if (r.status >= 400) return `no_${r.status}`;
  const sameHost = (() => {
    try { return new URL(orig).host === new URL(r.finalUrl).host; } catch { return false; }
  })();
  if (!sameHost) return `redirected_to:${r.finalUrl}`;
  if (orig !== normalized) return 'yes_url_fixed';
  return 'yes';
}

async function enrichRow(ctx: BrowserContext, row: Row, urlColumn: string): Promise<Row> {
  const origUrl = row[urlColumn] || '';
  const normalized = normalizeUrl(origUrl);
  const out: Row = { ...row };

  // Pre-fix existing data
  if (origUrl !== normalized) {
    out[urlColumn] = normalized; // fix typo'd URLs like "guardi core.com"
    out['notes'] = appendNote(out['notes'], `URL whitespace fixed ("${origUrl}" -> "${normalized}")`);
  }
  if (/^30\+\s*jobs$/i.test((out['Estimated Jobs'] || '').trim())) {
    out['Estimated Jobs'] = ''; // drop the bogus placeholder; we'll refill from page
  }
  // Drop "Built In article" hand-wave too.
  if (/built\s+in\s+article/i.test(out['Estimated Jobs'] || '')) {
    out['Estimated Jobs'] = '';
  }

  // Guard against obviously broken URLs (missing TLD).
  if (!/^https?:\/\/[^/]+\.[a-z]{2,}/i.test(normalized)) {
    out['careers_url_verified'] = 'no_invalid_url';
    out['final_url']            = '';
    out['http_status']          = '';
    out['ats_or_cms']           = 'unknown';
    out['rendering']            = 'unknown';
    out['pagination']           = 'unknown';
    out['anti_bot']             = 'unknown';
    out['language_rtl']         = 'unknown';
    out['structured_data']      = 'unknown';
    out['auth_required']        = 'unknown';
    out['israel_filtered_url']  = isIlMarkedUrl(normalized) ? normalized : 'needs-manual-research';
    out['detected_job_count']   = '';
    out['enrichment_notes']     = 'URL appears malformed (missing TLD?). Skipped fetch.';
    return out;
  }

  const r = await fetchPage(ctx, normalized);
  out['final_url']    = r.finalUrl || '';
  out['http_status']  = r.status ? String(r.status) : '';

  out['careers_url_verified'] = classifyVerified(origUrl, normalized, r);

  if (r.error || r.status >= 400 || !r.finalHtml) {
    out['ats_or_cms']           = 'unknown';
    out['rendering']            = 'unknown';
    out['pagination']           = 'unknown';
    out['anti_bot']             = r.error ? 'unknown' : detectAntiBot(r.rawHtml, r.responseHeaders);
    out['language_rtl']         = 'unknown';
    out['structured_data']      = 'unknown';
    out['auth_required']        = 'unknown';
    out['israel_filtered_url']  = isIlMarkedUrl(r.finalUrl || normalized) ? (r.finalUrl || normalized) : 'needs-manual-research';
    out['detected_job_count']   = '';
    out['enrichment_notes']     = r.error || `HTTP ${r.status}`;
    return out;
  }

  const ats  = detectAts(r.finalHtml, r.finalUrl);
  const anti = detectAntiBot(r.finalHtml, r.responseHeaders);
  out['ats_or_cms']          = ats;
  out['rendering']           = detectRendering(r.rawHtml, r.finalHtml);
  out['pagination']          = detectPagination(r.finalHtml);
  out['anti_bot']            = anti;
  out['language_rtl']        = detectLanguageRtl(r.finalHtml);
  out['structured_data']     = detectStructuredData(r.finalHtml);
  out['auth_required']       = detectAuthRequired(r.finalHtml);
  out['israel_filtered_url'] = isIlMarkedUrl(r.finalUrl) ? r.finalUrl : 'needs-manual-research';

  const jc = extractJobCount(r.visibleText);
  if (jc) {
    out['detected_job_count'] = jc;
    if (!out['Estimated Jobs']) out['Estimated Jobs'] = jc; // backfill original column too
  } else {
    out['detected_job_count'] = '';
  }

  // Skip-reason heuristics. Conservative: only set when we're confident.
  let skip = '';
  if (anti === 'Cloudflare' && /just a moment|challenge-platform/i.test(r.finalHtml)) skip = 'cloudflare-hard';
  if (out['pagination'] === 'load-more-button') skip = skip || 'load-more-button';
  if (out['pagination'] === 'numbered')         skip = skip || 'numbered-pagination';
  if (out['auth_required'] === 'yes')           skip = skip || 'login-wall';
  if (!out['skip_reason']) out['skip_reason'] = skip;

  // listing_type and requires_filter remain unknown (need detail-page sampling).
  if (!out['listing_type'])     out['listing_type']     = 'unknown';
  if (!out['requires_filter'])  out['requires_filter']  = 'unknown';
  if (!out['detail_url_pattern']) out['detail_url_pattern'] = '';

  return out;
}

function appendNote(existing: string, note: string): string {
  if (!existing) return note;
  if (existing.includes(note)) return existing;
  return existing + '; ' + note;
}

// --------------------------------------------------------------------------
// Concurrency
// --------------------------------------------------------------------------

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function loop() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => loop()));
  return results;
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

function parseArgs(argv: string[]): CliArgs {
  const a: CliArgs = {
    input:       path.resolve(process.cwd(), '..', 'career_pages_israel_updated.csv'),
    output:      path.resolve(process.cwd(), '..', 'career_pages_israel_enriched.csv'),
    limit:       0,
    start:       0,
    concurrency: 4,
    urlColumn:   'Career Page',
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--input')           { a.input = path.resolve(v); i++; }
    else if (k === '--output')     { a.output = path.resolve(v); i++; }
    else if (k === '--limit')      { a.limit = parseInt(v, 10) || 0; i++; }
    else if (k === '--start')      { a.start = parseInt(v, 10) || 0; i++; }
    else if (k === '--concurrency') { a.concurrency = Math.max(1, parseInt(v, 10) || 1); i++; }
    else if (k === '--url-column') { a.urlColumn = v; i++; }
  }
  return a;
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[enrich] input  = ${args.input}`);
  console.log(`[enrich] output = ${args.output}`);
  console.log(`[enrich] start=${args.start} limit=${args.limit || 'all'} concurrency=${args.concurrency}`);

  if (!fs.existsSync(args.input)) {
    throw new Error(`Input CSV not found at ${args.input}`);
  }
  const raw = fs.readFileSync(args.input, 'utf8');
  const { header, rows } = parseCsv(raw);
  console.log(`[enrich] parsed: ${rows.length} rows, ${header.length} columns`);

  // Final output header: original columns + any new ones we add. Use a
  // stable, predictable order so diffs against the previous file are easy.
  const ensureCols = [
    'careers_url_verified', 'ats_or_cms', 'rendering', 'listing_type',
    'pagination', 'detail_url_pattern', 'anti_bot', 'language_rtl',
    'structured_data', 'auth_required', 'requires_filter',
    'israel_filtered_url', 'skip_reason', 'notes',
    'final_url', 'http_status', 'detected_job_count', 'enrichment_notes',
  ];
  const outHeader = [...header];
  for (const c of ensureCols) if (!outHeader.includes(c)) outHeader.push(c);

  // Slice rows per --start / --limit.
  let slice = rows.slice(args.start);
  if (args.limit > 0) slice = slice.slice(0, args.limit);
  console.log(`[enrich] processing ${slice.length} rows`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  let done = 0;
  const t0 = Date.now();
  const enriched = await runPool(slice, args.concurrency, async (row, idx) => {
    const out = await enrichRow(ctx, row, args.urlColumn);
    done++;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const label = (row['Company'] || '(unknown)').slice(0, 28).padEnd(28);
    console.log(
      `[${String(done).padStart(3)}/${slice.length}] ` +
      `t=${elapsed}s  ${label}  verified=${out['careers_url_verified']}  ` +
      `ats=${out['ats_or_cms']}  pag=${out['pagination']}  bot=${out['anti_bot']}`,
    );
    return out;
  });

  await ctx.close();
  await browser.close();

  // Re-assemble final rows: untouched portion + enriched portion.
  const finalRows: Row[] = [];
  for (let i = 0; i < args.start; i++) finalRows.push(rows[i]);
  for (const r of enriched) finalRows.push(r);
  for (let i = args.start + enriched.length; i < rows.length; i++) finalRows.push(rows[i]);

  fs.writeFileSync(args.output, stringifyCsv(outHeader, finalRows), { encoding: 'utf8' });
  console.log(`[enrich] wrote ${finalRows.length} rows to ${args.output}`);
  console.log(`[enrich] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
