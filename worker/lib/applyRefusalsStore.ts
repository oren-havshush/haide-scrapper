/**
 * The apply-refusals reader's database side (worker/lib/applyRefusals.ts):
 * reads jobs and the reader's own fix items, writes only the reader's items
 * (CHECK, code prefix "public_site:", field APPLY). Never a site's status,
 * config or jobs.
 */
import { prisma } from "../../src/lib/prisma";
import { hostOf, LEFT_THE_LIST, READER_CODE_PREFIX, type CandidateJob, type RefusalsStore } from "./applyRefusals";

export const prismaRefusalsStore: RefusalsStore = {
  async candidates(externalJobIds) {
    const jobs = await prisma.job.findMany({
      where: { externalJobId: { in: externalJobIds } },
      select: { siteId: true, externalJobId: true, site: { select: { siteUrl: true } } },
    });
    const siteIds = [...new Set(jobs.map((j) => j.siteId))];
    const details = siteIds.length
      ? await prisma.job.findMany({ where: { siteId: { in: siteIds }, detailUrl: { not: null } }, select: { siteId: true, detailUrl: true } })
      : [];
    const hosts = new Map<string, Set<string>>();
    for (const j of jobs) {
      const set = hosts.get(j.siteId) ?? new Set<string>();
      const h = hostOf(j.site.siteUrl);
      if (h) set.add(h);
      hosts.set(j.siteId, set);
    }
    for (const d of details) {
      const h = hostOf(d.detailUrl ?? "");
      if (h) hosts.get(d.siteId)?.add(h);
    }
    return jobs.map((j): CandidateJob => ({ siteId: j.siteId, externalJobId: j.externalJobId ?? "", siteHosts: hosts.get(j.siteId) ?? new Set() }));
  },
  async openReaderItems() {
    return prisma.fixItem.findMany({
      where: { resolvedAt: null, source: "CHECK", code: { startsWith: READER_CODE_PREFIX } },
      select: { id: true, siteId: true, code: true, jobIds: true },
    });
  },
  async openItem(i) {
    await prisma.fixItem.create({
      data: {
        siteId: i.siteId,
        field: "APPLY",
        source: "CHECK",
        code: i.code,
        detail: i.detail,
        jobIds: [i.externalJobId],
        openedAt: i.now,
        note: "public site apply refusals",
      },
    });
  },
  async keepItem(i) {
    await prisma.fixItem.update({ where: { id: i.id }, data: { detail: i.detail } });
  },
  async resolveItems(ids, now) {
    await prisma.fixItem.updateMany({ where: { id: { in: ids } }, data: { resolvedAt: now, resolvedBy: "CHECK", note: LEFT_THE_LIST } });
  },
};
