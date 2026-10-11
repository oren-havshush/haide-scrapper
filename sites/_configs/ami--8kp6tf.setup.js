// ami.co.il/career-open-positions: Elementor nested accordion, listing-only, no detail pages.
//
// Each job is one details.e-n-accordion-item: the summary holds the title; the region holds
// widgets in order: heading "תיאור המשרה:" -> text-editor (role text), heading "דרישות המשרה"
// -> icon-list (requirements), then the job's own Elementor apply form.
//
// - title: the summary text as printed (no job number in it).
// - externalJobId: the job code the page carries in its own apply form, a hidden
//   form_fields[...] input with value "JB-40" (one job writes it "jb-98"); stored as ami-JB-<n>,
//   letters upper-cased as on allegronet. Not shown to visitors, but it is the employer's own
//   per-job code and the form sends it with every application. No code -> no id emitted; the
//   worker then makes its own h- id.
// - description / requirements: routed by the two headings; the labels themselves are dropped;
//   the form, its consent text and the submit button never enter either field. Lines keep
//   their breaks (<br> lines become paragraphs, list items stay list items). Text as printed.
// - location: only from a cue line in the role text that places the job ("להצטרף לצוות ...
//   ב<place>", "מקום העבודה"), matched against a closed list of city.csv rows. The head-office
//   line ("מטה החברה נמצא ב...") never counts. No place but "ברחבי הארץ" in the role text ->
//   "פריסה ארצית" (owner, 2026-10-11). Nothing -> "Unknown", injected so the worker's gazetteer
//   does not guess from prose.
var ITEM_SEL = '.e-n-accordion-item';
var PLACES = ['ראש העין']; // verbatim in CSV files/city.csv
var CUE = /(להצטרף\s+ל\S*\s*\S*|מקום\s+העבודה|העבודה\s+ממוקמת|ממוקמ\S*)/;
var NOT_CUE = /מטה\s+החברה/;
var NATION = /ברחבי\s+הארץ/;

var items = document.querySelectorAll(ITEM_SEL);
for (var i = 0; i < items.length; i++) {
  var item = items[i];
  try {
    if (item.querySelector('.__ai-title')) continue; // re-run guard

    var t = item.querySelector('.e-n-accordion-item-title-text') || item.querySelector('summary');
    var title = t ? (t.textContent || '').replace(/\s+/g, ' ').trim() : '';

    var region = item.querySelector('[role="region"]');
    var widgets = region ? region.querySelectorAll('[data-widget_type]') : [];
    var desc = [], req = [], mode = 'desc';
    for (var w = 0; w < widgets.length; w++) {
      var wd = widgets[w];
      var type = wd.getAttribute('data-widget_type') || '';
      if (type.indexOf('heading') === 0) {
        var h = (wd.textContent || '').replace(/\s+/g, ' ').trim();
        if (/^דרישות/.test(h)) mode = 'req';
        else if (/^תיאור/.test(h)) mode = 'desc';
        continue;
      }
      if (type.indexOf('text-editor') !== 0 && type.indexOf('icon-list') !== 0) continue; // form etc.
      var target = mode === 'req' ? req : desc;
      var c = wd.cloneNode(true);
      c.querySelectorAll('svg,style,script,form').forEach(function (e) { e.remove(); });
      var blocks = c.querySelectorAll('p, li');
      for (var b = 0; b < blocks.length; b++) {
        var el = blocks[b];
        if (el.tagName === 'P' && el.closest('li')) continue;
        if (el.tagName === 'LI') {
          var lt = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (lt) target.push({ li: true, text: lt });
          continue;
        }
        var cl = el.cloneNode(true);
        cl.querySelectorAll('br').forEach(function (br) { br.replaceWith('\n'); });
        var lines = (cl.textContent || '').split('\n');
        for (var k = 0; k < lines.length; k++) {
          var ln = lines[k].replace(/\s+/g, ' ').trim();
          if (ln) target.push({ li: false, text: ln });
        }
      }
    }

    var id = '';
    var hid = item.querySelectorAll('form input[type="hidden"][name^="form_fields["]');
    for (var x = 0; x < hid.length; x++) {
      var v = (hid[x].getAttribute('value') || '').trim();
      var m = /^([A-Za-z]+)-(\d+)$/.exec(v);
      if (m) { id = 'ami-' + m[1].toUpperCase() + '-' + m[2]; break; }
    }

    var places = [];
    for (var d = 0; d < desc.length; d++) {
      var s = desc[d].text;
      if (!CUE.test(s) || NOT_CUE.test(s)) continue;
      for (var p = 0; p < PLACES.length; p++) {
        if (s.indexOf('ב' + PLACES[p]) >= 0 && places.indexOf(PLACES[p]) < 0) places.push(PLACES[p]);
      }
    }

    var add = function (cls, val) {
      var wrap = document.createElement('div');
      wrap.className = cls;
      wrap.style.display = 'none';
      if (typeof val === 'string') { wrap.textContent = val; item.appendChild(wrap); return; }
      var ul = null;
      for (var q = 0; q < val.length; q++) {
        if (val[q].li) {
          if (!ul) { ul = document.createElement('ul'); wrap.appendChild(ul); }
          var li = document.createElement('li');
          li.textContent = val[q].text;
          ul.appendChild(li);
        } else {
          ul = null;
          var pp = document.createElement('p');
          pp.textContent = val[q].text;
          wrap.appendChild(pp);
        }
      }
      item.appendChild(wrap);
    };
    add('__ai-title', title);
    add('__ai-description', desc);
    add('__ai-requirements', req);
    // owner 2026-10-11: a field/travel job whose role text says "ברחבי הארץ" (and names no
    // place) is nationwide -> the city.csv row "פריסה ארצית"
    if (!places.length) {
      for (var n = 0; n < desc.length; n++) if (NATION.test(desc[n].text)) { places.push('פריסה ארצית'); break; }
    }
    add('__ai-location', places.length ? places.join(', ') : 'Unknown');
    if (id) add('__ai-jobid', id);

    // The job's own apply form (owner, 2026-10-11: per-job forms). Each item carries its own
    // Elementor form whose form_id, job code and phone field name differ per job; read it as
    // the page has it, hidden values included, and hand it to the worker as this job's form.
    // The form has no action attribute: Elementor posts it to admin-ajax.php by script.
    var fm = item.querySelector('form.elementor-form');
    if (fm) {
      var fields = [];
      var els = fm.querySelectorAll('input, select, textarea');
      for (var e = 0; e < els.length; e++) {
        var fe = els[e];
        var ft = (fe.getAttribute('type') || fe.tagName).toLowerCase();
        if (ft === 'submit' || ft === 'button' || ft === 'reset' || ft === 'image' || !fe.name) continue;
        var lab = fe.id ? fm.querySelector('label[for="' + fe.id + '"]') : null;
        var fo = { name: fe.name, label: lab ? (lab.textContent || '').replace(/\s+/g, ' ').trim() : '',
          fieldType: ft, required: fe.hasAttribute('required'), tagName: fe.tagName };
        if (ft === 'hidden') fo.value = fe.getAttribute('value') || '';
        if (ft === 'file' && fe.getAttribute('accept')) fo.accept = fe.getAttribute('accept');
        if (ft === 'file' && fe.hasAttribute('multiple')) fo.multiple = true;
        fields.push(fo);
      }
      var blob = JSON.stringify({ actionUrl: location.origin + '/wp-admin/admin-ajax.php', actionAttribute: '',
        method: (fm.getAttribute('method') || 'post').toUpperCase(), fields: fields });
      add('__ai-applicationInfo', blob);
      add('__ai-formData', blob);
    }
  } catch (e) { /* one bad item never stops the rest */ }
}
