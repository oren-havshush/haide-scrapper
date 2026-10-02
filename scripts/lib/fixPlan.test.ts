// Run: npx tsx scripts/lib/fixPlan.test.ts
//
// addsite2 phase two, step 3: `addsite-batch.ts fix --site <id> --patch <file>`.
// The two pure halves of the command:
//   - the path-level diff it prints before writing anything, in the
//     remediation-doc format (`$.fieldMappings._meta.x: a -> b`);
//   - the acceptance parser that reads the guarded run back: proceed only when
//     the run finished, its sweep item says wouldPromoteTo ACTIVE, and no CHECK
//     item for the fixed field recurred on this run.

import { parseAcceptance, renderConfigDiff, type AcceptanceInput } from "./fixPlan";

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

// --- the diff ------------------------------------------------------------------------
// Inputs are the PUT body shape (src/lib/configPatch.ts flattenStoredConfig);
// paths are printed where the value lives in the stored config.
{
  const before = {
    fieldMappings: { title: { selector: ".t" }, location: { selector: ".loc" } },
    pageFlow: [{ url: "https://x.test/jobs", action: "listing" }],
    itemSelector: ".card",
    pagination: { type: "url", param: "paged", maxPages: 5 },
    setupScript: "document.title;",
    formCapture: null,
  };
  eq(renderConfigDiff(before, { ...before }), [], "no change, no lines");
  eq(renderConfigDiff(before, { ...before, itemSelector: ".job" }), [`$.fieldMappings._meta.itemSelector: ".card" -> ".job"`], "a meta key is printed under _meta");
  eq(
    renderConfigDiff(before, { ...before, pagination: { type: "url", param: "paged", maxPages: 8 } }),
    [`$.fieldMappings._meta.pagination.maxPages: 5 -> 8`],
    "a nested change names the leaf",
  );
  eq(
    renderConfigDiff(before, { ...before, fieldMappings: { ...before.fieldMappings, location: { selector: ".city" } } }),
    [`$.fieldMappings.location.selector: ".loc" -> ".city"`],
    "a field mapping change is printed under fieldMappings",
  );
  eq(renderConfigDiff(before, { ...before, locationFallback: "חיפה" }), [`$.fieldMappings._meta.locationFallback: (absent) -> "חיפה"`], "an added key");
  const { itemSelector: _drop, ...without } = before;
  void _drop;
  eq(renderConfigDiff(before, without), [`$.fieldMappings._meta.itemSelector: ".card" -> (absent)`], "a removed key");
  eq(
    renderConfigDiff(before, { ...before, pageFlow: [{ url: "https://x.test/jobs", action: "listing" }, { url: "detail", action: "detail" }] }),
    [`$.pageFlow: 1 step(s) -> 2 step(s)`],
    "pageFlow is summarised by length when its length changes",
  );
  const long = "x".repeat(500);
  const lines = renderConfigDiff(before, { ...before, setupScript: long });
  eq(lines.length, 1, "a setupScript change is one line");
  assert(/^\$\.fieldMappings\._meta\.setupScript: 15 chars sha256 [0-9a-f]{12} -> 500 chars sha256 [0-9a-f]{12}$/.test(lines[0] ?? ""), `and summarised by length and hash, not printed (${lines[0]})`);
  eq(renderConfigDiff(before, { ...before, formCapture: { formSelector: "form", actionUrl: "", method: "POST", fields: [] } }).length > 0, true, "formCapture from null to a form is a change");

  // Key order is not a change. Postgres jsonb stores object keys in its own
  // order and the schema parse returns them in schema order, so the same form
  // field reads back as {name, label, tagName, ...} on one side and
  // {name, label, fieldType, ...} on the other (kahane smoke, 2026-10-02).
  const field = { name: "form_fields[fname]", label: "שם פרטי", tagName: "input", required: false, fieldType: "text" };
  const reordered = { name: "form_fields[fname]", label: "שם פרטי", fieldType: "text", required: false, tagName: "input" };
  const withForm = { ...before, formCapture: { formSelector: "form", actionUrl: "", method: "POST", fields: [field] } };
  const withFormReordered = { ...before, formCapture: { method: "POST", formSelector: "form", actionUrl: "", fields: [reordered] } };
  eq(renderConfigDiff(withForm, withFormReordered), [], "the same form with its keys in another order: no change");
  eq(renderConfigDiff(withForm, { ...withFormReordered, formCapture: { ...withFormReordered.formCapture, fields: [{ ...reordered, required: true }] } }).length, 1, "while a real change inside the array is still one line");
}

// --- the acceptance parser ---------------------------------------------------------------
const STARTED = "2026-10-02T10:00:00.000Z";
const done = (item: Record<string, unknown> | null): AcceptanceInput["request"] => ({
  id: "req1",
  status: "DONE",
  sweep: { id: "sw1", startedAt: STARTED, status: "COMPLETED", item: item as never },
});
const goodItem = { outcome: "ok", wouldPromoteTo: "ACTIVE", failureCategory: null, jobsBefore: 20, jobsAfter: 20, warnings: [] };
const field = "LOCATION";
{
  eq(parseAcceptance({ request: done(goodItem), items: [], field }).accept, true, "DONE, wouldPromoteTo ACTIVE, nothing recurring: accept");
  const notActive = parseAcceptance({ request: done({ ...goodItem, wouldPromoteTo: null }), items: [], field });
  eq(notActive.accept, false, "wouldPromoteTo not ACTIVE: refuse");
  assert(notActive.reasons.some((r) => r.includes("wouldPromoteTo")), "and say why");
  eq(parseAcceptance({ request: { ...done(goodItem), status: "FAILED" }, items: [], field }).accept, false, "the request FAILED: refuse");
  eq(parseAcceptance({ request: { ...done(goodItem), status: "PENDING" }, items: [], field }).accept, false, "the run has not finished: refuse");
  eq(parseAcceptance({ request: done(null), items: [], field }).accept, false, "no sweep item for the site: refuse");
  eq(parseAcceptance({ request: { id: "r", status: "DONE", sweep: null }, items: [], field }).accept, false, "no sweep at all: refuse");

  const recurring = { id: "f2", field, source: "CHECK", code: "location_off_list", openedAt: "2026-10-02T10:03:00.000Z", resolvedAt: null };
  const r = parseAcceptance({ request: done(goodItem), items: [recurring], field });
  eq(r.accept, false, "a CHECK item for the fixed field opened during the run: refuse");
  assert(r.reasons.some((x) => x.includes("location_off_list")), "and name its code");
  const original = { ...recurring, id: "f1", openedAt: "2026-10-01T23:00:00.000Z" };
  eq(parseAcceptance({ request: done(goodItem), items: [original], field }).accept, true, "the item being fixed (opened before the run) does not block");
  const auto = { ...recurring, code: "auto:PATCH /api/sites/[id]/config" };
  eq(parseAcceptance({ request: done(goodItem), items: [auto], field }).accept, true, "an auto: item (the fix's own write) does not block");
  const other = { ...recurring, field: "APPLY" };
  eq(parseAcceptance({ request: done(goodItem), items: [other], field }).accept, true, "a CHECK item for another field does not block");
  const manual = { ...recurring, source: "MANUAL" };
  eq(parseAcceptance({ request: done(goodItem), items: [manual], field }).accept, true, "a MANUAL item does not block");
  const resolved = { ...recurring, resolvedAt: "2026-10-02T10:05:00.000Z" };
  eq(parseAcceptance({ request: done(goodItem), items: [resolved], field }).accept, true, "a resolved item does not block");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("fixPlan: the path-level diff, and acceptance only on wouldPromoteTo ACTIVE with nothing recurring");
