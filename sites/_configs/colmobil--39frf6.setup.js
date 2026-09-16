// colmobil — enrich each listing card from the job page's server-rendered
// JSON-LD JobPosting (description + category) and canonicalise the city.
// The listing DOM carries only code/title/city; the body lives on the detail
// page, which is SSR'd, so one same-origin fetch per card is enough.
if (/\/career-in-colmobil\/jobs\/?$/.test(location.pathname)) {
  var CARD = "a.job-card-wrap";
  var CITY_FIX = { "\u05ea\u05dc \u05d0\u05d1\u05d9\u05d1": "\u05ea\u05dc \u05d0\u05d1\u05d9\u05d1-\u05d9\u05e4\u05d5" };
  var FIELD = "\u05e9\u05d8\u05d7";
  var NATIONWIDE = "\u05e4\u05e8\u05d9\u05e1\u05d4 \u05d0\u05e8\u05e6\u05d9\u05ea";
  // Region words a FIELD card can carry in its title, each an exact city.csv
  // entry. "merkaz" is deliberately absent: it collides with "merkazi" inside
  // ordinary role names.
  var REGIONS = [
    ["\u05e6\u05e4\u05d5\u05df", "\u05d0\u05d6\u05d5\u05e8 \u05e6\u05e4\u05d5\u05df"],
    ["\u05d3\u05e8\u05d5\u05dd", "\u05d0\u05d6\u05d5\u05e8 \u05d3\u05e8\u05d5\u05dd"],
    ["\u05d4\u05e9\u05e8\u05d5\u05df", "\u05d0\u05d6\u05d5\u05e8 \u05d4\u05e9\u05e8\u05d5\u05df"],
    ["\u05e9\u05e4\u05dc\u05d4", "\u05d0\u05d6\u05d5\u05e8 \u05e9\u05e4\u05dc\u05d4"],
    ["\u05d0\u05d9\u05dc\u05ea", "\u05d0\u05d6\u05d5\u05e8 \u05d0\u05d9\u05dc\u05ea"]
  ];

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  var mk = function (cls, text) {
    var s = document.createElement("span");
    s.className = cls;
    s.style.display = "none";
    s.textContent = text;
    return s;
  };

  // A FIELD card names a territory, not an office, so it has no city.csv entry
  // of its own. Prefer the region its title names; otherwise fall back to the
  // nationwide bucket.
  var regionFromTitle = function (item) {
    var h = item.querySelector("h3.position");
    var title = h ? (h.textContent || "") : "";
    var heb = /[\u0590-\u05ff]/;
    for (var r = 0; r < REGIONS.length; r++) {
      var word = REGIONS[r][0];
      for (var at = title.indexOf(word); at !== -1; at = title.indexOf(word, at + 1)) {
        var before = at > 0 ? title[at - 1] : " ";
        var after = at + word.length < title.length ? title[at + word.length] : " ";
        if (!heb.test(before) && !heb.test(after)) return REGIONS[r][1];
      }
    }
    return NATIONWIDE;
  };

  // A real city on the card always beats the territory bucket.
  var fixLocation = function (raw, item) {
    var out = [];
    String(raw || "").split(",").forEach(function (part) {
      var p = part.trim();
      if (!p) return;
      var v = p === FIELD ? regionFromTitle(item) : (CITY_FIX[p] || p);
      if (out.indexOf(v) === -1) out.push(v);
    });
    if (out.length > 1) {
      var real = out.filter(function (v) { return v !== NATIONWIDE && REGIONS.every(function (x) { return x[1] !== v; }); });
      if (real.length) out = real;
    }
    return out.join(", ");
  };

  var readJobPosting = function (html) {
    var re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
    var m;
    while ((m = re.exec(html))) {
      if (m[1].indexOf("JobPosting") === -1) continue;
      try {
        var j = JSON.parse(m[1]);
        if (j && j["@type"] === "JobPosting") return j;
      } catch (e) { /* try the next block */ }
    }
    return null;
  };

  // The board is a React island that hydrates well after DOMContentLoaded, and
  // the worker runs this before its own autoscroll — so wait for the cards to
  // mount and their count to settle, or we enrich an empty DOM.
  var prev = -1, stable = 0;
  for (var t = 0; t < 60; t++) {
    var n = document.querySelectorAll(CARD).length;
    if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
    prev = n;
    await sleep(500);
  }

  var queue = [].slice.call(document.querySelectorAll(CARD));
  var pump = async function () {
    while (queue.length) {
      var item = queue.shift();
      if (!item || item.querySelector(".__ai-description")) continue;
      var cityEl = item.querySelector(".city");
      if (!item.querySelector(".__ai-location"))
        item.appendChild(mk("__ai-location", fixLocation(cityEl ? cityEl.textContent : "", item)));
      // Namespace the site's own req number: a bare 4-digit integer is
      // indistinguishable from a row index to the id gate.
      var codeEl = item.querySelector(".code");
      var code = codeEl ? (codeEl.textContent || "").trim() : "";
      if (code && !item.querySelector(".__ai-jobid"))
        item.appendChild(mk("__ai-jobid", "colmobil-" + code));
      var href = item.getAttribute("href") || "";
      if (!href) continue;
      var abs = new URL(href, location.href).toString();
      if (!item.querySelector(".__ai-detailurl")) item.appendChild(mk("__ai-detailurl", abs));
      try {
        var res = await fetch(abs, { credentials: "same-origin" });
        if (!res.ok) continue;
        var ld = readJobPosting(await res.text());
        if (!ld) continue;
        var desc = String(ld.description || "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
        if (desc) item.appendChild(mk("__ai-description", desc));
        var dept = String(ld.responsibilities || "").trim();
        if (dept) item.appendChild(mk("__ai-department", dept));
      } catch (e) { /* leave this card listing-only */ }
    }
  };
  var lanes = [];
  for (var i = 0; i < 24; i++) lanes.push(pump());
  await Promise.all(lanes);
}
