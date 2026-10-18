// Run: npx tsx scripts/lib/addressRules.test.ts
//
// The company-profile address (developer's report 2026-10-18, item 3): a
// history-timeline line (m-pines.com), a P.O. box kept in a JSON-LD address
// (cet.ac.il), and a branch block taken over the head office's (brooks-keret).
//   - a line that opens with a year or a year range is never an address;
//   - the P.O.-box strip runs on every path that returns an address;
//   - among several office blocks, the one headed מטה or הנהלה is tried first.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addressFromJsonLd,
  extractAddressLine,
  extractCompactAddressLines,
  extractLabelledAddress,
  headOfficeBlock,
  startsWithYear,
} from "./company-extract";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

// m-pines: the timeline line is rejected on every scanning path.
{
  const timeline = "1998-2004 המפעל עבר לרחוב התעשייה 12 כרמיאל\n2010 כתובת: רחוב הברזל 3, תל אביב\n2015 הקמת סניף, 4, חיפה";
  assert(extractAddressLine(timeline) === null, `a year-led street line is not an address (got ${JSON.stringify(extractAddressLine(timeline))})`);
  assert(extractLabelledAddress(timeline).length === 0, `a year-led labelled line is not an address (got ${JSON.stringify(extractLabelledAddress(timeline))})`);
  assert(extractCompactAddressLines(timeline).length === 0, `a year-led compact line is not an address (got ${JSON.stringify(extractCompactAddressLines(timeline))})`);
  const page = timeline + "\nרחוב המלאכה 7, כרמיאל";
  assert(extractAddressLine(page) === "רחוב המלאכה 7, כרמיאל", `the real address after the timeline is still found (got ${JSON.stringify(extractAddressLine(page))})`);
  assert(startsWithYear("1998 – 2004 הקמה") && startsWithYear("2023") && !startsWithYear("20 רחוב הרצל") && !startsWithYear("19000 שקל"), "the year rule reads 19xx/20xx and ranges only");
}

// cet: the P.O. box is stripped from a JSON-LD address, and from the scanned paths.
{
  const cet = addressFromJsonLd({ streetAddress: "קלאוזנר 16, ת.ד. 39513", addressLocality: "תל אביב", postalCode: "6139401" } as Parameters<typeof addressFromJsonLd>[0]);
  assert(cet === "קלאוזנר 16, תל אביב, 6139401", `JSON-LD: the P.O. box is dropped (got ${JSON.stringify(cet)})`);
  const poOnly = addressFromJsonLd({ streetAddress: "P.O.B 7551" } as Parameters<typeof addressFromJsonLd>[0]);
  assert(poOnly === null, `JSON-LD that is only a P.O. box gives no address (got ${JSON.stringify(poOnly)})`);
  assert(extractAddressLine("רחוב הנביאים 4, ת.ד. 1234, ירושלים") === "רחוב הנביאים 4, ירושלים", `address line: the P.O. box is dropped (got ${JSON.stringify(extractAddressLine("רחוב הנביאים 4, ת.ד. 1234, ירושלים"))})`);
  const labelled = extractLabelledAddress("כתובת: שד' רוטשילד 10, ת\"ד 555, תל אביב");
  assert(labelled[0] === "שד' רוטשילד 10, תל אביב", `labelled: the P.O. box is dropped (got ${JSON.stringify(labelled)})`);
}

// brooks-keret: the מטה block is chosen over the דרום one before it.
{
  const page = [
    "המשרדים שלנו",
    "דרום",
    "רחוב העצמאות 40, באר שבע",
    "טל' 08-6000000",
    "מטה",
    "רחוב הברזל 3, תל אביב",
    "טל' 03-5000000",
  ].join("\n");
  assert(extractAddressLine(page) === "רחוב העצמאות 40, באר שבע", "without the block rule the first (דרום) address is found");
  const block = headOfficeBlock(page);
  assert(block !== null && extractAddressLine(block) === "רחוב הברזל 3, תל אביב", `the מטה block gives the head office's address (got ${JSON.stringify(block && extractAddressLine(block))})`);
  assert(extractAddressLine(headOfficeBlock("משרדי ההנהלה\nדרך מנחם בגין 12, רמת גן")!) === "דרך מנחם בגין 12, רמת גן", "a הנהלה heading counts");
  assert(headOfficeBlock("גללו למטה לפרטים\nרחוב הרצל 1, חיפה") === null, "\"למטה\" in prose is not a heading");
  assert(headOfficeBlock("צפון\nרחוב הנמל 2, חיפה") === null, "a regional heading alone is no head-office block");
}

// company-profile.ts: addressFrom tries the head-office block before the whole text.
{
  const src = readFileSync(join(__dirname, "..", "company-profile.ts"), "utf8");
  const start = src.indexOf("function addressFrom(");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert(/const head = headOfficeBlock\(text\);/.test(body) && /addressFromText\(head, cities\)/.test(body), "addressFrom tries the head-office block first");
  assert(/return addressFromText\(text, cities\);/.test(body), "then the whole text");
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("addressRules: no year-led address, no P.O. box on any path, the מטה block first");
