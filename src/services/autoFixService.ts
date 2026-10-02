import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sweepConfig } from "@/lib/config";
import {
  COMPANY_COLUMNS,
  estimateMinutes,
  fieldsForWrite,
  planAutoFix,
  startOfLocalDay,
  type AutoFixWrite,
  type CompanySnapshot,
} from "@/lib/autoFix";
import { isDashboardToken } from "@/lib/apiTokens";

/**
 * Fix items opened by the API writes themselves (addsite2 phase two, step 1c).
 * The rules are pure, in src/lib/autoFix.ts; this reads and writes the rows.
 *
 * Nothing here may fail the request it rides on: the write has already
 * happened, and the fix queue is a measurement of it. Every error is logged
 * and swallowed.
 */

const PRUNE_AFTER_MS = 7 * 24 * 60 * 60_000;

function bearerOf(request: Request): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

/** sha256 prefix of the bearer token. The token itself is never stored or logged. */
export function tokenHashOf(request: Request): string {
  const token = bearerOf(request);
  return token ? createHash("sha256").update(token).digest("hex").slice(0, 16) : "none";
}

/**
 * The request carries the dashboard's own token (step B). Its calls are not
 * recorded and it never moves the minutes estimate: the owner browsing a site
 * is not an operator fixing it.
 */
function fromDashboard(request: Request): boolean {
  return isDashboardToken(bearerOf(request), process.env.NEXT_PUBLIC_API_TOKEN);
}

/**
 * Record an API call on a site, for the minutes estimate. Only a token's FIRST
 * call on the site each day is kept — the estimate runs from it to the latest
 * write — so a dashboard polling a site adds one row a day, not thousands.
 */
export async function recordSiteCall(request: Request, siteId: string, route: string): Promise<void> {
  try {
    if (isDashboardToken(bearerOf(request), process.env.NEXT_PUBLIC_API_TOKEN)) return;
    const now = new Date();
    const tokenHash = tokenHashOf(request);
    const dayStart = startOfLocalDay(now, sweepConfig.timezone);
    const seen = await prisma.siteApiCall.findFirst({
      where: { siteId, tokenHash, at: { gte: dayStart } },
      select: { id: true },
    });
    if (!seen) {
      await prisma.siteApiCall.create({ data: { siteId, tokenHash, method: request.method, route, at: now } });
    }
  } catch (err) {
    console.warn(`[auto-fix] could not record the call on ${siteId}: ${(err as Error).message}`);
  }
}

/** The site's status now — read BEFORE a write, for applyAutoFix's statusBefore. */
/**
 * The site's company fields (COMPANY_COLUMNS), read before and after a company
 * write so the rule can tell a change from onboarding. Never throws: an empty
 * snapshot opens nothing.
 */
export async function companySnapshotOf(siteId: string): Promise<CompanySnapshot> {
  try {
    const select = Object.fromEntries(COMPANY_COLUMNS.map((c) => [c, true])) as Record<(typeof COMPANY_COLUMNS)[number], true>;
    return ((await prisma.site.findUnique({ where: { id: siteId }, select })) ?? {}) as CompanySnapshot;
  } catch {
    return {};
  }
}

export async function siteStatusOf(siteId: string): Promise<string> {
  try {
    return (await prisma.site.findUnique({ where: { id: siteId }, select: { status: true } }))?.status ?? "";
  } catch {
    return "";
  }
}

/**
 * A write the rules file nothing for (an admin note, a scrape, an analysis,
 * a policy review): records the call and recomputes the day's minutes, and
 * never opens an item.
 */
export async function noteSiteWrite(request: Request, siteId: string, route: string): Promise<void> {
  await applyAutoFix({ request, siteId, statusBefore: "", route, write: { kind: "other" } });
}

/**
 * After a write to a site: open or extend its auto fix items (src/lib/autoFix.ts)
 * and recompute the estimated minutes of the items this token opened today.
 *
 * @param statusBefore the site's status when the write ARRIVED — a config save
 *   demotes an ACTIVE site to REVIEW, and that save is still a write to an
 *   ACTIVE site.
 */
export async function applyAutoFix(a: {
  request: Request;
  siteId: string;
  statusBefore: string;
  route: string;
  write: AutoFixWrite;
}): Promise<void> {
  try {
    const now = new Date();
    const timeZone = sweepConfig.timezone;
    const tokenHash = tokenHashOf(a.request);
    const code = `auto:${a.route}`;
    // The dashboard's token opens and extends items like any other writer, but
    // is never recorded and never estimated (step B).
    const dashboard = fromDashboard(a.request);

    await recordSiteCall(a.request, a.siteId, a.route);
    await prisma.siteApiCall.deleteMany({
      where: { siteId: a.siteId, at: { lt: new Date(now.getTime() - PRUNE_AFTER_MS) } },
    });

    const openAuto = await prisma.fixItem.findMany({
      where: { siteId: a.siteId, source: "CHECK", code: { startsWith: "auto:" }, resolvedAt: null, lastWriteAt: { not: null } },
      select: { id: true, field: true, lastWriteAt: true },
    });
    const plan = planAutoFix({
      statusBefore: a.statusBefore,
      fields: fieldsForWrite(a.write),
      code,
      now,
      openAuto: openAuto.map((i) => ({ id: i.id, field: i.field, lastWriteAt: i.lastWriteAt as Date })),
    });

    for (const o of plan.open) {
      await prisma.fixItem.create({
        data: {
          siteId: a.siteId,
          field: o.field,
          source: "CHECK",
          code: o.code,
          detail: `opened by ${a.route}`,
          openedAt: now,
          lastWriteAt: now,
          tokenHash,
          minutesEstimated: !dashboard,
        },
      });
    }
    if (plan.extend.length > 0) {
      await prisma.fixItem.updateMany({ where: { id: { in: plan.extend } }, data: { lastWriteAt: now } });
    }

    // Recomputed on every write, whatever the site's status: the fix goes on
    // after the first save has demoted the site. Not for the dashboard's token.
    if (!dashboard) {
      const dayStart = startOfLocalDay(now, timeZone);
      const calls = await prisma.siteApiCall.findMany({
        where: { siteId: a.siteId, tokenHash, at: { gte: dayStart } },
        select: { at: true },
      });
      const minutes = estimateMinutes(calls.map((c) => c.at), now, timeZone);
      await prisma.fixItem.updateMany({
        where: {
          siteId: a.siteId,
          tokenHash,
          source: "CHECK",
          code: { startsWith: "auto:" },
          resolvedAt: null,
          openedAt: { gte: dayStart },
        },
        data: { minutes, minutesEstimated: true },
      });
    }
  } catch (err) {
    console.warn(`[auto-fix] could not record the fix for ${a.siteId}: ${(err as Error).message}`);
  }
}
