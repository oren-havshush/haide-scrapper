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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addressFromJsonLd,
  classifyProfileStatus,
  collectLogoCandidates,
  deriveHomepageCandidates,
  emptyHarvest,
  extractAboutText,
  extractAddressLine,
  extractCompactAddressLines,
  extractLabelledAddress,
  extractOfficeListRuns,
  pickPolicyUrl,
  homepageFromLinks,
  homepageFromOgUrl,
  isBotChallengePage,
  isAtsHost,
  parseJsonLdOrganization,
  pickAboutUrl,
  pickContactUrl,
  pickDirectionsUrl,
  sanitizeModelText,
  inlineLogoRejection,
  isHomeLink,
  logoPlacementRejection,
  isWidgetHost,
  modelAboutRejection,
  modelAboutGrounding,
  modelAddressUsable,
  stripPoBox,
  compactAddressAnchored,
  type HarvestedLink,
  type InlineLogo,
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

  // ישראייר's careers page is https://lp.vp4.me/foma, a landing page on Smoove's
  // host (vp4.me redirects to smoove.io). Derived as the employer's homepage, it
  // gave the 2026-10-05 dry run Smoove's about text, address, city and logo.
  assert.deepEqual(deriveHomepageCandidates("https://lp.vp4.me/foma"), [], "lp.vp4.me is Smoove's, not the employer's");
  for (const host of ["lp.vp4.me", "vp4.me", "www.smoove.io", "smoove.io"]) {
    assert.equal(isAtsHost(host), true, `${host} is a vendor host`);
  }
  assert.equal(isAtsHost("notvp4.me"), false, "only vp4.me itself and its subdomains");
  assert.equal(
    homepageFromLinks([{ href: "https://www.smoove.io/he/", text: "smoove", inChrome: true }], "https://lp.vp4.me/foma"),
    null,
    "a link to smoove.io is never the employer's homepage",
  );
  assert.equal(homepageFromOgUrl("https://www.smoove.io/he/", "https://lp.vp4.me/foma"), null, "nor is an og:url on smoove.io");
}

/**
 * og:url as a homepage candidate. This path was UNGATED and let a careers-board
 * vendor be stored as the employer.
 */
/**
 * A bot CHALLENGE clears on retry; a REFUSAL does not. Getting this wrong in
 * either direction costs: retrying a refusal wastes a page load, and not
 * retrying a challenge discards the page entirely.
 */
function testBotChallengePage() {
  // Verbatim titles. fritz.co.il serves the Hebrew one on the first navigation
  // in a fresh context, then 200s on the next.
  assert.equal(isBotChallengePage(403, "רק רגע..."), true);
  assert.equal(isBotChallengePage(403, "Just a moment..."), true);
  assert.equal(isBotChallengePage(503, "Just a moment..."), true);
  assert.equal(isBotChallengePage(403, "Attention Required! | Cloudflare"), true);
  assert.equal(isBotChallengePage(403, "Checking your browser before accessing"), true);

  // msh.co.il answers headless Chromium with a 403 titled "access denied".
  // That is a refusal, not a challenge — retrying it must never happen.
  assert.equal(
    isBotChallengePage(403, "הגישה נדחתה"),
    false,
    "an access-denied page is a refusal, not a clearing challenge",
  );

  // A real answer is never a challenge, whatever it is titled.
  assert.equal(isBotChallengePage(404, "Just a moment..."), false);
  assert.equal(isBotChallengePage(200, "Just a moment..."), false);
  assert.equal(isBotChallengePage(500, "Just a moment..."), false);
  assert.equal(isBotChallengePage(403, "Fritz | פריץ"), false);
  assert.equal(isBotChallengePage(403, ""), false);
}

function testHomepageFromOgUrl() {
  testBotChallengePage();

  // Verbatim from מנועי בית שמש. The board is hosted BY comeet, so the page's
  // own og:url is the vendor — which was captured as the company's homepage,
  // logo and about copy before this gate existed.
  assert.equal(
    homepageFromOgUrl("https://www.comeet.com", "https://www.comeet.com/jobs/betshemeshengines/1A.002"),
    null,
    "a vendor's own og:url must never become the employer's homepage",
  );

  // Every other refused host class, for the same reason.
  const careers = "https://acme.comeet.com/jobs/careers";
  assert.equal(homepageFromOgUrl("https://acme.wd3.myworkdayjobs.com/acme", careers), null);
  assert.equal(homepageFromOgUrl("https://www.linkedin.com/company/acme", careers), null);
  assert.equal(homepageFromOgUrl("https://www.nagish.li/", careers), null);

  // Same host as the careers page points back at the board — useless.
  assert.equal(homepageFromOgUrl("https://acme.comeet.com/about", careers), null);

  // The legitimate case still works, and yields an ORIGIN, not the full URL.
  assert.equal(
    homepageFromOgUrl("https://www.acme.co.il/careers/", careers),
    "https://www.acme.co.il",
  );

  // Junk in, null out — never a throw.
  assert.equal(homepageFromOgUrl(undefined, careers), null);
  assert.equal(homepageFromOgUrl("", careers), null);
  assert.equal(homepageFromOgUrl("not a url", careers), null);
  assert.equal(homepageFromOgUrl("javascript:alert(1)", careers), null);
  assert.equal(homepageFromOgUrl("https://www.acme.co.il/", "not a url"), null);
}

function testHomepageFromLinks() {
  testHomepageFromOgUrl();

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

  // Verbatim from natali: its careers page is on an ATS host, so the homepage
  // falls back to page links — and the "נגיש לי" accessibility widget linked in
  // the chrome won, dragging that vendor's about copy AND logo in as the
  // company's own. A vendor host is never the employer.
  assert.equal(
    homepageFromLinks(
      [
        { href: "http://www.nagish.li", text: "נגישות", inChrome: true },
        { href: "https://www.userway.org", text: "Accessibility", inChrome: true },
      ],
      "https://app.civi.co.il/promos/id=Y5499HHEL5",
    ),
    null,
    "an accessibility-widget vendor must never be taken as the company homepage",
  );

  // Blocking the widget host alone was NOT enough: natali then picked
  // localize.co.il, the vendor's parent company, which is an ordinary external
  // link in the chrome. An external chrome link is not evidence of ownership.
  assert.equal(
    homepageFromLinks(
      [
        { href: "https://www.localize.co.il/", text: "לוקלייז", inChrome: true },
        { href: "https://some-partner.example/", text: "שותפים", inChrome: true },
      ],
      "https://app.civi.co.il/promos/id=Y5499HHEL5",
    ),
    null,
    "an unrelated external chrome link must not become the company homepage",
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

  // sii.org.il, verbatim (Organization node of its @graph): every Hebrew field
  // is HTML-entity-encoded INSIDE the JSON. Taken as-is, the 2026-10-05 dry run
  // would have stored "&#x5E8;&#x5D7;…" as the HQ address, and the city gate
  // could not read a city out of it.
  const sii = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://www.sii.org.il/#organization",
        name: "&#x5DE;&#x5DB;&#x5D5;&#x5DF; &#x5D4;&#x5EA;&#x5E7;&#x5E0;&#x5D9;&#x5DD; &#x5D4;&#x5D9;&#x5E9;&#x5E8;&#x5D0;&#x5DC;&#x5D9;",
        alternateName: "SII",
        url: "https://www.sii.org.il",
        logo: { "@type": "ImageObject", url: "https://www.sii.org.il/assets/icons/logo.svg", width: 200, height: 60 },
        address: {
          "@type": "PostalAddress",
          streetAddress: "&#x5E8;&#x5D7;&#x5D5;&#x5D1; &#x5D7;&#x5D9;&#x5D9;&#x5DD; &#x5DC;&#x5D1;&#x5E0;&#x5D5;&#x5DF; 42",
          addressLocality: "&#x5EA;&#x5DC; &#x5D0;&#x5D1;&#x5D9;&#x5D1;",
          postalCode: "6997701",
          addressCountry: "IL",
        },
      },
    ],
  });
  const siiOrg = parseJsonLdOrganization([sii]);
  assert.equal(siiOrg?.name, "מכון התקנים הישראלי", "the name is decoded");
  assert.equal(addressFromJsonLd(siiOrg), "רחוב חיים לבנון 42, תל אביב, 6997701", "the address is decoded");
  assert.equal(siiOrg?.addressLocality, "תל אביב", "so the locality can reach the city gate");
  // Decimal references, the named ones JSON-LD writers emit, and one pass only:
  // "&amp;#x5E8;" is the literal text "&#x5E8;", not a letter.
  const named = parseJsonLdOrganization([
    JSON.stringify({ "@type": "Organization", name: "&#1488;&#1489; &amp; &quot;שות&apos;&quot; &lt;בע&quot;מ&gt;&nbsp;x &amp;#x5E8;" }),
  ]);
  assert.equal(named?.name, `אב & "שות'" <בע"מ> x &#x5E8;`, "decimal and named references decoded once");
  assert.equal(
    parseJsonLdOrganization([JSON.stringify({ "@type": "Organization", name: "&#xD800; &#x110000; &bogus;" })])?.name,
    "&#xD800; &#x110000; &bogus;",
    "an invalid or unknown reference is left as written",
  );

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

  testContactUrl();
}

/**
 * The directions page counts as a contact page. Verbatim from מוזיאון ישראל,
 * which publishes no address on any page matching the old keywords.
 */
/**
 * The office list. Verbatim line shapes from personetics.com/contact-us/, which
 * publishes no address anywhere and so had no city at all.
 */
function testOfficeListRuns() {
  const contact = [
    "Contact Us",
    "hr@personetics.com",
    "Our Offices",
    "Singapore",
    "Tel Aviv",
    "New York",
    "Paris",
    "Berlin",
    "London",
    "Sydney",
    "Hong Kong",
    "Ready to Take Your Financial Institution to the Next Level?",
  ].join(NL);

  const runs = extractOfficeListRuns(contact);
  assert.equal(runs.length, 1, "expected exactly one run of place-name lines");
  // "Contact Us" is a run of ONE — the email address below it breaks the run —
  // so it never reaches the three-line floor. The heading "Our Offices" does
  // ride along with the list; it is not a city, so it costs nothing.
  assert.deepEqual(runs[0], [
    "Our Offices",
    "Singapore",
    "Tel Aviv",
    "New York",
    "Paris",
    "Berlin",
    "London",
    "Sydney",
    "Hong Kong",
  ]);
  // The email breaks the run, and the closing sentence is too long to join it —
  // which is what keeps the run to lines that are only names.
  assert.ok(!runs[0].includes("hr@personetics.com"));

  // A nav menu is the same SHAPE and must still be harmless. It yields a run,
  // and the caller's "exactly one city.csv hit" rule is what rejects it — none
  // of these is a city, so there is no hit to be had.
  const nav = ["Products", "Act", "Enrich", "Engage", "Solutions"].join(NL);
  const navRuns = extractOfficeListRuns(nav);
  assert.equal(navRuns.length, 1, "a nav menu looks identical and must reach the gate, not bypass it");

  // Fewer than three consecutive names is not a list. Two capitalised lines in
  // a row is ordinary footer chrome.
  assert.deepEqual(extractOfficeListRuns(["Careers", "Contact us"].join(NL)), []);

  // Hebrew is refused outright: the Hebrew prose scanner was removed for
  // reading city names out of the middle of longer words.
  assert.deepEqual(extractOfficeListRuns(["תל אביב", "חיפה", "ירושלים"].join(NL)), []);

  // Digits mean an address line or a phone number, not a bare place name.
  assert.deepEqual(extractOfficeListRuns(["Tel Aviv 5", "New York 3", "Paris 1"].join(NL)), []);

  // A run must survive a blank line breaking it in two.
  assert.deepEqual(
    extractOfficeListRuns(["Singapore", "Tel Aviv", "", "New York", "Paris"].join(NL)),
    [],
    "a blank line ends a run, and neither half reaches three",
  );

  assert.deepEqual(extractOfficeListRuns(""), []);
}

function testDirectionsUrl() {
  // Verbatim from heara.co.il's navigation. The address lives ONLY on /107867/map;
  // the contact page lists phone numbers. pickContactUrl() resolved to the contact
  // page and the capture stored no address.
  const heara = "https://www.heara.co.il/107867/";
  const map = "https://www.heara.co.il/107867/map";
  const sitemap = "https://www.heara.co.il/site/detail/siteMap/index.asp?depart_id=107867";
  const starMap = "https://www.heara.co.il/107867/%D7%9E%D7%A4%D7%AA-%D7%9B%D7%95%D7%9B%D7%91%D7%99%D7%9D";
  const links: HarvestedLink[] = [
    { href: "https://www.heara.co.il/107867/contact", text: "צור קשר", inChrome: true },
    { href: map, text: "מפת הגעה", inChrome: true },
    { href: starMap, text: "מפת כוכבים", inChrome: true },
    { href: sitemap, text: "[מפת האתר]", inChrome: true },
  ];
  assert.equal(pickDirectionsUrl(links, heara), map, "the directions page, not the contact page");

  // Each signal must stand alone (see the "כתובת" note in testContactUrl).
  assert.equal(
    pickDirectionsUrl([{ href: map, text: "לפרטים נוספים", inChrome: true }], heara),
    map,
    "a whole /map path segment is enough",
  );
  assert.equal(
    pickDirectionsUrl(
      [{ href: "https://www.heara.co.il/107867/page-17", text: "מפת הגעה", inChrome: true }],
      heara,
    ),
    "https://www.heara.co.il/107867/page-17",
    "the link text 'מפת הגעה' is enough",
  );

  // Other maps are not directions.
  assert.equal(
    pickDirectionsUrl(
      [
        { href: sitemap, text: "[מפת האתר]", inChrome: true },
        { href: starMap, text: "מפת כוכבים", inChrome: true },
        { href: "https://www.heara.co.il/sitemap.xml", text: "sitemap", inChrome: true },
      ],
      heara,
    ),
    null,
    "sitemap / star-map product pages are not directions pages",
  );
  // heara's own sitemap path is 4 segments deep, and the depth penalty alone
  // rejects it — so it cannot prove `map` is matched as a WHOLE segment. A
  // shallow /sitemap/ (the WordPress default) can.
  assert.equal(
    pickDirectionsUrl(
      [{ href: "https://www.heara.co.il/sitemap/", text: "לכל הדפים", inChrome: true }],
      heara,
    ),
    null,
    "a shallow /sitemap/ path is not a /map segment",
  );
  assert.equal(
    pickDirectionsUrl([{ href: "https://maps.google.com/?q=heara", text: "מפת הגעה", inChrome: true }], heara),
    null,
    "off-host map links are refused",
  );
}

function testContactUrl() {
  const imj = "https://www.imj.org.il/he/";
  assert.equal(
    pickContactUrl(
      [
        // Percent-encoded exactly as it appears in the harvested href; the
        // keyword only matches once pickByKeyword decodes the pathname.
        {
          href: "https://www.imj.org.il/he/content/%D7%9B%D7%AA%D7%95%D7%91%D7%AA-%D7%95%D7%AA%D7%97%D7%91%D7%95%D7%A8%D7%94",
          text: "כתובת ותחבורה",
          inChrome: true,
        },
      ],
      imj,
    ),
    "https://www.imj.org.il/he/content/%D7%9B%D7%AA%D7%95%D7%91%D7%AA-%D7%95%D7%AA%D7%97%D7%91%D7%95%D7%A8%D7%94",
  );

  // The PATH keyword has to stand on its own. A first pass of this test proved
  // nothing, because the link text was also a keyword and scored the hit by
  // itself — deleting "כתובת" from CONTACT_HREF left the suite green. Give the
  // anchor neutral text so only the decoded pathname can match.
  assert.equal(
    pickContactUrl(
      [
        {
          href: "https://www.imj.org.il/he/content/%D7%9B%D7%AA%D7%95%D7%91%D7%AA-%D7%95%D7%AA%D7%97%D7%91%D7%95%D7%A8%D7%94",
          text: "לפרטים נוספים",
          inChrome: true,
        },
      ],
      imj,
    ),
    "https://www.imj.org.il/he/content/%D7%9B%D7%AA%D7%95%D7%91%D7%AA-%D7%95%D7%AA%D7%97%D7%91%D7%95%D7%A8%D7%94",
  );

  // "כתובת" is a common footer word, and the commonest thing it links to is a
  // map. Off-host is refused for the same reason it is for "About": a Google
  // Maps page is not the company's own copy.
  assert.equal(
    pickContactUrl(
      [{ href: "https://maps.google.com/?q=acme", text: "כתובת", inChrome: true }],
      "https://acme.co.il/",
    ),
    null,
  );

  testDirectionsUrl();

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

  // Verbatim shape of colmobil.co.il/about-us/: a company-history timeline.
  // The description is the LEDE; every block below it is a dated entry, and the
  // longest of those is a press release about a car brand the company imports.
  // Unbounded "longest wins" stored that as the company's own description —
  // which reads as the wrong company entirely.
  const lede =
    "להבין ברכבים זה קודם כל להבין באנשים שנוהגים בהם, במה חשוב להם ומה מניע אותם. " +
    "כבר 120 שנים שאנחנו מבינים שלהיות מקצוענים ובלתי מתפשרים מתחיל ונגמר בהבנת הצרכים שלכם. " +
    "אנחנו מבטיחים לעשות הכל בשביל שתמצאו את הפתרונות שמתאימים לכם, ולהיות איתכם בכל צעד.";
  const historyEntry =
    "חברת מילר ושות' חברה להנדסה בעמ הוקמה בשנת 1906 בידי נחום מילר, שעלה לישראל בסוף המאה " +
    "ה-19 והקים לפרנסת משפחתו עסק למכונות חקלאיות שהתפתח עם השנים לחברה לתיקון ולייבוא מכונות.";
  const brandNews =
    "החברה מתרחבת לאירופה עם קבלת זיכיון לשיווק שני מותגי רכב חדשים באוסטריה! זהו ציון דרך " +
    "משמעותי בהתפתחותה הבינלאומית. לאחר פחות משנת פעילות, הדגם הוא הנמכר ביותר בישראל השנה " +
    "עם כ-8,400 מסירות בחצי שנה. שוק הרכב האוסטרי דומה בהיקפו לשוק בישראל ונמצא במגמת צמיחה " +
    "מתמדת, עם העדפה הולכת וגוברת לטכנולוגיות הנעה מתקדמות מכל הסוגים.";
  // A second history entry, so the news block sits BELOW the lede window the
  // way it does on the real page (there it is #32 of 34).
  const historyEntry2 =
    "בשנת 1952 השיגה החברה את הזיכיון ליבוא משאיות כבדות משוודיה לישראל, והן זכו להצלחה " +
    "רבה בשוק המקומי והפכו למובילות בקטגוריה שלהן במשך שנים ארוכות לאחר מכן.";
  assert.ok(brandNews.length > lede.length, "the brand news must be the longer candidate");
  assert.equal(
    extractAboutText([lede, historyEntry, historyEntry2, brandNews].join("\n\n")),
    lede,
    "a timeline's dated entries must never outrank the lede",
  );

  // The window is not "first paragraph": a short hero line above the real
  // intro must not win just by being first.
  const heroLine =
    "כבר יותר מ-120 שנה אנחנו כאן בשבילכם, בכל הדרך, מהרגע הראשון שנכנסתם לאולם התצוגה " +
    "ועוד הרבה אחרי שיצאתם לדרך החדשה שלכם. זה מה שמניע אותנו כל בוקר מחדש.";
  assert.ok(heroLine.length >= 120 && heroLine.length < lede.length, "hero must qualify but be shorter");
  assert.equal(
    extractAboutText([heroLine, lede, historyEntry, historyEntry2, brandNews].join("\n\n")),
    lede,
    "longest still wins WITHIN the lede window",
  );

  // Verbatim from bankhapoalim.co.il: the longest paragraph on a bank homepage
  // is an OFFER, not a description of the company. It cleared every other
  // filter and would have become the bank's "about" text on the public site.
  // Note the boilerplate test needed "תנאי השימוש" with the definite article —
  // the article-less form alone missed this exact paragraph.
  const promo =
    String.raw`עד 20% הנחה באלפי בתי מלון בעולם ועד 20% הנחה על חופשה בארץ ובחול והנחות של מאות ` +
    String.raw`שקלים בשנה עם במגוון מותגים שווים! ההטבות בהתאם לתקנון שבאפליקציה. הבנק אינו ` +
    String.raw`אחראי לשירותים באתרים, הכפופים לתנאי השימוש המפורטים בהם.`;
  assert.equal(extractAboutText(promo), null, "promotional copy is not a company description");
  assert.equal(extractAboutText([promo, prose].join(NL + NL)), prose);

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
  // Verbatim from bankhapoalim.co.il. Correct street and city, then a phone
  // number and an email cut off mid-word — the trailing run in ADDRESS_LINE
  // swallowed both.
  assert.equal(
    extractAddressLine(
      String.raw`שדרות רוטשילד 50 תל אביב-יפו, מיקוד 6688314, טלפון: 076-8012790 או בדואל: m`,
    ),
    "שדרות רוטשילד 50 תל אביב-יפו, מיקוד 6688314",
  );
  // "St" without a word boundary matched the first two letters of "Statista",
  // and Personetics stored this award caption as its head-office address.
  assert.equal(extractAddressLine("2025 by CNBC and Statista"), null);
  assert.equal(
    extractAddressLine("10 Zarhin Street, Raanana, Israel"),
    "10 Zarhin Street, Raanana, Israel",
    "a real English address must still match",
  );

  // Verbatim from tnuva: a legal notice naming counsel ran on past the address.
  assert.equal(
    extractAddressLine(String.raw`רח' ויצמן 1 תל אביב, וכן אצל ב״כ המבקשים, עו״ד לירון פרמינגר`),
    String.raw`רח' ויצמן 1 תל אביב`,
  );

  // Addresses with NO street noun. Both verbatim from the 20-site batch, both
  // sitting in text already being read and missed only because every pattern
  // required a street.
  assert.deepEqual(extractCompactAddressLines("ספיר 1 הרצליה"), ["ספיר 1 הרצליה"]);
  assert.equal(
    extractCompactAddressLines(String.raw`פוליכד בע״מ, קיבוץ שפיים, 6099000, ישראל`).length,
    1,
  );

  // A branch list must never qualify — the column is companyHqCity. Two Hebrew
  // traps live here: \b does not fire after a Hebrew letter, and "סניף" ends in
  // FINAL fe while "סניפים" uses the regular form.
  for (const branch of ["סניף חיפה 3", "סניף באר שבע 3", "סניפים: תל אביב 5", "Branch: Haifa 3"]) {
    assert.deepEqual(extractCompactAddressLines(branch), [], `branch line accepted: ${branch}`);
  }

  // Prose is excluded by the length and word-count caps, even when it names a
  // real city — the polycad privacy page opens with exactly such a sentence.
  assert.deepEqual(
    extractCompactAddressLines(
      String.raw`התנאים שלהלן מפרטים את עיקרי מדיניות הפרטיות הנהוגה על ידי פוליכד מוצרי פלסטיק שפיים אגש״ח בע״מ ח.פ. 570046458`,
    ),
    [],
  );

  // Verbatim from polycad: "in 3 shifts to ensure production continuity", where
  // משמרות is both the word for shifts and a real kibbutz. Five words, no
  // comma — a sentence, not an address.
  assert.deepEqual(
    extractCompactAddressLines(String.raw`ב-3 משמרות להבטחת רציפות יצור`),
    [],
    "a sentence containing a place name is not an address",
  );

  // Contact lines carry digits but are not addresses.
  assert.deepEqual(extractCompactAddressLines("טל. 03-9483535"), []);

  // Round 3 (g): the contact tail is CUT from a compact line, not a reason to
  // drop it, and it also starts at "|" before a phone number and at וואטסאפ.
  // ness-tech.co.il's contact page, verbatim from dry run 3: the whole line was
  // stored as the HQ address, phone and WhatsApp numbers included.
  assert.deepEqual(
    extractCompactAddressLines("אינפיניטי פארק, רעננה | 03-7666800 | וואטסאפ: 054-5977779"),
    ["אינפיניטי פארק, רעננה"],
    "ness-tech: the phone and WhatsApp tail is cut, the address kept",
  );
  assert.deepEqual(extractCompactAddressLines("הבנאי 5, מודיעין | 08-9412345"), ["הבנאי 5, מודיעין"], "a | before a phone number starts the tail");
  assert.deepEqual(extractCompactAddressLines("הבנאי 5, מודיעין ווטסאפ 050-1234567"), ["הבנאי 5, מודיעין"], "ווטסאפ starts the tail");
  assert.deepEqual(extractCompactAddressLines("הבנאי 5, מודיעין, טלפון: 08-9412345"), ["הבנאי 5, מודיעין"], "טלפון starts the tail");
  assert.deepEqual(extractCompactAddressLines("קיבוץ שפיים | 6099000"), ["קיבוץ שפיים | 6099000"], "a postal code after | is not a phone number");
  assert.deepEqual(extractCompactAddressLines("וואטסאפ: 054-5977779"), [], "a line that is all tail is dropped");

  testOfficeListRuns();

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
    // The city is LAST in an Israeli address; earlier place names are streets.
    // All four verbatim from the 20-site batch, all four previously wrong.
    ["רחוב יגאל אלון 53 תל אביב מיקוד 6706206", "תל אביב-יפו"],
    ["רחוב השפלה 3 תל אביב", "תל אביב-יפו"],
    ["רח' אבא הלל 14, בית עוז ר״ג 52506", "רמת גן"],
    ["רחוב היוזמה 41 אזה״ת הצפוני אשדוד", "אשדוד"],
    // A landmark AFTER the city names a neighbouring place, not the address's
    // city, and it breaks last-place-wins. Verbatim from ono.ac.il, which stored
    // Savyon as the HQ of an institution in Kiryat Ono.
    ["השדרה האקדמית 1 קרית אונו, צומת סביון", "קריית אונו"],
    ["השדרה האקדמית 1 קרית אונו צומת סביון", "קריית אונו"],
    ["רחוב העצמאות 10 אשדוד, מחלף יבנה", "אשדוד"],
    ["רחוב המלאכה 5 ראש העין, ליד פתח תקווה", "ראש העין"],
    ["רחוב הרצל 12 רחובות, בצומת ביל״ו", "רחובות"],
    // A landmark alone says where the building is NEAR, never where it is.
    ["צומת סביון", null],
    // Kiryat in the other spelling from city.csv, inside a longer line. The scan
    // only knew the exact spelling, so Ono's address resolved to nothing once
    // Savyon stopped winning.
    ["השדרה האקדמית 1 קרית אונו", "קריית אונו"],
    ["רחוב הרצל 5 קריית גת", "קרית גת"],
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

  // The 1x1 spacer is scored below og:image rather than ranked as a logo —
  // where og:image is a candidate at all, which is on a careers board only.
  const boardUrls = collectLogoCandidates(harvest, org, { careersBoard: true }).map((c) => c.url);
  const spacerIndex = boardUrls.indexOf("https://acme.co.il/img/spacer.gif");
  const ogIndex = boardUrls.indexOf("https://acme.co.il/social-banner.jpg");
  assert.ok(ogIndex !== -1, "on a careers board og:image is a candidate");
  assert.ok(spacerIndex === -1 || spacerIndex > ogIndex, "a 1x1 spacer must not outrank og:image");
  assert.ok(!urls.includes("https://acme.co.il/social-banner.jpg"), "on a company homepage og:image is never a candidate");

  // Round 2: og:image is a social card. In dry run 2 it supplied calanit.co.il's
  // campaign photo and teleclalcc.co.il's ELDAR (another company's) as logos
  // from their homepages, and Israir's real logo from its careers board.
  for (const [page, og] of [
    ["https://calanit.co.il/", "https://calanit.co.il/wp-content/uploads/2023/02/homepage.png"],
    ["https://www.teleclalcc.co.il/", "https://www.teleclalcc.co.il/wp-content/uploads/2021/02/eldar.jpg"],
  ]) {
    assert.deepEqual(collectLogoCandidates({ ...emptyHarvest(page), metas: { "og:image": og } }, null), [], `${page}: og:image is not a homepage logo`);
  }
  const israir = { ...emptyHarvest("https://lp.vp4.me/foma"), metas: { "og:image": "https://content.vp4.me/ETISIMCHI/Content/logo%20israir_900x160-r.png" } };
  assert.deepEqual(
    collectLogoCandidates(israir, null, { careersBoard: true }).map((c) => c.url),
    ["https://content.vp4.me/ETISIMCHI/Content/logo%20israir_900x160-r.png"],
    "lp.vp4.me: on the careers board, og:image stays a candidate",
  );
  const profileSource = readFileSync(join(__dirname, "..", "company-profile.ts"), "utf8");
  assert.equal(
    (profileSource.match(/collectLogoCandidates\(careers, null, \{ careersBoard: true \}\)/g) ?? []).length,
    1,
    "only the careers-board path asks for og:image",
  );

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

/**
 * The model's about text is refused when it is a heading, policy or terms
 * text, or too short to describe anything. Both fixtures are verbatim from the
 * 2026-10-05 dry run, where each would have been stored as the company's about.
 */
/**
 * WIDGET_HOSTS was written with unescaped dots and a "(^|.)" prefix, so any
 * character stood in for a dot: it refused "notfacebook.com" and
 * "facebookXcom". Escaped, it must still refuse every host and subdomain it
 * refused before, and nothing that merely resembles one.
 */
function testWidgetHosts() {
  const listed = [
    "butterfly-button.web.app", "userway.org", "accessiway.com", "nagich.co.il", "nagish.li",
    "negishut.com", "enable.co.il", "equalweb.com", "tawk.to", "intercom.io", "intercom.com",
    "zendesk.com", "hotjar.com", "cookiebot.com", "onetrust.com", "trustpilot.com",
    "gravatar.com", "googletagmanager.com", "facebook.com", "doubleclick.net",
  ];
  for (const host of listed) {
    assert.equal(isWidgetHost(host), true, `${host} is still refused`);
    assert.equal(isWidgetHost(`cdn.${host}`), true, `cdn.${host} is still refused`);
    assert.equal(isWidgetHost(host.toUpperCase()), true, `${host} in capitals is still refused`);
  }
  for (const host of ["notfacebook.com", "facebookxcom", "myhotjar.com", "nagishxli", "butterfly-buttonxwebxapp", "acme.co.il"]) {
    assert.equal(isWidgetHost(host), false, `${host} is not a widget host`);
  }
}

function testModelAboutRefusal() {
  // careers.iec.co.il: the model returned a page heading.
  assert.ok(modelAboutRejection("על חברת החשמל"), "a 13-character heading is refused");
  // egged.co.il: the model returned the privacy policy's opening.
  assert.ok(
    modelAboutRejection(
      "אגד חברה לתחבורה בע״מ מפעילה את היישומון egg ואת יישומון Call Bus. הקבוצה מכבדת את פרטיותך, ושואפת לייעל את השירותים שהיא מספקת בהתאם לצרכי המשתמשים. מטרת מדיניות זו היא לפרט כל הנוגע למידע אישי הנאסף בעת השימוש בממשקים הדיגיטליים ואופן עיבודו.",
    ),
    "privacy-policy text is refused",
  );
  assert.ok(modelAboutRejection("השימוש באתר כפוף לתנאי השימוש ולתקנון האתר, כפי שיעודכנו מעת לעת על ידי החברה ובהתאם לשיקול דעתה."), "terms text is refused");
  assert.ok(modelAboutRejection("This website uses cookies to improve your experience and to analyse traffic on our pages."), "a cookie notice is refused");
  assert.ok(modelAboutRejection("אודות החברה ותחומי הפעילות שלה בישראל ובעולם לאורך השנים האחרונות"), "a long line with no sentence ending is a heading");
  // A real one must pass: alubin.com's about, as the deterministic rules took it.
  assert.equal(
    modelAboutRejection(
      "חברת אלובין הינה מהחברות הותיקות והמובילות בישראל ליצור ואספקת פרופילי אלומיניום לבנייה ותעשייה. מאז הקמתה בשנת 1958 מיצבה את עצמה אלובין כמובילת שוק בתחום.",
    ),
    null,
    "a company describing itself is kept",
  );
  // And the fallback must actually apply it to the model's about text.
  const source = readFileSync(join(__dirname, "..", "company-profile.ts"), "utf8");
  const fallback = source.slice(source.indexOf("async function llmFallback("), source.indexOf("// Logo\n"));
  assert.ok(/modelAboutRejection\(/.test(fallback), "llmFallback() runs modelAboutRejection on the about text");
}

/**
 * Round 2 (2026-10-06): the model's about text is accepted only if most of its
 * sentences appear verbatim in a paragraph of the site, and never if one comes
 * from a policy or terms page. A word list could not hold: in dry run 2 the
 * model paraphrased egged's privacy policy with none of the policy words.
 * Fixtures verbatim from dry run 2 and from the pages it read.
 */
function testModelAboutGrounding() {
  const eggedAbout =
    "קבוצת אגד (אגד חברה לתחבורה בע״מ, דרך אגד עוטף ירושלים בע״מ, אגד החזקות בע\"מ, אגד פלוס בע\"מ, אגד רמת הגולן בע\"מ, אגד מטרו בע\"מ - יחדיו \"הקבוצה\") מפעילה את יישומון egg ואת יישומון Call Bus, בנוסף לאתרים בכתובות שונות. אנו אוספים מידע בממשקים הדיגיטליים למטרות תפעול, ניהול ואספקת השירותים, למתן שירות למשתמשים, ביצוע בקרות תפעוליות ושיפור השירותים.";
  const eggedPrivacy = {
    url: "https://www.egged.co.il/privacy",
    text:
      "מדיניות הפרטיות מנוסחת בלשון זכר מטעמי נוחות בלבד, ופונה לכלל המגדרים. \n\n" +
      "קבוצת אגד (אגד חברה לתחבורה בע״מ, דרך אגד עוטף ירושלים בע״מ, אגד החזקות בע\"מ, אגד פלוס בע\"מ, אגד רמת הגולן בע\"מ, אגד מטרו בע\"מ  - יחדיו \"הקבוצה\") מפעילה את יישומון egg (\"היישומון\") ואת יישומון Call Bus (\"יישומון Call Bus\"), בנוסף לאתרים בכתובות:",
    policy: true,
  };
  assert.ok(modelAboutGrounding(eggedAbout, [eggedPrivacy]), "egged: a paraphrase of its privacy policy is refused");

  const iecAbout =
    "אודות חברת החשמל החברה חורגת מגבולות כדי לשמור על הזרם, וזמינים עבורך 24/7. השירותים הדיגיטליים שלנו כוללים את אתר האינטרנט, אפליקציות, שירות דיגיטלי בווטסאפ, שירות דיגיטלי בפייסבוק מסנג'ר ועוד.";
  const iecHome = {
    url: "https://www.iec.co.il/home",
    text: "זמינים עבורך 24/7\n\nבימים א'-ה': מ- 08:00 עד 19:00, ביום ו' וערבי חג: מ-08:00 עד 13:00\n\nלאחר שעות הפעילות הרגילות, זמינים בטלפון בכל שעה בנושאי מפגעים והפסקות חשמל",
  };
  assert.ok(modelAboutGrounding(iecAbout, [iecHome]), "careers.iec: text the site does not carry is refused");

  // Copied verbatim from the privacy page: refused for its source, even though
  // every sentence is verbatim.
  const fromPolicy = modelAboutGrounding("מדיניות הפרטיות מנוסחת בלשון זכר מטעמי נוחות בלבד, ופונה לכלל המגדרים.", [eggedPrivacy]);
  assert.ok(fromPolicy && /policy|terms/.test(fromPolicy), "verbatim from a policy page is refused as policy");
  // A policy page is known by its URL too, not only by the flag.
  assert.ok(
    modelAboutGrounding("מדיניות הפרטיות מנוסחת בלשון זכר מטעמי נוחות בלבד, ופונה לכלל המגדרים.", [{ url: eggedPrivacy.url, text: eggedPrivacy.text }]),
    "a /privacy URL counts as a policy source without the flag",
  );

  // alubin.com's about page paragraph, verbatim: copied whole, it is accepted.
  const alubinPara =
    "חברת אלובין הינה מהחברות הותיקות והמובילות בישראל ליצור ואספקת פרופילי אלומיניום לבנייה ותעשייה. מאז הקמתה בשנת 1958 מיצבה את עצמה אלובין כמובילת שוק בתחום ייצור ופיתוח מערכות אלומיניום.";
  const alubin = [{ url: "https://alubin.com/about", text: `תפריט\n\n${alubinPara}\n\nצור קשר` }];
  assert.equal(modelAboutGrounding(alubinPara, alubin), null, "verbatim from the about page is accepted");
  // Whitespace and quote styles do not count as changes.
  assert.equal(modelAboutGrounding(alubinPara.replace(/ /g, "  "), alubin), null, "doubled spaces still match");
  // Most, not all: two of three verbatim passes, one of three does not.
  const [s1, s2] = alubinPara.split(/(?<=\.)\s+/);
  const invented = "החברה מעסיקה מאות עובדים במפעלים ברחבי הארץ.";
  assert.equal(modelAboutGrounding(`${s1} ${s2} ${invented}`, alubin), null, "two of three sentences verbatim is most");
  assert.ok(modelAboutGrounding(`${s1} ${invented} החברה מייצאת לעשרות מדינות בעולם.`, alubin), "one of three is not");
  // A sentence split across two paragraphs is not "in a paragraph".
  assert.ok(modelAboutGrounding(s1, [{ url: "https://alubin.com/about", text: s1.replace("לבנייה", "\n\nלבנייה") }]), "a sentence must sit inside one paragraph");

  // And the fallback applies it, with the policy page marked as policy.
  const source = readFileSync(join(__dirname, "..", "company-profile.ts"), "utf8");
  const fallback = source.slice(source.indexOf("async function llmFallback("), source.indexOf("// Logo\n"));
  assert.ok(/modelAboutGrounding\(/.test(fallback), "llmFallback() runs modelAboutGrounding on the about text");
  assert.ok(/url: policyPage\.url, text: policyPage\.bodyText, policy: true/.test(source), "the policy page is passed as a policy source");
}

/**
 * Round 2: a model-produced address feeds the city only if it holds a street
 * word and a house number; otherwise address and city both stay empty. The
 * five model addresses of dry run 2, verbatim.
 */
function testModelAddressUsable() {
  assert.equal(modelAddressUsable("בפאתי ירושלים"), false, "chitadelivery: 'on the outskirts of Jerusalem' is not an address");
  assert.equal(modelAddressUsable("קיבוץ משמר העמק 1923600"), false, "tama: a kibbutz and a postal code, no street, no house number");
  assert.equal(
    modelAddressUsable("רחוב קציר א.ת. באר טוביה, ת.ד. 1325"),
    false,
    "benjerry: a street with no number, and a PO box number is not a house number",
  );
  assert.equal(modelAddressUsable("18 Hasivim St. Petach P.O.B 7551"), true, "eimsys: St. with 18");
  assert.equal(modelAddressUsable("רח' משה לוי 16, בית קנדי ראשל''צ"), true, "gomobile: רח' with 16");
  assert.equal(modelAddressUsable("שדרות רוטשילד 50, תל אביב-יפו"), true, "שדרות with a number");
  assert.equal(modelAddressUsable("דרך מנחם בגין 116, תל אביב יפו"), true, "דרך with a number");
  assert.equal(modelAddressUsable("בדרך 5 ירושלים"), false, "a street word inside another word is not one");
  assert.equal(modelAddressUsable("רחוב הנפח, מיקוד 5881804"), false, "a postal code is not a house number");
  assert.equal(modelAddressUsable("רחוב קציר ת.ד. 1325"), false, "a PO box number in the street's own part is not a house number");
  assert.equal(modelAddressUsable("Hasivim St. P.O.B 7551"), false, "nor in English");
  assert.equal(modelAddressUsable("ירושלים"), false, "a city on its own");

  // Round 3 (h): a PO box segment is dropped from a model address wherever it
  // sits, and the street part kept. eimsys.co.il, verbatim from dry run 3.
  assert.equal(stripPoBox("18 Hasivim St. Petach P.O.B 7551"), "18 Hasivim St. Petach", "eimsys: the P.O.B tail is dropped");
  assert.equal(stripPoBox("רחוב קציר א.ת. באר טוביה, ת.ד. 1325"), "רחוב קציר א.ת. באר טוביה", "benjerry: the ת.ד. part is dropped");
  assert.equal(stripPoBox("ת.ד. 55, רחוב הרצל 3, חולון"), "רחוב הרצל 3, חולון", "at the start");
  assert.equal(stripPoBox("רחוב הרצל 3, ת\"ד 55, חולון"), "רחוב הרצל 3, חולון", "in the middle, gershayim written with a quote");
  assert.equal(stripPoBox("Hamelacha 12 POB 3301 Netanya"), "Hamelacha 12 Netanya", "POB inside a part");
  assert.equal(stripPoBox("P.O. Box 7551, Petah Tikva"), "Petah Tikva", "P.O. Box");
  assert.equal(stripPoBox("רחוב הרצל 3, חולון"), "רחוב הרצל 3, חולון", "nothing to drop");
  assert.equal(modelAddressUsable(stripPoBox("18 Hasivim St. Petach P.O.B 7551")), true, "eimsys' street part is still usable");

  const source = readFileSync(join(__dirname, "..", "company-profile.ts"), "utf8");
  const merge = source.slice(source.indexOf("// --- 3. LLM fallback"), source.indexOf("// --- 4. City, through the gate"));
  assert.ok(/modelAddressUsable\(modelAddress\)/.test(merge), "captureSite() takes a model address only through modelAddressUsable");
  assert.ok(/const modelAddress = stripPoBox\(llm\.hqAddress\)/.test(merge), "after its PO box is dropped");
}

/**
 * Round 2: a compact address line (no street noun, found by
 * extractCompactAddressLines) is taken only when something before its city
 * anchors it as an address — a street word, an address label such as קיבוץ or
 * כתובת, or a house number. Dry run 2 took two sentences as addresses because
 * each was short, held a digit and named a real place.
 */
function testCompactAddressAnchor() {
  const cities = loadCityList();
  // cellcom.co.il's about page: "closing the 2G/3G networks". דור is a moshav.
  assert.equal(compactAddressAnchored("סגירת רשתות דור 2/3", cities), false, "cellcom: a network-shutdown sentence is refused");
  // iaa.gov.il's directions page: a photo-gallery caption. נתב"ג is a city.csv entry.
  assert.equal(compactAddressAnchored('נתב"ג בתמונות שנת 2020', cities), false, "iaa: a gallery caption is refused");
  // The two real shapes this path exists for (see extractCompactAddressLines).
  assert.equal(compactAddressAnchored("ספיר 1 הרצליה", cities), true, "globrands: street name and house number before the city");
  assert.equal(compactAddressAnchored("פוליכד בע״מ, קיבוץ שפיים, 6099000, ישראל", cities), true, "polycad: קיבוץ before the city");
  assert.equal(compactAddressAnchored("קיבוץ רבדים, מיקוד 7982000", cities), true, "oneline: קיבוץ before the city");
  assert.equal(compactAddressAnchored("כתובת: הרצליה 12", cities), true, "an address label before the city");
  assert.equal(compactAddressAnchored("אופקים מיקוד: 84747", cities), false, "a city and a postal code alone are not anchored");
  assert.equal(compactAddressAnchored("ת.ד. 1325 באר טוביה", cities), false, "a PO box number is not a house number");

  const source = readFileSync(join(__dirname, "..", "company-profile.ts"), "utf8");
  const fn = source.slice(source.indexOf("function addressFrom("), source.indexOf("function officeListCity("));
  assert.ok(/compactAddressAnchored\(candidate, cities\)/.test(fn), "addressFrom() gates the compact path with compactAddressAnchored");
}

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

// ---------------------------------------------------------------------------
// Logo context filters (task F, 2026-10-05)
// ---------------------------------------------------------------------------
//
// The 2026-10-05 dry run over 48 ACTIVE sites would have stored 22 wrong logos
// that passed every byte gate: an inline SVG or an SVG <img> in the header was
// trusted outright, so search, menu, pause and accessibility icons won, and an
// <img> with "logos" only in its filename (a TV-channel carousel) won too. The
// signals below are VERBATIM from those pages (rendered size, intrinsic size,
// <path> count, enclosing link, enclosing control, element + 5 ancestors).

function testLogoContextFilters() {
  // mikud-avtaha.co.il: the pojo accessibility toolbar's wheelchair, inline.
  const wheelchair = {
    dataUrl: "data:image/png;base64,WHEELCHAIR",
    pathCount: 2,
    area: 10_000,
    width: 100,
    height: 100,
    renderedWidth: 32,
    renderedHeight: 32,
    link: "javascript:void(0);",
    inControl: false,
    ancestry:
      "svg.#[] < a.pojo-a11y-toolbar-link pojo-a11y-toolbar-toggle-link#[כלי נגישות] < div.pojo-a11y-toolbar-toggle#[] < nav.pojo-a11y-toolbar-left pojo-a11y-#pojo-a11y-toolbar[] < body.rtl home page-template-default page page-id-1465#[]",
  };
  // shagrir.co.il: the carousel's pause button, inline.
  const pause = {
    dataUrl: "data:image/png;base64,PAUSE",
    pathCount: 1,
    area: 256,
    width: 16,
    height: 16,
    renderedWidth: 16,
    renderedHeight: 16,
    link: null,
    inControl: true,
    ancestry:
      "svg.bi bi-pause#[] < button.owlstop btn btn-sm btn-outline-danger#owl-play-stop[עצור ניגון] < div.owl-playstop#[] < div.owl-carousel owl-theme col-11 pr-0 owl-rtl owl-loaded owl-drag#carousel-homepage[] < div.header pb-4 row#[]",
  };
  // one1.co.il: the header search icon (search-icon.svg), an SVG <img> linking to "#".
  const search = {
    dataUrl: "data:image/png;base64,SEARCH",
    pathCount: 1,
    area: 529,
    width: 23,
    height: 23,
    renderedWidth: 23,
    renderedHeight: 23,
    link: "#",
    inControl: false,
    ancestry: "img.lazyloaded#[icon] < a.link#[חיפוש] < div.search-btn#[] < div.search-part#[] < div.header-in#[] < div.container#[]",
  };
  // maccabi4u.co.il: Google Translate's gadget icon (Google_Translate_logo.svg —
  // "logo" in its own file name), an SVG <img>, rendered 0x0.
  const translate = {
    dataUrl: "data:image/png;base64,TRANSLATE",
    pathCount: 4,
    area: 22_500,
    width: 150,
    height: 150,
    renderedWidth: 0,
    renderedHeight: 0,
    link: null,
    inControl: false,
    ancestry: "img.goog-te-gadget-icon#[] < div.goog-te-gadget-simple#:0.targetlanguage[] < div.skiptranslate goog-te-gadget#[] < div.#google_translate_element[] < li.nav-item google-append#[] < ul.navbar-nav#[]",
  };
  // maccabi4u.co.il's real logo on the same page (לוגו-מכבי_אדר-דסקטופ.svg), linking home.
  const maccabiLogo = {
    dataUrl: "data:image/png;base64,MACCABI",
    pathCount: 3,
    area: 4_620,
    width: 110,
    height: 42,
    renderedWidth: 87,
    renderedHeight: 33,
    link: "/",
    inControl: false,
    ancestry: "img.#[מכבי שירותי בריאות] < a.mobile-brand#[] < h1.#[] < nav.navbar navbar-expand-lg#[] < div.maccabi-hedear#[] < body.lang-he-il#[]",
  };

  for (const [name, logo] of [
    ["wheelchair (mikud-avtaha)", wheelchair],
    ["pause (shagrir)", pause],
    ["search (one1)", search],
    ["Google Translate (maccabi4u)", translate],
  ] as const) {
    assert.ok(inlineLogoRejection(logo, "https://www.example.co.il/"), `${name} must be refused`);
  }

  const maccabi: PageHarvest = {
    ...emptyHarvest("https://www.maccabi4u.co.il/"),
    // Highest path count first, the way the old ranking would have put it.
    inlineLogos: [translate, maccabiLogo],
  };
  const maccabiCandidates = collectLogoCandidates(maccabi, null);
  assert.deepEqual(
    maccabiCandidates.map((c) => c.url),
    ["data:image/png;base64,MACCABI"],
    "maccabi4u: the translate icon is dropped and the home-linked logo is the only candidate",
  );

  // cellcom.co.il: a TV-channel carousel image. "logos" is only in its file
  // name; it is not in the header and sits in a swiper slide. It won the dry run.
  const cellcom: PageHarvest = {
    ...emptyHarvest("https://cellcom.co.il/"),
    images: [
      {
        src: "https://contentepi.cellcom.co.il/globalassets/tv--/1/channel_gallery_logos_102x80_kan11.png",
        alt: "תמונות של ערוצים",
        width: 102,
        height: 80,
        inHeader: false,
        context: "homepagetvchannelslistblock__card",
        link: null,
        inControl: false,
        ancestry:
          "img.homepagetvchannelslistblock__image#[תמונות של ערוצים] < div.homepagetvchannelslistblock__card#[] < div.swiper-slide homepagetvchannelslistblock__slide#[] < div.swiper-wrapper#[] < div.swiper-container swiper-container-initialized#[] < div.homepagetvchannelslistblock#[]",
      },
    ],
  };
  assert.deepEqual(
    collectLogoCandidates(cellcom, { logo: "https://contentepi.cellcom.co.il/globalassets/2/cellcom.png" }).map((c) => c.url),
    ["https://contentepi.cellcom.co.il/globalassets/2/cellcom.png"],
    "cellcom: the channel carousel image (כאן 11) is never a candidate",
  );

  // Logos that must survive. Rendered and intrinsic size, link and ancestry are
  // verbatim from the same pages; an SVG <img>'s path count is read from its
  // file at harvest time, so here it is left unknown.
  const keep: [string, string, Partial<InlineLogo>][] = [
    ["BDO (Hunter board, logo.svg)", "https://bdo-career.hunterhrms.com/%D7%9B%D7%9C-%D7%94%D7%9E%D7%A9%D7%A8%D7%95%D7%AA/",
      { width: 152, height: 64, renderedWidth: 85, renderedHeight: 36, link: "https://bdo-career.hunterhrms.com/", ancestry: "img.custom-logo#[bdo] < a.custom-logo-link#[] < div.auto-width-logo wp-block-site-logo#[] < div.wp-block-group is-layout-flex wp-block-group-is-layout-flex#[]" }],
    ["kahane (logo-light.svg)", "https://www.kahane.co.il/",
      { width: 300, height: 82, renderedWidth: 166, renderedHeight: 46, link: "https://www.kahane.co.il", ancestry: "img.attachment-full size-full wp-image-22#[לוגו קבוצת כהנא] < a.#[] < div.elementor-widget-container#[] < div.elementor-element elementor-element-d9a8048 elementor-widget__width-auto elementor-widget elementor-widget-theme-site-logo elementor-widget-image#[]" }],
    ["ness-tech (inline, square, two paths, home-linked)", "https://www.ness-tech.co.il/",
      { pathCount: 2, pathCountKnown: true, width: 80.1, height: 80.1, renderedWidth: 69, renderedHeight: 69, link: "/", ancestry: "svg.#layer_1[] < a.#[ness חזור לדף הבית] < div.logo#[] < div.logoarea#[] < div.header-inner#[]" }],
    ["eychut (logo-eychut.svg)", "https://eychut.org.il/",
      { width: 146, height: 76, renderedWidth: 146, renderedHeight: 76, link: "https://eychut.org.il/", ancestry: "img.attachment-full size-full#[] < a.home-link#[] < div.col-1#[] < div.wrapper#[] < div.header-top#[] < header.site-header#masthead[]" }],
    ["gomobile (logo-txt.svg)", "https://www.gomobile.co.il/",
      { width: 196, height: 150, renderedWidth: 90, renderedHeight: 69, link: "/", ancestry: "img.#[go mobile] < a.router-link-active router-link-exact-active header-logo#[לחץ לעמוד הבית] < div.logo-place relative xl:self-start#[] < div.container flex justify-between items-center#[] < div.head-main py-2 lg:py-4#[]" }],
    ["iec (logo-with-text.svg, link 'home')", "https://www.iec.co.il/home",
      { width: 154, height: 75, renderedWidth: 152, renderedHeight: 75, link: "home", ancestry: "img.#[] < a.navbar-logo-container tw-relative tw-ms-[24px]#[קישור לדף הבית] < header.desktop-header#[] < div.desktop-layout-wrapper#[] < app-navbar.#[] < ng-component.#[]" }],
  ];
  for (const [name, pageUrl, signals] of keep) {
    const logo = { dataUrl: "data:image/png;base64,OK", area: 1, inControl: false, pathCount: 0, pathCountKnown: false, ...signals };
    assert.equal(inlineLogoRejection(logo as InlineLogo, pageUrl), null, `${name} must still be accepted`);
  }

  // The rules one at a time, on an otherwise acceptable home-linked mark.
  const base: InlineLogo = {
    dataUrl: "data:image/png;base64,BASE", pathCount: 5, area: 12_000, width: 200, height: 60,
    renderedWidth: 160, renderedHeight: 48, link: "/", inControl: false, ancestry: "svg.#[] < a.site-logo#[] < header.#[]",
  };
  const page = "https://acme.co.il/";
  assert.equal(inlineLogoRejection(base, page), null, "the base mark is accepted");
  assert.ok(inlineLogoRejection({ ...base, renderedWidth: 0, renderedHeight: 0 }, page), "a hidden (0x0) SVG is refused");
  assert.ok(inlineLogoRejection({ ...base, renderedWidth: 30, renderedHeight: 30 }, page), "under the 40px rendered floor is refused");
  assert.ok(inlineLogoRejection({ ...base, renderedWidth: 160, renderedHeight: 12 }, page), "a 12px-high sliver is refused");
  assert.ok(inlineLogoRejection({ ...base, width: 5, height: 12 }, page), "more than twice as tall as wide (a chevron) is refused");
  assert.equal(inlineLogoRejection({ ...base, width: 6, height: 12 }, page), null, "exactly twice as tall is the floor, kept");
  assert.ok(inlineLogoRejection({ ...base, inControl: true }, page), "inside a button or control is refused");
  assert.ok(inlineLogoRejection({ ...base, link: "/about/" }, page), "a link that is not the home link is refused");
  assert.ok(inlineLogoRejection({ ...base, link: "https://www.facebook.com/acme" }, page), "a link off-site is refused");
  assert.ok(inlineLogoRejection({ ...base, link: "#" }, page), "a '#' link is not the home link");
  assert.ok(inlineLogoRejection({ ...base, link: null, pathCount: 1 }, page), "a single-path SVG outside the home link is refused");
  assert.equal(inlineLogoRejection({ ...base, pathCount: 1 }, page), null, "a single-path mark IN the home link is kept");
  assert.equal(inlineLogoRejection({ ...base, link: null, pathCount: 1, pathCountKnown: false }, page), null, "an unknown path count is not held against it");
  assert.ok(inlineLogoRejection({ ...base, link: null, ancestry: "svg.#[] < button.e-n-menu-toggle#[כפתור פתיחת תפריט] < nav.e-n-menu#[]" }, page), "a menu control is refused");
  assert.ok(inlineLogoRejection({ ...base, link: null, ancestry: "svg.#[] < button.searchbtn#[] < form.#[]" }, page), "a search control is refused");
  assert.ok(inlineLogoRejection({ ...base, ancestry: "svg.#[] < a.elementor-social-icon#[פייסבוק] < div.social#[]" }, page), "a social icon is refused even linked home");
  assert.equal(
    inlineLogoRejection({ ...base, ancestry: "svg.#[] < a.site-logo#[] < div.main-menu-wrapper#[] < header.#[]" }, page),
    null,
    "a home-linked logo inside a menu wrapper is kept",
  );
  assert.ok(isHomeLink("/", page) && isHomeLink("https://www.acme.co.il", page) && isHomeLink("/he/", page) && isHomeLink("home", "https://acme.co.il/home"));
  assert.ok(!isHomeLink("#", page) && !isHomeLink("javascript:void(0);", page) && !isHomeLink("/about", page) && !isHomeLink("https://other.co.il/", page));

  // Round 2: the same HOST, ignoring "www." — not merely the same registrable
  // domain. ness-tech.co.il's header links its "Ness Place" mark, verbatim, to
  // another site on a sibling subdomain; it counted as a home link.
  assert.equal(isHomeLink("https://homeil.ness-tech.co.il", "https://www.ness-tech.co.il/"), false, "a sibling subdomain is not home");
  assert.equal(isHomeLink("https://ness-tech.co.il/", "https://www.ness-tech.co.il/"), true, "www. is ignored");
  assert.equal(isHomeLink("https://www.ness-tech.co.il/he/", "https://ness-tech.co.il/"), true, "either way round");
  const nessPlace: InlineLogo = {
    dataUrl: "data:image/png;base64,NESSPLACE", pathCount: 12, area: 9_276, pathCountKnown: true, width: 130.1, height: 71.3,
    renderedWidth: 82, renderedHeight: 46, link: "https://homeil.ness-tech.co.il", inControl: false,
    ancestry: "svg.#layer_1[] < a.#[אל ness place שלנו - נפתח בחלון חדש] < div.logo#[] < div.nessplace#[] < div.header-inner#[]",
  };
  assert.ok(inlineLogoRejection(nessPlace, "https://www.ness-tech.co.il/"), "ness-tech: the Ness Place mark links away from home");

  // Round 2: a rasterised mark that is one near-black colour is a silhouette —
  // an SVG whose fill came from the page's CSS, drawn with the default black.
  // Colour statistics measured on the real rasters of dry run 2 (every pixel,
  // alpha >= 128 opaque, RGB quantised to 4 bits per channel).
  const withColour = (colour: InlineLogo["colour"]): InlineLogo => ({ ...base, colour });
  assert.ok(
    inlineLogoRejection(withColour({ sampled: 148_200, opaque: 134_157, dominantShare: 1, dominant: [0, 0, 0] }), page),
    "ness-tech: the black silhouette of its glyph is refused",
  );
  assert.ok(inlineLogoRejection(withColour({ sampled: 40_000, opaque: 0, dominantShare: 0, dominant: [0, 0, 0] }), page), "a blank raster is refused");
  // Single-colour marks that are NOT black silhouettes must survive: maccabi4u's
  // blue and BDO's white are each 100% one colour, and both are correct logos.
  for (const [name, colour] of [
    ["maccabi4u (all blue)", { sampled: 226_380, opaque: 72_056, dominantShare: 1, dominant: [0, 68, 170] }],
    ["BDO (all white)", { sampled: 155_648, opaque: 76_734, dominantShare: 1, dominant: [255, 255, 255] }],
    ["kahane", { sampled: 393_600, opaque: 96_457, dominantShare: 0.5928, dominant: [255, 255, 255] }],
    ["gomobile", { sampled: 117_600, opaque: 36_204, dominantShare: 0.3477, dominant: [238, 0, 136] }],
    ["careers.iec", { sampled: 184_800, opaque: 55_633, dominantShare: 0.5266, dominant: [255, 85, 0] }],
  ] as const) {
    assert.equal(inlineLogoRejection(withColour({ ...colour, dominant: [...colour.dominant] as [number, number, number] }), page), null, `${name} is kept`);
  }
  // The harvest inlines computed fill and stroke into the clone before drawing,
  // and measures colour on both rasterising paths.
  const harvestSource = readFileSync(join(__dirname, "..", "company-profile.ts"), "utf8");
  const svgLoop = harvestSource.slice(harvestSource.indexOf("const svgCandidates"), harvestSource.indexOf("inlineLogos.push({"));
  assert.ok(/getComputedStyle\(/.test(svgLoop) && /setProperty\("fill"/.test(svgLoop) && /setProperty\("stroke"/.test(svgLoop), "computed fill and stroke are inlined into the clone");
  assert.ok(svgLoop.indexOf('setProperty("fill"') < svgLoop.indexOf("serializeToString("), "before it is serialised and drawn");
  assert.ok(/getImageData\(/.test(svgLoop), "the inline path measures colour");
  assert.ok(/getImageData\(/.test(readFileSync(join(__dirname, "svg-img-logos.ts"), "utf8")), "the SVG <img> path measures colour");

  // (k), owner 2026-10-06: a home link is also one whose target IS the page the
  // capture loaded. razel.co.il, verbatim: the capture loads http://www.razel.co.il/,
  // and the header logo links to the CMS URL /html5/?_id=9172&did=8843&G=8843 —
  // the same page (same canonical, identical text), but not a root path, so it
  // was refused as "links somewhere other than the home page". The harvest
  // fetches such a link and compares canonicals; linkIsPage is its answer.
  const razelLogo = {
    link: "/html5/?_id=9172&did=8843&G=8843",
    inControl: false,
    ancestry: "img.#[רזאל - משרות במיקור חוץ] < a.#[רזאל - משרות במיקור חוץ] < div.responsiveblock img sitelogo#[] < div.toprd#[] < div.#hresponsive[] < header.#[]",
  };
  assert.equal(logoPlacementRejection({ ...razelLogo, linkIsPage: true }, "http://www.razel.co.il/"), null, "razel: a link whose target is this page is a home link");
  assert.ok(logoPlacementRejection(razelLogo, "http://www.razel.co.il/"), "without that evidence the CMS link is still not home");
  assert.ok(logoPlacementRejection({ ...razelLogo, linkIsPage: false }, "http://www.razel.co.il/"), "nor when the fetched target is another page");
  const razelPage: PageHarvest = {
    ...emptyHarvest("http://www.razel.co.il/"),
    images: [{ src: "/html5/WEB/8843/720Imgfile.png", alt: "רזאל - משרות במיקור חוץ", width: 219, height: 94, inHeader: true, context: "responsiveblock img sitelogo ", ...razelLogo, linkIsPage: true }],
  };
  assert.deepEqual(collectLogoCandidates(razelPage, null).map((c) => c.url), ["http://www.razel.co.il/html5/WEB/8843/720Imgfile.png"], "razel's logo is a candidate again");
  const harvestCode = readFileSync(join(__dirname, "..", "company-profile.ts"), "utf8");
  assert.ok(/linkIsPage/.test(harvestCode) && /rel=\["'\]canonical/.test(harvestCode), "the harvest records linkIsPage by comparing canonicals");

  // The old shape (no signals at all) still passes through unchanged.
  assert.equal(inlineLogoRejection({ dataUrl: "data:image/png;base64,OLD", pathCount: 3, area: 3621 }, page), null);
}

function main() {
  testHomepageDerivation();
  testHomepageFromLinks();
  testJsonLd();
  testAbout();
  testAddressAndCity();
  testLogoCandidates();
  testLogoContextFilters();
  testModelOutputSanitising();
  testModelAboutRefusal();
  testModelAboutGrounding();
  testModelAddressUsable();
  testCompactAddressAnchor();
  testWidgetHosts();
  testStatus();
  console.log(
    "PASS: company-profile extraction (homepage, JSON-LD, about, address+city gate, logo, status)",
  );
}

main();
