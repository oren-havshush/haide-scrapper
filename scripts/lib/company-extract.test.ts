// Run: npx tsx scripts/lib/company-extract.test.ts
//
// Cover for the deterministic extraction rules and the city gate. No browser,
// no network — every case is a hand-built PageHarvest, which is the whole point
// of keeping scripts/lib/company-extract.ts pure.
//
// The cases that matter most and are easiest to regress:
//   - an ATS careers host must NOT yield a homepage (deriving one from
//     comeet.com points every company hosted there at the vendor)
//   - "רחוב"/"אלון"/"מגדל" are REAL city.csv entries as well as ordinary
//     address words, so the city gate must not pull them out of a street line
//   - a logo candidate must never be an SVG or a favicon, both of which the
//     server-side gate rejects anyway

import assert from "node:assert/strict";
import {
  addressFromJsonLd,
  classifyProfileStatus,
  collectLogoCandidates,
  deriveHomepageCandidates,
  emptyHarvest,
  extractAboutText,
  extractAddressLine,
  extractLabelledAddress,
  extractLocationLines,
  pickPolicyUrl,
  homepageFromLinks,
  isAtsHost,
  parseJsonLdOrganization,
  pickAboutUrl,
  sanitizeModelText,
  type HarvestedLink,
  type PageHarvest,
} from "./company-extract";
import { loadCityList, matchCityInAddress, isKnownCity, parseCityCsv } from "./city-csv";

/** Line separator for multi-line fixtures. */
const NL = "\n";

// ---------------------------------------------------------------------------
// Homepage derivation
// ---------------------------------------------------------------------------

function testHomepageDerivation() {
  assert.deepEqual(deriveHomepageCandidates("https://careers.acme.co.il/jobs"), [
    "https://acme.co.il",
    "https://careers.acme.co.il",
  ]);

  // No careers subdomain — the origin is the only candidate.
  assert.deepEqual(deriveHomepageCandidates("https://acme.co.il/careers"), ["https://acme.co.il"]);

  // Stripping the subdomain must not leave a bare registry suffix.
  assert.deepEqual(deriveHomepageCandidates("https://jobs.co.il/list"), ["https://jobs.co.il"]);

  // ATS hosts yield nothing — this is the signal to fall back to page links.
  for (const url of [
    "https://acme.comeet.com/jobs/careers",
    "https://acme.wd3.myworkdayjobs.com/en-US/acme",
    "https://boards.greenhouse.io/acme",
    "https://app.civi.co.il/promos/id=123",
  ]) {
    assert.deepEqual(deriveHomepageCandidates(url), [], `expected no candidates for ${url}`);
  }

  // Junk in, empty out — never a throw.
  assert.deepEqual(deriveHomepageCandidates("not a url"), []);
  assert.deepEqual(deriveHomepageCandidates("javascript:alert(1)"), []);
  assert.deepEqual(deriveHomepageCandidates("file:///etc/passwd"), []);

  assert.equal(isAtsHost("acme.comeet.co"), true);
  assert.equal(isAtsHost("acme.co.il"), false);
}

function testHomepageFromLinks() {
  const careersUrl = "https://acme.comeet.com/jobs/careers";
  const links: HarvestedLink[] = [
    { href: "https://www.facebook.com/acme", text: "Facebook", inChrome: true },
    { href: "https://acme.comeet.com/jobs", text: "All jobs", inChrome: true },
    { href: "https://www.acme.co.il/", text: "אתר החברה", inChrome: true },
    { href: "https://www.acme.co.il/products", text: "מוצרים", inChrome: false },
  ];
  assert.equal(homepageFromLinks(links, careersUrl), "https://www.acme.co.il");

  // Social and same-host links alone leave nothing to pick.
  assert.equal(
    homepageFromLinks(
      [
        { href: "https://www.linkedin.com/company/acme", text: "LinkedIn", inChrome: true },
        { href: "https://acme.comeet.com/jobs", text: "Jobs", inChrome: true },
      ],
      careersUrl,
    ),
    null,
  );

  // A careers host that is a subdomain of the link host is the parent company.
  assert.equal(
    homepageFromLinks(
      [{ href: "https://acme.co.il/", text: "", inChrome: false }],
      "https://careers.acme.co.il/",
    ),
    "https://acme.co.il",
  );
}

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------

function testJsonLd() {
  const graph = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", name: "not this one" },
      {
        "@type": "Organization",
        name: "אקמה בעמ",
        url: "https://acme.co.il",
        logo: { "@type": "ImageObject", url: "https://acme.co.il/logo.png" },
        address: {
          "@type": "PostalAddress",
          streetAddress: "דרך מנחם בגין 132",
          addressLocality: "תל אביב",
          postalCode: "6701101",
        },
      },
    ],
  });

  const org = parseJsonLdOrganization([graph]);
  assert.ok(org, "expected an Organization from the @graph shape");
  assert.equal(org.name, "אקמה בעמ");
  assert.equal(org.logo, "https://acme.co.il/logo.png", "ImageObject logo must be unwrapped");
  assert.equal(addressFromJsonLd(org), "דרך מנחם בגין 132, תל אביב, 6701101");

  // A malformed block must be skipped, not thrown on, and a later good block
  // must still be found.
  const malformed = '{"@type": "Organization", "name": "broken",}';
  const good = JSON.stringify({ "@type": "Corporation", name: "ok", url: "https://ok.example" });
  const recovered = parseJsonLdOrganization([malformed, good]);
  assert.equal(recovered?.name, "ok");

  // No Organization anywhere -> null, not an empty object.
  assert.equal(parseJsonLdOrganization([JSON.stringify({ "@type": "WebPage" })]), null);
  assert.equal(parseJsonLdOrganization([]), null);
  assert.equal(addressFromJsonLd(null), null);
}

// ---------------------------------------------------------------------------
// About page + copy
// ---------------------------------------------------------------------------

function testAbout() {
  const pageUrl = "https://acme.co.il/";
  const links: HarvestedLink[] = [
    { href: "/blog/2024/about-our-new-office/", text: "About our new office", inChrome: false },
    { href: "https://he.wikipedia.org/wiki/acme", text: "אודות", inChrome: false },
    { href: "/about-us", text: "אודות", inChrome: true },
  ];
  assert.equal(pickAboutUrl(links, pageUrl), "https://acme.co.il/about-us");

  // Off-host "About" links are never the company's own copy.
  assert.equal(
    pickAboutUrl([{ href: "https://en.wikipedia.org/wiki/Acme", text: "About", inChrome: true }], pageUrl),
    null,
  );

  const prose =
    "אקמה בעמ הוקמה בשנת 1998 ומעסיקה כיום כמאתיים עובדים בישראל ובאירופה. " +
    "החברה מפתחת פתרונות תוכנה לניהול שרשרת אספקה עבור לקוחות תעשייתיים. " +
    "המשרדים הראשיים ממוקמים בתל אביב.";
  const menu = "בית מוצרים שירותים צור קשר קריירה";
  const cookies =
    "אנו משתמשים בקובצי cookie כדי לשפר את חוויית הגלישה שלך באתר זה ולהתאים עבורך תוכן ופרסום. " +
    "המשך הגלישה מהווה הסכמה לשימוש בקובצי cookie בהתאם למדיניות הפרטיות שלנו באתר.";

  assert.equal(extractAboutText([menu, cookies, prose].join("\n\n")), prose);

  // Verbatim from msh.co.il. It opens like ordinary prose, is LONGER than the
  // real about copy, and sits on every page of the site — so a prefix-only
  // boilerplate test picked it as the company description. Must lose to the
  // real prose even though it is longer, and must be rejected outright when it
  // is the only candidate.
  const consentBanner =
    "אתר זה עושה שימוש בטכנולוגיות איסוף מידע כגון עוגיות (Cookies), לרבות על ידי צדדים " +
    "שלישיים, כדי לספק לך חווית גלישה טובה יותר, וכן לניתוח השימוש ולצרכי פרסום מותאם. " +
    "המשך הגלישה מהווה את הסכמתך לשימוש זה. למידע נוסף, יש לעיין במדיניות הפרטיות המעודכנת";
  assert.ok(consentBanner.length > prose.length, "the banner must be the longer candidate");
  assert.equal(extractAboutText([consentBanner, prose].join("\n\n")), prose);
  assert.equal(extractAboutText(consentBanner), null);

  // Verbatim from bankhapoalim.co.il, whose homepage throws a client-side
  // exception under headless Chromium. It is 140 chars, has sentence
  // punctuation and no legal vocabulary, so every other filter passed it and
  // the bank was stored with a JavaScript crash as its description.
  const crashPage =
    "Application error: a client-side exception has occurred while loading " +
    "www.bankhapoalim.co.il (see the browser console for more information).";
  assert.equal(extractAboutText(crashPage), null, "a crash page is never company copy");
  assert.equal(extractAboutText([crashPage, prose].join("\n\n")), prose);

  for (const failure of [
    "404 Not Found. The page you requested could not be located on this server at all.",
    "Access Denied. Sorry, you do not have permission to view this page from your address.",
    "Please enable JavaScript to continue using this application and view all of its content.",
    "TypeError: undefined is not a function at renderPage (/app/main.js:42:17) during startup.",
  ]) {
    assert.equal(extractAboutText(failure), null, `error page not rejected: ${failure.slice(0, 40)}`);
  }

  // ...but ordinary prose that merely mentions errors must survive.
  const legitimate =
    "החברה מפתחת מערכות בקרת איכות המזהות שגיאות בקווי ייצור תעשייתיים בזמן אמת. " +
    "שיעור הטעויות במערכות שלנו נמוך מאחוז אחד, והלקוחות מדווחים על שיפור משמעותי.";
  assert.equal(extractAboutText(legitimate), legitimate, "prose mentioning errors must survive");

  // Footer legalese, likewise anywhere in the paragraph rather than at its head.
  assert.equal(
    extractAboutText(
      "החברה שלנו מספקת שירותי ייעוץ פיננסי ללקוחות פרטיים ומוסדיים בישראל מזה כשלושים שנה. " +
        "כל הזכויות שמורות לחברה בעמ 2026.",
    ),
    null,
  );

  // A menu-only page has no prose to offer.
  assert.equal(extractAboutText([menu, "קצר מדי"].join("\n\n")), null);
  assert.equal(extractAboutText(""), null);

  // Truncation keeps it under the cap and marks the cut.
  const long = `${"א".repeat(400)}. ${"ב".repeat(400)}. ${"ג".repeat(600)}.`;
  const truncated = extractAboutText(long, 200);
  assert.ok(truncated && truncated.length <= 201, "truncated copy must respect the cap");
  assert.ok(truncated?.endsWith("…"), "truncation must be visible");
}

// ---------------------------------------------------------------------------
// Address + the city gate
// ---------------------------------------------------------------------------

function testAddressAndCity() {
  assert.equal(
    extractAddressLine("צור קשר\nרחוב הרצל 12 תל אביב\nטלפון 03-1234567"),
    "רחוב הרצל 12 תל אביב",
  );
  assert.equal(extractAddressLine("8 Hamelacha Street, Rosh Haayin")?.startsWith("8 Hamelacha"), true);
  assert.equal(extractAddressLine("no address here at all"), null);
  assert.equal(extractAddressLine(""), null);

  // Verbatim from flying-cargo.com/privacy/. The real address has NO street
  // noun and NO house number, so the structural pattern cannot see it — only
  // the label does. The SAME page also labels a domain as an address, which is
  // why the caller gates candidates through city.csv rather than taking the
  // first one.
  // The gershayim are load-bearing: ראשל"צ is a LOCATION_ALIAS key, while a
  // quote-stripped "ראשלצ" resolves to nothing.
  const privacyText = [
    "מדיניות פרטיות",
    'האתר פליינג קרגו כתובת: Flying-cargo.com מופעל על ידי פליינג קרגו בע"מ.',
    'כתובת דואר בית העסק: תעשיות צריפין, ראשל"צ.',
  ].join("\n");

  const labelled = extractLabelledAddress(privacyText);
  assert.ok(
    labelled.some((c) => c.includes("תעשיות צריפין")),
    "the labelled postal address must be found",
  );

  // What the CLI actually does: keep the first candidate the city gate accepts.
  // This is the assertion that matters — the decoy line survives extraction (it
  // has trailing Hebrew, so it is not a bare domain), and the GATE is what
  // discards it.
  const gatedCities = loadCityList();
  const chosen = labelled.find((c) => matchCityInAddress(c, gatedCities));
  assert.ok(chosen?.includes("תעשיות צריפין"), `gate picked the wrong candidate: ${chosen}`);
  assert.ok(!chosen?.includes("Flying-cargo.com"), "the decoy domain line must not win");
  assert.equal(matchCityInAddress(chosen as string, gatedCities), "ראשון לציון");

  assert.deepEqual(extractLabelledAddress(""), []);
  assert.deepEqual(extractLabelledAddress("no label anywhere in this sentence."), []);

  // English label, and one that is really a URL.
  assert.deepEqual(extractLabelledAddress("Address: 4 Hasadnaot St, Herzliya"), [
    "4 Hasadnaot St, Herzliya",
  ]);
  assert.deepEqual(extractLabelledAddress("Address: https://example.com/contact"), []);

  // Policy-page discovery, the last-resort hop for an address.
  const policyPageUrl = "https://acme.co.il/";
  assert.equal(
    pickPolicyUrl(
      [
        { href: "/terms", text: "תנאי שימוש", inChrome: true },
        { href: "/privacy", text: "מדיניות פרטיות", inChrome: true },
      ],
      policyPageUrl,
    ),
    "https://acme.co.il/privacy",
    "privacy outranks terms — terms pages more often omit the address",
  );

  // A PDF policy needs a different reader than a page harvest.
  assert.equal(
    pickPolicyUrl([{ href: "/terms.pdf", text: "תנאי שימוש", inChrome: true }], policyPageUrl),
    null,
  );

  // Off-host and irrelevant links yield nothing.
  assert.equal(
    pickPolicyUrl(
      [
        { href: "https://other.example/privacy", text: "Privacy Policy", inChrome: true },
        { href: "/products", text: "מוצרים", inChrome: true },
      ],
      policyPageUrl,
    ),
    null,
  );

  // Location lines: a city is the field that matters, so it must be findable
  // without a street and number — but ONLY from lines that state a location.
  const located = extractLocationLines(
    ["בית", "מוצרים", "המשרדים שלנו ממוקמים בחיפה ובאזור הצפון.", "צור קשר"].join(NL),
  );
  assert.ok(located.some((l) => l.includes("חיפה")), "an HQ sentence must be offered");

  // The bankhapoalim trap: "בניה" is a real city.csv entry AND the ordinary
  // word for construction. As a bare menu item it carries no location marker,
  // so it must never even be offered to the gate.
  assert.deepEqual(
    extractLocationLines(["בניה ונדל\"ן", "משכנתאות", "פיקדונות"].join(NL)),
    [],
    "a menu item must not be treated as a location line",
  );

  // Verbatim from kley-zemer.co.il. Seven valid city.csv cities in one
  // sentence, and NONE of them may be stored: they are branches, the column is
  // companyHqCity, and taking one would mean recording whichever was listed
  // first. Standing product rule, confirmed 2026-08-26 after a manual check of
  // that site found it publishes no HQ address at all.
  const branchList =
    "כלי זמר, מונה כיום 21 סניפים, 8 בבעלות מלאה (תל אביב, רמת גן, חיפה, " +
    "ירושלים, ראשון לציון, באר שבע, פתח תקוה ו-KZPRO), ו-13 זכיינים.";
  assert.deepEqual(
    extractLocationLines(branchList),
    [],
    "a branch list must never be offered as an HQ location",
  );

  // A head-office sentence outranks a generic labelled line.
  const ordered = extractLocationLines(
    ["כתובת: רחוב כלשהו 5, אילת", "המשרד הראשי ממוקם בתל אביב"].join(NL),
  );
  assert.ok(ordered[0].includes("הראשי"), "head-office lines come first");

  const cities = loadCityList();

  // The header row must never be a legal city.
  assert.equal(isKnownCity("city", cities), false);

  // Real addresses resolve to the VERBATIM city.csv spelling.
  const cases: [string, string | null][] = [
    ["רחוב הרצל 12, תל אביב יפו", "תל אביב-יפו"],
    ["מגדל אלון, דרך מנחם בגין 132, תל-אביב", "תל אביב-יפו"],
    ["הר חוצבים, ירושלים 9777402", "ירושלים"],
    ["רחוב זבוטינסקי 35, רמת גן 5251108", "רמת גן"],
    ["8 Hamelacha St., Rosh Ha'ayin, Israel", "ראש העין"],
    // Inconsistent transliteration is the norm on Israeli sites, so one edit of
    // slack against the English table is what separates a city from a NULL.
    ["4 Hasadnaot St, Herzlia 46728 Israel", "הרצליה"],
    ["12 Hamelacha Street, Raanana", "רעננה"],
    // Off-list and abroad must be NULL, never a near-miss.
    ["Somewhere, Berlin, Germany", null],
    ["1 Main Street, Boston", null],
    ["", null],
    // A street line alone must not manufacture a city out of "רחוב"/"אלון",
    // both of which ARE real city.csv entries.
    ["רחוב 12", null],
  ];
  for (const [address, expected] of cases) {
    assert.equal(
      matchCityInAddress(address, cities),
      expected,
      `city gate mismatch for ${JSON.stringify(address)}`,
    );
  }

  // Whatever the gate returns must itself be on the list, always.
  for (const [address] of cases) {
    const city = matchCityInAddress(address, cities);
    if (city !== null) {
      assert.equal(isKnownCity(city, cities), true, `gate returned an off-list value: ${city}`);
    }
  }

  // Quoted gershayim names survive the RFC4180 parse as one value.
  const quoted = parseCityCsv('city\n"ביל""ו"\nחיפה\n');
  assert.equal(quoted.byNormalized.size, 2);
  assert.equal(isKnownCity('ביל"ו', quoted), true);
}

// ---------------------------------------------------------------------------
// Logo candidates
// ---------------------------------------------------------------------------

function testLogoCandidates() {
  const harvest: PageHarvest = {
    ...emptyHarvest("https://acme.co.il/"),
    metas: { "og:image": "https://acme.co.il/social-banner.jpg" },
    images: [
      { src: "/img/spacer.gif", alt: "", width: 1, height: 1, inHeader: true, context: "logo-bar" },
      { src: "/img/hero.jpg", alt: "hero", width: 1200, height: 400, inHeader: false, context: "hero" },
      { src: "/img/logo.png", alt: "לוגו אקמה", width: 180, height: 60, inHeader: true, context: "site-logo" },
      { src: "/img/logo.svg", alt: "logo", width: 180, height: 60, inHeader: true, context: "site-logo" },
    ],
  };

  const org = { logo: "https://cdn.acme.co.il/brand/logo-512.png" };
  const candidates = collectLogoCandidates(harvest, org);
  const urls = candidates.map((c) => c.url);

  assert.equal(urls[0], "https://cdn.acme.co.il/brand/logo-512.png", "JSON-LD logo must rank first");
  assert.ok(urls.includes("https://acme.co.il/img/logo.png"), "header logo must be a candidate");
  assert.ok(!urls.some((u) => u.endsWith(".svg")), "SVG is rejected at the gate — never propose it");
  assert.ok(!urls.includes("https://acme.co.il/img/hero.jpg"), "non-logo images must not be proposed");

  // The 1x1 spacer is scored below og:image rather than ranked as a logo.
  const spacerIndex = urls.indexOf("https://acme.co.il/img/spacer.gif");
  const ogIndex = urls.indexOf("https://acme.co.il/social-banner.jpg");
  assert.ok(spacerIndex === -1 || spacerIndex > ogIndex, "a 1x1 spacer must not outrank og:image");

  // Nothing to offer -> empty list, not a throw.
  assert.deepEqual(collectLogoCandidates(emptyHarvest("https://acme.co.il/"), null), []);

  // Verbatim from bankhapoalim.co.il: the Butterfly accessibility widget's own
  // branded image, in the header, correctly sized, with "logo" in the filename.
  // It is indistinguishable from a real logo except by host, and it WON before
  // this rule — the bank's profile came out carrying a vendor's butterfly.
  const widgetOnly: PageHarvest = {
    ...emptyHarvest("https://www.bankhapoalim.co.il/"),
    images: [
      {
        src: "https://butterfly-button.web.app/img/butterfly-logo-200.png",
        alt: "לוגו",
        width: 200,
        height: 200,
        inHeader: true,
        context: "butterfly-logo",
      },
    ],
  };
  assert.deepEqual(
    collectLogoCandidates(widgetOnly, null),
    [],
    "an accessibility-widget logo must never be proposed",
  );

  // A rasterised inline <svg> outranks every <img> but not the company's own
  // JSON-LD claim, and its data: URL must survive the host-based rules that
  // would otherwise reject it (a data: URL has no hostname to test).
  const withInline: PageHarvest = {
    ...emptyHarvest("https://acme.co.il/"),
    images: [
      { src: "/img/logo.png", alt: "logo", width: 180, height: 60, inHeader: true, context: "site-logo" },
    ],
    inlineLogos: [
      { dataUrl: "data:image/png;base64,AAAA", pathCount: 3, area: 3621 },
    ],
  };
  const ranked = collectLogoCandidates(withInline, { logo: "https://acme.co.il/brand.png" });
  assert.equal(ranked[0].url, "https://acme.co.il/brand.png", "JSON-LD still wins");
  assert.equal(ranked[1].source, "inline-svg", "inline svg outranks a header <img>");
  assert.equal(ranked[1].url, "data:image/png;base64,AAAA", "the data URL must pass through intact");

  // With no JSON-LD claim it takes the top slot outright.
  assert.equal(collectLogoCandidates(withInline, null)[0].source, "inline-svg");

  // Verbatim shape from flying-cargo.com: a bare 3-path glyph in the header and
  // the 14-path lockup (glyph + "FLYING CARGO" wordmark) in the footer, both
  // inside a[href="/"]. They tie on every other signal, so before richness
  // ordering the winner was decided by document order — and document order
  // picked the one WITHOUT the company name on it.
  const glyphThenLockup: PageHarvest = {
    ...emptyHarvest("https://www.flying-cargo.com/"),
    inlineLogos: [
      { dataUrl: "data:image/png;base64,GLYPH", pathCount: 3, area: 3621 },
      { dataUrl: "data:image/png;base64,LOCKUP", pathCount: 14, area: 12087 },
    ],
  };
  assert.equal(
    collectLogoCandidates(glyphThenLockup, null)[0].url,
    "data:image/png;base64,LOCKUP",
    "the richer lockup must beat a bare glyph regardless of document order",
  );

  // The company's own host outranks an equally-scored third-party CDN image.
  const mixed: PageHarvest = {
    ...emptyHarvest("https://acme.co.il/"),
    images: [
      { src: "https://cdn.example.net/logo.png", alt: "logo", width: 200, height: 80, inHeader: true, context: "logo" },
      { src: "https://acme.co.il/logo.png", alt: "logo", width: 200, height: 80, inHeader: true, context: "logo" },
    ],
  };
  assert.equal(
    collectLogoCandidates(mixed, null)[0].url,
    "https://acme.co.il/logo.png",
    "a same-domain logo must outrank a third-party one",
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

function testModelOutputSanitising() {
  // Markup must never survive — companyAbout may be rendered unescaped.
  assert.equal(
    sanitizeModelText("<script>alert(1)</script>אקמה בעמ מפתחת תוכנה.", 600),
    "alert(1) אקמה בעמ מפתחת תוכנה.",
  );
  assert.equal(sanitizeModelText("<b>bold</b> text", 600), "bold text");

  // The model returns these as STRINGS rather than JSON null often enough that
  // storing them would put "N/A" on the public site.
  for (const value of ["null", "NULL", "N/A", "n/a", "none", "unknown", "לא ידוע", "אין מידע"]) {
    assert.equal(sanitizeModelText(value, 600), null, `${value} must be treated as absent`);
  }

  // Non-strings, empty and whitespace-only all mean absent.
  assert.equal(sanitizeModelText(null, 600), null);
  assert.equal(sanitizeModelText(42, 600), null);
  assert.equal(sanitizeModelText(undefined, 600), null);
  assert.equal(sanitizeModelText("   ", 600), null);

  // Wrapping quotes the model likes to add are stripped.
  assert.equal(sanitizeModelText('"אקמה בעמ."', 600), "אקמה בעמ.");

  // The cap is enforced and the cut is visible.
  const long = sanitizeModelText("א".repeat(900), 100);
  assert.ok(long && long.length <= 101 && long.endsWith("…"));
}

function testStatus() {
  assert.equal(
    classifyProfileStatus({
      companyHomepageUrl: "https://acme.co.il",
      companyAbout: "copy",
      companyLogoPath: "/logos/x.png",
      companyHqAddress: null,
      companyHqCity: null,
    }),
    "COMPLETE",
    "a missing HQ address must not hold the status at PARTIAL",
  );

  assert.equal(
    classifyProfileStatus({
      companyHomepageUrl: "https://acme.co.il",
      companyAbout: null,
      companyLogoPath: null,
      companyHqAddress: null,
      companyHqCity: null,
    }),
    "PARTIAL",
  );

  assert.equal(
    classifyProfileStatus({
      companyHomepageUrl: null,
      companyAbout: null,
      companyLogoPath: null,
      companyHqAddress: null,
      companyHqCity: null,
    }),
    "FAILED",
  );
}

function main() {
  testHomepageDerivation();
  testHomepageFromLinks();
  testJsonLd();
  testAbout();
  testAddressAndCity();
  testLogoCandidates();
  testModelOutputSanitising();
  testStatus();
  console.log(
    "PASS: company-profile extraction (homepage, JSON-LD, about, address+city gate, logo, status)",
  );
}

main();
