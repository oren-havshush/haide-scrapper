// Run: npx tsx src/lib/apiTokens.test.ts
//
// Step B (owner, 2026-09-30): per-operator tokens. The proxy accepts API_TOKEN
// or any entry of a comma-separated API_TOKENS list ("label:secret"), compared
// in constant time. Labels are for the owner's .env only: never logged, never
// accepted as a token. The dashboard's token is excluded from call recording
// and from the minutes estimate. No test here prints a token value.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isAcceptedToken, isDashboardToken, parseApiTokens } from "./apiTokens";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

// Fixture values only — none is a real token.
const LEGACY = "legacy-aaaaaaaaaaaaaaaa";
const NOA = "noa-bbbbbbbbbbbbbbbbbbbb";
const SECOND = "op2-cccccccccccccccccccc";

// --- parsing -------------------------------------------------------------------
{
  const both = parseApiTokens({ API_TOKEN: LEGACY, API_TOKENS: `noa:${NOA}, operator2:${SECOND}` });
  assert(both.length === 3, `API_TOKEN plus two listed entries: three accepted (${both.length})`);
  assert(both.includes(LEGACY) && both.includes(NOA) && both.includes(SECOND), "the secrets, labels stripped");
  assert(!both.some((t) => t.startsWith("noa:")), "a label is never part of an accepted token");
  assert(parseApiTokens({ API_TOKEN: LEGACY }).length === 1, "API_TOKEN alone still works — it stays valid until everyone has moved");
  assert(parseApiTokens({ API_TOKENS: `noa:${NOA}` }).length === 1, "and the list alone works once it is retired");
  assert(parseApiTokens({ API_TOKENS: ` , noa:${NOA},, ` }).length === 1, "empty entries and spaces are ignored");
  assert(parseApiTokens({ API_TOKENS: SECOND }).includes(SECOND), "an entry without a label is its own secret");
  assert(parseApiTokens({ API_TOKENS: "noa:" }).length === 0, "a label with no secret accepts nothing");
  assert(parseApiTokens({}).length === 0, "nothing configured accepts nothing");
  assert(parseApiTokens({ API_TOKEN: "", API_TOKENS: "" }).length === 0, "empty values accept nothing");
}

// --- accepting -------------------------------------------------------------------
{
  const accepted = parseApiTokens({ API_TOKEN: LEGACY, API_TOKENS: `noa:${NOA}` });
  assert(isAcceptedToken(LEGACY, accepted), "the legacy token is accepted");
  assert(isAcceptedToken(NOA, accepted), "a listed operator's token is accepted");
  assert(!isAcceptedToken(SECOND, accepted), "an unlisted token is refused");
  assert(!isAcceptedToken(`noa:${NOA}`, accepted), "the whole label:secret entry is not a token");
  assert(!isAcceptedToken("noa", accepted), "nor is the label");
  assert(!isAcceptedToken(NOA.slice(0, -1), accepted), "nor a prefix of a token");
  assert(!isAcceptedToken(`${NOA}x`, accepted), "nor a token with a character appended");
  assert(!isAcceptedToken("", accepted), "an empty token is refused");
  assert(!isAcceptedToken("", [""]), "even against an empty accepted value");
}

// --- the dashboard's token -----------------------------------------------------------
{
  assert(isDashboardToken(LEGACY, LEGACY), "the dashboard's own token is recognised");
  assert(!isDashboardToken(NOA, LEGACY), "an operator's is not");
  assert(!isDashboardToken(LEGACY, undefined), "with no dashboard token configured, nothing is the dashboard");
  assert(!isDashboardToken("", ""), "and an empty token never is");
}

// --- wiring: the proxy, the recorder, compose ----------------------------------------------
{
  const ROOT = join(__dirname, "..", "..");
  const read = (p: string) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : "");
  const proxy = read("src/proxy.ts");
  assert(/isAcceptedToken\(token, parseApiTokens\(process\.env\)\)/.test(proxy), "the proxy accepts through parseApiTokens and isAcceptedToken");
  assert(!/constantTimeEqual\(token, apiToken\)/.test(proxy), "and no longer compares against API_TOKEN alone");
  assert(!/console\.[a-z]+\([^)]*(token|label)/i.test(proxy), "the proxy logs neither a token nor a label");
  const svc = read("src/services/autoFixService.ts");
  const record = svc.slice(svc.indexOf("export async function recordSiteCall("));
  assert(/isDashboardToken\(/.test(record.slice(0, record.indexOf("\n}\n"))), "recordSiteCall skips the dashboard's token");
  const apply = svc.slice(svc.indexOf("export async function applyAutoFix("));
  assert(/if \(!dashboard\)/.test(apply.slice(0, apply.indexOf("\n}\n"))), "applyAutoFix leaves the minutes alone for the dashboard's token");
  const compose = read("docker-compose.yml");
  const web = compose.slice(compose.indexOf("\n  web:"), compose.indexOf("\n  worker:") > 0 ? compose.indexOf("\n  worker:") : undefined);
  assert(/API_TOKENS: \$\{API_TOKENS:-\}/.test(web), "compose passes API_TOKENS to the web container (no env_file reaches it otherwise)");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("apiTokens: API_TOKEN or any listed secret, constant-time; labels never tokens; dashboard excluded from minutes");
