// Self-test for the description-text enrichment regexes.
// Run: npx tsx .enrich-test.ts

import {
  extractFieldsFromText,
  normalizeJobRecord,
} from "./worker/lib/normalizer";

type Expect = Partial<{
  location: string | null;
  department: string | null;
  externalJobId: string | null;
  publishDate: string | null;
  requirements: string | null;
  jobType: string | null;
  applicationInfo: string | null;
}>;

const cases: { name: string; text: string; expect: Expect }[] = [
  {
    name: "tikshoov Hebrew detail",
    text:
      'מנהל/ת צוות | כללית מושלם | באר שבע | החלפה לחל"ד סוג המשרה: מנהל/ת צוות | כללית מושלם | באר שבע | החלפה לחל"ד אזור גיאוגרפי: באר שבע פרטי המשרה: דרוש/ה מנהל/ת צות למוקד השירות של כללית מושלם- החלפה לחל"ד עם אופציה להמשך העסקה. מיקום המשרה: באר שבע',
    expect: {
      location: "באר שבע",
      // jobType label is followed by the title (pipe-separated). Stopping
      // at the first `|` gives the cleaner head value, which is what we want
      // for sites that abuse the field this way.
      jobType: "מנהל/ת צוות",
    },
  },
  {
    name: "Hebrew with explicit מיקום",
    text:
      "תיאור המשרה: דרוש/ה מפתח/ת פולסטאק. מיקום: תל אביב. סוג משרה: משרה מלאה. דרישות: 3+ שנות ניסיון ב-React, ידע ב-TypeScript.",
    expect: {
      location: "תל אביב",
      jobType: "משרה מלאה",
      requirements: "3+ שנות ניסיון ב-React, ידע ב-TypeScript",
    },
  },
  {
    name: "English label format",
    text:
      "We are hiring a backend engineer. Location: Tel Aviv. Department: R&D. Job Type: Full-time. Job ID: REQ-1234. Posted: 15/01/2026. Requirements: 5+ years Python, AWS experience.",
    expect: {
      location: "Tel Aviv",
      department: "R&D",
      jobType: "Full-time",
      externalJobId: "REQ-1234",
      publishDate: "15/01/2026",
      requirements: "5+ years Python, AWS experience",
    },
  },
  {
    name: "Mixed labels with pipe terminators",
    text:
      "Senior Engineer | Department: Platform | Location: Haifa | Apply: jobs@example.com",
    expect: {
      department: "Platform",
      location: "Haifa",
      applicationInfo: "jobs@example.com",
    },
  },
  {
    name: "Hebrew דרישות block",
    text:
      "תיאור: מפתח Backend. דרישות: ניסיון של 3 שנים בפיתוח, ידע ב-Node.js, אנגלית ברמה גבוהה. יתרון: ידע ב-AWS.",
    expect: {
      requirements:
        "ניסיון של 3 שנים בפיתוח, ידע ב-Node.js, אנגלית ברמה גבוהה",
    },
  },
  {
    name: "Date with פורסם",
    text: "פורסם בתאריך 15/01/2026. תיאור המשרה: דרוש/ה מפתח/ת.",
    expect: { publishDate: "15/01/2026" },
  },
  {
    name: "External ID with hash",
    text: "Backend Engineer (#JR-9876) — Tel Aviv office. Apply now.",
    expect: { externalJobId: "JR-9876" },
  },
  {
    name: "Email + phone application info",
    text:
      "To apply, send your CV to careers@example.co.il or call 03-1234567.",
    expect: { applicationInfo: "careers@example.co.il" },
  },
  {
    name: "Nothing extractable",
    text: "We are a great company hiring great people. Join us today!",
    expect: {
      location: null,
      department: null,
      jobType: null,
      externalJobId: null,
      publishDate: null,
      requirements: null,
      applicationInfo: null,
    },
  },
  {
    name: "Don't false-positive on prose",
    text:
      "Our team is responsible for the success of our customers. We work hard and deliver value.",
    expect: { location: null, department: null, jobType: null },
  },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const out = extractFieldsFromText(c.text);
  const errs: string[] = [];
  for (const [k, expected] of Object.entries(c.expect)) {
    const got = (out as Record<string, string | null | undefined>)[k] ?? null;
    if (expected === null) {
      if (got) errs.push(`${k}: expected null, got ${JSON.stringify(got)}`);
    } else {
      if (typeof got !== "string" || got.trim() !== (expected as string).trim()) {
        errs.push(
          `${k}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`,
        );
      }
    }
  }
  if (errs.length === 0) {
    pass++;
    console.log(`  PASS  ${c.name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${c.name}`);
    for (const e of errs) console.log(`        - ${e}`);
    console.log(`        full output:`, out);
  }
}

console.log(`\n=== ${pass} pass / ${fail} fail ===`);

// Quick integration check on normalizeJobRecord
console.log("\n=== normalizeJobRecord integration ===");
const rec = normalizeJobRecord({
  title: "Backend Engineer",
  description:
    "We are hiring. Location: Tel Aviv. Department: R&D. Job ID: REQ-9000. Posted: 12/05/2026. Requirements: Node.js, TypeScript.",
  // Note: location/department/externalJobId/publishDate/requirements are all empty
});
console.log(JSON.stringify(
  {
    location: rec.location,
    department: rec.department,
    externalJobId: rec.externalJobId,
    publishDate: rec.publishDate,
    requirements: rec.requirements,
    jobType: rec.additionalFields.jobType ?? null,
    enrichedKeys: Object.keys(rec.rawFields).filter((k) =>
      k.startsWith("_enrichedFromDescription_"),
    ),
  },
  null,
  2,
));

// Pre-existing location should not be overwritten
const rec2 = normalizeJobRecord({
  title: "Backend Engineer",
  location: "Haifa",
  description: "Location: Tel Aviv. (this should NOT override.)",
});
console.log("preserveExisting:", JSON.stringify({ location: rec2.location }));

process.exit(fail > 0 ? 1 : 0);
