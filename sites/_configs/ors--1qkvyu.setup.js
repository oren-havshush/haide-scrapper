// ors.co.il /search/. Runs on page 1 only: pool all pages all-or-nothing (LRN-CO-4); a failed
// fetch, redirect, empty page or count unequal to the total removes every card. id ors-<n> (LRN-ID-11).
// location: tag via closed city.csv map + cue lines, 4-case rule, else Unknown. body split at headings
// (LRN-SETUP-10/18). Non Hebrew/Latin title and the "בדיקה בדיקה" test card dropped (LRN-LANG-1).
var S='div.swiper_hot_jobs',L=document.querySelector('#jobs-list-area');
if(L&&!document.querySelector('.__ai-pooled')){
var mk=document.createElement('i');mk.className='__ai-pooled';document.body.appendChild(mk);
var tm=(document.body.textContent||'').match(/מתוך\s+(\d+)/),total=tm?+tm[1]:-1;
var walk=async function(){
if(total<1)return null;
var pages=Math.ceil(total/12),have={},got=[],n=0;
for(var k=1;k<=pages;k+=5){
var ps=[];for(var p=k;p<k+5&&p<=pages;p++)ps.push(p);
var hs=await Promise.all(ps.map(function(p){
return fetch(location.origin+'/search/?page='+p+'&per-page=12').then(function(r){if(!r.ok||r.redirected)throw 0;return r.text();});
}));
for(var i=0;i<hs.length;i++){
var cs=new DOMParser().parseFromString(hs[i],'text/html').querySelectorAll(S);
if(!cs.length)return null;
cs.forEach(function(c){var id=c.getAttribute('data-job-id');if(!have[id]){have[id]=1;n++;got.push(c);}});
}}
return n===total?got:null;
};
var pooled=null;
for(var a=0;a<2&&!pooled;a++){try{pooled=await walk();}catch(e){pooled=null;}}
document.querySelectorAll(S).forEach(function(c){c.remove();});
if(pooled)pooled.forEach(function(c){L.appendChild(document.importNode(c,true));});
}
// canonical|variants ; "!" = tag only, never read from a cue line
var T={},V=[];
('פריסה ארצית|כל הארץ;תל אביב-יפו|תל אביב|ת"א|תל-אביב;פתח תקווה|פ"ת|פתח תקוה;ראשון לציון|ראשל"צ;באר שבע|ב"ש;'+
'פלמחים|פלמחים - קבוץ;מעברות|מעברות - קבוץ;דביר|קיבוץ דביר;קדימה צורן|קדימה-צורן|קדימה;פרדס חנה כרכור|פרדס חנה-כרכור;'+
'קרית מלאכי|קריית מלאכי;קרית אתא|קריית אתא;קרית גת|קריית גת;בת-ים|בת ים;כפר סבא;'+
'חיפה;כרמיאל;ירושלים;נחשון;מודיעין;בית שמש;נתניה;אור יהודה;שער העמקים;אופקים;חצרים;שוהם;אילת;אשלים;מבוא חורון;'+
'בני ברק;אשדוד;נס ציונה;זכרון יעקב;ניר צבי;יבנה;גוש עציון;שדרות;!גזר;דלתון;גבעת חיים איחוד;רמת ישי;!כנות;חולון;צפת;'+
'יקום;קיסריה;ראש העין;יהוד;חדרה;מעגן מיכאל;אריאל;אשקלון;ערד;רמת השרון;כפר סילבר;ירוחם;נשר;יד בנימין;דורות;רחובות;'+
'צרעה;מענית;כפר קאסם;גן שמואל;בית שאן;רעננה;גן יבנה;באר יעקב;כפר עזה;עכו;הרצליה;אחיסמך;בנימינה;!שקד;אור עקיבא;!אזור;'+
// owner 2026-10-11: tag-only maps for tags not in city.csv
'!רמלה לוד|לוד|רמלה;!איירפורט סיטי|קריית שדה התעופה;!הגליל העליון|גליל עליון;!עמק חפר|עמק חפר מזרח מ;!אזור דרום|דבירה|דודאים|עידן הנגב')
.split(';').forEach(function(e){var o=e.charAt(0)==='!',ns=(o?e.slice(1):e).split('|');
ns.forEach(function(v){T[v]=ns[0];if(!o)V.push([v,ns[0]]);});});
V.sort(function(x,y){return y[0].length-x[0].length;});
var SEP=' ,.()-–/|:!?;\n';
var find=function(s){var out=[];
s=s.replace(/\s/g,' ').replace(/[״”“]/g,'"').replace(/[׳’]/g,"'");
V.forEach(function(v){var i=s.indexOf(v[0]);while(i>=0){
var b=s.charAt(i-1)||' ',z=s.charAt(i+v[0].length)||' ';
if((SEP.indexOf(b)>=0||('בל'.indexOf(b)>=0&&SEP.indexOf(s.charAt(i-2)||' ')>=0))&&SEP.indexOf(z)>=0){
if(!out.some(function(o){return o[1]===v[1];}))out.push([i,v[1]]);
s=s.slice(0,i)+'#'.repeat(v[0].length)+s.slice(i+v[0].length);}
i=s.indexOf(v[0],i+1);}});
return out.sort(function(x,y){return x[0]-y[0];}).map(function(o){return o[1];});};
var REQH=/^(ה?דרישות|דרישת|כישורים|תכונות נדרשות|תנאי סף|מה (אנחנו |אנו )?מחפשים|מה צריך|מה חשוב (שיהיה|לנו)|מה נדרש)/;
var DESH=/^(תנאי|תיאור|תאור|תכולת עבודה|פרופיל ה?משרה|ה?תפקיד כולל|במסגרת התפקיד|היקף|שכר|מה (אנחנו |אנו )?מציעים|מה מציעים|שעות|ימים|פרטי המשרה|נתוני משרה|מה כולל|מה בתפקיד|תחומי אחריות|מהות התפקיד|אופי התפקיד|ליבת התפקיד|על התפקיד|העבודה כוללת|הגדרת ה?תפקיד|מה מחכה|מיקום)/;
var LABEL=/^(ה?דרישות( ה?תפקיד| ה?משרה| סף| נוספות| חובה| אישיות)?( ?[-–] ?חובה)?|כישורים( נדרשים)?|תכונות נדרשות|תכולת עבודה עיקרית|פרופיל ה?משרה|תנאי סף|תנאים( נוספים)?|תנאי ה?(משרה|העסקה|עבודה)( נוספים)?|תיאור( ה?תפקיד| ה?משרה)?|תאור ה?תפקיד|ה?תפקיד כולל|במסגרת התפקיד|היקף ה?משרה|שכר( ותנאים)?|מה (אנחנו |אנו )?(מחפשים|מציעים)|מה מציעים|תחומי אחריות( עיקריים)?|מהות התפקיד|אופי התפקיד|ליבת התפקיד|על התפקיד|העבודה כוללת|הגדרת ה?תפקיד|שעות ה?עבודה|נתוני משרה|מיקום)$/;
var TAIL=/^(ה?דרישות[^:\-–]{0,14})\s*[:\-–]\s*(\S.*)$/;
var RQW=/^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל|יכולת|נכונות|זמינות|שליטה|הכרה|הכרת|מגורים|דובר|עדיפות|נדרש|יוצא|רצוי|גישה|ראש גדול|עם ידע|עם ניסיון)/;
var HL=/(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u;
var OT=/(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u;
var MATH=new RegExp('['+String.fromCodePoint(0x1D400)+'-'+String.fromCodePoint(0x1D7FF)+']','gu');
var key=function(l){return l.replace(/^[^א-תA-Za-z]+/,'');};
var put=function(it,cls,val){var s=document.createElement('span');s.className=cls;s.style.display='none';s.textContent=val;it.appendChild(s);};
var split=function(lines,it){
var desc=[],req=[];
if(lines.some(function(l){return REQH.test(key(l));})){
var inReq=false,jr=false;
lines.forEach(function(l){
var k=key(l);
if(!k){(inReq?req:desc).push(l);return;}
var bare=LABEL.test(k.replace(/[\s:\-–?!.]+$/,''));
if(REQH.test(k)){inReq=true;jr=bare;if(bare)return;var m=k.match(TAIL);req.push(m?m[2]:l);return;}
if(DESH.test(k)&&!(bare&&jr))inReq=false;
jr=false;
if(bare&&DESH.test(k))return;
(inReq&&!/^שכר|\d:\d\d|^משרה (מלאה|מעולה|חלקית)/.test(k)?req:desc).push(l);});
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
};
var linesOf=function(el){return ((el&&el.textContent)||'').split('\n').map(function(l){return l.trim();});};
var items=document.querySelectorAll(S);
for(var x=0;x<items.length;x++){var it=items[x];try{
if(it.querySelector('.__ai-title'))continue;
var tEl=it.querySelector('.hot_jobs_slide_middle_title');
var title=tEl?(tEl.textContent||'').trim().replace(MATH,function(c){return c.normalize('NFKC');}):'';
if(!title||!HL.test(title)||OT.test(title)||/^(בדיקה\s*)+$/.test(title)){it.remove();continue;}
put(it,'__ai-title',title);
var num=((it.querySelector('.hot_jobs_item_up_number')||{}).textContent||'').match(/\d+/);
if(num){put(it,'__ai-id','ors-'+num[0]);put(it,'__ai-apply',location.origin+'/job/'+num[0]+'/');}// apply = the job's own page
var lines=linesOf(it.querySelector('.hot_jobs_slide_middle_text'));
var tag=((it.querySelector('.hot_jobs_slide_middle_place_text')||{}).textContent||'').trim(),P=T[tag],C=[];
var fw=/שטח|נסיעות|ברחבי הארץ|בכל הארץ|סניפ/.test(lines.join(' '));
lines.forEach(function(l){var k=key(l),f=[],m;if(/^(מיקום|מקום העבודה)/.test(k)&&!/מועמד|מגורים/.test(k))f=find(k.replace(/\([^)]*\)/g,' '));
// owner 2026-10-11: "company/job located in X" counts, not on field-work or multi-branch ads
else if(!fw&&(m=k.match(/(ממוקמ|יושב|נמצא)\S*\s+ב/))){f=find(k.slice(m.index).replace(/\([^)]*\)/g,' '));if(f.length>1)f=[];}
f.forEach(function(c){if(C.indexOf(c)<0)C.push(c);});});
var locs=!tag?C:!P?[]:P==='פריסה ארצית'?(C.length?C:[P]):(C.indexOf(P)>=0?C:[P]);
put(it,'__ai-location',locs.length?locs.join(', '):'Unknown');
split(lines,it);
}catch(err){}}
