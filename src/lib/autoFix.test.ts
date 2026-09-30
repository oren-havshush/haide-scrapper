// Run: npx tsx src/lib/autoFix.test.ts
//
// addsite2 phase two, step 1c (the owner's redesign, 2026-09-30): fix items are
// opened by the API writes themselves, not logged by hand. Every write to a
// site that is ACTIVE when the write arrives opens a CHECK item coded
// auto:<route>, filed under the field the change touched:
//   config save, setupScript or selector change  -> COVERAGE
//   config save touching exactly one mapped field -> that field
//   formCapture change                            -> APPLY
//   location override                             -> LOCATION
//   manual job delete                             -> COVERAGE
//   status change away from ACTIVE                -> OTHER
// A write to a site that is not ACTIVE opens nothing. The same site and field
// written again within one hour extends the open item instead of opening
// another. Minutes are estimated: the span between the first and last API
// call on the site by the same token on the same (Jerusalem) day.

import {
  AUTO_FIX_EXTEND_MS,
  estimateMinutes,
  fieldsForWrite,
  planAutoFix,
  startOfLocalDay,
  type ConfigSnapshot,
} from "./autoFix";

let failures = 0;
const eq = (got: unknown, want: unknown, msg: string) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL: ${msg}\n  got=${g}\n  want=${w}`);
    failures++;
  }
};

// A stored config, in the shape saveSiteConfig writes (_meta inside fieldMappings).
const base = (): ConfigSnapshot => ({
  fieldMappings: {
    title: { selector: "h2.job-title", confidence: 0.9 },
    location: { selector: ".job-location", confidence: 0.8 },
    description: { selector: ".job-body", confidence: 0.8 },
    _meta: {
      savedAt: "2026-09-01T10:00:00.000Z",
      itemSelector: ".job-card",
      listingSelector: null,
      setupScript: "return [];",
      formCapture: { formSelector: "form", actionUrl: "https://x.test/apply", method: "POST", fields: [] },
      pagination: null,
      locationFallback: null,
    },
  },
  pageFlow: [{ url: "https://x.test/jobs", action: "navigate" }],
});
type Meta = Record<string, unknown>;
const withMeta = (m: Partial<Meta>): ConfigSnapshot => {
  const c = base();
  const fm = c.fieldMappings as Record<string, unknown>;
  fm._meta = { ...(fm._meta as Meta), ...m };
  return c;
};
const withField = (name: string, v: unknown): ConfigSnapshot => {
  const c = base();
  (c.fieldMappings as Record<string, unknown>)[name] = v;
  return c;
};
const config = (after: ConfigSnapshot) => fieldsForWrite({ kind: "config", before: base(), after });

// --- rule 1: a setupScript or selector change -> COVERAGE --------------------
eq(config(withMeta({ setupScript: "return [1];" })), ["COVERAGE"], "a setupScript change files COVERAGE");
eq(config(withMeta({ itemSelector: ".job-row" })), ["COVERAGE"], "an item-selector change files COVERAGE");
{
  const two = base();
  const fm = two.fieldMappings as Record<string, unknown>;
  fm.title = { selector: "h3" };
  fm.location = { selector: ".loc" };
  eq(config(two), ["COVERAGE"], "two mapped fields at once are not one field: COVERAGE");
  const mixed = withMeta({ setupScript: "x" });
  (mixed.fieldMappings as Record<string, unknown>).location = { selector: ".loc" };
  eq(config(mixed), ["COVERAGE"], "one mapped field plus a script change: COVERAGE");
}

// --- rule 2: a diff touching exactly one mapped field -> that field ----------
eq(config(withField("location", { selector: ".where", confidence: 0.8 })), ["LOCATION"], "only location changed: LOCATION");
eq(config(withField("title", { selector: "h1" })), ["TITLE"], "only title: TITLE");
eq(config(withField("externalJobId", { selector: "[data-id]" })), ["JOB_ID"], "a new externalJobId mapping: JOB_ID");
eq(config(withField("publishDate", { selector: "time" })), ["DATE"], "publishDate: DATE");
eq(config(withField("requirements", { selector: ".req" })), ["DESCRIPTION"], "requirements: DESCRIPTION");
eq(config(withField("applicationInfo", { selector: "a.apply" })), ["APPLY"], "applicationInfo: APPLY");
eq(config(withField("department", { selector: ".dept" })), ["OTHER"], "a field with no fix category of its own: OTHER");
{
  // Key order differs the way jsonb reorders keys; nothing changed.
  const reordered: ConfigSnapshot = {
    fieldMappings: Object.fromEntries(Object.entries(base().fieldMappings as Meta).reverse()),
    pageFlow: base().pageFlow,
  };
  eq(config(reordered), [], "the same config with its keys reordered is no change");
  eq(config(withMeta({ savedAt: "2026-09-30T12:00:00.000Z" })), [], "a new savedAt alone is no change");

  // Absent and null are the same value, at any depth. kahane's smoke save
  // (2026-09-30) showed an older config missing keys that saveSiteConfig now
  // writes as explicit nulls; top-level _meta keys already compared equal,
  // nested ones did not.
  const older = base();
  const meta = (older.fieldMappings as Record<string, unknown>)._meta as Record<string, unknown>;
  delete meta.pagination;
  eq(
    fieldsForWrite({ kind: "config", before: older, after: withMeta({ listingUrls: null }) }),
    [],
    "top-level _meta keys going from absent to null are no change",
  );
  eq(
    fieldsForWrite({
      kind: "config",
      before: withMeta({ browserOverrides: { requestDelayMs: 3000 } }),
      after: withMeta({ browserOverrides: { requestDelayMs: 3000, userAgent: null } }),
    }),
    [],
    "a nested key going from absent to null is no change",
  );
  eq(
    config(withField("title", { selector: "h2.job-title", confidence: 0.9, attribute: null })),
    [],
    "nor inside a mapped field",
  );
  eq(
    config(withField("title", { selector: "h2.job-title", confidence: 0.9, attribute: "href" })),
    ["TITLE"],
    "while a nested key gaining a value is still a change",
  );
}

// --- rule 3: formCapture -> APPLY ---------------------------------------------
eq(
  config(withMeta({ formCapture: { formSelector: "form#cv", actionUrl: "https://x.test/apply", method: "POST", fields: [] } })),
  ["APPLY"],
  "a formCapture change files APPLY",
);
{
  const both = withMeta({ formCapture: null, setupScript: "x" });
  eq(config(both), ["APPLY", "COVERAGE"], "formCapture and a script change together: APPLY and COVERAGE");
}

// --- rules 4-6: the other writes ---------------------------------------------
eq(fieldsForWrite({ kind: "location_override" }), ["LOCATION"], "a location override files LOCATION");
eq(fieldsForWrite({ kind: "jobs_delete" }), ["COVERAGE"], "a manual job delete files COVERAGE");
eq(fieldsForWrite({ kind: "status", to: "SKIPPED" }), ["OTHER"], "a status change away from ACTIVE files OTHER");
eq(fieldsForWrite({ kind: "status", to: "REVIEW" }), ["OTHER"], "to REVIEW as well");
eq(fieldsForWrite({ kind: "status", to: "ACTIVE" }), [], "a status write that stays ACTIVE is no change away from it");
eq(fieldsForWrite({ kind: "other" }), [], "any other write (an admin note, a scrape, an analysis, a policy review) files nothing");

// --- rule 7 (owner, 2026-09-30): a company-field write -> COMPANY --------------
eq(fieldsForWrite({ kind: "company" }), ["COMPANY"], "a write to a company field files COMPANY");
{
  const code = "auto:PUT /api/sites/[id]/company-profile";
  const at = new Date("2026-09-30T10:00:00Z");
  eq(
    planAutoFix({ statusBefore: "ACTIVE", fields: fieldsForWrite({ kind: "company" }), code, now: at, openAuto: [] }).open,
    [{ field: "COMPANY", code }],
    "on an ACTIVE site it opens a COMPANY item",
  );
  const recent = { id: "c1", field: "COMPANY", lastWriteAt: new Date(at.getTime() - 5 * 60_000) };
  eq(
    planAutoFix({ statusBefore: "ACTIVE", fields: ["COMPANY"], code: "auto:POST /api/sites/[id]/company-logo", now: at, openAuto: [recent] }).extend,
    ["c1"],
    "the logo five minutes after the profile extends the same COMPANY item",
  );
  eq(
    planAutoFix({ statusBefore: "REVIEW", fields: ["COMPANY"], code, now: at, openAuto: [] }).open,
    [],
    "on a REVIEW site it opens nothing",
  );
}

// --- a write to a site that is not ACTIVE opens nothing -----------------------
const NOW = new Date("2026-09-30T10:00:00Z");
{
  for (const statusBefore of ["REVIEW", "ANALYZING", "FAILED", "SKIPPED"]) {
    const p = planAutoFix({ statusBefore, fields: ["COVERAGE"], code: "auto:PUT /api/sites/[id]/config", now: NOW, openAuto: [] });
    eq(p.open, [], `a write to a ${statusBefore} site opens nothing`);
  }
  const p = planAutoFix({ statusBefore: "ACTIVE", fields: ["COVERAGE"], code: "auto:PUT /api/sites/[id]/config", now: NOW, openAuto: [] });
  eq(p.open, [{ field: "COVERAGE", code: "auto:PUT /api/sites/[id]/config" }], "the same write to an ACTIVE site opens one item");
}

// --- the same site and field within an hour extends; after it, a new item ----
{
  const code = "auto:PUT /api/sites/[id]/config";
  const recent = { id: "f1", field: "COVERAGE", lastWriteAt: new Date(NOW.getTime() - 20 * 60_000) };
  const p = planAutoFix({ statusBefore: "ACTIVE", fields: ["COVERAGE"], code, now: NOW, openAuto: [recent] });
  eq([p.open, p.extend], [[], ["f1"]], "20 minutes later, the same field extends the open item");
  const edge = { ...recent, lastWriteAt: new Date(NOW.getTime() - AUTO_FIX_EXTEND_MS) };
  eq(planAutoFix({ statusBefore: "ACTIVE", fields: ["COVERAGE"], code, now: NOW, openAuto: [edge] }).extend, ["f1"], "exactly one hour still extends");
  const old = { ...recent, lastWriteAt: new Date(NOW.getTime() - AUTO_FIX_EXTEND_MS - 1) };
  const q = planAutoFix({ statusBefore: "ACTIVE", fields: ["COVERAGE"], code, now: NOW, openAuto: [old] });
  eq([q.open.length, q.extend], [1, []], "over an hour later a new item opens");
  const r = planAutoFix({ statusBefore: "ACTIVE", fields: ["APPLY"], code, now: NOW, openAuto: [recent] });
  eq([r.open.map((o) => o.field), r.extend], [["APPLY"], []], "another field opens its own item");
  const s = planAutoFix({ statusBefore: "REVIEW", fields: ["COVERAGE"], code, now: NOW, openAuto: [recent] });
  eq([s.open, s.extend], [[], ["f1"]], "a second save on the now-REVIEW site extends the item the first save opened");
}

// --- minutes: first to last API call, same token, same Jerusalem day -----------
{
  const TZ = "Asia/Jerusalem";
  const at = (iso: string) => new Date(iso);
  const now = at("2026-09-30T12:30:00Z"); // 15:30 in Jerusalem
  eq(estimateMinutes([at("2026-09-30T11:45:00Z"), at("2026-09-30T12:00:00Z")], now, TZ), 45, "11:45 to the write at 12:30: 45 minutes");
  eq(estimateMinutes([], now, TZ), 0, "a write with no earlier call: 0");
  eq(
    estimateMinutes([at("2026-09-29T20:59:00Z"), at("2026-09-30T12:00:00Z")], now, TZ),
    30,
    "a call on the previous Jerusalem day (23:59) is not counted",
  );
  eq(
    estimateMinutes([at("2026-09-29T21:30:00Z")], at("2026-09-29T22:00:00Z"), TZ),
    30,
    "00:30 to 01:00 Jerusalem is one day even though UTC crosses midnight",
  );
  eq(estimateMinutes([at("2026-09-30T12:00:20Z")], now, TZ), 30, "rounded to whole minutes");
  eq(startOfLocalDay(now, TZ).toISOString(), "2026-09-29T21:00:00.000Z", "the Jerusalem day starts at 21:00 UTC in summer time");
  eq(
    startOfLocalDay(at("2026-12-01T10:00:00Z"), TZ).toISOString(),
    "2026-11-30T22:00:00.000Z",
    "and at 22:00 UTC in winter",
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("autoFix: writes to ACTIVE sites open items by field, extend within the hour, minutes estimated");
