// goldpro.co.il/דרושים — build normalised job items from CONTENT anchors.
//
// Deliberately does NOT key on the theme's generated markup
// (section.single_faq / div.fqqc / div.fqqcm / button.ff.open_ans). Those class
// names are emitted by the WordPress theme's FAQ-accordion widget and change
// whenever the theme does — the previous config died exactly that way, leaving
// itemSelector ".item" matching nothing while three stale jobs masked it.
//
// What every posting reliably has instead:
//   - a paragraph stating "מיקום המשרה: <city>"
//   - a clickable title (button/heading) above that paragraph
//   - a mailto: link for applications
//
// So: anchor on the text, walk up to the posting container, and emit one
// self-contained `.__ai-job` node per posting with every field inside it.
// Fields are read item-scoped, so each node must carry its own values.
const GP_MARK = /מיקום\s*המשרה/;
const GP_EMAIL = /[\w.+-]+@[\w.-]+\.\w{2,}/;

if (!document.querySelector(".__ai-job")) {
  const gpSeen = [];
  const gpHost = document.createElement("div");
  gpHost.className = "__ai-jobs-host";
  gpHost.style.display = "none";

  for (const p of Array.from(document.querySelectorAll("p"))) {
    if (!GP_MARK.test(p.textContent || "")) continue;

    // Walk up until an ancestor also holds a real title node.
    let container = p;
    let titleEl = null;
    for (let i = 0; i < 6 && container.parentElement; i++) {
      container = container.parentElement;
      const t = container.querySelector("button, h2, h3, h4");
      if (t && (t.textContent || "").replace(/\s+/g, " ").trim().length > 2) {
        titleEl = t;
        break;
      }
    }
    if (!titleEl) continue;
    if (gpSeen.indexOf(container) !== -1) continue; // one node per posting
    gpSeen.push(container);

    const title = (titleEl.textContent || "").replace(/\s+/g, " ").trim();

    // Body = the container minus its title node, so the heading is not repeated
    // inside the description. innerHTML is copied rather than text so that
    // domFieldExtract still sees <br>/<p> and produces real line breaks.
    const clone = container.cloneNode(true);
    const cloneTitle = clone.querySelector("button, h2, h3, h4");
    if (cloneTitle) cloneTitle.remove();
    clone.querySelectorAll("style, script, noscript, svg, iframe").forEach(function (n) {
      n.remove();
    });

    const job = document.createElement("div");
    job.className = "__ai-job";

    const t = document.createElement("span");
    t.className = "__ai-title";
    t.textContent = title;
    job.appendChild(t);

    const d = document.createElement("div");
    d.className = "__ai-description";
    d.innerHTML = clone.innerHTML;
    job.appendChild(d);

    // "מיקום המשרה: תל אביב" -> "תל אביב"
    const locMatch = /מיקום\s*המשרה\s*:\s*([^\n<]{2,40})/.exec(container.textContent || "");
    if (locMatch) {
      const l = document.createElement("span");
      l.className = "__ai-location";
      l.textContent = locMatch[1].replace(/\s+/g, " ").trim();
      job.appendChild(l);
    }

    // Apply target: the posting's own mailto, else an address printed in prose.
    const mail = container.querySelector('a[href^="mailto:"]');
    const prose = GP_EMAIL.exec(container.textContent || "");
    const apply = mail
      ? mail.getAttribute("href")
      : prose
        ? "mailto:" + prose[0]
        : "";
    if (apply) {
      const a = document.createElement("span");
      a.className = "__ai-apply";
      a.textContent = apply;
      job.appendChild(a);
    }

    // Stable id. The site prints no requisition number and the postings have no
    // per-item URL, so hash the title — the only content that identifies a
    // posting and survives a rescrape. Never the location (LRN-ID-7: it is
    // re-canonicalised every run) and never the index (LRN-ID-1).
    let h = 5381;
    for (let i = 0; i < title.length; i++) {
      h = ((h << 5) + h) ^ title.charCodeAt(i);
      h = h >>> 0;
    }
    const id = document.createElement("span");
    id.className = "__ai-jobid";
    id.textContent = "gp-" + h.toString(36);
    job.appendChild(id);

    gpHost.appendChild(job);
  }

  if (gpHost.children.length) document.body.appendChild(gpHost);
}
