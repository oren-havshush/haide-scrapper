// Run: npx tsx src/lib/configStrict.test.ts
//
// H3 (owner, 2026-10-14): the config save refuses an unknown key. Maof's area
// table was saved before the version that knew it: the server answered 200 and
// dropped it. Now an unknown key, at the top level (a _meta key) or inside an
// object the schema describes, is a 400 naming the key; a _meta sent inside
// fieldMappings is refused; the PATCH merge agrees with the schema; and
// verify-config compares every key that was sent.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { flattenStoredConfig, mergeConfigPatch } from "./configPatch";
import { configIssueMessage, updateSiteConfigSchema } from "./validators";
import { sentKeysNotStored } from "../../scripts/lib/fixPlan";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}
function check(name: string, body: () => void) {
  try {
    body();
  } catch (err) {
    console.error(`FAIL: ${name} threw: ${(err as Error).message}`);
    failures++;
  }
}

const base = {
  itemSelector: ".job",
  fieldMappings: { title: { selector: "h2", source: "MANUAL", confidence: 100 } },
  pageFlow: [{ url: "https://x.example/jobs", action: "navigate" }],
  formCapture: {
    formSelector: "form",
    actionUrl: "https://x.example/apply",
    method: "post",
    fields: [{ name: "name", label: "Name", fieldType: "text", required: true, tagName: "input", options: [{ value: "a", label: "A" }] }],
  },
  pagination: { type: "url" as const, param: "page" },
  browserOverrides: { userAgent: "Mozilla/5.0" },
  limits: { maxItems: 100 },
  locationMap: { "עמקים וטבריה": null },
  setupScript: "return 1;",
};

/** The 400's text for a body, or null when it is accepted. */
function refusal(body: unknown): string | null {
  const r = updateSiteConfigSchema.safeParse(body);
  return r.success ? null : r.error.issues.map(configIssueMessage).join(", ");
}

check("a full, known config is accepted", () => {
  assert(refusal(base) === null, `accepted (got ${refusal(base)})`);
});

check("an unknown key is a 400 naming it, at every level", () => {
  const cases: Array<[string, unknown, string]> = [
    ["top level (a _meta key)", { ...base, areaTable: { x: "y" } }, "unknown config key(s) at the top level: areaTable"],
    ["browserOverrides", { ...base, browserOverrides: { userAgent: "u", proxy: "p" } }, "unknown config key(s) at browserOverrides: proxy"],
    ["pagination (url)", { ...base, pagination: { type: "url", param: "page", pages: 3 } }, "unknown config key(s) at pagination: pages"],
    ["pagination (click)", { ...base, pagination: { type: "click", nextSelector: ".n", clicks: 3 } }, "unknown config key(s) at pagination: clicks"],
    ["formCapture", { ...base, formCapture: { ...base.formCapture, submitEndpoint: "x" } }, "unknown config key(s) at formCapture: submitEndpoint"],
    ["a form field", { ...base, formCapture: { ...base.formCapture, fields: [{ ...base.formCapture.fields[0], placeholder: "p" }] } }, "unknown config key(s) at formCapture.fields.0: placeholder"],
    ["a select option", { ...base, formCapture: { ...base.formCapture, fields: [{ ...base.formCapture.fields[0], options: [{ value: "a", label: "A", selected: true }] }] } }, "unknown config key(s) at formCapture.fields.0.options.0: selected"],
    ["a pageFlow step", { ...base, pageFlow: [{ url: "u", action: "navigate", wait: 5 }] }, "unknown config key(s) at pageFlow.0: wait"],
    ["limits", { ...base, limits: { maxItems: 100, maxJobs: 5 } }, "unknown config key(s) at limits: maxJobs"],
  ];
  for (const [where, body, want] of cases) {
    const got = refusal(body);
    assert(got !== null && got.includes(want), `${where}: refused naming the key (got ${got})`);
  }
});

check("_meta inside fieldMappings is refused, not silently replaced", () => {
  const got = refusal({ ...base, fieldMappings: { ...base.fieldMappings, _meta: { locationMap: { a: null } } } });
  assert(got !== null && got.includes("fieldMappings._meta is not saved"), `refused (got ${got})`);
});

check("the PATCH merge agrees with the schema", () => {
  const stored = { fieldMappings: { ...base.fieldMappings, _meta: { ...base, fieldMappings: undefined, pageFlow: undefined, savedAt: "x" } }, pageFlow: base.pageFlow };
  let msg = "";
  try {
    mergeConfigPatch(stored, { browserOverrides: { userAgent: "u", proxy: "p" } });
  } catch (e) {
    msg = (e as Error).message;
  }
  assert(msg.includes("unknown config key(s) at browserOverrides: proxy"), `a nested unknown key in a PATCH names itself (got ${msg})`);
  msg = "";
  try {
    mergeConfigPatch(stored, { areaTable: {} });
  } catch (e) {
    msg = (e as Error).message;
  }
  assert(/areaTable/.test(msg), `and a top-level one (got ${msg})`);
  const merged = mergeConfigPatch(stored, { limits: { setupScriptSeconds: 120 } });
  assert(merged.limits?.setupScriptSeconds === 120 && merged.locationMap?.["עמקים וטבריה"] === null, "a known PATCH merges over the stored config and keeps the rest");
  assert(refusal(flattenStoredConfig(stored)) === null, "a stored config, flattened, passes the strict schema (a re-save never breaks)");
});

check("verify-config: every key that was sent", () => {
  const stored = flattenStoredConfig({ fieldMappings: { ...base.fieldMappings, _meta: { ...base, fieldMappings: undefined, pageFlow: undefined, savedAt: "x" } }, pageFlow: base.pageFlow });
  assert(sentKeysNotStored(base, stored).length === 0, `everything stored: nothing named (got ${sentKeysNotStored(base, stored).join("; ")})`);
  const withoutMap: Record<string, unknown> = { ...stored };
  delete withoutMap.locationMap;
  const lost = sentKeysNotStored(base, withoutMap);
  assert(lost.length === 1 && lost[0].startsWith("$.fieldMappings._meta.locationMap:") && lost[0].endsWith("-> (absent)"), `Maof's case: the table sent and not stored is named (got ${lost.join("; ")})`);
  const changed = sentKeysNotStored({ ...base, fieldMappings: { title: { selector: "h3" } } }, stored);
  assert(changed.some((l) => l.startsWith("$.fieldMappings.title")), `a field stored differently is named (got ${changed.join("; ")})`);
  assert(sentKeysNotStored({ listingSelector: "", minPublishDate: undefined }, stored).length === 0, "an empty or absent value sends nothing to compare");
  const urls = sentKeysNotStored({ listingUrls: ["https://x.example"] }, { listingUrls: ["https://x.example/"] });
  assert(urls.length === 0, `listingUrls compared as the save stores them (got ${urls.join("; ")})`);
});

check("the wiring", () => {
  const route = readFileSync(join(__dirname, "..", "app", "api", "sites", "[id]", "config", "route.ts"), "utf8");
  assert(/parsed\.error\.issues\.map\(configIssueMessage\)/.test(route), "the PUT route states the issue through configIssueMessage");
  const patch = readFileSync(join(__dirname, "configPatch.ts"), "utf8");
  assert(/issues\.map\(configIssueMessage\)/.test(patch), "and so does the PATCH merge");
  assert(/const KNOWN_KEYS = new Set\(Object\.keys\(updateSiteConfigSchema\.shape\)\)/.test(patch), "whose known keys are the schema's own");
  const batch = readFileSync(join(__dirname, "..", "..", "scripts", "addsite-batch.ts"), "utf8");
  const verify = batch.slice(batch.indexOf("async function cmdVerifyConfig"), batch.indexOf("// Command: verify-jobids"));
  assert(/sentKeysNotStored\(sentBody, flattenStoredConfig\(/.test(verify), "verify-config compares the sent body with the stored config");
  assert(/const ok = [^;]*&& keysOk;/.test(verify), "and a key not stored fails the verdict");
});

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("configStrict: an unknown config key is a 400 naming it; verify-config compares every key sent");
