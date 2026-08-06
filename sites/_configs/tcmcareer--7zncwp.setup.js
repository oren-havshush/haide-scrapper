const ul = document.querySelector('ul.job_listings');
if (ul) {
  const origin = location.origin || 'https://tcmcareer.com';
  const rest = origin + '/wp-json/wp/v2/';
  ul.innerHTML = '';

  // 1) region taxonomy id -> name
  const regions = {};
  try {
    const terms = await fetch(rest + 'job_listing_region?per_page=100&_fields=id,name').then(r=>r.json());
    if (Array.isArray(terms)) terms.forEach(t => { regions[t.id] = decodeEnt(t.name); });
  } catch(e) {}

  // 2) all job listings (paged, 100 at a time)
  const jobs = [];
  for (let page = 1; page <= 30; page++) {
    let arr = null;
    try {
      arr = await fetch(rest + 'job-listings?per_page=100&orderby=date&order=desc&page=' + page +
        '&_fields=id,link,date,title,content,job_listing_region,meta').then(r => r.ok ? r.json() : null);
    } catch(e) { break; }
    if (!Array.isArray(arr) || arr.length === 0) break;
    arr.forEach(j => jobs.push(j));
    if (arr.length < 100) break;
  }

  const seen = new Set();
  jobs.forEach(j => {
    const id = String(j.id || '');
    if (!id || seen.has(id)) return;
    seen.add(id);

    const li = document.createElement('li');
    li.className = 'job_listing';
    li.id = 'job_listing-' + id;

    const a = document.createElement('a');
    a.className = 'job_listing-clickbox';
    a.setAttribute('href', j.link || '');
    li.appendChild(a);

    const h3 = document.createElement('h3');
    h3.className = 'job_listing-title';
    h3.textContent = decodeEnt((j.title && j.title.rendered) || '');
    li.appendChild(h3);

    const loc = document.createElement('div');
    loc.className = 'job_listing-location';
    let locName = (j.meta && j.meta._job_location) || '';
    if (!locName && Array.isArray(j.job_listing_region)) locName = j.job_listing_region.map(r => regions[r]).filter(Boolean).join(', ');
    loc.textContent = locName || '';
    li.appendChild(loc);

    addSpan(li, '__ai-jobid', id);
    if (j.date) addSpan(li, '__ai-date', String(j.date).slice(0, 10));
    const desc = structuredText((j.content && j.content.rendered) || '');
    if (desc) addSpan(li, '__ai-description', desc);
    const app = j.meta && j.meta._application;
    if (app) addSpan(li, '__ai-apply', String(app));

    ul.appendChild(li);
  });
}

function addSpan(li, cls, val) {
  const s = document.createElement('span');
  s.className = cls; s.style.display = 'none'; s.textContent = val;
  li.appendChild(s);
}
function decodeEnt(s) {
  if (!s) return '';
  const ta = document.createElement('textarea');
  ta.innerHTML = s; let out = ta.value;
  if (/&[a-z#0-9]+;/i.test(out)) { ta.innerHTML = out; out = ta.value; }
  return out;
}
function structuredText(htmlStr) {
  if (!htmlStr) return '';
  const doc = new DOMParser().parseFromString(htmlStr, 'text/html');
  const c = doc.body;
  if (!c) return '';
  c.querySelectorAll('script,style').forEach(n => n.remove());
  c.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
  c.querySelectorAll('li').forEach(n => { n.insertBefore(doc.createTextNode('\u2022 '), n.firstChild); n.appendChild(doc.createTextNode('\n')); });
  c.querySelectorAll('p,div,h1,h2,h3,h4,h5,tr').forEach(n => n.appendChild(doc.createTextNode('\n')));
  let t = decodeEnt(c.textContent || '');
  t = t.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t;
}
