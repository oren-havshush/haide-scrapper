// Run: npx tsx src/lib/siteLane.test.ts
//
// The lane flag (big-lane design, item 2): `lane: "big"` is a top-level config
// key stored as _meta.lane. The schema takes "big" or nothing; a PATCH that
// does not name it keeps it, and a PATCH with lane: null clears it; the save
// writes it; the sites table shows a badge.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { updateSiteConfigSchema } from "./validators";
import { mergeConfigPatch } from "./configPatch";
import { readSiteLane } from "./siteLane";

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

const base = { fieldMappings: {}, pageFlow: [], formCapture: null };

check("the schema", () => {
  const big = updateSiteConfigSchema.safeParse({ ...base, lane: "big" });
  assert(big.success && (big.data as { lane?: string }).lane === "big", "the schema accepts lane big and keeps it");
  assert(updateSiteConfigSchema.safeParse(base).success, "the schema accepts no lane");
  for (const bad of ["small", "", "BIG", true, 1]) {
    assert(!updateSiteConfigSchema.safeParse({ ...base, lane: bad }).success, `the schema refuses lane ${JSON.stringify(bad)}`);
  }
});

const storedBig = {
  fieldMappings: { title: { selector: "h2" }, _meta: { lane: "big", setupScript: "x()", savedAt: "2026-10-13T00:00:00.000Z" } },
  pageFlow: [],
};

check("a patch that does not name lane keeps it", () => {
  const merged = mergeConfigPatch(storedBig, { setupScript: "y()" }) as { lane?: string; setupScript?: string };
  assert(merged.lane === "big", `lane kept (got ${JSON.stringify(merged.lane)})`);
  assert(merged.setupScript === "y()", "and the named key changed");
});

check("a patch with lane null clears it", () => {
  const merged = mergeConfigPatch(storedBig, { lane: null }) as { lane?: string };
  assert(merged.lane === undefined, `lane cleared (got ${JSON.stringify(merged.lane)})`);
});

check("a patch sets it", () => {
  const stored = { fieldMappings: { title: { selector: "h2" } }, pageFlow: [] };
  const merged = mergeConfigPatch(stored, { lane: "big" }) as { lane?: string };
  assert(merged.lane === "big", `lane set (got ${JSON.stringify(merged.lane)})`);
  let refused = false;
  try {
    mergeConfigPatch(stored, { lane: "small" });
  } catch {
    refused = true;
  }
  assert(refused, "a patch with an unknown lane is refused");
});

check("readSiteLane", () => {
  assert(readSiteLane(storedBig.fieldMappings) === "big", "reads big");
  assert(readSiteLane({ _meta: { lane: "small" } }) === null, "an unknown value is the nightly");
  assert(readSiteLane({ _meta: {} }) === null, "absent is the nightly");
  assert(readSiteLane(null) === null, "no fieldMappings is the nightly");
});

const strip = (s: string) => s.replace(/\/\/[^\n]*/g, "");
const service = strip(readFileSync(join(__dirname, "..", "services", "siteService.ts"), "utf8"));
const saveBody = service.slice(service.indexOf("export async function saveSiteConfig"), service.indexOf("export async function createScrapeRun"));
assert(/lane:\s*config\.lane\s*\?\?\s*null/.test(saveBody), "saveSiteConfig writes _meta.lane from the top-level key");
assert(/lane\?:\s*SiteLane/.test(saveBody), "saveSiteConfig takes lane as a top-level param");

const table = readFileSync(join(__dirname, "..", "components", "sites", "SitesTable.tsx"), "utf8");
assert(/readSiteLane\(site\.fieldMappings\)/.test(table), "the sites table reads the lane");
assert(/big lane/.test(table), "the sites table shows a big lane badge");

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("siteLane: all passed");
