// Run: npx tsx src/lib/configPatch.test.ts
//
// addsite2 phase two, step 3: the merging config PATCH. PUT replaces the whole
// config, and saveSiteConfig rebuilds _meta from top-level keys — so a PUT
// carrying only a new setupScript silently clears formCapture, listingUrls,
// pagination and locationFallback. PATCH reads the stored config, applies only
// the keys present (a present null clears one), merges fieldMappings per field,
// validates the result with the full schema, and saves through the same
// saveSiteConfig, so the ACTIVE -> REVIEW demotion and configLocked are
// inherited unchanged. PUT stays replace.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { flattenStoredConfig, mergeConfigPatch } from "./configPatch";

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
const threw = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

// A stored config as the database holds it: field mappings and _meta together.
const FORM = {
  formSelector: "form.elementor-form",
  actionUrl: "https://www.kahane.co.il/wp-admin/admin-ajax.php",
  method: "POST",
  fields: [{ name: "form_fields[email]", label: "אימייל", fieldType: "email", required: true, tagName: "input" }],
};
const STORED = {
  fieldMappings: {
    title: { selector: ".jobtitle", source: "manual" },
    location: { selector: ".loc", source: "manual" },
    _meta: {
      listingSelector: null,
      itemSelector: ".card",
      revealSelector: null,
      originalMappings: null,
      formCapture: FORM,
      listingUrls: ["https://www.kahane.co.il/jobs", "https://www.kahane.co.il/jobs/page/2"],
      pagination: { type: "url", param: "paged", start: 1, maxPages: 5 },
      setupScript: "document.title;",
      loadMoreSelector: null,
      browserOverrides: { requestDelayMs: 1500 },
      applyRequiresLogin: false,
      applyLoginReason: null,
      minPublishDate: null,
      minPublishDays: null,
      locationFallback: "חיפה",
      savedAt: "2026-09-30T10:00:00.000Z",
    },
  },
  pageFlow: [{ url: "https://www.kahane.co.il/jobs", action: "listing" }],
};

// --- flattening the stored config into the PUT body shape --------------------------
{
  const flat = flattenStoredConfig(STORED) as Record<string, unknown>;
  eq(Object.keys(flat.fieldMappings as object), ["title", "location"], "fieldMappings without _meta");
  eq(flat.itemSelector, ".card", "a _meta key comes up to the top level");
  assert(!("savedAt" in flat), "savedAt is not carried: the save stamps its own");
  assert(!("listingSelector" in flat), "a stored null is absent, not null (the schema's optional fields take no null)");
  eq(flat.formCapture, FORM, "formCapture comes up as stored");
  eq(flat.pageFlow, STORED.pageFlow, "pageFlow as stored");
}

// --- a patch with only setupScript keeps everything else ----------------------------
{
  const merged = mergeConfigPatch(STORED, { setupScript: "document.body;" });
  eq(merged.setupScript, "document.body;", "the patched key is applied");
  eq(merged.formCapture, FORM, "formCapture is kept");
  eq(merged.listingUrls, STORED.fieldMappings._meta.listingUrls, "listingUrls are kept");
  eq(merged.pagination, STORED.fieldMappings._meta.pagination, "pagination is kept");
  eq(merged.locationFallback, "חיפה", "locationFallback is kept");
  eq(merged.browserOverrides, { requestDelayMs: 1500 }, "browserOverrides are kept");
  eq(merged.itemSelector, ".card", "itemSelector is kept");
  eq(Object.keys(merged.fieldMappings), ["title", "location"], "the field mappings are kept");
  eq(merged.pageFlow, STORED.pageFlow, "pageFlow is kept");
}

// --- a present null clears one key ------------------------------------------------------
{
  const merged = mergeConfigPatch(STORED, { locationFallback: null });
  assert(!("locationFallback" in merged), "locationFallback: null clears it");
  eq(merged.pagination, STORED.fieldMappings._meta.pagination, "and nothing else");
  eq(mergeConfigPatch(STORED, { formCapture: null }).formCapture, null, "formCapture: null clears the form (the schema's own null)");
}

// --- fieldMappings merge per field ------------------------------------------------------
{
  const merged = mergeConfigPatch(STORED, { fieldMappings: { location: { selector: ".city", source: "manual" }, deadline: { selector: ".dl", source: "manual" } } });
  eq(merged.fieldMappings.title, { selector: ".jobtitle", source: "manual" }, "an untouched field mapping is kept");
  eq(merged.fieldMappings.location, { selector: ".city", source: "manual" }, "a present field mapping is replaced");
  eq(merged.fieldMappings.deadline, { selector: ".dl", source: "manual" }, "a new field mapping is added");
  const cleared = mergeConfigPatch(STORED, { fieldMappings: { location: null } });
  assert(!("location" in cleared.fieldMappings), "a field mapping set to null is removed");
  eq(Object.keys(cleared.fieldMappings), ["title"], "and only that one");
}

// --- refused, never guessed -------------------------------------------------------------
{
  assert(threw(() => mergeConfigPatch(STORED, { setupScrpt: "x" })) !== null, "an unknown key is refused, not silently dropped");
  assert(threw(() => mergeConfigPatch(STORED, { fieldMappings: { _meta: {} } })) !== null, "_meta inside fieldMappings is refused: meta keys are top-level");
  assert(threw(() => mergeConfigPatch(STORED, { fieldMappings: null })) !== null, "fieldMappings: null is refused");
  assert(threw(() => mergeConfigPatch(STORED, { pageFlow: null })) !== null, "pageFlow: null is refused");
  assert(threw(() => mergeConfigPatch(STORED, { locationFallback: "תל אביב" })) !== null, "the merged result is validated with the full schema (a fallback off city.csv)");
  assert(threw(() => mergeConfigPatch(STORED, {})) !== null, "an empty patch is refused");
  assert(threw(() => mergeConfigPatch(STORED, [] as unknown as Record<string, unknown>)) !== null, "a patch that is not an object is refused");
}

// --- the route: PATCH saves through saveSiteConfig, PUT stays replace ---------------------
{
  const src = readFileSync(join(__dirname, "..", "app", "api", "sites", "[id]", "config", "route.ts"), "utf8");
  const patchAt = src.indexOf("export async function PATCH(");
  assert(patchAt > 0, "the config route exports PATCH");
  const patch = patchAt > 0 ? src.slice(patchAt) : "";
  const merge = patch.indexOf("mergeConfigPatch(");
  const save = patch.indexOf("saveSiteConfig(");
  assert(merge > 0 && save > merge, "PATCH merges, then saves through saveSiteConfig (the demotion and configLocked are inherited)");
  assert(/applyAutoFix\(/.test(patch) && /route: "PATCH \/api\/sites\/\[id\]\/config"/.test(patch), "and files its auto-fix like the PUT");
  const put = src.slice(src.indexOf("export async function PUT("), patchAt > 0 ? patchAt : undefined);
  assert(!put.includes("mergeConfigPatch("), "PUT stays replace");
}

// --- formCapture's verified action (owner, 2026-10-08, lilit) -----------------------
// Two optional keys, stored by hand after reading the page by GET: the schema
// keeps them (a plain zod object would strip them silently, and the fix
// command's read-back would then fail), and refuses a malformed value.
{
  const verified = { ...FORM, verifiedAction: "https://www.kahane.co.il/forms/index/index/", formTag: "div" };
  const merged = mergeConfigPatch(STORED, { formCapture: verified });
  const kept = merged.formCapture as Record<string, unknown> | null;
  eq([kept?.verifiedAction, kept?.formTag, kept?.fields], [verified.verifiedAction, verified.formTag, FORM.fields], "formCapture keeps verifiedAction and formTag");
  eq(mergeConfigPatch(STORED, { setupScript: "x;" }).formCapture, FORM, "a capture without them is unchanged");
  assert(threw(() => mergeConfigPatch(STORED, { formCapture: { ...FORM, verifiedAction: "/forms/index/index/" } })) !== null, "a relative verifiedAction is refused");
  assert(threw(() => mergeConfigPatch(STORED, { formCapture: { ...FORM, formTag: "<div>" } })) !== null, "a formTag that is not a tag name is refused");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("configPatch: a patch changes only what it names; PATCH saves through saveSiteConfig; PUT stays replace");
