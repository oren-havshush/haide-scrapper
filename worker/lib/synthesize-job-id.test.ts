// Run: npx tsx worker/lib/synthesize-job-id.test.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  haideHash,
  synthesizeExternalJobId,
  applyJobIdFallback,
} from "./synthesizeJobId";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

// --- hash shape -------------------------------------------------------------
const h = haideHash("רכז/ת לקליניקה הפסיכולוגית");
assert(/^[0-9a-z]+$/.test(h), `hash must be lowercase base-36 ASCII, got "${h}"`);
assert(h === haideHash("רכז/ת לקליניקה הפסיכולוגית"), "hash must be deterministic");
assert(
  haideHash("מכונאי/ת") !== haideHash("מכונאי"),
  "hash must distinguish near-identical Hebrew titles",
);

// --- never overwrite an extracted id ---------------------------------------
{
  const r = applyJobIdFallback([
    { externalJobId: "623888", title: "רכז/ת" },
    { externalJobId: "  1213  ", title: "מיישם/ת SAP MM" },
  ]);
  assert(r.ids[0] === "623888", "an extracted id must be left untouched");
  assert(r.ids[1] === "1213", "an extracted id must only be trimmed");
  assert(r.synthesized === 0, "nothing should be synthesised when ids exist");
}

// --- fills only the gaps ----------------------------------------------------
{
  const r = applyJobIdFallback([
    { externalJobId: "623888", title: "has native id" },
    { externalJobId: "", title: "no id", url: "https://x.example/a" },
    { externalJobId: null, title: "no id either", url: "https://x.example/b" },
  ]);
  assert(r.ids[0] === "623888", "native id preserved alongside synthesis");
  assert(r.ids[1]!.startsWith("h-"), "synthesised ids carry the h- prefix");
  assert(r.synthesized === 2, `expected 2 synthesised, got ${r.synthesized}`);
  assert(r.collisions === 0, "distinct inputs must not collide");
  assert(new Set(r.ids).size === 3, "all ids distinct");
}

// --- stability: order must not matter (never index-based) -------------------
{
  const a = { externalJobId: "", title: "מכונאי/ת", url: "https://x.example/1" };
  const b = { externalJobId: "", title: "נהג/ת", url: "https://x.example/2" };
  const forward = applyJobIdFallback([a, b]).ids;
  const reversed = applyJobIdFallback([b, a]).ids;
  assert(forward[0] === reversed[1], "id must not depend on position (a)");
  assert(forward[1] === reversed[0], "id must not depend on position (b)");
}

// --- LRN-ID-7: location must NOT feed the hash ------------------------------
{
  const before = synthesizeExternalJobId({ title: "מורה לאנגלית", url: "https://x/1" });
  // A later gazetteer fix rewrites location; the id must be unaffected.
  const after = synthesizeExternalJobId({
    title: "מורה לאנגלית",
    url: "https://x/1",
    // @ts-expect-error — location is intentionally not part of JobIdSeed
    location: "תל אביב-יפו",
  });
  assert(before === after, "location changes must not churn a synthesised id");
}

// --- collisions are reported, not hidden (LRN-ID-8) -------------------------
{
  const r = applyJobIdFallback([
    { externalJobId: "", title: "same title", url: "https://x/same" },
    { externalJobId: "", title: "same title", url: "https://x/same" },
  ]);
  assert(r.collisions === 1, `identical seeds must report a collision, got ${r.collisions}`);
  assert(r.ids[0] === r.ids[1], "identical seeds hash identically (that IS the collision)");
}

// --- nothing stable to hash => null, not a fabricated id --------------------
{
  assert(synthesizeExternalJobId({}) === null, "empty seed yields null");
  assert(
    synthesizeExternalJobId({ title: "  ", url: "" }) === null,
    "whitespace-only seed yields null",
  );
  const r = applyJobIdFallback([{ externalJobId: "", title: "" }]);
  assert(r.ids[0] === null, "unresolvable job keeps a null id");
  assert(r.unresolved === 1, "unresolvable jobs are counted");
  assert(r.synthesized === 0, "unresolvable jobs are not counted as synthesised");
}

// --- a URL alone is enough (listing-only sites with detail links) -----------
{
  const id = synthesizeExternalJobId({ url: "https://x.example/job/42" });
  assert(id === null, "url without a title is too weak to key on");
}

// ---------------------------------------------------------------------------
// The recipe's hash IS the worker's (addsite2 phase two, step 4)
// ---------------------------------------------------------------------------
// addsite3-recipes/setupscript-patterns.md §3 carries the one snippet a script
// may use when it truly must hash. It was a backward copy (it walked the string
// from the end, and multiplied without masking), so "abc" hashed to 375kp1 in a
// script and 375fut in the worker. The snippet is extracted from the recipe,
// evaluated, and compared with the worker on ASCII, Hebrew and empty inputs.
{
  const recipe = readFileSync(join(__dirname, "..", "..", "addsite3-recipes", "setupscript-patterns.md"), "utf8");
  const section3 = recipe.slice(recipe.indexOf("## 3."), recipe.indexOf("## 4."));
  const blocks = [...section3.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]!);
  const block = blocks.find((b) => /function haideHash\s*\(/.test(b)) ?? "";
  // The function alone, by brace matching: the block around it may touch the DOM.
  let snippet = "";
  const start = block.search(/function haideHash\s*\(/);
  if (start >= 0) {
    let depth = 0;
    for (let i = block.indexOf("{", start); i < block.length; i++) {
      if (block[i] === "{") depth++;
      else if (block[i] === "}" && --depth === 0) {
        snippet = block.slice(start, i + 1);
        break;
      }
    }
  }
  assert(snippet.length > 0, "recipe §3 has a haideHash snippet");
  let recipeHash: ((s: string) => string) | null = null;
  try {
    recipeHash = new Function(`${snippet}\nreturn haideHash;`)() as (s: string) => string;
  } catch (e) {
    assert(false, `the recipe snippet evaluates (${(e as Error).message})`);
  }
  // Pinned, so flipping BOTH loops still fails: the worker walks forward.
  assert(haideHash("abc") === "375fut", `the worker hashes "abc" forward to 375fut (got ${haideHash("abc")})`);
  const fixtures = [
    "abc",
    "Senior Driver|Logistics|https://jobs.example.co.il/careers/driver-17",
    "רכז/ת לקליניקה הפסיכולוגית",
    "מכונאי/ת|אחזקה|https://www.kahane.co.il/jobs/%d7%9e%d7%9b%d7%95%d7%a0%d7%90%d7%99/",
    "",
  ];
  for (const s of fixtures) {
    const got = recipeHash ? recipeHash(s) : "(no snippet)";
    assert(got === haideHash(s), `recipe and worker agree on ${JSON.stringify(s.slice(0, 30))}: ${got} vs ${haideHash(s)}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("synthesize-job-id: all assertions passed");
