// Run: npx tsx scripts/lib/headOfficeAddress.test.ts
//
// Report fixes 3, item 14, the address half (the developer's 2026-10-21
// report, item 1, LRN-HQ-11): eladsoft.com's footer heads one block
// "מטה - תל אביב" and the next "סניף ירושלים". headOfficeBlock found the Tel
// Aviv block, its line was not read, and addressFrom then read the whole page
// and took the Jerusalem branch's street line as the head office.
//   - when a head-office block exists, the answer is its address or none;
//   - the block ends at the next office's heading;
//   - a P.O. box does not count against the compact line's word caps.

import { loadCityList } from "./city-csv";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const cities = loadCityList();

(async () => {
  const { addressFrom, extractCompactAddressLines } = await import("./company-extract");

  // eladsoft.com's footer as the page reads (GET, 2026-10-21).
  const ELADSOFT = [
    "מטה - תל אביב",
    "ראול ולנברג 18 א', בניין c, קומה 6 רמת החייל ת.ד. 58175, תל אביב",
    "972-73-2330-120+",
    "972-3-6498951+",
    "info@elad.co.il",
    "סניף ירושלים",
    "רחוב חפצדי 15 בניין דקסל, ירושלים",
    "972-73-2371170+",
  ].join("\n");
  const elad = addressFrom(ELADSOFT, cities);
  assert(elad === null || !/ירושלים/.test(elad), `eladsoft: never the Jerusalem branch (got ${JSON.stringify(elad)})`);

  // The branch's street line within five lines of the heading: the block ends at the branch.
  const close = "מטה - תל אביב\ninfo@x.co.il\nסניף ירושלים\nרחוב חפצדי 15, ירושלים";
  assert(addressFrom(close, cities) === null, `a branch heading ends the head-office block (got ${JSON.stringify(addressFrom(close, cities))})`);

  // A head-office block with an address: that address, not a later one.
  const both = "מטה החברה\nרחוב הברזל 3, תל אביב\nסניף חיפה\nרחוב הנמל 2, חיפה";
  assert(addressFrom(both, cities) === "רחוב הברזל 3, תל אביב", `the head office's own address (got ${JSON.stringify(addressFrom(both, cities))})`);

  // No head-office block: the whole page, as before.
  assert(addressFrom("צור קשר\nרחוב הנמל 2, חיפה", cities) === "רחוב הנמל 2, חיפה", "no block: the page's address");

  // The P.O. box's words are not counted: twelve words, ten once the box is gone.
  const poBox = "המלאכה 8 פארק אפק בניין B קומה 3 ת.ד. 2244, ראש העין";
  const compact = extractCompactAddressLines(poBox);
  assert(compact.length === 1 && !/ת\.ד/.test(compact[0]!), `a line over the cap only by its P.O. box is a candidate, box removed (got ${JSON.stringify(compact)})`);
  assert(addressFrom(`מטה\n${poBox}`, cities) !== null, `and gives the head office (got ${JSON.stringify(addressFrom(`מטה\n${poBox}`, cities))})`);
  assert(extractCompactAddressLines("המלאכה 8 פארק אפק בניין B קומה 3 אגף מזרחי ליד הכניסה, ראש העין").length === 0, "a line over the cap without a box still is not");

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("headOfficeAddress: a head-office block gives its own address or none; a branch ends it; a P.O. box is not counted");
})().catch((e) => {
  console.error(`FAIL: headOfficeAddress test threw — ${(e as Error).message}`);
  process.exit(1);
});
