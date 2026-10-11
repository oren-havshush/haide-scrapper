// l-b.co.il. The worker runs this on page 1 only: pool /page/2.. all-or-nothing (LRN-CO-4); a
// failed fetch or a count unequal to the printed total removes every card.
// id l-b-<n> (LRN-ID-11). location: tags->region rows; a title, lede or "מיקום:" place by the 4-case
// rule ("קיבוץ/מושב X" is not X). body split at headings (LRN-SETUP-10/18). Non Hebrew/Latin title dropped (LRN-LANG-1).
var S='div.job-item.p-4';
if(!document.querySelector('.__ai-pooled')&&document.querySelector(S)){
var mk=document.createElement('i');mk.className='__ai-pooled';document.body.appendChild(mk);
var base=location.origin+location.pathname.replace(/page\/\d+\/?$/,'');
if(!/\/$/.test(base))base+='/';
var row=document.querySelector(S).parentElement.parentElement;
var walk=async function(){// page 1 too: a query string skips the site's stale page cache
var have={},got=[],k=1,done=false,n=0,total=-1;
while(!done&&k<120){
var hs=await Promise.all([k,k+1,k+2,k+3].map(function(p){
return fetch(base+(p>1?'page/'+p+'/':'?nc=1')).then(function(r){if(!r.ok||r.redirected)throw 0;return r.text();});
}));
k+=4;
for(var i=0;i<hs.length&&!done;i++){
var m=hs[i].match(/נמצאו\s+(\d+)\s+משרות/);if(m)total=+m[1];
var cs=new DOMParser().parseFromString(hs[i],'text/html').querySelectorAll(S);
if(!cs.length)done=true;
cs.forEach(function(c){var id=c.getAttribute('job-data-id');if(!have[id]){have[id]=1;n++;got.push(c.parentElement);}});
}
}
return done&&n===total?got:null;
};
var pooled=null;
for(var a=0;a<2&&!pooled;a++){try{pooled=await walk();}catch(e){pooled=null;}}
document.querySelectorAll(S).forEach(function(c){c.parentElement.remove();});
if(pooled)pooled.forEach(function(w){row.appendChild(document.importNode(w,true));});
}
var RN={M:'אזור מרכז',S:'אזור השרון',P:'אזור שפלה',D:'אזור דרום',Z:'אזור צפון',J:'אזור ירושלים',E:'אזור אילת'};
var R={'גוש דן':'M','אזור תל אביב':'M','השרון':'S','חדרה ומורדות הכרמל':'S','השפלה':'P','דרום':'D','הנגב':'D','חבל לכיש':'D','צפון':'Z','הגליל':'Z','עמק יזרעאל':'Z','חיפה והקריות':'Z','ירושלים יו"ש':'J','אילת והערבה':'E'};
// place|variants:regions (none: an area, masked)
var V=[];
('תל אביב-יפו|ת"א|תל אביב|תל-אביב|יפו:M;פתח תקווה|פ"ת|פתח תקוה:M;ראשון לציון|ראשל"צ:MP;רמת גן|ר"ג:M;חולון:M;בני ברק:M;'+
'בת-ים|בת ים:M;גבעתיים:M;קריית אונו|קרית אונו:M;אור יהודה:M;גבעת שמואל:M;יהוד:MP;הרצליה:MS;רמת השרון:MS;ראש העין:MS;'+
'איירפורט סיטי:MP;נתב"ג:MP;שוהם:MP;מודיעין:MP;רמלה לוד|לוד|רמלה:MP;רחובות:MP;נס ציונה:MP;באר יעקב:MP;פלמחים:MP;ניר צבי:MP;'+
'משמר השבעה:M;בארות יצחק:M;עינת:M;נתניה:S;רעננה:S;כפר סבא|כפ"ס|כ"ס:S;הוד השרון:S;גן חיים:S;יקום:S;חדרה:SZ;קיסריה:SZ;'+
'יבנה:P;גדרה:P;גבעת ברנר:P;קרית עקרון:P;אשדוד:PD;קרית גת:PD;בני עי"ש:PD;באר שבע|ב"ש:D;שדרות:D;דימונה:D;נאות חובב:D;'+
'חיפה:Z;קרית ביאליק:Z;קרית אתא:Z;כרמיאל:Z;עפולה:Z;חפציבה:Z;נצרת:Z;טבריה:Z;'+
'ירושלים:J;מבשרת ציון:J;בית שמש:JP;מודיעין עלית|מודיעין עילית:J;אילת:E;חיפה והקריות;הקריות').split(';').forEach(function(e){
var f=e.split(':'),ns=f[0].split('|');ns.forEach(function(v){V.push([v,ns[0],f[1]||'']);});});
V.sort(function(x,y){return y[0].length-x[0].length;});
var SEP=' ,.()-–/|:!?;\n';
var find=function(s,out){
s=s.replace(/\s/g,' ').replace(/[״”“]/g,'"').replace(/[׳’]/g,"'");
V.forEach(function(v){var i=s.indexOf(v[0]);while(i>=0){
var b=s.charAt(i-1)||' ',z=s.charAt(i+v[0].length)||' ';
if((SEP.indexOf(b)>=0||('בל'.indexOf(b)>=0&&SEP.indexOf(s.charAt(i-2)||' ')>=0))&&SEP.indexOf(z)>=0&&!/(קיבוץ|מושב) $/.test(s.slice(i-6,i))&&(v[0]!='שדרות'||/^($|[^ ]| או( |$)| ו)/.test(s.slice(i+5)))){
if(v[2]&&!out.some(function(o){return o[0]===v[1];}))out.push([v[1],v[2]]);
s=s.slice(0,i)+'#'.repeat(v[0].length)+s.slice(i+v[0].length);}
i=s.indexOf(v[0],i+1);}});
return out;};
var REQH=/^(ה?דרישות|דרישת|כישורים|תנאי סף|מה (אנחנו |אנו )?מחפשים|מה צריך|מה חשוב (שיהיה|לנו)|מה נדרש|ניסיון מקצועי:)/;
var DESH=/^(תנאי|תיאור|תאור|ה?תפקיד כולל|במסגרת התפקיד|היקף|שכר|מה (אנחנו |אנו )?מציעים|מה מציעים|שעות|פרטי המשרה|מה כולל|מה בתפקיד|מה עושים|תחומי אחריות|מהות התפקיד|על התפקיד|העבודה כוללת|הגדרת תפקיד|מה מחכה|מיקום)/;
var LABEL=/^(ה?דרישות( ה?תפקיד| ה?משרה| סף)?|כישורים( נדרשים)?|תנאי סף|תנאים( נוספים)?|תנאי ה?משרה( והשתכרות)?|תנאים והיקף ה?משרה|תיאור( ה?תפקיד| ה?משרה)?|תאור ה?תפקיד|ה?תפקיד כולל|במסגרת התפקיד|היקף ה?משרה|שכר( ותנאים)?|מה (אנחנו |אנו )?(מחפשים|מציעים)|מה מציעים|מה צריך|מה חשוב (שיהיה לך|לנו)|מה כולל התפקיד|מה בתפקיד|מה עושים( בתפקיד)?|תחומי אחריות|מהות התפקיד|על התפקיד|העבודה כוללת|הגדרת תפקיד|מה מחכה (לך|לכם)|שעות העבודה|פרטי המשרה|ניסיון מקצועי|מיקום והיקף ה?משרה)$/;
var TAIL=/^(ה?דרישות[^:\-–]{0,14})\s*[:\-–]\s*(\S.*)$/;
var RQW=/^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל|יכולת|נכונות|זמינות|שליטה|הכרה|הכרת|מגורים|דובר|עדיפות|נדרש|יוצא|רצוי|גישה|ראש גדול|עם ידע|עם ניסיון)/;
var HL=/(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var OT=/(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH=new RegExp('['+String.fromCodePoint(0x1D400)+'-'+String.fromCodePoint(0x1D7FF)+']','gu');
var key=function(l){return l.replace(/^[^א-תA-Za-z]+/,'');};
var put=function(it,cls,val){// wrapped: WP emoji script keeps emoji as text
var s=document.createElement('span'),w=document.createElement('span');
w.style.display='none';s.className=cls+' wp-exclude-emoji';s.textContent=val;w.appendChild(s);it.appendChild(w);};
var items=document.querySelectorAll(S);
for(var x=0;x<items.length;x++){var it=items[x];try{
if(it.querySelector('.__ai-title'))continue;
var tEl=it.querySelector('h6.job-title');
var title=tEl?(tEl.textContent||'').trim().replace(MATH,function(c){return c.normalize('NFKC');}):'';
if(!title||!HL.test(title)||OT.test(title)){it.remove();continue;}
put(it,'__ai-title',title);
var num=((it.querySelector('.meta-job-id')||{}).textContent||'').match(/\d+/);
if(num)put(it,'__ai-id','l-b-'+num[0]);
var body=it.querySelector('.job-description');
body=body?body.cloneNode(true):null;
if(body)body.querySelectorAll('img').forEach(function(i){i.replaceWith(i.getAttribute('alt')||'');});
var lines=((body&&body.textContent)||'').split('\n').map(function(l){return l.trim();});
var tags='',locs=[];
((it.querySelector('.meta_area .meta span')||{}).textContent||'').split(',').forEach(function(r){
var c=R[r.trim()];if(c&&tags.indexOf(c)<0){tags+=c;locs.push(RN[c]);}});
var cue=find(title,[]),ld=lines.filter(String)[0];
if(ld)find(ld.replace(/\([^)]*\)/g,' '),cue);
lines.forEach(function(l){if(/^(מיקום|מקום העבודה)/.test(key(l)))find(l.replace(/\([^)]*\)/g,' '),cue);});
if(cue.some(function(c){return c[1].split('').some(function(g){return tags.indexOf(g)>=0;});}))locs=cue.map(function(c){return c[0];});
put(it,'__ai-location',locs.length?locs.join(', '):'Unknown');
var desc=[],req=[];
if(lines.some(function(l){return REQH.test(key(l));})){
var inReq=false,jr=false;
lines.forEach(function(l){
var k=key(l);
if(!k){(inReq?req:desc).push(l);return;}
var bare=LABEL.test(k.replace(/[\s:\-–?!.]+$/,''));
if(REQH.test(k)){inReq=true;jr=bare;if(bare)return;var m=k.match(TAIL);req.push(m?m[2]:l);return;}
if(DESH.test(k)&&!(bare&&jr))inReq=false;// desc label under a req label: ad slip
jr=false;
if(bare&&DESH.test(k))return;
(inReq?req:desc).push(l);});
}else{
lines=lines.filter(function(l){return !LABEL.test(key(l).replace(/[\s:\-–?!.]+$/,''));});
var fl=lines.map(function(l){var k=key(l);
if(!k||/דרוש/.test(l)||/\d:\d\d/.test(l)||l.length>150||/^שכר/.test(k))return false;
return /חובה|יתרון/.test(l)||RQW.test(k);});
for(var a=0;a<lines.length;a++){
var b0=lines[a].charAt(0);
if(!b0||/[א-תA-Za-z0-9]/.test(b0))continue;
var e=a,q=0,r;
while(e+1<lines.length&&lines[e+1].charAt(0)===b0)e++;
if(e>a){for(r=a;r<=e;r++)if(fl[r])q++;if(q*2>=e-a+1)for(r=a;r<=e;r++)fl[r]=true;}
a=e;}
lines.forEach(function(l,i){(fl[i]?req:desc).push(l);});
}
var td=function(z){return z.join('\n').replace(/\n{3,}/g,'\n\n').trim();};
var d=td(desc),q2=td(req);
if(d)put(it,'__ai-description',d);
if(q2&&q2!==d)put(it,'__ai-requirements',q2);
}catch(err){}}
