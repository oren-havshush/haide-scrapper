// סיני סטור — single-page accordion board (WPBakery/us-core .w-tabs-section).
// Only injection needed: location. Every posting is the Tel Aviv store/HQ and the
// city is stated inside the prose, never in its own element, so a hardcoded
// constant is injected per item — this overrides the gazetteer, which
// locationFallback cannot do (LRN-LOC-1).
// description/title need no injection: domFieldExtract already inserts newlines
// after block elements and prefixes <li> with "• " (bfe1935).
// externalJobId is deliberately UNMAPPED — the section id attributes
// (.w-tabs-section[id]) are regenerated randomly on every render, so the worker's
// h-<hash(title)> fallback is the only stable key here.
for (const item of document.querySelectorAll(".w-tabs-section")) {
  if (item.querySelector(".__ai-location")) continue;
  const span = document.createElement("span");
  span.className = "__ai-location";
  span.style.display = "none";
  span.textContent = "תל אביב";
  item.appendChild(span);
}
