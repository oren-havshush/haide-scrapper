#!/usr/bin/env node
/**
 * scripts/sync-addsite2.mjs
 *
 * Keeps every skill's canonical source in sync with its copies.
 *
 * Usage:
 *   node scripts/sync-addsite2.mjs           # write copies from canonical
 *   node scripts/sync-addsite2.mjs --check   # exit 1 if CI-tracked copies are stale
 *
 * Sync targets, per skill:
 *   <name>.md            → .claude/commands/<name>.md              (in-repo, CI-checked)
 *                        → ~/.cursor/skills/<name>/SKILL.md        (local hardlink)
 *   <recipesDir>/*.md    → ~/.cursor/skills/<name>/recipes/*.md    (local copies)
 *
 * The filename still says addsite2 because CI invokes `pnpm check:addsite2` and
 * the docs cite `pnpm sync:addsite2`; `sync:skills` / `check:skills` are aliases
 * for the same file. Add a skill by adding one entry to SKILLS below.
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { link } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/**
 * Every skill this repo owns. `recipesDir` is optional — only addsite2 splits
 * its detail across recipe files.
 */
const SKILLS = [
  { name: 'addsite2', recipesDir: 'addsite2-recipes' },
  { name: 'company-profile' },
];

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

function pathsFor(skill) {
  const skillRoot = join(homedir(), '.cursor', 'skills', skill.name);
  return {
    canonical: join(ROOT, `${skill.name}.md`),
    commandCopy: join(ROOT, '.claude', 'commands', `${skill.name}.md`),
    skillRoot,
    skillLink: join(skillRoot, 'SKILL.md'),
    skillRecipes: join(skillRoot, 'recipes'),
    repoRecipes: skill.recipesDir ? join(ROOT, skill.recipesDir) : null,
  };
}

// ---------------------------------------------------------------------------

if (CHECK_MODE) {
  // ---- CI check: only the in-repo command copies are CI-tracked ------------
  let drift = false;
  for (const skill of SKILLS) {
    const p = pathsFor(skill);
    if (!existsSync(p.canonical)) {
      console.error(`ERROR: canonical source not found: ${p.canonical}`);
      drift = true;
      continue;
    }
    if (!existsSync(p.commandCopy)) {
      console.error(
        `DRIFT: .claude/commands/${skill.name}.md is missing — run 'pnpm sync:skills' to create it.`,
      );
      drift = true;
      continue;
    }
    if (!filesMatch(p.canonical, p.commandCopy)) {
      console.error(`DRIFT: .claude/commands/${skill.name}.md is out of sync with ${skill.name}.md`);
      console.error(
        `       Edit ${skill.name}.md (the canonical source), then run 'pnpm sync:skills'.`,
      );
      drift = true;
      continue;
    }
    console.log(`OK: .claude/commands/${skill.name}.md matches canonical ${skill.name}.md`);
  }
  process.exit(drift ? 1 : 0);
}

// ---- Default mode: write copies from canonical ----------------------------

for (const skill of SKILLS) {
  const p = pathsFor(skill);

  if (!existsSync(p.canonical)) {
    console.error(`ERROR: canonical source not found: ${p.canonical}`);
    process.exit(1);
  }

  // 1. In-repo command copy (CI-checked)
  if (filesMatch(p.canonical, p.commandCopy)) {
    console.log(`SKIP: .claude/commands/${skill.name}.md already matches canonical`);
  } else {
    ensureDir(dirname(p.commandCopy));
    copyFileSync(p.canonical, p.commandCopy);
    console.log(`WROTE: .claude/commands/${skill.name}.md`);
  }

  // 2. Skill hardlink for the core (local only — best effort)
  if (existsSync(p.skillLink)) {
    if (filesMatch(p.canonical, p.skillLink)) {
      console.log(`SKIP: ~/.cursor/skills/${skill.name}/SKILL.md already matches canonical`);
    } else {
      try {
        unlinkSync(p.skillLink);
        await link(p.canonical, p.skillLink);
        console.log(`LINKED: ~/.cursor/skills/${skill.name}/SKILL.md → ${skill.name}.md`);
      } catch {
        copyFileSync(p.canonical, p.skillLink);
        console.log(`COPIED (hardlink failed): ~/.cursor/skills/${skill.name}/SKILL.md`);
      }
    }
  } else {
    // First-time: create the skill dir and link. Unlike the original, the
    // directory is CREATED rather than skipped — a new skill has no directory
    // yet, and refusing to make one meant it could never be installed.
    ensureDir(p.skillRoot);
    try {
      await link(p.canonical, p.skillLink);
      console.log(`LINKED (new): ~/.cursor/skills/${skill.name}/SKILL.md → ${skill.name}.md`);
    } catch {
      copyFileSync(p.canonical, p.skillLink);
      console.log(`COPIED (new): ~/.cursor/skills/${skill.name}/SKILL.md`);
    }
  }

  // 3. Recipe files (local only — plain copies, not CI-checked)
  if (!p.repoRecipes) continue;
  if (existsSync(p.repoRecipes) && existsSync(p.skillRoot)) {
    ensureDir(p.skillRecipes);
    const recipeFiles = readdirSync(p.repoRecipes).filter((f) => f.endsWith('.md'));
    for (const file of recipeFiles) {
      const src = join(p.repoRecipes, file);
      const dest = join(p.skillRecipes, file);
      if (filesMatch(src, dest)) {
        console.log(`SKIP: recipes/${file} already matches`);
      } else {
        copyFileSync(src, dest);
        console.log(`WROTE: ~/.cursor/skills/${skill.name}/recipes/${file}`);
      }
    }
  } else if (!existsSync(p.repoRecipes)) {
    console.log(`SKIP: ${skill.recipesDir}/ directory not found`);
  }
}

console.log('Done.');
