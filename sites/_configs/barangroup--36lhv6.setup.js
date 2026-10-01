// barangroup irm-careers: hidden body per row; popup deep link ?jobid=<id>
var ROW = "li.loop-career", prev = -1, stable = 0;
for (var t = 0; t < 40; t++) {
  var n = document.querySelectorAll(ROW).length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}
var LI = String.fromCharCode(1);
// page spelling -> verbatim city.csv value
var VOCAB = [["מחוז אילת", "אזור אילת"], ["תל אביב", "תל אביב-יפו"], ["פתח תקווה", "פתח תקווה"],
  ["ירושלים", "ירושלים"], ["בית שמש", "בית שמש"], ["בית דגן", "בית דגן"], ["שפרעם", "שפרעם"],
  ["חולון", "חולון"], ["נתניה", "נתניה"], ["עומר", "עומר"], ["חיפה", "חיפה"], ["אילת", "אילת"],
  ["פריסה ארצית", "פריסה ארצית"], ["אזור השרון", "אזור השרון"], ["יו\"ש", "אזור יהודה ושומרון"],
  ["יו״ש", "אזור יהודה ושומרון"]];
var REGION_WORD = { "דרום": "אזור דרום", "צפון": "אזור צפון", "מרכז": "אזור מרכז" };
var SECTOR = { "גוש דן": "אזור מרכז", "השפלה": "אזור שפלה", "השרון": "אזור השרון",
  "צפון": "אזור צפון", "דרום": "אזור דרום", "אילת": "אזור אילת" };
var HEB = /[א-ת]/;
var push = function (a, v) { if (a.indexOf(v) === -1) a.push(v); };
var findPlaces = function (s, out, needB) {
  for (var v = 0; v < VOCAB.length; v++) {
    var w = VOCAB[v][0], from = 0, k;
    while ((k = s.indexOf(w, from)) !== -1) {
      from = k + 1;
      var b = s.charAt(k - 1), pre = "בלו".indexOf(b) !== -1 && !HEB.test(s.charAt(k - 2));
      var ok = needB ? b === "ב" && !HEB.test(s.charAt(k - 2)) : (k === 0 || !HEB.test(b) || pre);
      if (!ok || HEB.test(s.charAt(k + w.length))) continue;
      push(out, VOCAB[v][1]);
      s = s.slice(0, k) + " ".repeat(w.length) + s.slice(k + w.length);
    }
  }
  return s;
};
var segPlaces = function (s, out) {
  var segs = s.split(/\s[|–\-]\s?|\s?[|–\-]\s/);
  for (var i = 0; i < segs.length; i++)
    for (var v = 0; v < VOCAB.length; v++) if (segs[i].trim() === VOCAB[v][0]) push(out, VOCAB[v][1]);
};
var strip = function (s) { return s.replace(/^[^א-תA-Za-z0-9]+|[\s:*?.\-–]+$/g, ""); };
var REQ_H = /^(דרישות( התפקיד| המשרה| חובה| סף| נוספות)?|כישורים( אישיים)?|תנאי סף|יתרון( משמעותי)?|יתרונות|מה אנחנו מחפשים|מה חשוב לנו)$/;
var DESC_H = /^(תיאור (ה)?(תפקיד|משרה)|תחומי אחריות|התפקיד כולל|מה כולל התפקיד|מה בתפקיד|במסגרת התפקיד|על התפקיד|תנאי (ה)?משרה|מיקום( המשרה)?|היקף (ה)?משרה|סיווג ביטחוני|אזור פעילות)$/;
var DROP_H = /^(דרישות( התפקיד| המשרה)?|תיאור (ה)?(תפקיד|משרה)|מה אנחנו מחפשים|מה חשוב לנו|מה בתפקיד|על התפקיד)$/;
var CLOSE = /^[*\s]*(המשרה מיועדת|רק פניות|פניות (רלוונטיות|מתאימות)|הגישו|הזדמנות|מכירים מישהו|משמרת)|^[📍🕒🕗💼🚗🔐📩]/u;
// LRN-SETUP-18
var isReq = function (s) {
  return /חובה|יתרון/.test(s) || /^(ניסיון|נסיון|ידע|רישיון|רשיון|תעודה|תעודת|בעל|יכולת|נכונות|זמינות|שליטה|הכרה|הכרת|השכלה|תואר|נדרש|רצוי|\S+ שנות ניסיון)/.test(s);
};
var notReq = function (s) { return /דרוש|מגייס|\d:\d\d|:$/.test(s) || s.length > 150 || CLOSE.test(s); };
var toLines = function (el) {
  var c = el.cloneNode(true);
  c.querySelectorAll("img").forEach(function (x) { var a = x.getAttribute("alt") || ""; x.replaceWith(a.length <= 4 ? a : ""); });
  c.querySelectorAll("br").forEach(function (x) { x.replaceWith("\n"); });
  c.querySelectorAll("li").forEach(function (x) { x.prepend(LI); });
  c.querySelectorAll("p,div,li,h1,h2,h3,h4,h5,h6,section,ul,ol").forEach(function (x) { x.append("\n"); });
  var raw = (c.textContent || "").split("\n"), out = [], pend = false;
  for (var i = 0; i < raw.length; i++) {
    var s = raw[i].replace(/[\s ]+/g, " ").trim(), li = pend;
    if (s.charAt(0) === LI) { li = true; s = s.replace(new RegExp("^[" + LI + "\\s]+"), ""); }
    if (!s || !/[א-תA-Za-z0-9]/.test(s)) { pend = li; continue; }
    pend = false;
    out.push({ t: s, li: li });
  }
  return out;
};
var render = function (lines, cls) {
  var box = document.createElement("div"), ul = null;
  box.className = cls; box.style.display = "none";
  for (var i = 0; i < lines.length; i++) {
    var li = lines[i].li;
    if (li && !ul) { ul = document.createElement("ul"); box.appendChild(ul); }
    if (!li) ul = null;
    var e = document.createElement(li ? "li" : "p"); e.textContent = lines[i].t;
    (li ? ul : box).appendChild(e);
  }
  return box;
};
var add = function (row, cls, text, href) {
  var e = document.createElement(href ? "a" : "span");
  e.className = cls; e.style.display = "none"; e.textContent = text;
  if (href) e.setAttribute("href", href);
  row.appendChild(e);
};
var base = location.origin + location.pathname;
var rows = Array.prototype.slice.call(document.querySelectorAll(ROW));
for (var i = 0; i < rows.length; i++) {
  var row = rows[i], id = (row.getAttribute("data-order_id") || "").trim();
  if (!id || row.querySelector(".__ai-externalJobId")) continue;
  add(row, "__ai-externalJobId", "barangroup-" + id);
  add(row, "__ai-detailUrl", base + "?jobid=" + id, base + "?jobid=" + id);
  var dm = /^(\d{2})-(\d{2})-(\d{4})$/.exec((row.getAttribute("data-pub_date") || "").trim());
  if (dm) add(row, "__ai-publishDate", dm[3] + "-" + dm[2] + "-" + dm[1]);
  var cat = (row.getAttribute("data-category") || "").trim();
  if (cat) add(row, "__ai-department", cat);
  var titleEl = row.querySelector(".loop-career-title h3");
  var title = titleEl ? titleEl.textContent.replace(/\s+/g, " ").trim() : "";
  var body = row.querySelector(".loop-career-content");
  var lines = body ? toLines(body) : [];
  var desc = [], req = [], sec = "none", places = [];
  for (var j = 0; j < lines.length; j++) {
    var L = lines[j], h = strip(L.t);
    var m = /^([^:]{2,25}?)\s*\*?\s*:\s*\*?\s*(.+)$/.exec(L.t.replace(/^[^א-תA-Za-z]+/, ""));
    var lab = m ? strip(m[1]) : "";
    if (/^[^א-תA-Za-z]*מיקום/.test(L.t) || /^📍/u.test(L.t)) {
      var val = L.t.replace(/^[^א-תA-Za-z]*(מיקום( המשרה)?[\s*]*[:–\-]?[\s*]*)?/u, "");
      if (!val && lines[j + 1]) val = lines[j + 1].t;
      var w = strip(findPlaces(val, places).replace(/[^א-ת ]/g, " ").replace(/\s+/g, " ").trim());
      if (REGION_WORD[w]) push(places, REGION_WORD[w]);
    }
    if (REQ_H.test(h)) { sec = "req"; if (!DROP_H.test(h)) req.push({ t: L.t.replace(/^[*\s]+|[*\s]+$/g, ""), li: false }); continue; }
    if (DESC_H.test(h)) { sec = "desc"; if (!DROP_H.test(h)) desc.push(L); continue; }
    if (m && REQ_H.test(lab)) { sec = "req"; req.push({ t: DROP_H.test(lab) ? m[2] : L.t, li: L.li }); continue; }
    if (m && DESC_H.test(lab)) { sec = "desc"; desc.push(DROP_H.test(lab) ? { t: m[2], li: L.li } : L); continue; }
    if (CLOSE.test(L.t)) sec = "close";
    if (sec === "req") req.push(L);
    else desc.push({ t: L.t, li: L.li, free: sec === "none" });
  }
  var keep = [], run = [];
  var flush = function () {
    var q = run.filter(function (x) { return isReq(x.t) && !notReq(x.t); }).length;
    for (var r = 0; r < run.length; r++) {
      var mv = !notReq(run[r].t) && (run.length > 1 ? q * 2 >= run.length : q === 1);
      (mv ? req : keep).push(run[r]);
    }
    run = [];
  };
  for (var d = 0; d < desc.length; d++) {
    if (desc[d].free && !notReq(desc[d].t)) run.push(desc[d]); else { flush(); keep.push(desc[d]); }
  }
  flush();
  if (!places.length) {
    segPlaces(title, places);
    for (var b2 = 0; b2 < lines.length; b2++) segPlaces(lines[b2].t, places);
    if (/(^|[\sב])פריסה ארצית/.test(title + "\n" + lines.map(function (x) { return x.t; }).join("\n"))) push(places, "פריסה ארצית");
    if (!places.length) findPlaces(title, places, true);
  }
  var sector = (row.getAttribute("data-sector") || "").trim();
  add(row, "__ai-location", places.length ? places.slice(0, 3).join(" / ") : (SECTOR[sector] || "Unknown"));
  if (keep.length) row.appendChild(render(keep, "__ai-description"));
  if (req.length) row.appendChild(render(req, "__ai-requirements"));
}
