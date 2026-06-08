#!/usr/bin/env node
/**
 * scripts/sync-addsite.mjs
 *
 * Keeps addsite.md (canonical) in sync with its copies.
 *
 * Usage:
 *   node scripts/sync-addsite.mjs           # write copies from canonical
 *   node scripts/sync-addsite.mjs --check   # exit 1 if copies are stale (used by CI)
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { link } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const CANONICAL = join(ROOT, 'addsite.md');
const COMMAND_COPY = join(ROOT, '.claude', 'commands', 'addsite.md');
const SKILL_LINK = join(homedir(), '.cursor', 'skills', 'addsite', 'SKILL.md');

const CHECK_MODE = process.argv.includes('--check');

// ---------------------------------------------------------------------------

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function filesMatch(a, b) {
  if (!existsSync(b)) return false;
  return sha256(a) === sha256(b);
}

// ---------------------------------------------------------------------------

if (CHECK_MODE) {
  // ---- CI check: fail fast if command copy is stale ----------------------
  if (!existsSync(CANONICAL)) {
    console.error(`ERROR: canonical source not found: ${CANONICAL}`);
    process.exit(1);
  }
  if (!existsSync(COMMAND_COPY)) {
    console.error(`DRIFT: ${COMMAND_COPY} is missing — run 'pnpm sync:addsite' to create it.`);
    process.exit(1);
  }
  if (!filesMatch(CANONICAL, COMMAND_COPY)) {
    console.error(`DRIFT: .claude/commands/addsite.md is out of sync with addsite.md`);
    console.error(`       Edit addsite.md (the canonical source), then run 'pnpm sync:addsite'.`);
    process.exit(1);
  }
  console.log('OK: .claude/commands/addsite.md matches canonical addsite.md');
  process.exit(0);
}

// ---- Default mode: write copies from canonical ---------------------------

if (!existsSync(CANONICAL)) {
  console.error(`ERROR: canonical source not found: ${CANONICAL}`);
  process.exit(1);
}

// 1. Command copy (in-repo, CI-checked)
if (filesMatch(CANONICAL, COMMAND_COPY)) {
  console.log(`SKIP: .claude/commands/addsite.md already matches canonical`);
} else {
  copyFileSync(CANONICAL, COMMAND_COPY);
  console.log(`WROTE: .claude/commands/addsite.md`);
}

// 2. Skill hardlink (local only, outside repo — best-effort)
if (existsSync(SKILL_LINK)) {
  // Check if it's already the same inode (hardlink) or same content
  if (filesMatch(CANONICAL, SKILL_LINK)) {
    console.log(`SKIP: ~/.cursor/skills/addsite/SKILL.md already matches canonical`);
  } else {
    // Re-create hardlink: delete old file, link canonical → skill path
    try {
      unlinkSync(SKILL_LINK);
      await link(CANONICAL, SKILL_LINK);
      console.log(`LINKED: ~/.cursor/skills/addsite/SKILL.md → addsite.md`);
    } catch (err) {
      // Fall back to a plain copy if cross-drive hardlink is not supported
      copyFileSync(CANONICAL, SKILL_LINK);
      console.log(`COPIED (hardlink failed, cross-drive?): ~/.cursor/skills/addsite/SKILL.md`);
    }
  }
} else {
  console.log(`SKIP: ~/.cursor/skills/addsite/SKILL.md not found (path absent, ignoring)`);
}

console.log('Done.');
