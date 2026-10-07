// Automatic fix items (addsite2 phase two, step 1c; the owner's redesign of
// 2026-09-30). Pure: what a write changed in, which fix items to open or
// extend out. src/services/autoFixService.ts reads and writes the rows.
//
// Every write to a site that is ACTIVE when the write arrives opens a CHECK
// item coded auto:<route>, filed under the field the change touched:
//   config save, setupScript or selector change  -> COVERAGE
//   config save touching exactly one mapped field -> that field
//   formCapture change                            -> APPLY
//   location override                             -> LOCATION
//   manual job delete                             -> COVERAGE
//   status change away from ACTIVE                -> OTHER
//   company name, profile, logo, HQ city, homepage -> COMPANY, only when the
//     write changes a field that already held a non-empty value (owner,
//     2026-10-02); a write that only fills empty fields is onboarding
// Admin note, scrape, analyze and policy review file nothing.
// A write to a site that is not ACTIVE opens nothing. The same site and field
// written again within AUTO_FIX_EXTEND_MS extends the open item instead —
// whatever the site's status by then, because the first config save itself
// demotes the site to REVIEW and the rest of the fix happens there.

import type { FixFieldValue } from "./fixFields";

/** A write within this long of an item's last write extends it. */
export const AUTO_FIX_EXTEND_MS = 60 * 60_000;

/** A site's stored config: fieldMappings (with _meta) and pageFlow. */
export type ConfigSnapshot = { fieldMappings: unknown; pageFlow: unknown };

export type AutoFixWrite =
  | { kind: "config"; before: ConfigSnapshot; after: ConfigSnapshot }
  | { kind: "location_override" }
  | { kind: "jobs_delete" }
  | { kind: "status"; to: string }
  /** A company field: name, profile, logo, HQ city or homepage, with the
   *  site's company fields read just before and just after the write. */
  | { kind: "company"; before: CompanySnapshot; after: CompanySnapshot }
  /** Any other write: files nothing, but still recomputes the day's minutes. */
  | { kind: "other" };

/** The Site columns a company write can change (not the capture's bookkeeping,
 *  companyProfileAt and companyProfileStatus, which every capture restamps). */
export const COMPANY_COLUMNS = [
  "companyName",
  "companyHomepageUrl",
  "companyAbout",
  "companyLogoPath",
  "companyLogoSourceUrl",
  "companyHqAddress",
  "companyHqCity",
  "companyHqCitySource",
] as const;

export type CompanySnapshot = Partial<Record<string, unknown>>;

/** An open auto item on the site, for the one-hour extension. */
export type OpenAutoItem = { id: string; field: string; lastWriteAt: Date };

export type AutoFixPlan = { open: Array<{ field: FixFieldValue; code: string }>; extend: string[] };

/**
 * Mapped field names (the keys of fieldMappings, measured across
 * sites/_configs on 2026-09-30) to the field a fix is filed under. A name not
 * listed is OTHER.
 */
const MAPPED_FIELD: Readonly<Record<string, FixFieldValue>> = {
  title: "TITLE",
  description: "DESCRIPTION",
  requirements: "DESCRIPTION",
  skills: "DESCRIPTION",
  location: "LOCATION",
  externalJobId: "JOB_ID",
  jobNumber: "JOB_ID",
  publishDate: "DATE",
  deadline: "DATE",
  applicationInfo: "APPLY",
  applicationFormSchema: "APPLY",
  applicationFormAction: "APPLY",
  contactEmail: "APPLY",
  company: "COMPANY",
  detailUrl: "COVERAGE",
};

/**
 * _meta keys that carry no behaviour: a change in them alone is no change.
 * acceptedGates is a report setting (src/lib/acceptedGates.ts), not a fix.
 */
const INERT_META = new Set(["savedAt", "originalMappings", "acceptedGates"]);

/**
 * JSON with object keys sorted, so jsonb's key reordering is not a change, and
 * with null-valued keys dropped at every depth: saveSiteConfig writes explicit
 * nulls where an older config simply lacks the key, and the two mean the same.
 */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined && o[k] !== null)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function configFields(before: ConfigSnapshot, after: ConfigSnapshot): FixFieldValue[] {
  const fb = asRecord(before.fieldMappings);
  const fa = asRecord(after.fieldMappings);
  const mb = asRecord(fb._meta);
  const ma = asRecord(fa._meta);

  const changedMapped = [...new Set([...Object.keys(fb), ...Object.keys(fa)])]
    .filter((k) => k !== "_meta")
    .filter((k) => canonical(fb[k]) !== canonical(fa[k]));
  const changedMeta = [...new Set([...Object.keys(mb), ...Object.keys(ma)])]
    .filter((k) => !INERT_META.has(k))
    .filter((k) => canonical(mb[k]) !== canonical(ma[k]));
  const formCapture = changedMeta.includes("formCapture");
  const coverageKeys = changedMeta.filter((k) => k !== "formCapture");
  const pageFlow = canonical(before.pageFlow) !== canonical(after.pageFlow);

  const out: FixFieldValue[] = [];
  if (formCapture) out.push("APPLY");
  if (changedMapped.length === 1 && coverageKeys.length === 0 && !pageFlow) {
    const f = MAPPED_FIELD[changedMapped[0]] ?? "OTHER";
    if (!out.includes(f)) out.push(f);
  } else if (changedMapped.length > 0 || coverageKeys.length > 0 || pageFlow) {
    out.push("COVERAGE");
  }
  return out;
}

const isEmptyValue = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** True when the write changed a company field that already held a value. */
function changedHeldCompanyField(before: CompanySnapshot, after: CompanySnapshot): boolean {
  return COMPANY_COLUMNS.some((k) => !isEmptyValue(before[k]) && canonical(before[k]) !== canonical(after[k]));
}

export function fieldsForWrite(write: AutoFixWrite): FixFieldValue[] {
  switch (write.kind) {
    case "config":
      return configFields(write.before, write.after);
    case "location_override":
      return ["LOCATION"];
    case "jobs_delete":
      return ["COVERAGE"];
    case "status":
      return write.to === "ACTIVE" ? [] : ["OTHER"];
    case "company":
      return changedHeldCompanyField(write.before, write.after) ? ["COMPANY"] : [];
    case "other":
      return [];
  }
}

export function planAutoFix(a: {
  statusBefore: string;
  fields: FixFieldValue[];
  code: string;
  now: Date;
  openAuto: OpenAutoItem[];
}): AutoFixPlan {
  const plan: AutoFixPlan = { open: [], extend: [] };
  for (const field of a.fields) {
    const recent = a.openAuto.find(
      (i) => i.field === field && a.now.getTime() - i.lastWriteAt.getTime() <= AUTO_FIX_EXTEND_MS,
    );
    if (recent) {
      if (!plan.extend.includes(recent.id)) plan.extend.push(recent.id);
    } else if (a.statusBefore === "ACTIVE") {
      plan.open.push({ field, code: a.code });
    }
  }
  return plan;
}

/** Midnight of `now`'s calendar day in `timeZone`, as an instant. */
export function startOfLocalDay(now: Date, timeZone: string): Date {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  const sinceMidnight = ((Number(p.hour) * 60 + Number(p.minute)) * 60 + Number(p.second)) * 1000 + now.getUTCMilliseconds();
  return new Date(now.getTime() - sinceMidnight);
}

/** The calendar date of `d` in `timeZone`, as YYYY-MM-DD. */
function localDate(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * Estimated minutes: from the first API call on the site that day (same token,
 * already filtered by the caller) to `now`, the write being recorded.
 */
export function estimateMinutes(calls: Date[], now: Date, timeZone: string): number {
  const day = localDate(now, timeZone);
  const today = calls.filter((c) => localDate(c, timeZone) === day && c.getTime() <= now.getTime());
  if (today.length === 0) return 0;
  const first = Math.min(...today.map((c) => c.getTime()));
  return Math.round((now.getTime() - first) / 60_000);
}
