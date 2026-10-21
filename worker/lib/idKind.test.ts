// Run: npx tsx worker/lib/idKind.test.ts
//
// Report fixes 3, item 1 (2026-10-21, with the reviewer's retry): every Job row
// says what kind of id it holds. The rule is the prefix, not the maker: an id
// starting "h-" is "synthesised", the worker's fallback hash and a setupScript's
// own hash alike (no printed number went into either); every other id is
// "native". The same on a scheduled, a guarded and a manual run, since all
// three write through buildJobRows.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyJobIdFallback, jobIdKind } from "./synthesizeJobId";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

// --- the three cases, as the stored id reaches buildJobRows ---------------------------------
{
  const r = applyJobIdFallback([
    // the worker's fallback: the page gave no id
    { externalJobId: "", title: "מנהל/ת חשבונות", url: "https://x.test/jobs/1" },
    // a setupScript's own hash (yafa-maximov's shape: h- and 8 hex)
    { externalJobId: "h-26cbb9e6", title: "Nurse", url: "https://x.test/jobs/2" },
    // a printed id
    { externalJobId: "JOB-1", title: "Engineer", url: "https://x.test/jobs/3" },
  ]);
  assert(/^h-[0-9a-z]{1,7}$/.test(r.ids[0] ?? "") && jobIdKind(r.ids[0]) === "synthesised", `the worker's fallback id is synthesised (got ${r.ids[0]} ${jobIdKind(r.ids[0])})`);
  assert(r.ids[1] === "h-26cbb9e6" && jobIdKind(r.ids[1]) === "synthesised", "a script-emitted h- id is synthesised too");
  assert(r.ids[2] === "JOB-1" && jobIdKind(r.ids[2]) === "native", "a printed id is native");
  assert(jobIdKind(null) === "native" && jobIdKind("") === "native", "no id: the column's default, native");
  assert(jobIdKind("hilan-2647") === "native" && jobIdKind("H-12") === "native", "only the exact h- prefix counts");
}

// --- buildJobRows writes it on every row, from the id it stores ------------------------------
{
  const src = readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8");
  const start = src.indexOf("function buildJobRows(");
  const body = src.slice(start, start + 8000);
  assert(/idKind: jobIdKind\(persistedExternalJobId\)/.test(body), "buildJobRows writes idKind from the persisted id");
  const schema = readFileSync(join(__dirname, "..", "..", "prisma", "schema.prisma"), "utf8");
  assert(/idKind\s+String\s+@default\("native"\)/.test(schema), "Job.idKind is a non-null String defaulting to native");
  const mig = readFileSync(join(__dirname, "..", "..", "prisma", "migrations", "20261021000000_add_job_id_kind", "migration.sql"), "utf8");
  assert(/"externalJobId" LIKE 'h-%'/.test(mig), "the backfill marks every h- id synthesised");
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("idKind: an h- id is synthesised (the worker's or a script's), every other id native; written on every row");
