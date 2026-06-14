#!/usr/bin/env node
/**
 * scripts/sync-addsite2.mjs
 *
 * Keeps addsite2.md (canonical core) and addsite2-recipes/*.md (recipe files)
 * in sync with their Cursor skill copies at ~/.cursor/skills/addsite2/.
 *
 * Usage:
 *   node scripts/sync-addsite2.mjs           # write copies from canonical
 *   node scripts/sync-addsite2.mjs --check   # exit 1 if CI-tracked copies are stale
 *
 * Sync targets:
 *   addsite2.md              → .claude/commands/addsite2.md   (in-repo, CI-checked)
 *                            → ~/.cursor/skills/addsite2/SKILL.md  (local hardlink)
 *   addsite2-recipes/*.md    → ~/.cursor/skills/addsite2/recipes/*.md  (local copies)
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { link } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const CANONICAL_CORE   = join(ROOT, 'addsite2.md');
const COMMAND_COPY     = join(ROOT, '.claude', 'commands', 'addsite2.md');
const SKILL_ROOT       = join(homedir(), '.cursor', 'skills', 'addsite2');
const SKILL_LINK       = join(SKILL_ROOT, 'SKILL.md');
const SKILL_RECIPES    = join(SKILL_ROOT, 'recipes');
const REPO_RECIPES_DIR = join(ROOT, 'addsite2-recipes');

const CHECK_MODE = process.argv.includes('--check');

// ---------------------------------------------------------------------------

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function filesMatch(a, b) {
  if (!existsSync(b)) return false;
  return sha256(a) === sha256(b);
}

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

// ---------------------------------------------------------------------------

if (!existsSync(CANONICAL_CORE)) {
  console.error(`ERROR: canonical source not found: ${CANONICAL_CORE}`);
  process.exit(1);
}

if (CHECK_MODE) {
  // ---- CI check: only the in-repo command copy is CI-tracked ---------------
  if (!existsSync(COMMAND_COPY)) {
    console.error(`DRIFT: ${COMMAND_COPY} is missing — run 'pnpm sync:addsite2' to create it.`);
    process.exit(1);
  }
  if (!filesMatch(CANONICAL_CORE, COMMAND_COPY)) {
    console.error(`DRIFT: .claude/commands/addsite2.md is out of sync with addsite2.md`);
    console.error(`       Edit addsite2.md (the canonical source), then run 'pnpm sync:addsite2'.`);
    process.exit(1);
  }
  console.log('OK: .claude/commands/addsite2.md matches canonical addsite2.md');
  process.exit(0);
}

// ---- Default mode: write copies from canonical ----------------------------

// 1. In-repo command copy (CI-checked)
if (filesMatch(CANONICAL_CORE, COMMAND_COPY)) {
  console.log(`SKIP: .claude/commands/addsite2.md already matches canonical`);
} else {
  ensureDir(dirname(COMMAND_COPY));
  copyFileSync(CANONICAL_CORE, COMMAND_COPY);
  console.log(`WROTE: .claude/commands/addsite2.md`);
}

// 2. Skill hardlink for the core (local only — best effort)
if (existsSync(SKILL_LINK)) {
  if (filesMatch(CANONICAL_CORE, SKILL_LINK)) {
    console.log(`SKIP: ~/.cursor/skills/addsite2/SKILL.md already matches canonical`);
  } else {
    try {
      unlinkSync(SKILL_LINK);
      await link(CANONICAL_CORE, SKILL_LINK);
      console.log(`LINKED: ~/.cursor/skills/addsite2/SKILL.md → addsite2.md`);
    } catch {
      copyFileSync(CANONICAL_CORE, SKILL_LINK);
      console.log(`COPIED (hardlink failed): ~/.cursor/skills/addsite2/SKILL.md`);
    }
  }
} else {
  // First-time: create skill dir and link
  if (existsSync(SKILL_ROOT)) {
    // Dir exists but SKILL.md is missing — create the hardlink
    try {
      await link(CANONICAL_CORE, SKILL_LINK);
      console.log(`LINKED (new): ~/.cursor/skills/addsite2/SKILL.md → addsite2.md`);
    } catch {
      copyFileSync(CANONICAL_CORE, SKILL_LINK);
      console.log(`COPIED (new): ~/.cursor/skills/addsite2/SKILL.md`);
    }
  } else {
    console.log(`SKIP: ~/.cursor/skills/addsite2/ directory not found (Cursor not installed here)`);
  }
}

// 3. Recipe files (local only — plain copies, not CI-checked)
if (existsSync(REPO_RECIPES_DIR) && existsSync(SKILL_ROOT)) {
  ensureDir(SKILL_RECIPES);
  const recipeFiles = readdirSync(REPO_RECIPES_DIR).filter(f => f.endsWith('.md'));
  for (const file of recipeFiles) {
    const src  = join(REPO_RECIPES_DIR, file);
    const dest = join(SKILL_RECIPES, file);
    if (filesMatch(src, dest)) {
      console.log(`SKIP: recipes/${file} already matches`);
    } else {
      copyFileSync(src, dest);
      console.log(`WROTE: ~/.cursor/skills/addsite2/recipes/${file}`);
    }
  }
} else if (!existsSync(REPO_RECIPES_DIR)) {
  console.log(`SKIP: addsite2-recipes/ directory not found`);
} else {
  console.log(`SKIP: ~/.cursor/skills/addsite2/ directory not found — recipes not synced`);
}

console.log('Done.');
