// Guard against re-run
if (document.getElementById('__kimama-jobs')) return;

const mk = (cls, val) => {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = val;
  return s;
};

// Find all description items: comp-m9sbzwuv__item-*
const descEls = [...document.querySelectorAll('[id^="comp-m9sbzwuv__item-"]')]
  .filter(el => !el.id.includes('inlineContent') && !el.id.includes('gridContainer'));

if (descEls.length === 0) return;

const container = document.createElement('div');
container.id = '__kimama-jobs';
container.style.display = 'none';

for (const descEl of descEls) {
  // Extract item ID suffix (everything after "comp-m9sbzwuv__item-")
  const suffix = descEl.id.replace('comp-m9sbzwuv__item-', '');

  // Find matching title element
  const titleEl = document.getElementById('comp-m9sbzwuu5__item-' + suffix);
  const title = titleEl ? titleEl.textContent.trim() : '';
  if (!title || title.length < 3) continue;

  // Extract description text (strip "הגישו מועמדות" apply button text)
  let description = (descEl.textContent || '').replace(/הגישו מועמדות/g, '').replace(/\s+/g, ' ').trim();

  // Requirements live in a separate element: comp-m9zsa5ow__item-*
  const reqEl = document.getElementById('comp-m9zsa5ow__item-' + suffix);
  let requirements = reqEl ? (reqEl.textContent || '').replace(/הגישו מועמדות/g, '').replace(/\s+/g, ' ').trim() : '';
  requirements = requirements.replace(/^דרישות התפקיד:?\s*/, '').trim();

  const externalJobId = 'kimama-' + suffix;
  const applicationInfo = 'mailto:jobs@campkimama.org';

  const item = document.createElement('div');
  item.className = 'kimama-job-item';
  item.appendChild(mk('__ai-title', title));
  item.appendChild(mk('__ai-externalJobId', externalJobId));
  if (description) item.appendChild(mk('__ai-description', description));
  if (requirements) item.appendChild(mk('__ai-requirements', requirements));
  item.appendChild(mk('__ai-applicationInfo', applicationInfo));
  item.appendChild(mk('__ai-location', 'כל הארץ'));
  container.appendChild(item);
}

document.body.prepend(container);
