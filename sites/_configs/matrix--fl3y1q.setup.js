// /jobs/ lists no jobs: pool the menu's top-level categories + linked hot-jobs tag page, all-or-nothing (LRN-CO-4),
// dedup by job no. (tag cards: on the CV button). id matrix-<no.>; tags->regions + cues, 4-case rule; body split.
var S='div.job-item',Q=(e,s)=>e.querySelectorAll(s);
if(!document.querySelector('.__ai-pooled')&&document.querySelector('#jobs_category_list')){
var mk=document.createElement('i');mk.className='__ai-pooled';document.body.appendChild(mk);
var us=[...new Set([...Q(document,'#jobs_category_list > li > a')].map(a=>a.href))],n=us.length,tg=document.querySelector('a[href*="/tag/"]');if(tg)us.push(location.origin+new URL(tg.href).pathname.replace(/\/\/+/g,'/'));
var get=u=>fetch(u).then(r=>{if(!r.ok||r.redirected)throw 0;return r.text();});
var walk=async()=>{if(n<10)return null;var got=[],have={},i,j;
for(i=0;i<us.length;i+=5){var hs=await Promise.all(us.slice(i,i+5).map(get));
for(j=0;j<hs.length;j++){var d=new DOMParser().parseFromString(hs[j],'text/html');if(!d.querySelector('.jobs-results'))return null;
var cs=Q(d,'.jobs-results '+S);for(var c of cs){var id=c.getAttribute('job-id')||(c.querySelector('.quick-cv-button')||{}).id;c.setAttribute('job-id',id);if(!/^\d+$/.test(id||''))return null;if(!have[id]){have[id]=1;got.push(c);}}}}
return got.length?got:null;};
var pooled=null;
for(var a=0;a<2&&!pooled;a++){try{pooled=await walk();}catch(e){pooled=null;}}
Q(document,S).forEach(c=>{c.remove();});
if(pooled){var box=document.createElement('div');box.className='__ai-pool';document.body.appendChild(box);pooled.forEach(c=>{box.appendChild(document.importNode(c,true));});}
}
var RN={M:'אזור מרכז',S:'אזור השרון',P:'אזור שפלה',D:'אזור דרום',Z:'אזור צפון',J:'אזור ירושלים',Y:'אזור יהודה ושומרון'};
var R={'גוש דן':'M','השרון':'S','השפלה':'P','דרום':'D','צפון':'Z','חיפה והקריות':'Z','ירושלים יו"ש':'JY'};
// place|variants:regions; no regions = area name, masked; "!" = counts in title/lede only after ב/ל (מודיעין = intelligence)
var V=[];
('תל אביב-יפו|ת"א|תל אביב|תל-אביב:M;פתח תקווה|פ"ת|פתח תקוה:M;ראשון לציון|ראשל"צ:MP;רמת גן|ר"ג:M;חולון:M;בני ברק:M;'+
'בת-ים|בת ים:M;גבעתיים:M;קריית אונו|קרית אונו:M;אור יהודה:M;גבעת שמואל:M;יהוד:MP;הרצליה:MS;רמת השרון:MS;ראש העין:MS;'+
'שוהם:MP;!מודיעין:MP;רמלה לוד|לוד|רמלה:MP;רחובות:MP;נס ציונה:MP;באר יעקב:MP;איירפורט סיטי:MP;'+
'נתניה:S;רעננה:S;כפר סבא|כפ"ס|כ"ס:S;הוד השרון:S;חדרה:SZ;קיסריה:SZ;יבנה:P;גדרה:P;אשדוד:PD;אשקלון:D;קרית גת:PD;'+
'באר שבע|ב"ש:D;דימונה:D;חיפה:Z;טירת הכרמל|טירת כרמל:Z;יוקנעם|יקנעם:Z;קרית ביאליק:Z;קרית אתא:Z;כרמיאל:Z;עכו:Z;נהריה:Z;'+
'עפולה:Z;נצרת:Z;טבריה:Z;ירושלים:J;מבשרת ציון:J;בית שמש:JP;מודיעין עלית|מודיעין עילית:J;מעלה אדומים:JY;'+
'פריסה ארצית:MSPDZJY;חיפה והקריות;הקריות').split(';').forEach(e=>{
var f=e.split(':'),h=f[0][0]==='!',ns=f[0].replace('!','').split('|');ns.forEach(v=>{V.push([v,ns[0],f[1]||'',h]);});});
V.sort((x,y)=>y[0].length-x[0].length);
var SEP=' ,.()-–/|:!?;\n',sp=c=>SEP.indexOf(c||' ')>=0;
var find=(s,out,st)=>{
s=s.replace(/\s/g,' ').replace(/[״”“]|''/g,'"').replace(/[׳’]/g,"'");
V.forEach(v=>{var i=s.indexOf(v[0]);while(i>=0){
var b=s[i-1],b2=s[i-2],w=!(st&&v[3]),pf='בל'.indexOf(b)>=0&&(sp(b2)||(b2==='ו'&&sp(s[i-3])));
if(((sp(b)&&w)||pf||(b==='ו'&&sp(b2)&&w))&&sp(s[i+v[0].length])&&!/(קיבוץ|מושב|אזור) $/.test(s.slice(Math.max(0,i-6),i))){
if(v[2]&&!out.some(o=>o[0]===v[1]))out.push([v[1],v[2]]);
s=s.slice(0,i)+'#'.repeat(v[0].length)+s.slice(i+v[0].length);}
i=s.indexOf(v[0],i+1);}});
return out;};
var PIN=String.fromCodePoint(0x1F4CD),NB=new RegExp(String.fromCharCode(160),'g');
var CUE=/^((ה|ב|ל)?משרה|מיקום|מקום העבודה|(ה)?עבודה (מלאה |היברידית )?ב)/;
// owner 10-11: company-location line counts unless field work/branches
var CO=/הממוקמ|היושב|ממוקמ|מטה (ה?חברה|מטריקס)|משרדי (ה?חברה|מטה)/,FW=/שטח|בכל הארץ|פריסה ארצית|סניפים|נסיעות/;
var REQH=/^(ה?דרישות|דרישת|ה?כישורים|תנאי סף|יתרון|יתרונות|השכלה|ניסיון (נדרש|וידע|מקצועי|חובה)|ידע מקצועי|רקע תעסוקתי|מאפייני אישיות|דגשים אישיותיים|מה (אנחנו |אנו )?מחפשים|מה חשוב לנו|חובה|requirements|qualifications|advantages|experience and education|other requirements|key requirements)/i;
var DESH=/^(תיאור|תאור|ה?תפקיד כולל|במסגרת התפקיד|תחומי אחריות|אחריות מרכזית|מה (כולל|כוללת) ה?(תפקיד|משרה)|מה ה?תפקיד כולל|מה בתפקיד|מה (תעשו|עושים)|מהות התפקיד|על התפקיד|מה מחכה|מה (אנחנו |אנו )?מציעים|מה מציעים|השירות כולל|responsibilities|role overview|key responsibilities|you will be responsible|about the role|job description)/i;
var LABEL=/^(ה?דרישות( ה?תפקיד| ה?משרה| לתפקיד)?|requirements|תיאור( ה?תפקיד| ה?משרה)?|תאור ה?תפקיד|job description|description)$/i;
var TERM=/^((ה|ב|ל)?משרה|היקף|שכר|מיקום|מקום העבודה)/,CLO=/^(אם |מוזמנים|שלחו|הגישו|ניתן לפנות|לשליחת|נשמח|אשמח|מצטרפים)|@/;
var RQW=/^(ניסיון|נסיון|ידע|השכלה|תואר|הנדסאי|הכרות|הכרה|הכרת|היכרות|יכולת|נכונות|זמינות|שליטה|עדיפות|יתרון|רישיון|בעל|בוגר|נדרש|מינימום|חובת|אנגלית|שנות|שנים|שנה)|(חובה|יתרון|יתרון משמעותי)[.! ]*$/;
var HL=/(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var OT=/(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH=new RegExp('['+String.fromCodePoint(0x1D400)+'-'+String.fromCodePoint(0x1D7FF)+']','gu');
var key=l=>l.replace(/^[^א-תA-Za-z]+/,''),bare=k=>LABEL.test(k.replace(/[\s:\-–?!.]+$/,''));
var txt=e=>{if(!e)return [];var c=e.cloneNode(true);c.innerHTML=c.innerHTML.replace(/[\r\n]+/g,' ');
Q(c,'br').forEach(x=>{x.replaceWith('\n');});Q(c,'p,div,li').forEach(x=>{x.append('\n');});
return c.textContent.replace(NB,' ').split('\n').map(l=>l.replace(/[ \t]+/g,' ').trim());};
var put=(it,cls,val)=>{// wrapped: WP emoji script keeps emoji as text
var s=document.createElement('span'),w=document.createElement('span');
w.style.display='none';s.className=cls+' wp-exclude-emoji';s.textContent=val;w.appendChild(s);it.appendChild(w);};
var items=Q(document,S);
for(var x=0;x<items.length;x++){var it=items[x];try{
if(it.querySelector('.__ai-title'))continue;
var title=((it.querySelector('.job-title')||{}).textContent||'').trim().replace(MATH,c=>c.normalize('NFKC'));
if(!title||!HL.test(title)||OT.test(title)){it.remove();continue;}
put(it,'__ai-title',title);
var num=(it.getAttribute('job-id')||'').trim();
if(/^\d+$/.test(num))put(it,'__ai-id','matrix-'+num);
var lines=[];[].forEach.call(it.children,k=>{if(k.tagName==='P'&&!k.className)lines=lines.concat(txt(k));});
var more=txt(it.querySelector('.job-more-content'));
var desc=[],req=[],inReq=false;
lines.forEach(l=>{var k=key(l);
if(!k){(inReq?req:desc).push(l);return;}
if((k.length<=80&&REQH.test(k))||(k.length<=45&&/^(אנחנו|אנו) מחפשים.*[:?] *$/.test(k))){inReq=true;if(!bare(k))req.push(l);return;}
if(k.length<=60&&DESH.test(k)){inReq=false;if(!bare(k))desc.push(l);return;}
if(inReq&&CLO.test(k))inReq=false;
if(inReq&&(TERM.test(k)||l.indexOf(PIN)===0)){desc.push(l);return;}
(inReq?req:desc).push(l);});
more.forEach(l=>{var k=key(l);if(!(k&&bare(k)))req.push(l);});
// no heading, no requirements block: a requirement line still goes to requirements (rule 1)
if(!req.join('')){var d0=desc;desc=[];d0.forEach((l,i)=>{var k=key(l);
(k&&RQW.test(k)&&!TERM.test(k)&&!(i===0&&/דרוש|מגייס|מחפש|לארגון|לחברה/.test(k))?req:desc).push(l);});}
var td=z=>z.join('\n').replace(/\n{3,}/g,'\n\n').trim();
var d=td(desc),q2=td(req);
if(d)put(it,'__ai-description',d);
if(q2&&q2!==d)put(it,'__ai-requirements',q2);
var tags='',locs=[];
((it.querySelector('.job-areas')||{}).textContent||'').split(',').forEach(r=>{
(R[r.trim()]||'').split('').forEach(c=>{if(tags.indexOf(c)<0){tags+=c;locs.push(RN[c]);}});});
var cue=find(title,[],1),ld=lines.filter(String)[0];
if(ld)find(ld.replace(/\([^)]*\)/g,' '),cue,1);
var al=lines.concat(more),fw=FW.test(title+al.join(' '));
al.forEach(l=>{if(CUE.test(key(l))||l.indexOf(PIN)===0||(!fw&&CO.test(l)))find(l.replace(/\([^)]*\)/g,' '),cue);});
if(cue.length&&(!tags||cue.some(c=>c[1].split('').some(g=>tags.indexOf(g)>=0))))locs=cue.map(c=>c[0]);
put(it,'__ai-location',locs.length?locs.join(', '):'Unknown');
}catch(err){}}
