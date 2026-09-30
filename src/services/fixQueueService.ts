import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/errors";
import { cohortOf, scoreSite, type CohortBounds, type Cohort, type ScoreItem } from "@/lib/fixScore";
import type { z } from "zod";
import type { fixItemCreateSchema, fixItemPatchSchema } from "@/lib/validators";

/**
 * The fix queue (addsite2 phase two, step 1a): what a site needed fixing after
 * it went ACTIVE, and how long it took. Operators log MANUAL items here, from
 * the dashboard or scripts/fix-log.ts; step 2's nightly checks will open CHECK
 * items through worker/lib/fixQueuePlan.ts. The API never opens a CHECK item.
 */

const siteSelect = {
  id: true,
  siteUrl: true,
  status: true,
  createdAt: true,
  activeAt: true,
  onboardingSkill: true,
} as const;

export async function listFixItems(opts: {
  siteId?: string;
  open?: boolean;
  cohort?: Exclude<Cohort, "none">;
  bounds?: CohortBounds;
}) {
  const bounds: CohortBounds = opts.bounds ?? { freezeAt: null, switchAt: null };
  const rows = await prisma.fixItem.findMany({
    where: {
      ...(opts.siteId ? { siteId: opts.siteId } : {}),
      ...(opts.open === true ? { resolvedAt: null } : {}),
      ...(opts.open === false ? { resolvedAt: { not: null } } : {}),
    },
    orderBy: [{ siteId: "asc" }, { field: "asc" }, { openedAt: "asc" }],
    include: { site: { select: siteSelect } },
  });
  const items = opts.cohort ? rows.filter((r) => cohortOf(r.site, bounds) === opts.cohort) : rows;

  // The per-site score column: every item of each listed site (open or not),
  // scored over its 14-day window.
  const siteIds = [...new Set(items.map((r) => r.siteId))];
  const all = siteIds.length
    ? await prisma.fixItem.findMany({
        where: { siteId: { in: siteIds } },
        select: { siteId: true, field: true, source: true, code: true, openedAt: true, minutes: true, minutesEstimated: true },
      })
    : [];
  const scoreItems: ScoreItem[] = all;
  const sites = new Map(items.map((r) => [r.siteId, r.site]));
  const now = new Date();
  const scores = [...sites.values()].map((s) => scoreSite(s, scoreItems, { now, bounds }));

  return {
    data: items.map((r) => ({
      id: r.id,
      siteId: r.siteId,
      siteUrl: r.site.siteUrl,
      siteStatus: r.site.status,
      field: r.field,
      source: r.source,
      code: r.code,
      detail: r.detail,
      jobIds: r.jobIds,
      openedAt: r.openedAt,
      resolvedAt: r.resolvedAt,
      resolvedBy: r.resolvedBy,
      minutes: r.minutes,
      minutesEstimated: r.minutesEstimated,
      operator: r.operator,
      note: r.note,
      cohort: cohortOf(r.site, bounds),
    })),
    meta: { total: items.length, scores },
  };
}

export async function createFixItem(input: z.infer<typeof fixItemCreateSchema>) {
  const site = await prisma.site.findUnique({ where: { id: input.siteId }, select: { id: true } });
  if (!site) throw new NotFoundError("Site", input.siteId);
  const now = new Date();
  return prisma.fixItem.create({
    data: {
      siteId: input.siteId,
      field: input.field,
      source: "MANUAL",
      code: input.code,
      detail: input.detail ?? null,
      minutes: input.minutes ?? null,
      operator: input.operator ?? null,
      note: input.note ?? null,
      openedAt: now,
      ...(input.resolved ? { resolvedAt: now, resolvedBy: "MANUAL" as const } : {}),
    },
  });
}

export async function updateFixItem(id: string, patch: z.infer<typeof fixItemPatchSchema>) {
  const existing = await prisma.fixItem.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new NotFoundError("FixItem", id);
  return prisma.fixItem.update({
    where: { id },
    data: {
      ...(patch.minutes !== undefined ? { minutes: patch.minutes } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.operator !== undefined ? { operator: patch.operator } : {}),
      ...(patch.resolved === true ? { resolvedAt: new Date(), resolvedBy: "MANUAL" as const } : {}),
      ...(patch.resolved === false ? { resolvedAt: null, resolvedBy: null } : {}),
    },
  });
}
