// Run: npx tsx worker/lib/valueChecks.test.ts
//
// apply_replay_token (step 2a/2b, owner 2026-10-01): an apply form whose
// captured fields include a PER-SESSION value — a nonce, an anti-forgery token,
// a captcha response — cannot be submitted server-side by replaying what was
// captured. The operator is told which fields. Static values (Elementor's
// form_id) and per-job values (queried_id, post_id) are replayable and are not
// flagged. The rule is on the field NAME, so it works on forms captured before
// values were.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NON_PLACE_LOCATIONS } from "./cityHomographs";
import { HONEYPOT_NAME } from "./formFields";
import {
  applyReplayTokenFinding,
  applyReplayTokenWarning,
  perSessionFieldNames,
  planValueCheckItems,
  runValueChecks,
  VALUE_CHECK_QUEUE_CODES,
  type SavedJobForChecks,
  type ValueCheckInput,
} from "./valueChecks";

let failures = 0;
const eq = (got: unknown, want: unknown, msg: string) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL: ${msg}\n  got=${g}\n  want=${w}`);
    failures++;
  }
};

const f = (...names: string[]) => names.map((name) => ({ name }));

// medulla (Elementor): only the nonce is per-session.
eq(
  perSessionFieldNames(f("post_id", "form_id", "queried_id", "form_fields[Job]", "_wpnonce", "form_fields[name]")),
  ["_wpnonce"],
  "medulla: _wpnonce is flagged; post_id, form_id, queried_id and form_fields[Job] are not",
);
// isrotel (Umbraco) and the other anti-forgery and captcha names.
eq(perSessionFieldNames(f("ufprt", "area", "job")), ["ufprt"], "isrotel: ufprt");
eq(
  perSessionFieldNames(f("__RequestVerificationToken", "csrf_token", "_csrf", "_token", "security_nonce")),
  ["__RequestVerificationToken", "csrf_token", "_csrf", "_token", "security_nonce"],
  "anti-forgery tokens and any *nonce* name",
);
eq(
  perSessionFieldNames(f("g-recaptcha-response", "_wpcf7_recaptcha_response", "cf-turnstile-response")),
  ["g-recaptcha-response", "_wpcf7_recaptcha_response", "cf-turnstile-response"],
  "captcha responses",
);
eq(
  perSessionFieldNames(f("_wpcf7_container_post", "job_id", "token_type", "tokens", "phone")),
  [],
  "per-job and ordinary names are not flagged (a CF7 container post, a job id, a 'token_type')",
);

// Across a run's jobs: one finding, the names union, the jobs counted.
{
  const blob = (...names: string[]) => JSON.stringify({ actionUrl: "a", method: "POST", fields: f(...names) });
  const finding = applyReplayTokenFinding([
    blob("post_id", "_wpnonce"),
    blob("post_id", "_wpnonce"),
    blob("form_id"),
    undefined,
    "not json",
  ]);
  eq(finding, { code: "apply_replay_token", field: "APPLY", count: 2, names: ["_wpnonce"] }, "two jobs carry a per-session field");
  eq(applyReplayTokenFinding([blob("form_id"), null]), null, "no per-session field: no finding");
  eq(
    finding ? applyReplayTokenWarning(finding) : "",
    "apply_replay_token: 2 job(s) carry per-session apply fields (_wpnonce) — cannot be replayed by a server-side submit",
    "the warning names the fields and says why",
  );
}

// ===========================================================================
// Step 2b — the value checks (owner, 2026-10-03). One fixture per rule, from
// the live cases where one exists. Each rule was shown red against a stub that
// finds nothing, and red again with its rule inverted.
// ===========================================================================

const codes = (r: { findings: Array<{ code: string }> }) => r.findings.map((x) => x.code);
const base: ValueCheckInput = { saved: [], previous: [], formBlobs: [], idSeeds: [], listingItemsSeen: null, savedCount: 0 };
const job = (over: Partial<SavedJobForChecks>): SavedJobForChecks => ({
  externalJobId: null,
  detailUrl: null,
  title: "משרה",
  department: null,
  location: "חיפה",
  locations: ["חיפה"],
  description: "תיאור המשרה",
  requirements: null,
  publishDate: "2026-09-20",
  ageBucket: "fresh",
  ...over,
});
const blobOf = (fields: Array<{ name: string; label?: string; fieldType?: string }>, actionUrl = "https://x.test/apply") =>
  JSON.stringify({ actionUrl, method: "POST", fields });

// Live blobs (production, read 2026-10-04), fields only.
const ETGARIM = blobOf(
  [
    { name: "post_id", label: "", fieldType: "hidden" },
    { name: "form_id", label: "", fieldType: "hidden" },
    { name: "referer_title", label: "", fieldType: "hidden" },
    { name: "queried_id", label: "", fieldType: "hidden" },
    { name: "form_fields[field_e6f9361]", label: "", fieldType: "hidden" },
    { name: "form_fields[field_cce66dc]", label: "", fieldType: "hidden" },
    { name: "form_fields[field_9f241b6]", label: "", fieldType: "hidden" },
    { name: "form_fields[message][]", label: "קורות חיים להורדה", fieldType: "file" },
  ],
  "https://www.etgarim2000.co.il/wp-admin/admin-ajax.php",
);
const ISROTEL = blobOf(
  [
    { name: "Name", label: "שמך המלא", fieldType: "text" },
    { name: "MobilePhoneNumber", label: "הטלפון שלך", fieldType: "number" },
    { name: "Email", label: "המייל שלך", fieldType: "email" },
    { name: "AttachmentFile", label: "צרף קובץ", fieldType: "file" },
    { name: "ufprt", label: "Umbraco form route token (per job)", fieldType: "hidden" },
  ],
  "https://www.isrotel.co.il/careers/job-res/{area}/{job}/",
);
const SINAISTORE = blobOf([
  { name: "input_1", label: "שם מלא", fieldType: "text" },
  { name: "input_3", label: "מספר טלפון", fieldType: "tel" },
  { name: "input_4", label: "כתובת מייל", fieldType: "email" },
  { name: "input_5", label: "קובץ קורות חיים", fieldType: "file" },
]);
const LIMEDIGITAL = blobOf([
  { name: "post_id", label: "", fieldType: "hidden" },
  { name: "form_fields[name]", label: "שם", fieldType: "text" },
  { name: "form_fields[phone]", label: "טלפון", fieldType: "tel" },
  { name: "form_fields[email]", label: "מייל", fieldType: "email" },
  { name: "form_fields[file]", label: "file", fieldType: "file" },
  { name: "form_fields[honeypot]", label: "", fieldType: "text" },
]);
// avivim-hr's maspik pair: the honeypot's own name says "name", and it must not
// count as an identity field. A form with ONLY the honeypot has none.
const MASPIK_ONLY = blobOf([
  { name: "post_id", label: "post id", fieldType: "hidden" },
  { name: "full-name-maspik-hp", label: "Leave this field empty", fieldType: "text" },
  { name: "maspik_spam_key", label: "maspik spam key", fieldType: "hidden" },
  { name: "form_fields[file_send]", label: "צירוף קובץ", fieldType: "file" },
]);

console.log("# apply_no_identity_field — etgarim's form asks nobody who they are");
{
  const r = runValueChecks({ ...base, formBlobs: [{ key: "h-u6ajx7", formData: ETGARIM }, { key: "h-2", formData: ETGARIM }] });
  const f = r.findings.find((x) => x.code === "apply_no_identity_field");
  eq(f?.field, "APPLY", "etgarim opens an APPLY item");
  eq(f?.jobIds, ["h-u6ajx7", "h-2"], "naming its jobs");
  eq(f?.count, 2, "counting them");
  eq(r.warnings.some((w) => w.startsWith("apply_no_identity_field: 2 job(s)")), true, "and warns under its code");
  eq(
    codes(runValueChecks({ ...base, formBlobs: [{ key: "a", formData: SINAISTORE }, { key: "b", formData: ISROTEL }] })).includes(
      "apply_no_identity_field",
    ),
    false,
    "sinaistore (Hebrew labels) and isrotel (Name, MobilePhoneNumber) have identity fields",
  );
  eq(
    codes(runValueChecks({ ...base, formBlobs: [{ key: "m", formData: MASPIK_ONLY }] })).includes("apply_no_identity_field"),
    true,
    "a honeypot named full-name is not an identity field",
  );
  eq(
    codes(runValueChecks({ ...base, formBlobs: [{ key: "e", formData: blobOf([]) }, { key: "n", formData: null }] })),
    [],
    "a blob with no fields, or none at all, is not this check's question",
  );
}

console.log("# apply_template_action_url — isrotel posts to {area}/{job}");
{
  const r = runValueChecks({ ...base, formBlobs: [{ key: "isrotel-77016-eilatkiddos", formData: ISROTEL }, { key: "s", formData: SINAISTORE }] });
  const f = r.findings.find((x) => x.code === "apply_template_action_url");
  eq(f?.jobIds, ["isrotel-77016-eilatkiddos"], "isrotel's job is named; sinaistore's is not");
  eq(f?.detail?.includes("{area}/{job}"), true, "the detail shows the URL");
  eq(
    codes(runValueChecks({ ...base, formBlobs: [{ key: "enc", formData: blobOf([], "https://x.test/apply/%7Bjob%7D/") }] })),
    ["apply_template_action_url"],
    "the URL-encoded placeholder too",
  );
}

console.log("# apply_honeypot_field — limedigital's form_fields[honeypot]");
{
  const r = runValueChecks({ ...base, formBlobs: [{ key: "h-x8pjw5", formData: LIMEDIGITAL }, { key: "s", formData: SINAISTORE }] });
  const f = r.findings.find((x) => x.code === "apply_honeypot_field");
  eq(f?.jobIds, ["h-x8pjw5"], "limedigital's job is named");
  eq(f?.detail?.includes("form_fields[honeypot]"), true, "with the field");
  eq(codes(r).includes("apply_no_identity_field"), false, "and it still has identity fields");
  // The rule is the capture template's, character for character.
  const template = readFileSync(join(__dirname, "../../sites/_shared/form-capture-template.js"), "utf8");
  eq(template.includes(`/${HONEYPOT_NAME.source}/${HONEYPOT_NAME.flags}`), true, "the template's honeypot regex is identical");
}

console.log("# external_job_id_churn — ern minted its ids per page load");
{
  const titles = [
    "מנתח/ת מערכות מנוסה לצוות מנתחי מערכות",
    "נציג/ת גבייה",
    "נציגי תיאום פגישות",
    "סטודנטים למגוון משרות- דגש על מוקד בחינת ואישור עסקאות בסיכון גבוה",
    "שירות לקוחות אסטרטגיים",
    "נציג שירות למוצר מאצ'ינג",
    "שירות לקוחות עסקי",
    "מכירות שטח",
  ];
  // LRN-ID-9: the June hash, then the next load's.
  const previous = titles.map((title, i) => ({ externalJobId: `#collapse-8bda9230-${i}`, detailUrl: null, title, department: null }));
  const saved = titles.map((title, i) => job({ externalJobId: `#collapse-5ef12a84-${i}`, title }));
  const r = runValueChecks({ ...base, saved, previous });
  const f = r.findings.find((x) => x.code === "external_job_id_churn");
  eq(f?.field, "JOB_ID", "ern opens a JOB_ID item");
  eq(f?.count, 8, "all eight re-keyed");
  eq(f?.jobIds?.[0], "#collapse-5ef12a84-0", "named by tonight's id");

  // ern since the fix: the same ids two nights running.
  const stable = titles.map((title, i) => ({ externalJobId: `ern-${i}`, detailUrl: null, title, department: null }));
  eq(
    codes(runValueChecks({ ...base, saved: stable.map((p) => job(p)), previous: stable })).includes("external_job_id_churn"),
    false,
    "stable ids: no churn",
  );
  // A native id switched to a synthesised one is churn, not synthesis.
  const native = runValueChecks({
    ...base,
    saved: [job({ externalJobId: "h-abc123", title: "מאבטח" })],
    previous: [{ externalJobId: "1386", detailUrl: null, title: "מאבטח", department: null }],
    idSeeds: [{ extracted: null, id: "h-abc123" }],
  });
  eq(codes(native), ["external_job_id_churn"], "a native -> h- switch opens a churn item and no synthesis item");
  // Joined by URL: a retitled job on a hashed site moves its id by design.
  const url = "https://x.test/job/1";
  eq(
    codes(
      runValueChecks({
        ...base,
        saved: [job({ externalJobId: "h-new", detailUrl: url, title: "כותרת חדשה" })],
        previous: [{ externalJobId: "h-old", detailUrl: url, title: "כותרת ישנה", department: null }],
      }),
    ),
    [],
    "a retitled job is not paired, so not churn",
  );
  eq(
    codes(
      runValueChecks({
        ...base,
        saved: [job({ externalJobId: "77", detailUrl: url, title: "א" })],
        previous: [{ externalJobId: "76", detailUrl: url, title: "א", department: null }],
      }),
    ),
    ["external_job_id_churn"],
    "same URL, same title, a new id: churn",
  );
  eq(
    codes(
      runValueChecks({
        ...base,
        saved: [job({ externalJobId: "1", title: "א" }), job({ externalJobId: "2", title: "א" })],
        previous: [{ externalJobId: "9", detailUrl: null, title: "א", department: null }],
      }),
    ),
    [],
    "a title + department pair held by two jobs pairs nothing",
  );
}

console.log("# synthesised_id_collision — two jobs hashed alike become a queue item");
{
  const r = runValueChecks({
    ...base,
    idSeeds: [
      { extracted: null, id: "h-aaa" },
      { extracted: null, id: "h-aaa" },
      { extracted: null, id: "h-bbb" },
      { extracted: "h-bbb", id: "h-bbb" },
    ],
  });
  const f = r.findings.find((x) => x.code === "synthesised_id_collision");
  eq(f?.jobIds, ["h-aaa"], "the colliding id is named; a native id equal to a hash is not a collision");
  eq(f?.count, 1, "one collision");
  eq(
    r.warnings.includes(
      "synthesised_id_collision: 1 job(s) share a synthesised id and will dedup into one row — the site needs a real externalJobId",
    ),
    true,
    "the warning text is unchanged",
  );
  eq(
    r.warnings.some((w) => w.startsWith("synthesised_external_job_id: 3/4 job(s)")),
    true,
    "the synthesis warning is still written",
  );
  eq(codes(runValueChecks({ ...base, idSeeds: [{ extracted: null, id: "h-1" }, { extracted: null, id: "h-2" }] })), [], "full synthesis opens no item");
}

console.log("# undated_rate — a DATE item only for unparseable dates; the missing share is a warning (owner, 2026-10-04)");
{
  const saved = [
    job({ externalJobId: "1", publishDate: null, ageBucket: null }),
    job({ externalJobId: "2", publishDate: "", ageBucket: null }),
    job({ externalJobId: "3", publishDate: "לפני כמה ימים", ageBucket: null }),
    job({ externalJobId: "4" }),
  ];
  const r = runValueChecks({ ...base, saved });
  const f = r.findings.find((x) => x.code === "undated_rate");
  eq(f?.field, "DATE", "an unparseable date opens a DATE item");
  eq(f?.jobIds, ["3"], "naming only the unparseable job — a missing date is nothing to fix");
  eq(f?.count, 1, "counting it");
  eq(
    r.warnings.includes("undated_rate: 3/4 job(s) have no usable date (75%) — 2 missing, 1 unparseable"),
    true,
    "the warning keeps the whole share, missing and unparseable apart",
  );

  // A board that publishes no dates at all (147 of 179 sites on 2026-10-04).
  const none = runValueChecks({ ...base, saved: [saved[0]!, saved[1]!, job({ externalJobId: "8", publishDate: null, ageBucket: null })] });
  eq(codes(none), [], "all missing: no item");
  eq(none.warnings.some((w) => w.startsWith("undated_rate: 3/3 job(s) have no usable date (100%) — 3 missing, 0 unparseable")), true, "but the warning line stays");

  // One bad date on a site that otherwise dates everything: a parser defect.
  const one = runValueChecks({ ...base, saved: [saved[2]!, saved[3]!, job({ externalJobId: "5" }), job({ externalJobId: "6" }), job({ externalJobId: "7" })] });
  eq(codes(one), ["undated_rate"], "1 unparseable of 5 (20%) still opens the item");
  eq(one.warnings.some((w) => w.startsWith("undated_rate: 1/5 job(s) have no usable date (20%) — 0 missing, 1 unparseable")), true, "with its line");

  const quiet = runValueChecks({ ...base, saved: [saved[0]!, saved[1]!, job({ externalJobId: "5" }), job({ externalJobId: "6" }), job({ externalJobId: "7" })] });
  eq(codes(quiet), [], "2 missing of 5 (exactly 40%): no item");
  eq(quiet.warnings.some((w) => w.startsWith("undated_rate")), false, "and no line");
}

console.log("# synthesised_external_job_id — partial synthesis is a JOB_ID item; all-hashed is not (owner, 2026-10-04)");
{
  // weizmann 2/55: a native mapping that missed two jobs.
  const seeds = [
    ...Array.from({ length: 53 }, (_, i) => ({ extracted: `${7000 + i}`, id: `${7000 + i}` })),
    { extracted: null, id: "h-w1" },
    { extracted: "", id: "h-w2" },
  ];
  const r = runValueChecks({ ...base, idSeeds: seeds });
  const f = r.findings.find((x) => x.code === "synthesised_external_job_id");
  eq(f?.field, "JOB_ID", "weizmann 2/55 opens a JOB_ID item");
  eq(f?.jobIds, ["h-w1", "h-w2"], "naming the hashed jobs");
  eq(r.warnings.some((w) => w.startsWith("synthesised_external_job_id: 2/55 job(s)")), true, "the warning text is unchanged");
  // safari 1/9
  const safari = runValueChecks({
    ...base,
    idSeeds: [...Array.from({ length: 8 }, (_, i) => ({ extracted: `s${i}`, id: `s${i}` })), { extracted: null, id: "h-s" }],
  });
  eq(codes(safari), ["synthesised_external_job_id"], "safari 1/9 opens one");
  // sinaistore 4/4: no native id at all, the legitimate case.
  const all = runValueChecks({ ...base, idSeeds: Array.from({ length: 4 }, (_, i) => ({ extracted: null, id: `h-${i}` })) });
  eq(codes(all), [], "all hashed (sinaistore 4/4): nothing opens");
  eq(all.warnings.some((w) => w.startsWith("synthesised_external_job_id: 4/4")), true, "the warning still says so");
  eq(codes(runValueChecks({ ...base, idSeeds: [{ extracted: "1", id: "1" }] })), [], "all native: nothing");
  eq(VALUE_CHECK_QUEUE_CODES.has("apply_replay_token"), false, "apply_replay_token stays a warning only");
}

console.log("# location_homograph — the list moved, and the check names jobs");
{
  const saved = [
    // clalitsmile, before the city gate: an unfilled <select> stored three times.
    job({ externalJobId: "c1", location: "בחר", locations: [] }),
    job({ externalJobId: "c2", location: "בחר", locations: [] }),
    job({ externalJobId: "c3", location: "בחר", locations: [] }),
    // mikud-avtaha 6746, live: "באזור (צמוד לחולון)" — Azor is on city.csv.
    job({ externalJobId: "6746", location: "אזור", locations: ["אזור", "חולון"] }),
    // a homograph that is only in the list, not the primary value
    job({ externalJobId: "x9", location: "חולון", locations: ["חולון", "מצליח"] }),
    job({ externalJobId: "ok" }),
  ];
  const r = runValueChecks({ ...base, saved });
  const f = r.findings.find((x) => x.code === "location_homograph");
  eq(f?.field, "LOCATION", "a LOCATION item");
  eq(f?.jobIds, ["c1", "c2", "c3", "6746", "x9"], "naming each job, including one whose homograph is second");
  eq(f?.detail?.startsWith(`"בחר"×3, "אזור"×1, "מצליח"×1`), true, `the values with counts (${f?.detail})`);
  eq(NON_PLACE_LOCATIONS.has("אזור") && NON_PLACE_LOCATIONS.has("בחר תחום"), true, "the list lives in cityHomographs.ts");
  eq(r.warnings.some((w) => w.startsWith("non_place_location")), false, "the old code is gone");
}

console.log("# unknown_location_rate, region_over_city, listing_vs_saved_gap — unchanged logic, now queue items");
{
  const unknown = runValueChecks({
    ...base,
    saved: [
      job({ externalJobId: "u1", location: "Unknown", locations: [] }),
      job({ externalJobId: "u2", location: "Unknown", locations: [] }),
      job({ externalJobId: "u3", location: "", locations: [] }),
      job({ externalJobId: "k1" }),
      job({ externalJobId: "k2" }),
    ],
  });
  const u = unknown.findings.find((x) => x.code === "unknown_location_rate");
  eq(u?.jobIds, ["u1", "u2", "u3"], "unknown_location_rate names the unknown jobs");
  eq(unknown.warnings.includes("unknown_location_rate: 3/5 job(s) have no location (60%)"), true, "with today's text");
  eq(
    codes(
      runValueChecks({
        ...base,
        saved: [job({ location: "Unknown" }), job({ location: "Unknown" }), job({}), job({}), job({})],
      }),
    ).includes("unknown_location_rate"),
    false,
    "2 of 5 (40%) is not over the ratio",
  );

  // tikshoov 5084: the board files it under a region, the ad labels the city.
  const region = runValueChecks({
    ...base,
    saved: [
      job({ externalJobId: "5084", location: "השפלה", locations: [], description: "שירות מהבית | רימון ספקית אינטרנט\nמיקום המשרה: גבעת שמואל" }),
      job({ externalJobId: "r2", location: "השפלה", locations: [], description: "דרוש/ה מנהל/ת צוות לחברה מובילה" }),
    ],
  });
  const g = region.findings.find((x) => x.code === "region_over_city");
  eq(g?.jobIds, ["5084"], "region_over_city names the job whose ad names a city, not the region-only one");
  eq(
    region.warnings.includes("region_over_city: 1 job(s) stored a region while the ad names a city (e.g. השפלה -> גבעת שמואל)"),
    true,
    "with today's text",
  );

  // samelet: 8 cards, 7 saved (a reused requisition number).
  const gap = runValueChecks({ ...base, listingItemsSeen: 8, savedCount: 7 });
  const l = gap.findings.find((x) => x.code === "listing_vs_saved_gap");
  eq(l?.field, "COVERAGE", "listing_vs_saved_gap is a COVERAGE item");
  eq(l?.count, 1, "counting the unaccounted card");
  eq(codes(runValueChecks({ ...base, listingItemsSeen: 7, savedCount: 7 })), [], "no gap, no item");
  eq(codes(runValueChecks({ ...base, listingItemsSeen: 8, savedCount: 0 })), [], "nothing saved is not this check's question");
}

console.log("# description_fill_low — allegronet, 3 of 6 (2026-10-03)");
{
  const allegronet = [
    job({ externalJobId: "allegronet-JB-8", title: "איש/ת תשתית ענן ב- AZURE", description: null }),
    job({ externalJobId: "allegronet-JB-5", title: "מומחה System", description: "" }),
    job({ externalJobId: "allegronet-JB-6", title: "איש/ת אבטחת מידע", description: "  " }),
    job({ externalJobId: "allegronet-JB-4", title: "תומך/ת טכני/ת" }),
    job({ externalJobId: "allegronet-JB-7", title: "טכנאי/ת טלפוני למערכות מידע ומחשוב" }),
    job({ externalJobId: "allegronet-JB-9", title: "מנהל/ת תיקי לקוחות" }),
  ];
  const r = runValueChecks({ ...base, saved: allegronet });
  const f = r.findings.find((x) => x.code === "description_fill_low");
  eq(f?.field, "DESCRIPTION", "a DESCRIPTION item");
  eq(f?.jobIds, ["allegronet-JB-8", "allegronet-JB-5", "allegronet-JB-6"], "naming the jobs without one");
  eq(r.warnings.includes("description_fill_low: 3/6 job(s) have a description (50%) — below 60%"), true, "50% < 60%");
  const five = [...allegronet.slice(0, 2), ...allegronet.slice(3)];
  eq(codes(runValueChecks({ ...base, saved: five })).includes("description_fill_low"), false, "3 of 5 (exactly 60%) is not below");
}

console.log("# the queue: these checks open and close only their own items");
{
  const r = runValueChecks({ ...base, saved: [job({ externalJobId: "a", description: null })] });
  const open = [
    { id: "auto", source: "CHECK" as const, code: "auto:PATCH /api/sites/[id]/config", field: "OTHER" },
    { id: "company", source: "CHECK" as const, code: "company_hq_changed", field: "COMPANY" },
    { id: "manual", source: "MANUAL" as const, code: "manual", field: "APPLY" },
    { id: "homograph", source: "CHECK" as const, code: "location_homograph", field: "LOCATION" },
    { id: "desc", source: "CHECK" as const, code: "description_fill_low", field: "DESCRIPTION" },
  ];
  const plan = planValueCheckItems(r.findings, open);
  eq(plan.open.map((x) => x.code), [], "description_fill_low is already open: nothing new");
  eq(plan.close, [{ id: "homograph", resolvedBy: "CHECK" }], "the homograph no longer fires: closed");
  eq(plan.keep, ["desc"], "the firing item is kept");
  eq(
    [...VALUE_CHECK_QUEUE_CODES].every((c) => !c.startsWith("auto:")),
    true,
    "an auto: item, another check's item and a MANUAL item are never touched",
  );
  const fresh = planValueCheckItems(r.findings, []);
  eq(fresh.open[0]?.jobIds, ["a"], "a new finding opens with its jobs");
}

console.log("# listing_vs_saved_gap — a card whose detail page was dead or unavailable is accounted for (owner, 2026-10-08)");
{
  // civi HTRAMH7PYM, 2026-10-08: 5 cards, 3 saved, 2 detail pages declared
  // themselves unavailable. Those two are accounted for: no item.
  const civi = runValueChecks({ ...base, listingItemsSeen: 5, savedCount: 3, deadDetailPages: 2 } as ValueCheckInput);
  eq(codes(civi), [], "civi: 5 cards, 3 saved, 2 unavailable — no item");
  eq(civi.warnings.filter((w) => w.startsWith("listing_vs_saved_gap")), [], "and no warning");

  // The same counts with no dead page: the gap is real and the item opens.
  const real = runValueChecks({ ...base, listingItemsSeen: 5, savedCount: 3, deadDetailPages: 0 } as ValueCheckInput);
  const r = real.findings.find((x) => x.code === "listing_vs_saved_gap");
  eq(r?.count, 2, "5 cards, 3 saved, 0 unavailable — the item opens, 2 unaccounted");
  eq(/\(2 unaccounted\)/.test(r?.detail ?? ""), true, `and says so (${r?.detail})`);

  // Partly accounted: the detail names both numbers.
  const part = runValueChecks({ ...base, listingItemsSeen: 6, savedCount: 3, deadDetailPages: 2 } as ValueCheckInput);
  const p = part.findings.find((x) => x.code === "listing_vs_saved_gap");
  eq(p?.count, 1, "6 cards, 3 saved, 2 unavailable — 1 unaccounted");
  eq(/2 unavailable/.test(p?.detail ?? "") && /1 unaccounted/.test(p?.detail ?? ""), true, `naming "2 unavailable" and "1 unaccounted" (${p?.detail})`);

  // The open item closes itself on a run where the check no longer fires.
  const close = planValueCheckItems(civi.findings, [
    { id: "cmuz9omog00031lr3t66n2w8f", source: "CHECK", code: "listing_vs_saved_gap", field: "COVERAGE" },
  ]);
  eq(close.close, [{ id: "cmuz9omog00031lr3t66n2w8f", resolvedBy: "CHECK" }], "civi's open gap item is closed, resolvedBy CHECK, on a run with nothing unaccounted");

  // scrape.ts passes the run's dead detail pages to the checks.
  const scrape = readFileSync(join(__dirname, "..", "jobs", "scrape.ts"), "utf8");
  const call = scrape.slice(scrape.indexOf("const checks = runValueChecks({"), scrape.indexOf("const checks = runValueChecks({") + 1200);
  eq(/deadDetailPages:\s*countDeadDetailPages\(rawFieldsList\)/.test(call), true, "scrape.ts passes countDeadDetailPages(rawFieldsList) to runValueChecks");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("valueChecks: per-session apply fields flagged by name; the step 2b checks warn and queue with job keys");
