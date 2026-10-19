// nisha.co.il setupScript, minified from setup.src.js; the pooling block below was rewritten readable on 2026-10-19
var _=".item-job",v=function(e){return e.querySelector('h3.job-title a[href*="/job/"]')};
// Pooling (2026-10-19 nightly reply): the three lists (all jobs, high-tech, finance) are read page by page with no
// cookie (the site's PHP session serves one request per session at a time: 6 parallel fetches with the browser's
// PHPSESSID took 8 to 30 s, without it about 10 s each), 6 in flight, 60 s per attempt, 2 attempts, no new attempt
// after 220 s, so the script ends by itself inside the stored 300 s limit. Each page's cards wait in a <template>
// (outside the .item-job selector) and replace the page's own cards, in list and page order, one per job link, only
// when every page answered and each list's number of different jobs equals its "מצאנו עבורך N משרות"; a list that
// misses is read once more. Anything else: every card is removed, nothing is written (all-or-nothing, as before).
// high-tech is read with ?orderby=ID&order=DESC: in its default order the pages are not stable (2026-10-19: printed
// 118, 120 rows, 116 different jobs, a different set per request); by ID they add up (120 / 120 / 120).
if (!document.querySelector(".__ai-pooled") && document.querySelector("#container-jobs")) {
  var POOL = await (async function () {
    var mark = document.createElement("i");
    mark.className = "__ai-pooled";
    document.body.appendChild(mark);
    var STAGE = document.createElement("template");
    STAGE.id = "haide-jobs-staging";
    document.body.appendChild(STAGE);
    var O = location.origin, Q = "?search=&s=&positions=";
    var LISTS = [
      function (n) { return O + (n > 1 ? "/page/" + n + "/" : "/") + Q; },
      function (n) { return O + "/job_cat/high-tech/" + (n > 1 ? "page/" + n + "/" : "") + "?orderby=ID&order=DESC"; },
      function (n) { return O + "/job_cat/finance/" + (n > 1 ? "page/" + n + "/" : ""); }
    ];
    var IN_FLIGHT = 6, ATTEMPT_MS = 60000, ATTEMPTS = 2, LAST_START_MS = 220000, T0 = Date.now(), BAD = "";
    var fail = function (why) { if (!BAD) BAD = why; };
    // one page: its cards (each with its job link), plus the list's total and last page when it is page 1
    var read = async function (list, n) {
      var url = LISTS[list](n), why = "";
      for (var t = 0; t < ATTEMPTS && !BAD; t++) {
        if (Date.now() - T0 > LAST_START_MS) { why = "out of time (" + LAST_START_MS / 1000 + " s)"; break; }
        if (t) await new Promise(function (ok) { setTimeout(ok, 1000); });
        var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, ATTEMPT_MS);
        try {
          var r = await fetch(url, { credentials: "omit", signal: ctl.signal });
          if (!r.ok || r.redirected) { why = "HTTP " + r.status + (r.redirected ? " (redirected)" : ""); continue; }
          var d = new DOMParser().parseFromString(await r.text(), "text/html");
          var cs = [].filter.call(d.querySelectorAll(_), v);
          if (!cs.length) { why = "no job card"; continue; }
          var page = { cards: cs.map(function (c) { return { href: v(c).href, node: c }; }) };
          if (n === 1) {
            var m = (d.body.textContent || "").match(/מצאנו עבורך\s+(\d+)\s+משרות/);
            if (!m) { why = "no job count"; continue; }
            page.total = +m[1];
            page.last = 1;
            d.querySelectorAll('a[href*="/page/"]').forEach(function (a) {
              var u = (a.getAttribute("href") || "").match(/\/page\/(\d+)\//);
              if (u && +u[1] > page.last) page.last = +u[1];
            });
          }
          return page;
        } catch (e) {
          why = e && e.name === "AbortError" ? "no answer within " + ATTEMPT_MS / 1000 + " s" : "network error";
        } finally {
          clearTimeout(timer);
        }
      }
      fail("page failed (" + why + "): " + url);
      return null;
    };
    // a pool of IN_FLIGHT over [list, page] tasks; every page that answers is staged at once
    var PAGES = LISTS.map(function () { return []; });
    var stage = function (list, n, page) {
      var box = document.createElement("div");
      page.cards.forEach(function (c) { box.appendChild(document.importNode(c.node, true)); });
      STAGE.content.appendChild(box);
      PAGES[list][n] = { total: page.total, last: page.last, hrefs: page.cards.map(function (c) { return c.href; }), box: box };
    };
    var run = async function (tasks) {
      var next = 0;
      var worker = async function () {
        while (next < tasks.length && !BAD) {
          var k = tasks[next++], page = await read(k[0], k[1]);
          if (page && !BAD) stage(k[0], k[1], page);
        }
      };
      await Promise.all([1, 2, 3, 4, 5, 6].slice(0, IN_FLIGHT).map(worker));
    };
    var walk = async function (lists) {
      lists.forEach(function (l) { PAGES[l] = []; });
      await run(lists.map(function (l) { return [l, 1]; }));
      var rest = [];
      lists.forEach(function (l) { if (PAGES[l][1]) for (var n = 2; n <= PAGES[l][1].last; n++) rest.push([l, n]); });
      if (!BAD) await run(rest);
    };
    var short = function () {
      return LISTS.map(function (f, l) { return l; }).filter(function (l) {
        var p = PAGES[l], seen = {}, count = 0;
        for (var n = 1; n <= p[1].last; n++) p[n].hrefs.forEach(function (h) { if (!seen[h]) { seen[h] = 1; count++; } });
        return count !== p[1].total;
      });
    };
    await walk([0, 1, 2]);
    // a job added or closed during the walk shifts the pages: read that list once more
    var miss = BAD ? [] : short();
    if (miss.length) { await walk(miss); if (!BAD && short().length) fail("card count differs from the job count on list " + short().join(", ")); }
    if (BAD) return { bad: BAD, nodes: [] };
    var seen = {}, out = [];
    PAGES.forEach(function (p) {
      for (var n = 1; n <= p[1].last; n++) {
        var nodes = [].slice.call(p[n].box.children);
        p[n].hrefs.forEach(function (h, j) { if (!seen[h]) { seen[h] = 1; out.push(nodes[j]); } });
      }
    });
    return { bad: "", nodes: out };
  })();
  // The cards go into the page here, after the last await: the card code below runs in the same synchronous step,
  // before the site's wp-emoji observer turns an emoji in a moved card into an <img> (its text would lose the emoji).
  var POOL_BOX = document.querySelector("#container-jobs");
  document.querySelectorAll(_).forEach(function (e) { e.remove(); });
  if (POOL.bad) console.warn("nisha pool failed: " + POOL.bad + "; all cards removed, nothing written");
  else POOL.nodes.forEach(function (e) { POOL_BOX.appendChild(e); });
}
var k={מרכז:"אזור מרכז",שרון:"אזור השרון","ירושלים והסביבה":"אזור ירושלים",דרום:"אזור דרום",צפון:"אזור צפון",שפלה:"אזור שפלה"},ee={"אזור מרכז":"M","אזור השרון":"S","אזור ירושלים":"J","אזור דרום":"D","אזור צפון":"Z","אזור שפלה":"P"},g=[];'ירושלים:J;נתניה:S;רעננה:S;פתח תקווה|פתח תקוה:M;תל אביב-יפו|תל אביב|תל-אביב:M;בת-ים|בת ים:M;איירפורט סיטי|אירפורט סיטי|Airport City:MP;חיפה|Haifa:Z;רחובות:P;מודיעין:MP;ראש העין:MS;אשדוד:PD;הרצליה:MS;רמת גן:M;ראשון לציון|ראשל"צ:MP;בני ברק:M;שוהם:MP;יבנה:P;ירוחם:D;אור עקיבא:SZ;באר טוביה:PD;נס ציונה:MP;רמת השרון:MS;קיסריה:SZ;יוקנעם|יקנעם:Z;אזור ירושלים:J;אזור מרכז|אזור המרכז|מרכז הארץ:M;אזור השרון:S;אזור שפלה|אזור השפלה:P;אזור צפון|אזור הצפון:Z;אזור דרום|אזור הדרום:D'.split(";").forEach(function(e){var t=e.split(":"),n=t[0].split("|");n.forEach(function(r){g.push([r,n[0],t[1]])})}),g.push(["מרכז","אזור מרכז","M",1],["צפון","אזור צפון","Z",1],["דרום","אזור דרום","D",1],["שפלה","אזור שפלה","P",1],["שרון","אזור השרון","S",1]),g.sort(function(e,t){return t[0].length-e[0].length});for(var te=/(מיקום המשרה|מקום העבודה|המשרה ממוקמת ב|^[^א-תA-Za-z]*location\b|^[^א-תA-Za-z]*(ה?עבודה|משרה מלאה) .*(במשרדי|מהמשרדים|ממשרדי|במשרה מלאה ב))/i,re=/(ממוקמ|ממוקדמ|יושב|שוכנ)[א-ת]* ב|(^|[^א-ת])(באתר|בצוות) /,ne=/(^|[^א-ת])ל(חבר[הת]|ארגון|קבוצ[הת]|מפעל|משרד|סטא?רט ?-?אפ|רשת|מעבד[הת]|מכון|אתר)/,J=/(משרת|עבודת|עבודה ב|ב)שטח([\s,.)]|$)/,j=' ,.()-–/|:;!?*"',y=function(e,t,n){return e=e.replace(/\s/g," ").replace(/[״”“]/g,'"'),g.forEach(function(r){if(!(r[3]&&n!==1))for(var a=e.indexOf(r[0]);a>=0;){var o=e.charAt(a-1)||" ",h=e.charAt(a+r[0].length)||" ";(n===1?o==="ב"&&!/[א-ת]/.test(e.charAt(a-2)):j.indexOf(o)>=0||"בומ".indexOf(o)>=0&&j.indexOf(e.charAt(a-2)||" ")>=0)&&(n===2?a+r[0].length===e.length:j.indexOf(h)>=0)&&(t.some(function(s){return s[0]===r[1]})||t.push([r[1],r[2]]),e=e.slice(0,a)+"#".repeat(r[0].length)+e.slice(a+r[0].length)),a=e.indexOf(r[0],a+1)}}),t},ae=/(?=\p{L})[\p{sc=Hebrew}\p{sc=Latin}]/u,ie=/(?![\p{sc=Hebrew}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}])\p{L}/u,oe=new RegExp("["+String.fromCodePoint(119808)+"-"+String.fromCodePoint(120831)+"]","gu"),M=function(e){var t=document.createElement("div");e.forEach(function(a){t.appendChild(a.cloneNode(!0))});for(var n=document.createTreeWalker(t,4),r;r=n.nextNode();)r.data=r.data.replace(/\s+/g," ");return t.querySelectorAll("br").forEach(function(a){a.replaceWith(`
`)}),t.querySelectorAll("li").forEach(function(a){var o=(a.textContent||"").trim();a.textContent=o?/^[•\-–*]/.test(o)?o:"• "+o:""}),t.querySelectorAll("p,li,div,h1,h2,h3,h4,h5,h6,ul,ol").forEach(function(a){a.append(`
`)}),(t.textContent||"").split(`
`).map(function(a){return a.replace(/\s+/g," ").trim()}).join(`
`).replace(/\n{3,}/g,`

`).trim()},l=function(e,t,n){var r=document.createElement("span");r.className=t,r.style.display="none",r.textContent=n,e.appendChild(r)},$=document.querySelector("form.wpcf7-form"),P=$?[].map.call($.querySelectorAll("input,select,textarea"),function(e){if(/submit|button/.test(e.type))return null;var t={name:e.name,label:((e.closest("label")||{}).innerText||e.placeholder||"").trim(),tagName:e.tagName,required:e.required||/validates-as-required/.test(e.className),fieldType:e.tagName==="INPUT"?e.type:e.tagName.toLowerCase()};return e.accept&&(t.accept=e.accept),e.type==="hidden"&&!/recaptcha/.test(e.name)&&(t.value=e.value),t}).filter(Boolean):null,U=document.querySelectorAll(_),N=0;N<U.length;N++){var i=U[N];try{if(i.querySelector(".__ai-title")||!v(i))continue;var c=(v(i).textContent||"").trim().replace(oe,function(e){return e.normalize("NFKC")});if(!c||!ae.test(c)||ie.test(c)){i.remove();continue}if(/השאירו קו.ח/.test(c)){i.remove();continue}l(i,"__ai-title",c);var O=((i.querySelector(".job-id")||{}).textContent||"").trim();/^\d+$/.test(O)&&l(i,"__ai-id","nisha-"+O);var S=((i.querySelector(".job-date")||{}).textContent||"").match(/(\d\d)\/(\d\d)\/(\d{4})/);S&&l(i,"__ai-date",S[3]+"-"+S[2]+"-"+S[1]);var z=i.querySelector(".job-description"),m={d:[],r:[],a:[]},W="d";z&&[].forEach.call(z.childNodes,function(e){if(e.nodeType===1&&e.classList.contains("more-details")){[].forEach.call(e.childNodes,function(t){if(t.nodeType===1&&t.matches("p.title")){var n=(t.textContent||"").trim();W=/דרישות/.test(n)?"r":/על החברה/.test(n)?"a":"d";return}m[W].push(t)});return}e.nodeType===1&&e.matches("p.title")||m.d.push(e)});var T=M(m.d),Z=M(m.r),B=M(m.a),G=[T,B].filter(String).join(`

`);G&&l(i,"__ai-description",G),Z&&l(i,"__ai-requirements",Z);var x=[],K="";i.querySelectorAll(".job-tags span").forEach(function(e){var t=k[(e.textContent||"").trim()];t&&x.indexOf(t)<0&&(x.push(t),K+=ee[t])});var b=[T,Z,B].join(`
`),f=[];if(b.split(`
`).forEach(function(e){te.test(e)&&!/מרחוק|הלקוח/.test(e)&&y(e,f)}),!f.length&&!J.test(b)&&b.split(`
`).forEach(function(e){for(var t=new RegExp(re.source,"g"),n;n=t.exec(e);){var r=e.slice(n.index).split(/[.:(]|נכונות|בהמשך|בעתיד/)[0].replace(/[״”“]/g,'"').replace(/אזור (ה[א-ת]+)\/(ה[א-ת]+)/,"אזור $1 / אזור $2");/סניפ/.test(r)||y(r,f)}}),!f.length&&!J.test(b)){var E=Math.max(c.lastIndexOf("-"),c.lastIndexOf("–"));E>0&&!(/[א-ת]/.test(c.charAt(E-1))&&/[א-ת]/.test(c.charAt(E+1)))&&y(c.slice(E+1).trim().replace(/[.)\s]+$/,""),f,2),[c].concat(T.split(`
`).filter(String).slice(0,3)).forEach(function(e){var t=e.match(ne);if(t){var n=e.slice(t.index).split(/דרוש|[.:]/)[0];/סניפ/.test(n)||y(n,f,1)}})}var w=x;x.length?f.some(function(e){return e[1].split("").some(function(t){return K.indexOf(t)>=0})})&&(w=f.map(function(e){return e[0]})):w=f.map(function(e){return e[0]}),l(i,"__ai-location",w.length?w.join(", "):"Unknown");var ce=(i.querySelector("[data-job]")||{getAttribute:function(){return""}}).getAttribute("data-job")||"",R=P&&P.filter(function(e){return e.name==="_wpcf7"})[0];R&&l(i,"__ai-form",JSON.stringify({formSelector:"form.wpcf7-form:has(input[type=file])",actionUrl:location.origin+"/wp-json/contact-form-7/v1/contact-forms/"+R.value+"/feedback",method:"POST",enctype:"multipart/form-data",fields:P.map(function(e){var t=Object.assign({},e),n={"job-title":c,"order-id":O,"job-id":ce}[e.name];return n!==void 0&&(t.value=n),t})}))}catch{}}
