// Run: npx tsx src/lib/setupScriptBytes.test.ts
//
// LRN-SETUP-19, and what this repo can actually do about it.
//
// On 2026-09-23 a careers.jnj.com setupScript stopped matching. The cause was a
// DOUBLED backslash: `new RegExp("…\\b")` is the correct way to put a word
// boundary in a JS string, but the tooling that composed the script collapsed
// the pair to one backslash, and JS then read the survivor as the BACKSPACE
// escape. The regex ended up holding a raw 0x08 and matched nothing.
//
// Two facts decide what the fix is.
//
// 1. The collapse is NOT in any path this repo owns. Measured: a script
//    carrying `\d`, `\\b` and `\\s` survives writeFileSync + readFileSync and a
//    JSON round trip — the export mirror's write and the config PUT body —
//    byte for byte, with zero control characters. The corruption happened
//    before the PUT, in the authoring step, which is why the stored script was
//    byte-identical to the one sent and `verify-config` passed.
// 2. Nothing downstream could see it. `\b` and a raw backspace are
//    indistinguishable in a terminal, in a diff, and in JSON.stringify — which
//    renders BOTH as "\b". Requirements went to 0/22 while every other field
//    stayed at 1.00, and the run reported success.
//
// So the guard belongs at the write boundary: a setupScript carrying a raw
// control character is refused, loudly, instead of stored and silently
// mismatching for a month. What the fix cannot do is un-collapse anything —
// the information is gone by then. What it does is make the failure visible at
// the only moment anyone is looking.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { updateSiteConfigSchema } from "./validators";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const BS = String.fromCharCode(92); // a literal backslash, never an escape

// The smallest body the config schema accepts, so every failure below is about
// the script and nothing else.
const BASE = { fieldMappings: {}, pageFlow: [] as unknown[], formCapture: null };
const parse = (setupScript: string) =>
  updateSiteConfigSchema.safeParse({ ...BASE, setupScript });
const ok = (setupScript: string) => parse(setupScript).success;

// ---------------------------------------------------------------------------
console.log("# a correct script is accepted, backslashes and all");
// ---------------------------------------------------------------------------
{
  // The shape the jnj script was MEANT to have: a regex literal with \d, and a
  // string with a doubled \\b and \\s for new RegExp.
  const good =
    `var RE = /` + BS + `d{3,5}/;\n` +
    `var RE2 = new RegExp("^(Qualifications|Requirements)` + BS + BS + `b");\n` +
    `var RE3 = new RegExp("` + BS + BS + `s+");\n`;
  assert(ok(good), "a script containing \\d, \\\\b and \\\\s is accepted");
  assert(
    good.split(BS).length - 1 === 5,
    "and the fixture really does carry five backslashes, so this is not vacuous",
  );
  assert(
    ![...good].some((c) => c.charCodeAt(0) < 32 && c !== "\n" && c !== "\t" && c !== "\r"),
    "and no control characters, which is what makes it the correct version",
  );

  // Tabs, newlines and carriage returns are ordinary script formatting.
  assert(
    ok("var a = 1;\n\tvar b = 2;\r\n"),
    "tab, newline and carriage return are not control characters for this purpose",
  );
  assert(ok(""), "an empty script is accepted");
}

// ---------------------------------------------------------------------------
console.log("# the collapsed script is refused");
// ---------------------------------------------------------------------------
{
  // Exactly what the tooling produced: the `\\b` pair became one backslash, and
  // the JS parser turned `\b` into 0x08. This is the byte that shipped.
  const collapsed =
    `var RE2 = new RegExp("^(Qualifications|Requirements)` + String.fromCharCode(8) + `");\n`;
  assert(!ok(collapsed), "a script carrying a raw backspace (0x08) is refused");

  // The same collapse drops \s and \d, per LRN-SETUP-19's closing note.
  for (const [code, name] of [
    [8, "backspace, from \\b"],
    [12, "form feed, from \\f"],
    [11, "vertical tab, from \\v"],
    [7, "bell, from \\a"],
    [0, "NUL"],
    [27, "escape"],
  ] as Array<[number, string]>) {
    assert(
      !ok(`var x = "a${String.fromCharCode(code)}b";`),
      `a script carrying ${name} (0x${code.toString(16)}) is refused`,
    );
  }

  // Why this needs a machine rather than an eye. The two forms differ by
  // exactly one backslash inside a JSON dump and by nothing at all on a
  // terminal, where the raw byte prints as zero columns.
  const rendered = JSON.stringify(String.fromCharCode(8)); //  "\b"
  const renderedCorrect = JSON.stringify(BS + "b"); //           "\\b"
  assert(
    rendered !== renderedCorrect && renderedCorrect === rendered.replace(BS, BS + BS),
    "a JSON dump tells the collapsed script from the correct one by one backslash, nothing more",
  );
  assert(
    String.fromCharCode(8).length === 1 && (BS + "b").length === 2,
    "and by one character of length — which is the only thing a check can actually measure",
  );
}

// ---------------------------------------------------------------------------
console.log("# the refusal says what is wrong");
// ---------------------------------------------------------------------------
{
  const r = parse(`var x = "a${String.fromCharCode(8)}b";`);
  assert(!r.success, "refused");
  const msg = r.success ? "" : JSON.stringify(r.error.issues);
  assert(
    /control character/i.test(msg),
    `the message names the cause, not just "invalid" (got ${msg.slice(0, 200)})`,
  );
  assert(
    /0x8|\\\\b|backslash/i.test(msg),
    `and points at the doubled-backslash collapse (got ${msg.slice(0, 200)})`,
  );
}

// ---------------------------------------------------------------------------
console.log("# and the guard is not itself a victim");
// ---------------------------------------------------------------------------
{
  // Not a theoretical worry. The first version of this guard was a regex with
  // escaped bounds, and the write path turned those escapes into six raw
  // control bytes INSIDE the regex literal. It still passed every assertion
  // above — a checker made of the thing it checks for. So the source is
  // scanned by bytes, which is what LRN-SETUP-19 says to do after every write.
  const src = readFileSync(join(__dirname, "validators.ts"), "utf8");
  const bad: string[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) {
      bad.push(`0x${c.toString(16)} near ${JSON.stringify(src.slice(Math.max(0, i - 40), i))}`);
    }
  }
  assert(src.length > 1000, "validators.ts was actually read, so this is not vacuous");
  assert(
    bad.length === 0,
    `validators.ts carries no raw control character (found ${bad.length}: ${bad.slice(0, 3).join(" | ")})`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nsetupScriptBytes: a collapsed escape cannot be stored silently");
