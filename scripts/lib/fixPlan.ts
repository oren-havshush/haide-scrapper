// The pure halves of `addsite-batch.ts fix` (addsite2 phase two, step 3):
// the diff it prints before writing, and the acceptance it reads back from the
// guarded run. scripts/lib/fixPlan.test.ts covers both.

import { createHash } from "node:crypto";

/** Top-level body keys that are not stored under fieldMappings._meta. */
const NOT_META = new Set(["fieldMappings", "pageFlow"]);

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function show(v: unknown): string {
  if (v === undefined) return "(absent)";
  const s = JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}

function scriptSummary(v: unknown): string {
  if (typeof v !== "string") return show(v);
  return `${v.length} chars sha256 ${createHash("sha256").update(v).digest("hex").slice(0, 12)}`;
}

/**
 * JSON with object keys sorted at every depth. Postgres jsonb stores keys in
 * its own order and the schema parse returns them in schema order, so key
 * order is never a change.
 */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isRecord(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

function walk(path: string, a: unknown, b: unknown, out: string[], summarise?: (v: unknown) => string): void {
  if (a === undefined && b === undefined) return;
  if (canonical(a) === canonical(b) && (a === undefined) === (b === undefined)) return;
  if (isRecord(a) && isRecord(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])]) walk(`${path}.${k}`, a[k], b[k], out);
    return;
  }
  const fmt = summarise ?? show;
  out.push(`${path}: ${fmt(a)} -> ${fmt(b)}`);
}

/**
 * Path-level diff of two configs in the PUT body shape, printed where each
 * value lives in the stored config: `$.fieldMappings.<field>...`,
 * `$.fieldMappings._meta.<key>...`, `$.pageFlow`. setupScript is summarised by
 * length and hash, and pageFlow by its step count when that changes.
 */
export function renderConfigDiff(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const out: string[] = [];
  walk("$.fieldMappings", before.fieldMappings ?? {}, after.fieldMappings ?? {}, out);
  const pb = Array.isArray(before.pageFlow) ? before.pageFlow : [];
  const pa = Array.isArray(after.pageFlow) ? after.pageFlow : [];
  if (pb.length !== pa.length) out.push(`$.pageFlow: ${pb.length} step(s) -> ${pa.length} step(s)`);
  else walk("$.pageFlow", pb, pa, out);
  const metaKeys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !NOT_META.has(k));
  for (const k of metaKeys) {
    walk(`$.fieldMappings._meta.${k}`, before[k], after[k], out, k === "setupScript" ? scriptSummary : undefined);
  }
  return out;
}

export type AcceptanceInput = {
  /** One entry of GET /api/sites/[id]/guarded-run. */
  request: {
    id: string;
    status: string;
    sweep: {
      id: string;
      startedAt: string;
      status: string;
      item: { outcome: string; wouldPromoteTo: string | null; failureCategory?: string | null } | null;
    } | null;
  };
  /** The site's fix items (GET /api/dashboard/fix-queue?siteId=). */
  items: Array<{ id: string; field: string; source: string; code: string; openedAt: string; resolvedAt: string | null }>;
  /** The field the fix is for (FixField). */
  field: string;
};

/**
 * Proceed to the promotion question only when the guarded run finished, its
 * sweep item says wouldPromoteTo ACTIVE, and no CHECK item for the fixed field
 * was opened during the run (a value check that fired again). The item being
 * fixed was opened before the run; an auto: item is the fix's own write.
 */
export function parseAcceptance(a: AcceptanceInput): { accept: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (a.request.status !== "DONE") reasons.push(`the guarded run is ${a.request.status}, not DONE`);
  const sweep = a.request.sweep;
  const item = sweep?.item ?? null;
  if (!sweep) reasons.push("the guarded run recorded no sweep");
  else if (!item) reasons.push(`sweep ${sweep.id} has no item for this site`);
  else if (item.wouldPromoteTo !== "ACTIVE") {
    reasons.push(
      `wouldPromoteTo is ${item.wouldPromoteTo ?? "null"} (outcome ${item.outcome}${item.failureCategory ? `, ${item.failureCategory}` : ""})`,
    );
  }
  if (sweep) {
    const started = Date.parse(sweep.startedAt);
    for (const i of a.items) {
      if (i.field !== a.field || i.source !== "CHECK" || i.resolvedAt) continue;
      if (i.code.startsWith("auto:")) continue;
      if (Date.parse(i.openedAt) >= started) reasons.push(`CHECK ${i.code} on ${i.field} recurred on this run (item ${i.id})`);
    }
  }
  return { accept: reasons.length === 0, reasons };
}
