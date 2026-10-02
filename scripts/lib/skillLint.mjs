// The addsite3 lint (addsite2 phase two, step 4; step 6 extends it).
//
// Phrases a rewritten rule has removed, which must not come back into
// addsite3.md. Run by `node scripts/sync-addsite2.mjs --check` (check:skills);
// scripts/skillLint.test.ts covers it. Plain JS so the .mjs sync script imports it.

const RULES = [
  {
    // Step 4: native id first; with no native id the script emits no id and the
    // worker synthesises h-<haideHash(title|department|url)>.
    rule: 'removed rule "Prefer h-<hash>": native id first, else no id (the worker synthesises it); step 4',
    pattern: /Prefer\s+`?h-<hash>`?/,
  },
];

/** Every violation in the text, with its 1-based line number. */
export function lintAddsite3(text) {
  const out = [];
  const lines = String(text).split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const r of RULES) if (r.pattern.test(line)) out.push({ line: i + 1, rule: r.rule });
  });
  return out;
}
