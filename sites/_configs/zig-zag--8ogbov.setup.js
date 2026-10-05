// Next.js page: poll for the cards (rendered client-side) before marking them.
function cards() {
  return Array.prototype.filter.call(document.querySelectorAll('div.rounded-2xl'), function (c) {
    return c.querySelector('h3') && /הגש מועמדות/.test(c.textContent || '');
  });
}
var prev = -1, stable = 0;
for (var t = 0; t < 60; t++) {
  var n = cards().length;
  if (n > 0 && n === prev) { if (++stable >= 2) break; } else { stable = 0; }
  prev = n;
  await new Promise(function (r) { setTimeout(r, 500); });
}

function haideHash(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
function sq(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
function mk(item, cls, v) { if (!v) return; var s = document.createElement('span'); s.className = cls; s.style.display = 'none'; s.textContent = v; item.appendChild(s); }

// Owner, 2026-10-05: a card naming Holon -> חולון; "גוש דן ומרכז הארץ" -> אזור מרכז; no place -> Unknown.
// Read from the card's own line only, never the requirement ticks ("תושב מרכז הארץ" is a requirement).
var PLACES = [[/חולון/, 'חולון'], [/גוש דן|מרכז הארץ/, 'אזור מרכז']];

// The page-wide intro printed once above every card (rule 4: travels with each job).
var shared = '';
Array.prototype.some.call(document.querySelectorAll('p'), function (p) {
  if (/אנחנו מחפשים/.test(p.textContent || '')) { shared = sq(p.textContent); return true; }
  return false;
});

cards().forEach(function (card) {
  if (card.classList.contains('__haide-job')) return;
  card.classList.add('__haide-job');
  var title = sq(card.querySelector('h3').textContent);
  var type = sq((card.querySelector('h3 + span') || {}).textContent);
  var line = sq((card.querySelector('p') || {}).textContent);
  // Requirement ticks: <div><span>✓</span> text</div>
  var reqs = Array.prototype.filter.call(card.querySelectorAll('div > span:first-child'), function (s) { return sq(s.textContent) === '✓'; })
    .map(function (s) { return sq(s.parentElement.textContent).replace(/^✓\s*/, ''); }).filter(Boolean);
  var locs = [];
  PLACES.forEach(function (p) { if (p[0].test(line) && locs.indexOf(p[1]) < 0) locs.push(p[1]); });
  var desc = [line];
  if (type) desc.push('סוג משרה: ' + type);
  if (shared) desc.push(shared);
  mk(card, '__ai-title', title);
  // No job number and no per-job URL: id = h-haideHash(title).
  mk(card, '__ai-eid', 'h-' + haideHash(title));
  mk(card, '__ai-location', locs.length ? locs.join(', ') : 'Unknown');
  mk(card, '__ai-description', desc.filter(Boolean).join('\n'));
  mk(card, '__ai-requirements', reqs.join('\n'));
});
