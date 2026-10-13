// Run: npx tsx scripts/placeRegion.test.ts
//
// scripts/place-region.ts proposes a region for a place, with its evidence,
// and never writes (city-file design item 4, commit E): the council's majority
// with its share; else the sub-district by the table, except the split ones,
// which ask; else "propose from knowledge".

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { proposeRegion, readAuthority, SUB_DISTRICT_REGION } from "./place-region";

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

const cityCsv = [
  "city,region,kind",
  "אזור שפלה,,region",
  "אזור מרכז,,region",
  "אזור צפון,,region",
  "אזור רמת הגולן,,region",
  "כרמי יוסף,אזור שפלה,moshav",
  "סתריה,אזור שפלה,moshav",
  "פדיה,אזור שפלה,moshav",
  "גני הדר,אזור מרכז,moshav",
  "עמיר,אזור רמת הגולן,kibbutz",
  "ראש פינה,אזור צפון,town",
  "חולון,אזור מרכז,town",
  "",
].join("\n");
const authority = readAuthority(
  [
    "# fixture",
    "code,name,sub_district,council",
    "1,כרמי יוסף,רמלה,גזר",
    "2,סתריה,רמלה,גזר",
    "3,פדיה,רמלה,גזר",
    "4,גני הדר,רמלה,גזר",
    "5,משמר דוד,רמלה,גזר",
    "6,עמיר,צפת,הגליל העליון",
    "7,ראש פינה,צפת,",
    "8,חצור הגלילית,צפת,",
    "9,עזריקם,צפת,מבואות",
    "10,חולון,חולון,",
    "11,אזור,חולון,",
    "12,ראשונה,צפת,מבואות",
    "",
  ].join("\n"),
);
const cbsCsv = ["# fixture", "code,name,district,sub_district,type,council", "5,משמר דוד,המרכז,רמלה,330,", "8,חצור הגלילית,הצפון,צפת,170,", ""].join("\n");
const data = { cityCsv, authority, cbsCsv };

check("the council's majority, with its share", () => {
  const p = proposeRegion("משמר דוד", data);
  assert(p.region === "אזור שפלה", `proposes אזור שפלה (got ${p.region})`);
  assert(p.kind === "kibbutz", `kind from the bureau's type 330 (got ${p.kind})`);
  assert(p.evidence.some((e) => /council גזר: 3 of 4 places אזור שפלה \(75%\)/.test(e)), `the share is shown (got ${JSON.stringify(p.evidence)})`);
});

check("a split sub-district with no council asks", () => {
  const p = proposeRegion("חצור הגלילית", data);
  assert(p.region === null, `no proposal (got ${p.region})`);
  assert(p.evidence.some((e) => /sub-district צפת is split/.test(e) && /a person decides/.test(e)), `says so, with its counts (got ${JSON.stringify(p.evidence)})`);
});

check("a council with no majority asks", () => {
  // Council מבואות: ראשונה under אזור צפון, כפר בלום under אזור רמת הגולן, one each.
  const split = {
    ...data,
    cityCsv: cityCsv.replace("ראש פינה,אזור צפון,town", "ראשונה,אזור צפון,town\nכפר בלום,אזור רמת הגולן,kibbutz\nראש פינה,אזור צפון,town"),
    authority: [...authority, { code: "13", name: "כפר בלום", sub_district: "צפת", council: "מבואות" }],
  };
  const p = proposeRegion("עזריקם", split);
  assert(p.region === null, `no proposal on a tie (got ${p.region})`);
  assert(p.evidence.some((e) => /council מבואות is split: /.test(e) && /a person decides/.test(e)), `shows both counts and asks (got ${JSON.stringify(p.evidence)})`);
});

check("a sub-district in the table answers, with its share", () => {
  const p = proposeRegion("אזור", data);
  assert(p.region === "אזור מרכז", `חולון's sub-district is אזור מרכז (got ${p.region})`);
});

check("a name no list has: propose from knowledge", () => {
  const p = proposeRegion("אזור תעשיה ציפורית", data);
  assert(p.region === null && p.evidence.some((e) => /not a listed settlement: propose from knowledge/.test(e)), `the line (got ${JSON.stringify(p.evidence)})`);
});

check("the table marks the six split sub-districts", () => {
  for (const s of ["צפת", "חדרה", "פתח תקווה", "רמלה", "אשקלון", "באר שבע"]) {
    assert(SUB_DISTRICT_REGION[s] === "split", `${s} is split`);
  }
});

check("it never writes", () => {
  const src = readFileSync(join(__dirname, "place-region.ts"), "utf8");
  for (const w of ["writeFileSync", "appendFileSync", "writeFile(", "createWriteStream", "prisma", "fetch("]) {
    assert(!src.includes(w), `place-region.ts has no ${w}`);
  }
});

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("placeRegion: all assertions passed");
