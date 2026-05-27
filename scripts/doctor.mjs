#!/usr/bin/env node
// Pre-flight check for the /addsite skill. Verifies that everything the
// skill needs is present on the local machine before the agent kicks off
// the autonomous flow. Exits 0 when ready, non-zero with a clear message
// otherwise.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

const PROD_BASE = 'https://scrapper.haide-jobs.co.il';

const checks = [];
function check(name, fn) {
  try {
    const detail = fn();
    checks.push({ name, ok: true, detail: detail ?? '' });
  } catch (e) {
    checks.push({ name, ok: false, detail: e.message });
  }
}

check('node version >= 18', () => {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) throw new Error(`node ${process.versions.node} is too old; need >= 18`);
  return `node ${process.versions.node}`;
});

check('playwright installed', () => {
  const pkgPath = require.resolve('playwright/package.json', { paths: [root] });
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return `playwright ${pkg.version}`;
});

check('tsx installed', () => {
  const pkgPath = require.resolve('tsx/package.json', { paths: [root] });
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return `tsx ${pkg.version}`;
});

check('chromium browser available', () => {
  const { chromium } = require(require.resolve('playwright', { paths: [root] }));
  const exe = chromium.executablePath();
  if (!exe || !existsSync(exe)) {
    throw new Error(
      `chromium executable not found at "${exe}". Run: npm run playwright:install`,
    );
  }
  return exe;
});

check('.claude/scrap-token populated', () => {
  const p = path.join(root, '.claude', 'scrap-token');
  if (!existsSync(p)) throw new Error(`missing ${p}`);
  const raw = readFileSync(p, 'utf8').trim();
  if (!raw) throw new Error('file is empty');
  if (raw.startsWith('REPLACE_ME')) {
    throw new Error('still contains placeholder; paste the real prod token');
  }
  if (raw.toLowerCase().startsWith('bearer ')) {
    throw new Error('drop the "Bearer " prefix; just the raw token');
  }
  return `${raw.length} chars`;
});

check('.scratch/ writable', () => {
  const p = path.join(root, '.scratch');
  if (!existsSync(p)) throw new Error(`missing ${p}; recreate it`);
  const s = statSync(p);
  if (!s.isDirectory()) throw new Error(`${p} is not a directory`);
  return p;
});

check('prod API reachable (HEAD /api/sites)', () => {
  // Best-effort. Use curl.exe since fetch on older Node would need polyfill.
  // We only care that DNS + TLS work; auth-required 401 is fine.
  try {
    const out = execFileSync(
      'curl.exe',
      ['-sS', '-o', 'NUL', '-w', '%{http_code}', `${PROD_BASE}/api/sites`],
      { encoding: 'utf8', timeout: 10000 },
    );
    if (!/^[1-5]\d\d$/.test(out.trim())) throw new Error(`unexpected output: ${out}`);
    return `HTTP ${out.trim()}`;
  } catch (e) {
    throw new Error(`curl.exe failed: ${e.message}`);
  }
});

const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
let anyFail = false;
for (const c of checks) {
  const mark = c.ok ? '[OK]  ' : '[FAIL]';
  console.log(`${mark} ${pad(c.name, 38)} ${c.detail}`);
  if (!c.ok) anyFail = true;
}
if (anyFail) {
  console.log('');
  console.log('One or more checks failed. Fix them before running /addsite.');
  process.exit(1);
} else {
  console.log('');
  console.log('All checks passed. /addsite is ready to run.');
}
