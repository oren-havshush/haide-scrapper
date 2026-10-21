#!/usr/bin/env node
/**
 * scripts/compact-form-template.mjs — the compact copy of the shared form
 * template (report fixes 3, item 16c; the developer's 2026-10-21 report,
 * item 12, LRN-SETUP-33).
 *
 *   node scripts/compact-form-template.mjs           write sites/_shared/form-capture-template.compact.js
 *   node scripts/compact-form-template.mjs --check   fail (exit 1) when the committed copy is not what this makes
 *
 * The template is ~10,000 characters of a 16,000-character setup-script cap,
 * most of it comments. The compact copy drops every comment line and every
 * blank line and trims each line; nothing else changes, so it runs exactly as
 * the template does (scripts/lib/compactTemplate.test.ts runs both on one
 * page). The template has no block comment, no comment after code on a line
 * and no template literal, which is what makes line-wise stripping safe; the
 * check refuses a template that grows one of those.
 *
 * Edit the template, never the compact copy, then run this.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = join(ROOT, "sites", "_shared", "form-capture-template.js");
const COMPACT = join(ROOT, "sites", "_shared", "form-capture-template.compact.js");
const HEADER = "// generated from form-capture-template.js by scripts/compact-form-template.mjs; edit the template";

/** The compact text of a template: its comment and blank lines dropped, each line trimmed. */
export function compactTemplate(source) {
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("//"));
  return `${HEADER}\n${lines.join("\n")}\n`;
}

/** Why line-wise stripping would not be safe for this source, or null. */
export function unsafeForCompaction(source) {
  if (source.includes("`")) return "a template literal (its lines would be trimmed)";
  if (/\/\*/.test(source)) return "a block comment";
  return null;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1]);
if (isMain) {
  const source = readFileSync(TEMPLATE, "utf8");
  const unsafe = unsafeForCompaction(source);
  if (unsafe) {
    console.error(`[compact-template] the template has ${unsafe}; line-wise compaction is not safe`);
    process.exit(1);
  }
  const want = compactTemplate(source);
  if (process.argv.includes("--check")) {
    let have = "";
    try {
      have = readFileSync(COMPACT, "utf8");
    } catch {
      have = "";
    }
    if (have !== want) {
      console.error("[compact-template] sites/_shared/form-capture-template.compact.js is not the template's compact copy; run: node scripts/compact-form-template.mjs");
      process.exit(1);
    }
    console.log(`OK: the compact form template matches (${want.length} of ${source.length} characters)`);
  } else {
    writeFileSync(COMPACT, want);
    console.log(`wrote sites/_shared/form-capture-template.compact.js (${want.length} of ${source.length} characters)`);
  }
}
