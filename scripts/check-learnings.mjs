#!/usr/bin/env node
/**
 * check-learnings — addsite2 phase two, step 6. Run by `pnpm check:skills`
 * (scripts/sync-addsite2.mjs --check), and on its own:
 *
 *   node scripts/check-learnings.mjs
 *
 * Fails when addsite3.md or addsite3-recipes/ cites an LRN- id that
 * docs/addsite-learnings.md lacks, when two learnings share an id, or when a
 * RECIPE row's line (or the three after it) does not cite its id. A learning
 * with no row in docs/learnings-status.tsv is a warning until the addsite3
 * switch (SWITCH_AT) and a failure from it. The rules are in
 * scripts/lib/checkLearnings.mjs.
 *
 * Adding a learning? Add its row to docs/learnings-status.tsv in the same
 * commit: CODE <test or file>, RECIPE <addsite3 file:line citing the id>, or
 * RETIRED <why>.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SWITCH_AT, checkLearnings } from './lib/checkLearnings.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Problems for the repo at `root`, as strings: `errors` fail the check, `warnings`
 * are printed (a learning with no status row, until SWITCH_AT).
 */
export function runCheckLearnings(root = ROOT, now = new Date()) {
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
    readLines: (p) => (existsSync(rel(p)) ? readFileSync(rel(p), 'utf8').split(/\r?\n/) : null),
    switchAt: SWITCH_AT ? new Date(SWITCH_AT) : null,
    now,
  });
  const text = (p) => `${p.kind}: ${p.detail}`;
  return {
    errors: problems.filter((p) => p.severity === 'error').map(text),
    warnings: problems.filter((p) => p.severity === 'warning').map(text),
  };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const { errors, warnings } = runCheckLearnings();
  for (const w of warnings) console.warn(`WARN: LEARNINGS: ${w}`);
  for (const e of errors) console.error(`LEARNINGS: ${e}`);
  if (errors.length > 0) process.exit(1);
  console.log('OK: every cited learning exists, ids are unique, every RECIPE line cites its id' + (warnings.length ? ` (${warnings.length} warning(s))` : ''));
}
