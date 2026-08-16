// pac.ac.il/jobs/ — expose the apply target and the printed requisition number.
//
// Runs on BOTH the listing and the AdamTotal apply page, so each half is
// guarded by a marker that only exists on its own page.
//
// LISTING: the apply control is `<button class="custom-btn" data-csp-open="…">`,
// not an anchor, so Navigate Mode (which reads href off an <a>) finds nothing to
// follow. Mirror the target into a real anchor it can collect.
//
// APPLY PAGE: the requisition number is printed as
//   <span class="inline-flex …"><i class="fa fa-hashtag"></i> מספר משרה: 623888</span>
// The worker honors no regex on field mappings (LRN-WRK-1) and domFieldExtract
// would hand back the whole "מספר משרה: 623888" label, so slice the digits here.
// Prefixed (`pac-`) so verify-jobids does not read an all-integer id set as
// index-based.

// --- listing -----------------------------------------------------------------
const PAC_ITEM = "div.job-item";
if (document.querySelector(PAC_ITEM)) {
  for (const item of document.querySelectorAll(PAC_ITEM)) {
    if (item.querySelector(".__ai-applyurl")) continue; // idempotent across re-runs
    const btn = item.querySelector("button.custom-btn[data-csp-open]");
    const target = btn ? btn.getAttribute("data-csp-open") || "" : "";
    if (!target) continue;

    // applicationInfo — the real per-job apply target (https… or mailto:…).
    const info = document.createElement("span");
    info.className = "__ai-applyinfo";
    info.style.display = "none";
    info.textContent = target;
    item.appendChild(info);

    // Only http(s) targets are navigable; a mailto: anchor would send the
    // worker nowhere useful.
    if (/^https?:\/\//i.test(target)) {
      const a = document.createElement("a");
      a.className = "__ai-applyurl";
      a.href = target;
      a.style.display = "none";
      a.textContent = "apply";
      item.appendChild(a);
    }
  }
}

// --- AdamTotal apply page ----------------------------------------------------
if (
  location.hostname.indexOf("adamtotal") !== -1 &&
  !document.querySelector(".__ai-jobid")
) {
  const m = /מספר\s*משרה[:\s]*([0-9]{3,})/.exec(document.body.innerText || "");
  if (m) {
    const span = document.createElement("span");
    span.className = "__ai-jobid";
    span.style.display = "none";
    span.textContent = "pac-" + m[1];
    document.body.appendChild(span);
  }
}
