import * as fs from 'fs';
import * as path from 'path';

const URL = 'https://cellcom.co.il/jobs/Careersportal/';

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

const fieldMapping = (selector: string, extra: Record<string, any> = {}) => ({
  selector,
  confidence: 100,
  source: 'MANUAL',
  capturedOnUrl: URL,
  ...extra,
});

const config = {
  itemSelector: '.haide-cellcom-job',
  setupScript: SETUP_SCRIPT,
  fieldMappings: {
    title: fieldMapping('.haide-title'),
    externalJobId: fieldMapping('.haide-codejob'),
    description: fieldMapping('.haide-description'),
    requirements: fieldMapping('.haide-requirements'),
    location: fieldMapping('.haide-location'),
    careerScope: fieldMapping('.haide-scope'),
    brand: fieldMapping('.haide-brand'),
    publishDate: fieldMapping('.haide-publishdate'),
    applicationInfo: fieldMapping('.haide-whatsapp'),
    detailUrl: fieldMapping('.haide-detailurl'),
    isHot: fieldMapping('.haide-ishot'),
  },
  pageFlow: [],
  formCapture: null,
};

const outPath = path.resolve('.scratch', 'cellcom-config.json');
fs.writeFileSync(outPath, JSON.stringify(config, null, 2), 'utf8');
console.log('wrote', outPath, 'bytes=', fs.statSync(outPath).size);
console.log('field count:', Object.keys(config.fieldMappings).length);
console.log('setupScript length:', SETUP_SCRIPT.length);
