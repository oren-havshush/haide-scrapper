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
  // Step 6 (phase one M7): the owner ranks cost per site last, so the skill does
  // not optimise for it, and a run no longer ends on a time cap or a fix count.
  {
    rule: 'removed goal "at low/minimum cost": the owner ranks cost last (addsite3 §0); step 6',
    pattern: /\bat\s+(low|minimum)\s+cost\b/i,
  },
  {
    rule: 'removed goal "lean-core cost goal": the owner ranks cost last (addsite3 §0); step 6',
    pattern: /lean-core\s+cost\s+goal/i,
  },
  {
    rule: 'removed SKIP budget "Time cap: 15 minutes": runs no longer end on a time cap; step 6',
    pattern: /Time\s+cap:?\**\s*15\s*min/i,
  },
  {
    rule: 'removed SKIP budget "≤ 3 total distinct fix attempts": runs no longer end on a fix count; step 6',
    pattern: /3\s+total\s+distinct\s+fix\s+attempts/i,
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
