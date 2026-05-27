/**
 * Generic per-site form-schema probe.
 *
 * Reads stored site config (itemSelector + existing setupScript) from JSON file,
 * loads the listing page, runs the stored setupScript, then enumerates per-item
 * forms and reports: { count, itemsWithForm, sampleSchema, allActions }.
 *
 * Usage: npx tsx form-probe.ts <configJsonPath> <listingUrl>
 *
 * The config JSON shape expected: the `data` block returned by GET /api/sites/:id/config,
 * or any object with `data.fieldMappings._meta.{itemSelector,setupScript}`.
 */
import { chromium } from 'playwright';
import * as fs from 'fs';

const FORM_HELPER = `
(function () {
  function extractFormSchema(form) {
    var action = form.getAttribute('action') || '';
    var method = (form.getAttribute('method') || 'GET').toUpperCase();
    var fields = [];
    var els = form.querySelectorAll('input, select, textarea');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var tag = el.tagName.toLowerCase();
      var type = tag === 'input' ? ((el.getAttribute('type') || 'text').toLowerCase()) : tag;
      if (type === 'submit' || type === 'button' || type === 'image' || type === 'reset') continue;
      var name = el.getAttribute('name') || '';
      var style = (el.getAttribute('style') || '').toLowerCase();
      var isOffscreen = style.indexOf('-99999') !== -1 || style.indexOf('display:none !important') !== -1 || style.indexOf('display: none !important') !== -1;
      var isHpName = /\\b(hp[_-]|honeypot|maspik|nickname)/i.test(name + ' ' + (el.id || '') + ' ' + (el.className || ''));
      if ((isOffscreen || isHpName) && type !== 'hidden') continue;
      var label = '';
      if (el.id) {
        var safe = el.id.replace(/"/g, '\\\\"');
        var lab = form.querySelector('label[for="' + safe + '"]');
        if (lab) label = (lab.textContent || '').replace(/\\s+/g, ' ').trim();
      }
      if (!label) {
        var parentLabel = el.closest('label');
        if (parentLabel) label = (parentLabel.textContent || '').replace(/\\s+/g, ' ').trim();
      }
      if (!label) label = el.getAttribute('placeholder') || el.getAttribute('aria-label') || '';
      var required = el.hasAttribute('required') || el.getAttribute('aria-required') === 'true';
      var rec = { name: name, fieldType: type, label: label, required: required, tagName: tag };
      if (type === 'hidden') rec.value = el.getAttribute('value') || '';
      if (type === 'file') {
        var accept = el.getAttribute('accept');
        if (accept) rec.accept = accept;
      }
      if (tag === 'select') {
        var opts = el.querySelectorAll('option'); var options = [];
        for (var k = 0; k < opts.length; k++) {
          options.push({ value: opts[k].value, label: (opts[k].textContent || '').replace(/\\s+/g, ' ').trim() });
        }
        rec.options = options;
      }
      fields.push(rec);
    }
    return { actionUrl: action, method: method, fields: fields };
  }
  function pickForm(scope) {
    var forms = scope.querySelectorAll('form');
    var best = null, bestScore = -1;
    for (var i = 0; i < forms.length; i++) {
      var f = forms[i];
      var name = (f.getAttribute('name') || '').toLowerCase();
      var role = (f.getAttribute('role') || '').toLowerCase();
      if (role === 'search' || /search/.test(name)) continue;
      var inputs = f.querySelectorAll('input:not([type="hidden"]), select, textarea');
      var visibleCount = 0;
      for (var j = 0; j < inputs.length; j++) {
        var t = (inputs[j].getAttribute('type') || '').toLowerCase();
        if (t === 'submit' || t === 'button' || t === 'image' || t === 'reset') continue;
        visibleCount++;
      }
      if (visibleCount > bestScore) { bestScore = visibleCount; best = f; }
    }
    return bestScore >= 1 ? best : null;
  }
  window.__haide_extractFormSchema = extractFormSchema;
  window.__haide_pickForm = pickForm;
})();
`;

(async () => {
  const cfgPath = process.argv[2];
  const url = process.argv[3];
  if (!cfgPath || !url) { console.error('usage: form-probe.ts <configJson> <url>'); process.exit(2); }
  const cfgRaw = fs.readFileSync(cfgPath, 'utf8');
  const cfg = JSON.parse(cfgRaw);
  const meta = (cfg && cfg.data && cfg.data.fieldMappings && cfg.data.fieldMappings._meta) || {};
  const itemSelector = meta.itemSelector;
  const existingSetup = meta.setupScript || '';
  if (!itemSelector) { console.error('no itemSelector in config'); process.exit(2); }

  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  const p = await ctx.newPage();
  let navOk = true;
  try {
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  } catch (e: any) {
    navOk = false;
    console.log(JSON.stringify({ url, error: 'nav_failed', message: String(e && e.message || e) }));
    await b.close();
    return;
  }

  if (existingSetup) {
    try { await p.evaluate(existingSetup); } catch (e: any) {
      console.error('existing setupScript threw:', String(e && e.message || e));
    }
  }
  await p.evaluate(FORM_HELPER);

  const out = await p.evaluate((args) => {
    const itemSel: string = args.itemSel;
    const items = document.querySelectorAll(itemSel);
    const itemCount = items.length;
    let withForm = 0;
    let withMultiForm = 0;
    let actions: Record<string, number> = {};
    let firstSchema: any = null;
    let schemaShapeSig: string | null = null;
    let differingShapeFound = false;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const f = (window as any).__haide_pickForm(it);
      if (!f) continue;
      withForm++;
      const allForms = it.querySelectorAll('form');
      if (allForms.length > 1) withMultiForm++;
      const schema = (window as any).__haide_extractFormSchema(f);
      const sig = (schema.fields || []).map((x: any) => x.name + ':' + x.fieldType).join('|');
      if (!firstSchema) { firstSchema = schema; schemaShapeSig = sig; }
      else if (sig !== schemaShapeSig) { differingShapeFound = true; }
      const ak = schema.actionUrl || '(empty)';
      actions[ak] = (actions[ak] || 0) + 1;
    }
    return {
      itemCount, withForm, withMultiForm,
      actions, sampleSchema: firstSchema,
      schemasIdentical: !differingShapeFound,
    };
  }, { itemSel: itemSelector });

  console.log(JSON.stringify({ url, ...out }, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
