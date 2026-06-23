// Run: npx tsx worker/lib/external-job-id.test.ts

import { extractBracketedJobCode, normalizeJobRecord } from "./normalizer";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

// --- extractBracketedJobCode ---------------------------------------------
assert(extractBracketedJobCode("Analyst - (JB-3138)") === "JB-3138", "JB in parens");
assert(extractBracketedJobCode("Role [AB-1234]") === "AB-1234", "alpha code in brackets");
assert(extractBracketedJobCode("Role (REQ_99)") === "REQ-99", "underscore normalized to dash");
assert(extractBracketedJobCode("Senior Dev (jb-2683)") === "JB-2683", "lowercase upcased");
// Must NOT match prose / years / percentages — these aren't req codes.
assert(extractBracketedJobCode("Founded (2024)") === null, "bare year not an ID");
assert(extractBracketedJobCode("Part time (50%)") === null, "percentage not an ID");
assert(extractBracketedJobCode("5+ years experience") === null, "no brackets, no match");
assert(extractBracketedJobCode("") === null, "empty");

// --- normalizeJobRecord: title-scan fallback -----------------------------
// No selector/description ID, but the title prints the code -> recovered.
const fromTitle = normalizeJobRecord({
  title: "Senior Data Scientist - (JB-2683)",
  description: "Great role, no id in the body.",
});
assert(
  fromTitle.externalJobId === "JB-2683",
  `title-scan should recover JB-2683, got "${fromTitle.externalJobId}"`,
);
assert(
  fromTitle.rawFields["_enrichedFromTitle_externalJobId"] === "JB-2683",
  "title-scan should record provenance",
);

// A dedicated selector value always wins over the title code.
const fromSelector = normalizeJobRecord({
  title: "Senior Data Scientist - (JB-2683)",
  externalJobId: "internal-555",
});
assert(
  fromSelector.externalJobId === "internal-555",
  `selector value must win, got "${fromSelector.externalJobId}"`,
);

// Description-printed bracketed code is recovered even without a title code.
const fromDesc = normalizeJobRecord({
  title: "Backend Engineer",
  description: "We are hiring. Reference (JR-7788). Apply now.",
});
assert(
  fromDesc.externalJobId === "JR-7788",
  `description bracketed code should be recovered, got "${fromDesc.externalJobId}"`,
);

// A title with no code and no other source leaves the ID empty (no invention).
const noId = normalizeJobRecord({
  title: "Marketing Lead",
  description: "Lead our marketing. 5+ years required.",
});
assert(noId.externalJobId === "", `must not invent an ID, got "${noId.externalJobId}"`);

console.log("external-job-id.test.ts: all assertions passed");
