// Run: npx tsx src/lib/validators.test.ts
//
// addsite2 phase two, step 1a: the one POST field addsite3 needs now.
// `Site.onboardingSkill` tags a site's cohort (null = addsite2 or older), and
// it is set at creation. zod strips unknown keys, so without the schema field
// the value never reaches createSite and every addsite3 site would count as
// control.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createSiteSchema,
  fixItemCreateSchema,
  fixItemPatchSchema,
  fixQueueQuerySchema,
  updateSiteConfigSchema,
} from "./validators";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
const eq = (got: unknown, want: unknown, msg: string) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL: ${msg}\n  got=${g}\n  want=${w}`);
    failures++;
  }
};

// --- createSiteSchema -------------------------------------------------------
{
  const r = createSiteSchema.safeParse({ siteUrl: "https://example.co.il/careers", onboardingSkill: "addsite3" });
  assert(r.success, "a create body with onboardingSkill parses");
  eq(r.success ? r.data.onboardingSkill : undefined, "addsite3", "onboardingSkill survives createSiteSchema");

  const plain = createSiteSchema.safeParse({ siteUrl: "https://example.co.il/careers" });
  assert(plain.success, "a body without it still parses — addsite2 and the dashboard send none");
  eq(plain.success ? plain.data.onboardingSkill : "x", undefined, "and it stays absent, so the column stays NULL");

  assert(
    !createSiteSchema.safeParse({ siteUrl: "https://example.co.il/", onboardingSkill: "" }).success,
    "an empty tag is refused — NULL, not \"\", means untagged",
  );
  assert(
    !createSiteSchema.safeParse({ siteUrl: "https://example.co.il/", onboardingSkill: "x".repeat(65) }).success,
    "and so is an implausibly long one",
  );
}

// --- wiring: the route and the service carry it through ---------------------
{
  const route = readFileSync(join(__dirname, "..", "app", "api", "sites", "route.ts"), "utf8");
  assert(
    /createSite\(\s*parsed\.data\.siteUrl\s*,\s*\{[^}]*onboardingSkill: parsed\.data\.onboardingSkill/.test(route),
    "POST /api/sites passes onboardingSkill to createSite",
  );
  const svc = readFileSync(join(__dirname, "..", "services", "siteService.ts"), "utf8");
  const start = svc.indexOf("export async function createSite(");
  const body = start >= 0 ? svc.slice(start, svc.indexOf("\n}\n", start)) : "";
  assert(/onboardingSkill: opts\.onboardingSkill \?\? null/.test(body), "createSite stores it, NULL when absent");
}

// --- the fix-queue routes' bodies (step 1a) ---------------------------------
{
  const ok = fixItemCreateSchema.safeParse({ siteId: "s1", field: "APPLY", minutes: 12, note: "form moved" });
  assert(ok.success, "a manual item with site, field, minutes and note parses");
  eq(ok.success ? ok.data.code : null, "manual", "its code defaults to manual");
  assert(!fixItemCreateSchema.safeParse({ siteId: "s1", field: "APPLY", source: "CHECK" }).success,
    "the API opens MANUAL items only — a source key is refused, never trusted");
  assert(!fixItemCreateSchema.safeParse({ siteId: "s1", field: "NOPE" }).success, "an unknown field is refused");
  assert(!fixItemCreateSchema.safeParse({ siteId: "s1", field: "APPLY", minutes: -1 }).success, "negative minutes are refused");
  assert(!fixItemCreateSchema.safeParse({ siteId: "s1", field: "APPLY", minutes: 1.5 }).success, "minutes are whole");
  assert(!fixItemCreateSchema.safeParse({ field: "APPLY" }).success, "a site is required");

  assert(fixItemPatchSchema.safeParse({ minutes: 20 }).success, "PATCH takes minutes");
  assert(fixItemPatchSchema.safeParse({ resolved: true, note: "done" }).success, "resolve and note");
  assert(fixItemPatchSchema.safeParse({ minutes: null }).success, "a null clears minutes");
  assert(!fixItemPatchSchema.safeParse({}).success, "an empty PATCH is refused rather than silently doing nothing");
  assert(!fixItemPatchSchema.safeParse({ resolvedBy: "CHECK" }).success, "a resolvedBy without resolved: true is refused");
  assert(!fixItemPatchSchema.safeParse({ source: "CHECK" }).success, "and one naming a key it does not take");

  // (n), owner 2026-10-06: an item a write opened that was not a fix is
  // closed as CHECK, with a note. MANUAL stays the default.
  const check = fixItemPatchSchema.safeParse({ resolved: true, resolvedBy: "CHECK", note: "not a fix" });
  assert(check.success, "resolved: true with resolvedBy CHECK and a note parses");
  eq(check.success ? check.data.resolvedBy : null, "CHECK", "and keeps resolvedBy CHECK");
  assert(fixItemPatchSchema.safeParse({ resolved: true, resolvedBy: "MANUAL" }).success, "resolvedBy MANUAL may be named");
  assert(!fixItemPatchSchema.safeParse({ resolved: false, resolvedBy: "CHECK" }).success, "a reopen carries no resolvedBy");
  assert(!fixItemPatchSchema.safeParse({ resolved: true, resolvedBy: "AUTO" }).success, "an unknown resolvedBy is refused");

  const q = fixQueueQuerySchema.safeParse({ open: "true", cohort: "control", freezeAt: "2026-10-01T00:00:00Z" });
  assert(q.success, "the list query parses");
  eq(q.success ? q.data.open : null, true, "open=true is a boolean");
  assert(!fixQueueQuerySchema.safeParse({ cohort: "everyone" }).success, "an unknown cohort is refused");
  assert(!fixQueueQuerySchema.safeParse({ freezeAt: "yesterday" }).success, "a freezeAt that is not a date is refused");
}

// --- step 2a: the form-capture schema keeps what the capture now records -------
{
  const base = {
    fieldMappings: {},
    pageFlow: [{ url: "https://medulla.test/jobs", action: "navigate" }],
  };
  const formCapture = {
    formSelector: "form.elementor-form",
    actionUrl: "https://medulla.test/wp-admin/admin-ajax.php",
    method: "POST",
    enctype: "multipart/form-data",
    fields: [
      { name: "post_id", label: "", fieldType: "hidden", required: false, tagName: "input", value: "18642" },
      { name: "_wpnonce", label: "", fieldType: "hidden", required: false, tagName: "input", value: "a1b2c3d4e5" },
      { name: "form_fields[cv]", label: "CV", fieldType: "file", required: true, tagName: "input", accept: ".pdf,.docx", multiple: true },
      {
        name: "form_fields[shift]", label: "משמרת", fieldType: "radio", required: true, tagName: "input",
        options: [{ value: "morning", label: "בוקר" }, { value: "evening", label: "ערב" }],
      },
    ],
  };
  const r = updateSiteConfigSchema.safeParse({ ...base, formCapture });
  assert(r.success, "a formCapture with values, accept, multiple, radio options and enctype parses");
  const fc = r.success ? r.data.formCapture : null;
  eq(fc?.fields.map((x) => (x as { value?: string }).value ?? null), ["18642", "a1b2c3d4e5", null, null], "hidden values survive the save — zod stripped them before");
  eq([(fc?.fields[2] as { accept?: string }).accept, (fc?.fields[2] as { multiple?: boolean }).multiple], [".pdf,.docx", true], "file accept and multiple survive");
  eq(fc?.fields[3]?.options?.length, 2, "radio options survive, in the select shape");
  eq((fc as { enctype?: string } | null)?.enctype, "multipart/form-data", "the form's enctype survives");

  const old = updateSiteConfigSchema.safeParse({
    ...base,
    formCapture: { formSelector: "form", actionUrl: "a", method: "POST", fields: [{ name: "n", label: "N", fieldType: "text", required: false, tagName: "input" }] },
  });
  assert(old.success, "an existing config with none of them still parses");
  assert(
    !updateSiteConfigSchema.safeParse({ ...base, formCapture: { ...formCapture, fields: [{ ...formCapture.fields[0], value: "x".repeat(4001) }] } }).success,
    "a value longer than 4000 characters is refused",
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("validators: onboardingSkill survives site creation");
