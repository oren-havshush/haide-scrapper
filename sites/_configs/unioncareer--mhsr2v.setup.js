function structuredText(el){
  if (!el) return '';
  const c = el.cloneNode(true);
  c.querySelectorAll('style,script,link,meta').forEach(n => n.remove());
  c.querySelectorAll('p,div,ul,ol,li,br,h2,h3,h4').forEach(e => e.insertAdjacentText('afterend','\n'));
  return c.textContent.replace(/[ \t]+/g,' ').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
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
      {name:'the-file',label:'קובץ קו\"ח',tagName:'INPUT',required:true,fieldType:'file'},
      {name:'here-by-friend',label:'הגעתי דרך חבר',tagName:'INPUT',required:false,fieldType:'checkbox'},
      {name:'friend-name',label:'נא לציין את שם החבר',tagName:'INPUT',required:false,fieldType:'text'},
      {name:'job-number',label:'',tagName:'INPUT',required:false,fieldType:'hidden'},
      {name:'post-url',label:'',tagName:'INPUT',required:false,fieldType:'hidden'}
    ]
  });
}
// DOM-walk approach: treats any <b><u>...</u></b> (at any depth, any position)
// as a section heading separator. Handles 4 observed formats on this site.
function parseContent(content){
  // Build a linear list of segments [{label, lines[]}]
  const segs = [{ label:'', lines:[] }];
  function cur(){ return segs[segs.length-1]; }
  function addLine(t){ const c=cur(); if(t!=='\n'||c.lines[c.lines.length-1]!=='\n') c.lines.push(t); }
  function walk(n){
    if (n.nodeType===3){
      const t=(n.textContent||'').replace(/\u00a0/g,' ').trim();
      if(t) addLine(t);
      return;
    }
    if (n.nodeType!==1) return;
    const tag=n.tagName;
    // Detect <b><u>heading</u></b> or <strong><u>...</u></strong>
    if ((tag==='B'||tag==='STRONG') && n.querySelector('u,ins')){
      const inner=(n.textContent||'').trim();
      if (inner && inner.length<80){ segs.push({label:inner,lines:[]}); return; }
    }
    // Semantic headings
    if (/^H[2-4]$/.test(tag)){
      const inner=(n.textContent||'').trim();
      if(inner) segs.push({label:inner,lines:[]});
      return;
    }
    // Each <p> gets its own segment boundary so Format C plain-text headings
    // don't bleed into the previous labeled segment.
    if (tag==='P'){
      const last=segs[segs.length-1];
      if (last.label || last.lines.some(l=>l.trim())) segs.push({label:'',lines:[]});
    }
    if (tag==='BR'||tag==='P'||tag==='LI') addLine('\n');
    for (const c of n.childNodes) walk(c);
    if (tag==='P'||tag==='LI') addLine('\n');
  }
  walk(content);
  const desc=[], req=[];
  let section='desc', location='';
  for (const seg of segs){
    const text=seg.lines.join('').replace(/\n{3,}/g,'\n\n').trim();
    const label=seg.label;
    if (label){
      if (/מיקום/i.test(label)){
        const same=label.replace(/^.*?מיקום\s*:?\s*/i,'').trim();
        location=same||text.split('\n').find(l=>l.trim())||'';
        section='loc';
      } else if (/דרישות/i.test(label)){
        section='req';
        if(text) req.push(text);
      } else if (/תיאור/i.test(label)){
        section='desc';
        if(text) desc.push(text);
      }
    } else {
      if (!text) continue;
      const lines=text.split('\n');
      // Format C: plain-text heading on first line
      if (/^דרישות/i.test(lines[0])){
        section='req';
        const body=lines.slice(1).join('\n').trim();
        if(body) req.push(body);
      } else if (/^תיאור/i.test(lines[0])){
        section='desc';
        const body=lines.slice(1).join('\n').trim();
        if(body) desc.push(body);
      } else {
        // Regular content: scan for inline מיקום
        const mi=lines.findIndex(l=>/מיקום\s*:?/i.test(l));
        if (mi>=0){
          const same=lines[mi].replace(/^.*?מיקום\s*:?\s*/i,'').trim();
          location=same||lines.slice(mi+1).find(l=>l.trim())||'';
          const before=lines.slice(0,mi).join('\n').trim();
          if(before)(section==='req'?req:desc).push(before);
        } else {
          (section==='req'?req:desc).push(text);
        }
      }
    }
  }
  return {description:desc.join('\n').trim(),requirements:req.join('\n').trim(),location};
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
      const parsed = parseContent(content);
      mk(item, '__ai-location', parsed.location);
      mk(item, '__ai-description', parsed.description);
      mk(item, '__ai-requirements', parsed.requirements);
    }
    mk(item, '__ai-applicationInfo', buildAppInfo(jobId, detailUrl));
  } catch(e) {}
}));
