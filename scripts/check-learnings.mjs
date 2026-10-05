#!/usr/bin/env node
/**
 * check-learnings — addsite2 phase two, step 6. Run by `pnpm check:skills`
 * (scripts/sync-addsite2.mjs --check), and on its own:
 *
 *   node scripts/check-learnings.mjs
 *
 * Fails when addsite3.md or addsite3-recipes/ cites an LRN- id that
 * docs/addsite-learnings.md lacks, when two learnings share an id, or when a
 * learning has no row in docs/learnings-status.tsv. The rules are in
 * scripts/lib/checkLearnings.mjs.
 *
 * Adding a learning? Add its row to docs/learnings-status.tsv in the same
 * commit: CODE <test or file>, RECIPE <addsite3 file:line>, or RETIRED <why>.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLearnings } from './lib/checkLearnings.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Problems for the repo at `root`, as strings; [] when it passes. */
export function runCheckLearnings(root = ROOT) {
  const rel = (p) => join(root, p);
  const recipes = existsSync(rel('addsite3-recipes'))
    ? readdirSync(rel('addsite3-recipes')).filter((f) => f.endsWith('.md')).map((f) => `addsite3-recipes/${f}`)
    : [];
  const cited = ['addsite3.md', ...recipes]
    .filter((f) => existsSync(rel(f)))
    .map((f) => ({ file: f, text: readFileSync(rel(f), 'utf8') }));
  const tsv = rel('docs/learnings-status.tsv');
  const problems = checkLearnings({
    learningsText: readFileSync(rel('docs/addsite-learnings.md'), 'utf8'),
    tsvText: existsSync(tsv) ? readFileSync(tsv, 'utf8') : '',
    cited,
    fileExists: (p) => existsSync(rel(p)),
    lineCount: (p) => (existsSync(rel(p)) ? readFileSync(rel(p), 'utf8').split(/\r?\n/).length : 0),
  });
  return problems.map((p) => `${p.kind}: ${p.detail}`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const problems = runCheckLearnings();
  for (const p of problems) console.error(`LEARNINGS: ${p}`);
  if (problems.length > 0) process.exit(1);
  console.log('OK: every cited learning exists, ids are unique, every learning has a status row');
}
