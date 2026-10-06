// Run: npx tsx src/lib/fixQueueRoutes.test.ts
//
// addsite2 phase two, step 1a: the fix-queue routes. Source-level, like
// scrapeRequestBoundary.test.ts, because the handlers need a live database.
//   - GET, POST and PATCH exist under /api/, so src/proxy.ts's token covers them;
//   - each body or query goes through its strict schema before the service;
//   - the API opens MANUAL items only: the service writes the source itself and
//     never reads one from the request.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const root = join(__dirname, "..");
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : "");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const list = strip(read("app/api/dashboard/fix-queue/route.ts"));
const one = strip(read("app/api/dashboard/fix-queue/[id]/route.ts"));
const svc = strip(read("services/fixQueueService.ts"));
const proxy = read("proxy.ts");

assert(list.length > 0, "src/app/api/dashboard/fix-queue/route.ts exists");
assert(one.length > 0, "src/app/api/dashboard/fix-queue/[id]/route.ts exists");
assert(svc.length > 0, "src/services/fixQueueService.ts exists");
assert(proxy.includes('matcher: "/api/:path*"'), "the proxy's token covers every /api/ route");

assert(/export async function GET\(/.test(list), "the list route exports GET");
assert(/export async function POST\(/.test(list), "and POST");
assert(/export async function PATCH\(/.test(one), "the item route exports PATCH");

assert(/fixQueueQuerySchema\.safeParse\(/.test(list), "GET parses its query with fixQueueQuerySchema");
assert(/fixItemCreateSchema\.safeParse\(/.test(list), "POST parses its body with fixItemCreateSchema");
assert(/fixItemPatchSchema\.safeParse\(/.test(one), "PATCH parses its body with fixItemPatchSchema");
for (const [name, src] of [["list", list], ["item", one]] as const) {
  assert(src.includes("formatErrorResponse("), `the ${name} route answers errors through formatErrorResponse`);
  assert(!/\.\.\.body/.test(src), `the ${name} route never spreads the raw body`);
}

// The source is the service's to write, and only ever MANUAL through the API.
const create = svc.slice(svc.indexOf("export async function createFixItem("));
const createBody = create.slice(0, create.indexOf("\n}\n"));
assert(createBody.length > 0, "createFixItem exists");
assert(/source: "MANUAL"/.test(createBody), "createFixItem writes source MANUAL itself");
assert(!/input\.source|body\.source|\.\.\.input/.test(createBody), "and never takes a source (or a spread) from its input");
assert(/resolvedBy: "MANUAL"/.test(svc), "an operator's resolve is recorded as resolvedBy MANUAL");

// (n), owner 2026-10-06: the PATCH may close an item as CHECK; MANUAL stays the default.
const update = svc.slice(svc.indexOf("export async function updateFixItem("));
const updateBody = update.slice(0, update.indexOf("\n}\n"));
assert(updateBody.length > 0, "updateFixItem exists");
assert(
  /patch\.resolved === true \? \{ resolvedAt: new Date\(\), resolvedBy: patch\.resolvedBy \?\? "MANUAL" \}/.test(updateBody),
  "updateFixItem resolves as patch.resolvedBy, MANUAL by default",
);

// The Log-fix dialog's site list. Found in the 1a smoke run (2026-09-30): with
// no empty option, a controlled value of "" left the browser showing the one
// filtered site as selected, so clicking it fired no change and "Log fix"
// stayed disabled. An explicit empty first option keeps nothing pre-selected.
const dialog = read("components/fixes/LogFixDialog.tsx");
const siteSelect = dialog.slice(dialog.indexOf("value={siteId}"), dialog.indexOf("</select>", dialog.indexOf("value={siteId}")));
assert(siteSelect.length > 0, "the dialog's site select was found");
assert(/<option value="" disabled>/.test(siteSelect), "the site list starts with an empty, disabled option");

// Step 1c: items open themselves from API writes; the page is for optional
// notes, and an estimated minute count says so.
const svcRaw = read("services/fixQueueService.ts");
assert(/minutesEstimated: r\.minutesEstimated/.test(svcRaw), "the list returns whether minutes are estimated");
const table = read("components/fixes/FixQueueTable.tsx");
assert(/minutesEstimated \? `~\$\{i\.minutes\}`/.test(table), "the table marks estimated minutes with ~");
const page = read("app/(dashboard)/fixes/page.tsx");
assert(page.includes("Add note") && !page.includes(">Log fix<"), "the page's button offers a note, not a duty to log");
assert(dialog.includes("optional"), "and the dialog says the note is optional");

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.info("fixQueueRoutes: three routes behind the token, strict bodies, MANUAL items only");
