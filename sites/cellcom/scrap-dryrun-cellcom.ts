import { chromium } from 'playwright';

const SETUP_SCRIPT = `(async function () {
  try {
    var resp = await fetch('https://contentepi.cellcom.co.il/jobs/Careersportal/?expand=*&currentPageUrl=%2Fjobs%2FCareersportal%2F', {
      headers: { 'Accept': 'application/json' },
      credentials: 'omit',
      mode: 'cors'
    });
    if (!resp.ok) return 0;
    var data = await resp.json();
    var arr = (data.listAdsCareers && data.listAdsCareers.expandedValue) || [];
    var scopeNames = {0:'משרה מלאה',1:'משרה חלקית',2:'משמרות',3:'משרה ללא ניסיון',4:'משרת סטודנט',5:'משרת הורים'};
    var brandNames = {'_cellcom.png':'Cellcom','dynamica.png':'Dynamica','golan.png':'Golan Telecom'};
    var host = document.getElementById('haide-cellcom-jobs');
    if (host) host.remove();
    host = document.createElement('div');
    host.id = 'haide-cellcom-jobs';
    host.style.display = 'none';
    document.body.appendChild(host);
    var v = function (j, k, def) { def = def === undefined ? '' : def; return (j[k] && j[k].value !== undefined && j[k].value !== null) ? j[k].value : def; };
    function set(div, cls, text, isHtml) {
      var el = document.createElement('div');
      el.className = cls;
      if (isHtml) {
        var tmp = document.createElement('div');
        tmp.innerHTML = text || '';
        el.textContent = (tmp.textContent || '').replace(/\\s+/g, ' ').trim();
      } else {
        el.textContent = text != null ? String(text) : '';
      }
      div.appendChild(el);
    }
    for (var i = 0; i < arr.length; i++) {
      var j = arr[i];
      var codeJob = v(j,'codeJob');
      var title = v(j,'title') || j.name || '';
      var description = v(j,'description');
      var requirements = v(j,'listRequirements');
      var locations = (j.listOfCareerLocations && j.listOfCareerLocations.value) || [];
      var scopes = (j.careersScope && j.careersScope.value) || [];
      var isHot = !!v(j,'isHotAd', false);
      var whatsapp = v(j,'whatsappNumber');
      var startPublish = j.startPublish || j.created || '';
      var route = j.routeSegment || '';
      var url = j.url || '';
      var detailUrl = url ? ('https://cellcom.co.il' + url) : '';
      var logoSeg = j.logoIcon && j.logoIcon.expandedValue ? j.logoIcon.expandedValue.routeSegment : '';
      var brand = brandNames[logoSeg] || (logoSeg ? logoSeg.replace(/\\.png$/, '') : '');
      var scopeText = scopes.map(function (s) { return scopeNames[s.careerScope]; }).filter(Boolean).join(', ');
      var locationText = locations.join(', ');
      var div = document.createElement('div');
      div.className = 'haide-cellcom-job';
      set(div, 'haide-title', title);
      set(div, 'haide-codejob', codeJob);
      set(div, 'haide-description', description, true);
      set(div, 'haide-requirements', requirements, true);
      set(div, 'haide-location', locationText);
      set(div, 'haide-scope', scopeText);
      set(div, 'haide-brand', brand);
      set(div, 'haide-publishdate', startPublish);
      set(div, 'haide-whatsapp', whatsapp);
      set(div, 'haide-detailurl', detailUrl);
      set(div, 'haide-route', route);
      set(div, 'haide-ishot', isHot ? '1' : '0');
      host.appendChild(div);
    }
    return arr.length;
  } catch (e) {
    return -1;
  }
})();`;

(async () => {
  const url = process.argv[2];
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { 'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8' },
  });
  const p = await ctx.newPage();

  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await p.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(3000);

  // Run the setup script
  const scriptResult = await p.evaluate(SETUP_SCRIPT);
  console.log('setupScript returned:', scriptResult);

  // Now read items and fields like the worker would
  const result = await p.evaluate(() => {
    const items = document.querySelectorAll('.haide-cellcom-job');
    const fields: Record<string, string> = {
      title: '.haide-title',
      externalJobId: '.haide-codejob',
      description: '.haide-description',
      requirements: '.haide-requirements',
      location: '.haide-location',
      careerScope: '.haide-scope',
      brand: '.haide-brand',
      publishDate: '.haide-publishdate',
      whatsappContact: '.haide-whatsapp',
      detailUrl: '.haide-detailurl',
      isHot: '.haide-ishot',
    };
    const samples: Record<string, string | null>[] = [];
    const limit = Math.min(5, items.length);
    for (let i = 0; i < limit; i++) {
      const it = items[i];
      const rec: Record<string, string | null> = {};
      for (const [name, sel] of Object.entries(fields)) {
        const el = it.querySelector(sel);
        if (!el) { rec[name] = null; continue; }
        const txt = (el.textContent || '').trim();
        rec[name] = txt.length > 100 ? txt.slice(0, 100) + '…' : txt;
      }
      samples.push(rec);
    }
    return { count: items.length, samples };
  });

  console.log(JSON.stringify(result, null, 2));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
