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
 * The filename still says addsite2 because the docs cite `pnpm sync:addsite2`;
 * CI runs `pnpm check:skills` (step 1b), and both names run this same file.
 * Add a skill by adding one entry to SKILLS below.
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { link } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { lintAddsite3 } from './lib/skillLint.mjs';
import { runCheckLearnings } from './check-learnings.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/**
 * Every skill this repo owns. `recipesDir` is optional.
 *
 * `frozen` (addsite2 phase two, step 1b): the skill is the control cohort's and
 * must not move. `--check` fails when the skill file or any file in its recipes
 * directory differs from the sha256 recorded here, or a recipe is added or
 * removed. A rule, not a date check. Skill fixes go into addsite3.
 */
const SKILLS = [
  {
    name: 'addsite2',
    recipesDir: 'addsite2-recipes',
    frozen: {
      // The later of 2026-10-01 00:00 Asia/Jerusalem and the last commit that
      // touched addsite2 (a1c5672, 2026-09-30 10:05 +03:00). Sites onboarded
      // since then with this unchanged skill are the control cohort
      // (src/lib/fixScore.ts ADDSITE2_FREEZE_AT carries the same value).
      freezeAt: '2026-09-30T21:00:00.000Z',
      // Operators switched to addsite3 here (step 7, owner 2026-10-07). Control is
      // untagged sites created in [freezeAt, switchAt); src/lib/fixScore.ts
      // ADDSITE3_SWITCH_AT carries the same value.
      switchAt: '2026-10-07T09:31:51.000Z',
      rule: 'delete 4 weeks after switch if addsite3 is no worse than control; see addsite2-phase2.md',
      sha256: {
        'addsite2.md': 'a8726e2d29756364882a49f13ab90e39605efe933fde8e165c8b4864a4e5bc48',
        'addsite2-recipes/form-capture.md': '04ed61c1655c8e67956bd6e7bfb36301f953d9e576a80a49e62221ad022c7108',
        'addsite2-recipes/pagination-and-loading.md': '0e0bd3bcf62794caec12f8f6670aded17340386679adba6119663f005a944736',
        'addsite2-recipes/setupscript-patterns.md': '99b3d1698f1d6c19488a59ed3c195b939a3ff2e758e34c42364a6d21eecb5dae',
        'addsite2-recipes/spa-frameworks.md': '5f6b01a03f29a3139106eb9868b2e03b30964a10f6edfd375c6a0acf905d161c',
        'addsite2-recipes/waf-bypasses.md': '2df2aa8664b3a86d0e4138464675997cbf0a178f9363b7e40b0ee9020555643c',
      },
    },
  },
  { name: 'addsite3', recipesDir: 'addsite3-recipes' },
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

  // ---- The freeze: a frozen skill's files must match their recorded sha256 --
  for (const skill of SKILLS) {
    if (!skill.frozen) continue;
    const recorded = skill.frozen.sha256;
    const onDisk = [`${skill.name}.md`];
    if (skill.recipesDir && existsSync(join(ROOT, skill.recipesDir))) {
      for (const f of readdirSync(join(ROOT, skill.recipesDir)).filter((x) => x.endsWith('.md'))) {
        onDisk.push(`${skill.recipesDir}/${f}`);
      }
    }
    let frozenOk = true;
    for (const rel of [...new Set([...Object.keys(recorded), ...onDisk])].sort()) {
      const abs = join(ROOT, rel);
      let problem = null;
      if (!(rel in recorded)) problem = 'was added after the freeze';
      else if (!existsSync(abs)) problem = 'is missing';
      else if (sha256(abs) !== recorded[rel]) problem = 'differs from its frozen sha256';
      if (problem) {
        console.error(`FROZEN: ${rel} ${problem}. ${skill.name} is frozen as of ${skill.frozen.freezeAt}: ${skill.frozen.rule}.`);
        console.error(`       Skill fixes go into the next skill (addsite3); do not edit ${skill.name}.`);
        frozenOk = false;
        drift = true;
      }
    }
    if (frozenOk) {
      console.log(`OK: ${skill.name} is frozen as of ${skill.frozen.freezeAt}; ${Object.keys(recorded).length} file(s) match their sha256`);
    }
  }

  // ---- The addsite3 lint: removed rules stay removed (scripts/lib/skillLint.mjs) --
  const addsite3 = join(ROOT, 'addsite3.md');
  if (existsSync(addsite3)) {
    const hits = lintAddsite3(readFileSync(addsite3, 'utf8'));
    for (const h of hits) console.error(`LINT: addsite3.md:${h.line} ${h.rule}`);
    if (hits.length > 0) drift = true;
    else console.log('OK: addsite3.md passes the skill lint');
  }

  // ---- check-learnings: cited ids exist, ids unique, every learning has a status row --
  const learningProblems = runCheckLearnings(ROOT);
  // A learning with no status row is a warning until the addsite3 switch (SWITCH_AT).
  for (const w of learningProblems.warnings) console.warn(`WARN: LEARNINGS: ${w}`);
  for (const e of learningProblems.errors) console.error(`LEARNINGS: ${e}`);
  if (learningProblems.errors.length > 0) drift = true;
  else console.log(`OK: learnings — cited ids exist, ids are unique, every RECIPE line cites its id${learningProblems.warnings.length ? ` (${learningProblems.warnings.length} warning(s))` : ''}`);
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
