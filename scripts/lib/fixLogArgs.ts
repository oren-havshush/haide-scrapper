// scripts/fix-log.ts's flags, turned into the POST body for
// /api/dashboard/fix-queue and checked against the route's own strict schema,
// so a typo fails on the operator's machine rather than as a 400.

import { FIX_FIELDS, fixItemCreateSchema } from "../../src/lib/validators";

export type FixLogParse = { ok: true; body: Record<string, unknown> } | { ok: false; error: string };

const VALUE_FLAGS: Record<string, string> = {
  "--site": "siteId",
  "--field": "field",
  "--minutes": "minutes",
  "--note": "note",
  "--operator": "operator",
  "--code": "code",
  "--detail": "detail",
};

export function parseFixLogArgs(argv: string[]): FixLogParse {
  const raw: Record<string, unknown> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--resolved") {
      raw.resolved = true;
      continue;
    }
    const key = VALUE_FLAGS[flag];
    if (!key) return { ok: false, error: `unknown flag ${flag}` };
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) return { ok: false, error: `${flag} needs a value` };
    i++;
    if (key === "minutes") {
      const n = Number(value);
      if (!Number.isInteger(n)) return { ok: false, error: `--minutes must be a whole number (got ${value})` };
      raw.minutes = n;
    } else if (key === "field") {
      raw.field = value.toUpperCase();
    } else {
      raw[key] = value;
    }
  }
  if (!raw.siteId) return { ok: false, error: "--site <id> is required" };
  if (!raw.field) return { ok: false, error: `--field is required: one of ${FIX_FIELDS.join(" ")}` };
  if (!(FIX_FIELDS as readonly string[]).includes(String(raw.field))) {
    return { ok: false, error: `--field ${String(raw.field)} is not one of ${FIX_FIELDS.join(" ")}` };
  }
  const parsed = fixItemCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") };
  return { ok: true, body: parsed.data };
}
