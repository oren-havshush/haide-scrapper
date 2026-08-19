// בנק הפועלים (Drupal webform jobs board) — listing-scope detail-fetch setupScript.
// Injects description / requirements / location / externalJobId / detailUrl per card.
function stx(node){
  if(!node) return '';
  const c=node.cloneNode(true);
  c.querySelectorAll('style,script,link,meta').forEach(n=>n.remove());
  c.querySelectorAll('p,div,ul,ol,li,br,h1,h2,h3,h4,h5,h6,tr').forEach(e=>e.insertAdjacentText('afterend','\n'));
  return c.textContent.replace(/ /g,' ').replace(/[ \t]+/g,' ')
    .replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
// city.csv-verbatim vocabulary (values pass through normalizeLocations unchanged).
const CITY=['תל אביב-יפו','ירושלים','חיפה','נשר','חולון','בת-ים','רמת גן','גבעתיים','פתח תקווה',
'ראשון לציון','נתניה','רחובות','אשדוד','אשקלון','באר שבע','הרצליה','כפר סבא','רעננה','בני ברק',
'חדרה','כרמיאל','עפולה','נצרת','טבריה','אילת','קרית גת','בית שמש','יבנה','נס ציונה','הוד השרון',
'רמת השרון','ראש העין','אור יהודה','קריית אונו'];
const ALIAS={'תל אביב':'תל אביב-יפו','תא':'תל אביב-יפו','בת ים':'בת-ים','קרית אונו':'קריית אונו',
'פתח תקוה':'פתח תקווה','הרצלייה':'הרצליה','קריית גת':'קרית גת','באר-שבע':'באר שבע'};
// listing area chip -> city.csv region bucket (matches worker LOCATION_ALIAS)
const AREA={'גוש דן':'אזור מרכז','מרכז':'אזור מרכז','תל-אביב':'תל אביב-יפו','תל אביב':'תל אביב-יפו',
'ירושלים והסביבה':'אזור ירושלים','ירושלים':'אזור ירושלים','צפון':'אזור צפון','דרום':'אזור דרום',
'השפלה':'אזור שפלה','השרון':'אזור השרון','כל הארץ':'פריסה ארצית'};
const nrm=s=>(s||'').replace(/["'״׳]/g,'').replace(/[-–—]/g,' ').replace(/\s+/g,' ').trim();
const LOOK=[];
CITY.forEach(c=>LOOK.push([nrm(c),c]));
Object.keys(ALIAS).forEach(a=>LOOK.push([nrm(a),ALIAS[a]]));
LOOK.sort((a,b)=>b[0].length-a[0].length);
function citiesIn(line){
  const n=nrm(line), out=[];
  for(const [k,v] of LOOK) if(n.includes(k)&&!out.includes(v)) out.push(v);
  return out;
}
// Requirements heading: must START the line and be short (never a prose line, LRN calanit).
const REQ=/^(דרישות|כישורים נדרשים|כישורים|תנאי סף|מה נדרש|הכישורים)/;
// Only these lines are trusted as job-location evidence (excludes "הבורסה בתל אביב").
const LOCCTX=/(מיקום|ממוקם|ממוקמת|מוקד|מוקדי|סניף|סניפי|משרדי|יושב|יושבת)/;

const items=Array.from(document.querySelectorAll('a.views-row.job'));
for(const it of items){
  if(it.querySelector('.__ai-description')) continue;
  const href=it.getAttribute('href')||'';
  if(!href) continue;
  const abs=new URL(href,location.origin).toString();
  const idm=abs.match(/\/node\/(\d+)/);
  const mk=(cls,val)=>{ if(!val) return; const s=document.createElement('span');
    s.className=cls; s.style.display='none'; s.textContent=val; it.appendChild(s); };
  mk('__ai-url',abs);
  mk('__ai-jobid', idm?('bhp-'+idm[1]):('bhp-'+href.replace(/\W+/g,'-')));
  let doc=null;
  try{ doc=new DOMParser().parseFromString(await fetch(abs).then(r=>r.text()),'text/html'); }catch(e){}
  const body=doc&&doc.querySelector('.job-content-description-text');
  const lines=stx(body).split('\n').map(l=>l.trim()).filter(Boolean);
  // description / requirements split by heading POSITION (disjoint by construction).
  let cut=-1;
  for(let i=0;i<lines.length;i++){ if(lines[i].length<120&&REQ.test(lines[i])){ cut=i; break; } }
  // location: explicit "מיקום המשרה:" line -> other trusted context lines -> area chip
  const LOCLINE=/^מיקום\s*(?:ה?משרה)?\s*[:\-–]\s*(.+)$/;
  let locs=[];
  for(const l of lines){ const m=l.match(LOCLINE); if(m){ locs=citiesIn(m[1]); if(locs.length) break; } }
  if(!locs.length) for(const l of lines){ if(LOCCTX.test(l)){ const c=citiesIn(l); if(c.length){ locs=c; break; } } }
  if(!locs.length){ const a=(it.querySelector('.job-area')?.textContent||'').trim();
    if(AREA[a]) locs=[AREA[a]]; }
  mk('__ai-location', locs.length?locs.join(', '):'Unknown');
  // The "מיקום המשרה:" line ships in `location` only — never in the prose.
  const keep=l=>!LOCLINE.test(l);
  const dTxt=(cut>0?lines.slice(0,cut):lines.slice()).filter(keep).join('\n');
  const rTxt=(cut>0?lines.slice(cut+1):[]).filter(keep).join('\n');
  mk('__ai-description', dTxt);
  if(rTxt && rTxt!==dTxt) mk('__ai-req', rTxt);
}
