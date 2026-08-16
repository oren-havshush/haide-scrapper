// ashtrom.co.il — inject a bare, parseable publish date on detail pages.
//
// The detail page prints the date as "11/08/2026" inside a <p> whose emotion
// class (muirtl-7hzu6h-NewText-StyledTypography) is SHARED with the "משרה חמה"
// badge that renders just above it — so `document.querySelector` on that class
// returns the badge, not the date, and no CSS selector can separate them.
//
// parsePublishDateToUtc is anchored (^D/M/YYYY$ via the [/.-] branch), so any
// surrounding text makes the value unparseable and ageBucket comes back null —
// "filled but useless", the LRN-WRK-14 failure. Emit the bare date instead.
//
// Runs on the listing page too (worker parity). The listing prints no dates, so
// the loop simply finds nothing there. Idempotent: guarded on .__ai-publishdate.
if (!document.querySelector(".__ai-publishdate")) {
  var __ashNodes = Array.from(document.querySelectorAll("p, span, time"));
  for (var __i = 0; __i < __ashNodes.length; __i++) {
    if (__ashNodes[__i].children.length) continue;
    var __t = (__ashNodes[__i].textContent || "").trim();
    if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(__t)) continue;
    var __s = document.createElement("span");
    __s.className = "__ai-publishdate";
    __s.style.display = "none";
    __s.textContent = __t;
    document.body.appendChild(__s);
    break;
  }
}
