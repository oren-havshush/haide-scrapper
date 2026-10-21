// Run: npx tsx scripts/lib/englishCities.test.ts
//
// Report fixes 3, item 16a (the developer's 2026-10-21 report, item 8):
// il.att.com prints only "2 Negev Street, Airport City 7010000, Israel", and
// the city gate compared Hebrew names only, so no HQ city was found although
// איירפורט סיטי is a city.csv row. An English-name table (scripts/lib/city-csv.ts
// ADDRESS_CITY_EN) maps each name to its verbatim city.csv value, and is used
// only by matchCityInAddress, only on a Latin-script address; a name not in the
// table is not matched. Seeded with the names in the reports (Airport City,
// Tel Aviv, Givat Shmuel) and the twenty largest cities.

import { isKnownCity, loadCityList, matchCityInAddress } from "./city-csv";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const cities = loadCityList();

(async () => {
  const { ADDRESS_CITY_EN } = await import("./city-csv");
  const table = ADDRESS_CITY_EN as Readonly<Record<string, string>> | undefined;
  assert(!!table && Object.keys(table).length >= 23, `the table exists with the seeds and the twenty largest cities (got ${table ? Object.keys(table).length : 0})`);
  for (const [en, he] of Object.entries(table ?? {})) {
    assert(isKnownCity(he, cities), `${en} -> ${he} is verbatim on city.csv`);
    assert(en === en.toLowerCase().trim(), `${en}: keys are lower case`);
  }

  const cases: Array<[string, string | null]> = [
    // The reports' addresses, as printed.
    ["2 Negev Street, Airport City 7010000, Israel", "איירפורט סיטי"],
    ["2 Rechavam Zeevi St. Givat Shmuel 5401852", "גבעת שמואל"],
    ["Derech Menachem Begin 132, Tel Aviv-Yafo, Israel", "תל אביב-יפו"],
    ["Yigal Alon 94, Tel Aviv", "תל אביב-יפו"],
    ["5 HaBarzel St., Ramat Gan 5252247", "רמת גן"],
    ["Beit Shemesh, Israel", "בית שמש"],
    ["10 HaTavor St., Bat Yam", "בת-ים"],
    ["Hamada 7, Rehovot", "רחובות"],
    ["Har Hotzvim, Jerusalem 9777603", "ירושלים"],
    // The vocabulary's English names are in the table too: what resolved before still does.
    ["Pessach Lev 5 st, Lod, Israel", "רמלה לוד"],
    ["8 Hamelacha St., Rosh Ha'ayin, Israel", "ראש העין"],
    ["12 Hamelacha Street, Raanana", "רעננה"],
    ["4 Hasadnaot St, Herzlia 46728 Israel", "הרצליה"],
    // Not in the table: not matched. "Yokneam Illit" is another place than Yokneam,
    // and a one-letter variant is no longer guessed.
    ["12 Hamelacha St., Yokneam Illit", null],
    ["3 Hamada St., Yoqneam", null],
    // Abroad and off-list.
    ["1 Main Street, Boston", null],
    ["Somewhere, Berlin, Germany", null],
    // A street that merely contains a city's English name is not the city.
    ["12 Haifa Road, Somewhere", null],
    // Hebrew addresses keep the Hebrew rules.
    ["רחוב הברזל 3, תל אביב", "תל אביב-יפו"],
    ["2 Negev Street, איירפורט סיטי", "איירפורט סיטי"],
  ];
  for (const [address, want] of cases) {
    const got = matchCityInAddress(address, cities);
    assert(got === want, `${JSON.stringify(address)} -> ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    if (got !== null) assert(isKnownCity(got, cities), `off-list value: ${got}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("englishCities: a Latin address finds its city only through the table, verbatim on city.csv");
})().catch((e) => {
  console.error(`FAIL: englishCities test threw — ${(e as Error).message}`);
  process.exit(1);
});
