// check-learnings (addsite2 phase two, step 6). Pure: the CLI
// (scripts/check-learnings.mjs) and `pnpm check:skills` read the files and call
// in; scripts/checkLearnings.test.ts covers every rule.
//
// docs/addsite-learnings.md stays the append-only archive. docs/learnings-status.tsv
// holds one row per learning saying what carries it now:
//   CODE     the test or file that enforces it (a repo path that exists)
//   RECIPE   the addsite3 line that carries it (addsite3.md or addsite3-recipes/, file:line)
//   RETIRED  why it no longer needs carrying
// The check fails on an LRN- id cited in addsite3 that the archive lacks, on a
// duplicated id, and on a learning with no row (or a row naming no learning).

const HEADING = /^(#{2,4}) (LRN-[A-Z]+-\d+)\b/;
const CITED = /\bLRN-[A-Z]+-\d+\b/g;
const STATUSES = new Set(['CODE', 'RECIPE', 'RETIRED']);

/** Every learning heading, in file order: { id, line }. */
export function learningIds(text) {
  const out = [];
  String(text)
    .split(/\r?\n/)
    .forEach((l, i) => {
      const m = l.match(HEADING);
      if (m) out.push({ id: m[2], line: i + 1 });
    });
  return out;
}

/** Rows of the status file, header skipped: { id, status, reference, aliases, line }. */
function parseTsv(text) {
  const rows = [];
  String(text)
    .split(/\r?\n/)
    .forEach((l, i) => {
      if (i === 0 || l.trim() === '') return;
      const [id = '', status = '', reference = '', aliases = ''] = l.split('\t');
      rows.push({ id: id.trim(), status: status.trim(), reference: reference.trim(), aliases: aliases.trim(), line: i + 1 });
    });
  return rows;
}

function referenceProblem(row, env) {
  if (!row.reference) return 'no reference';
  if (row.status === 'CODE') {
    return env.fileExists(row.reference) ? null : `${row.reference} does not exist`;
  }
  if (row.status === 'RECIPE') {
    // addsite3 and its recipes; company-profile.md for the company lessons (HQ, LOGO),
    // the canonical skill addsite3 §14 runs. Never frozen addsite2.
    const m = row.reference.match(/^((?:addsite3\.md)|(?:addsite3-recipes\/[^:]+\.md)|(?:company-profile\.md)):(\d+)$/);
    if (!m) return `${row.reference} is not an addsite3.md, addsite3-recipes/ or company-profile.md file:line`;
    const n = env.lineCount(m[1]);
    if (n === 0) return `${m[1]} does not exist`;
    if (Number(m[2]) < 1 || Number(m[2]) > n) return `${m[1]} has ${n} lines, not ${m[2]}`;
  }
  return null;
}

/**
 * @param {{ learningsText: string, tsvText: string, cited: Array<{file: string, text: string}>,
 *           fileExists: (rel: string) => boolean, lineCount: (rel: string) => number }} a
 * @returns {Array<{ kind: string, id?: string, where?: string, detail: string }>}
 */
export function checkLearnings(a) {
  const problems = [];
  const heads = learningIds(a.learningsText);
  const seen = new Map();
  for (const h of heads) {
    if (seen.has(h.id)) {
      problems.push({ kind: 'duplicate', id: h.id, detail: `${h.id} is a heading at lines ${seen.get(h.id)} and ${h.line}` });
    } else seen.set(h.id, h.line);
  }

  for (const c of a.cited) {
    const ids = new Set(String(c.text).match(CITED) ?? []);
    for (const id of ids) {
      if (!seen.has(id)) problems.push({ kind: 'cited-missing', id, where: c.file, detail: `${c.file} cites ${id}, which the learnings file does not have` });
    }
  }

  const rows = parseTsv(a.tsvText);
  const rowIds = new Map();
  for (const r of rows) {
    if (rowIds.has(r.id)) {
      problems.push({ kind: 'duplicate-row', id: r.id, detail: `${r.id} has rows at tsv lines ${rowIds.get(r.id)} and ${r.line}` });
      continue;
    }
    rowIds.set(r.id, r.line);
    if (!seen.has(r.id)) {
      problems.push({ kind: 'unknown-row', id: r.id, detail: `tsv line ${r.line}: ${r.id} is not a learning` });
      continue;
    }
    if (!STATUSES.has(r.status)) {
      problems.push({ kind: 'bad-status', id: r.id, detail: `tsv line ${r.line}: status "${r.status}" is not CODE, RECIPE or RETIRED` });
      continue;
    }
    const bad = referenceProblem(r, a);
    if (bad) problems.push({ kind: 'bad-reference', id: r.id, detail: `tsv line ${r.line}: ${r.status} ${bad}` });
  }
  for (const id of seen.keys()) {
    if (!rowIds.has(id)) problems.push({ kind: 'no-status', id, detail: `${id} has no row in docs/learnings-status.tsv` });
  }
  return problems;
}
