// Add an optional note to the fix queue (addsite2 phase two, step 1a).
//
// Since step 1c fix items open themselves from the API writes (config save,
// status change, location override, job delete on an ACTIVE site), with
// estimated minutes. This is for context a write cannot carry; nobody has to
// run it.
//
//   npx tsx scripts/fix-log.ts --site <id> --field APPLY --minutes 12 [--note "..."]
//     [--operator <name>] [--code <label>] [--detail "..."] [--resolved]
//
// Fields: JOB_ID APPLY TITLE DESCRIPTION DATE LOCATION COVERAGE COMPANY OTHER.
// Opens a MANUAL item (open until resolved on the dashboard, or at once with
// --resolved). Posts through the API with the token in .claude/scrap-token;
// the token is never printed.

import fs from "node:fs";
import path from "node:path";
import { parseFixLogArgs } from "./lib/fixLogArgs";

const BASE_URL = "https://scrapper.haide-jobs.co.il";
const TOKEN_PATH = path.join(process.cwd(), ".claude", "scrap-token");

function readToken(): string {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(`Missing ${TOKEN_PATH} — paste the prod API token into that file.`);
  }
  const t = fs.readFileSync(TOKEN_PATH, "utf8").replace(/\s/g, "");
  if (!t || t.startsWith("REPLACE_ME")) {
    throw new Error(".claude/scrap-token is empty or still contains the placeholder.");
  }
  return t;
}

(async () => {
  const parsed = parseFixLogArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`fix-log: ${parsed.error}`);
    console.error('usage: npx tsx scripts/fix-log.ts --site <id> --field APPLY --minutes 12 [--note "..."]');
    process.exit(2);
  }
  const r = await fetch(`${BASE_URL}/api/dashboard/fix-queue`, {
    method: "POST",
    headers: { Authorization: `Bearer ${readToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(parsed.body),
  });
  const text = await r.text();
  if (!r.ok) {
    console.error(`fix-log: POST /api/dashboard/fix-queue -> ${r.status}: ${text}`);
    process.exit(1);
  }
  const item = (JSON.parse(text) as { data: { id: string; field: string; siteId: string; resolvedAt: string | null } }).data;
  console.info(
    `fix-log: logged ${item.field} on ${item.siteId} as ${item.id}` + (item.resolvedAt ? " (resolved)" : " (open)"),
  );
})().catch((e) => {
  console.error(`fix-log: ${(e as Error).message}`);
  process.exit(1);
});
