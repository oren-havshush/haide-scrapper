/**
 * Read every job of a site through GET /api/jobs, page by page (report fixes
 * 3, item 10; the developer's 2026-10-21 report, item 4, LRN-API-12).
 *
 * verify-jobids and verify-location-csv, both mandatory before ACTIVE, read
 * one page of 100 and printed "OK: 100 jobs" with no sign that the rest went
 * unread: l-b.co.il has 655 jobs, careers.eladsoft.com 261. They now page with
 * pageSize 100 and page=1,2,... until a short page, and say how many they
 * checked of meta.total; fewer than the total is a failure. Paging is sound
 * only since the list's sort was made total (createdAt, then id).
 */

export const JOB_PAGE_SIZE = 100;
/** A ceiling on pages, so a server that never answers a short page cannot loop forever. */
const MAX_PAGES = 200;

export interface JobPage<T> {
  data?: T[];
  meta?: { total?: number };
}

export interface PagedJobs<T> {
  /** Every job read, each once (by id). */
  jobs: T[];
  /** meta.total from the first page (0 when absent). */
  total: number;
  pages: number;
  /** True when the jobs read are at least meta.total. */
  complete: boolean;
}

export async function pageAllJobs<T extends { id?: string }>(
  fetchPage: (page: number, pageSize: number) => Promise<JobPage<T>>,
  pageSize = JOB_PAGE_SIZE,
): Promise<PagedJobs<T>> {
  const byId = new Map<string, T>();
  const noId: T[] = [];
  let total = 0;
  let pages = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await fetchPage(page, pageSize);
    const data = Array.isArray(r?.data) ? r.data : [];
    if (page === 1) total = typeof r?.meta?.total === "number" ? r.meta.total : 0;
    pages = page;
    for (const j of data) {
      if (typeof j.id === "string") {
        if (!byId.has(j.id)) byId.set(j.id, j);
      } else noId.push(j);
    }
    if (data.length < pageSize) break;
  }
  const jobs = [...byId.values(), ...noId];
  return { jobs, total, pages, complete: jobs.length >= total };
}

/** The line both gates print: "checked N of T". */
export function checkedLine(p: { jobs: unknown[]; total: number }): string {
  return `checked ${p.jobs.length} of ${p.total}`;
}

/** The API's page reader for one site, for the gates. */
export function siteJobsPageReader<T>(
  base: string,
  siteId: string,
  headers: Record<string, string>,
): (page: number, pageSize: number) => Promise<JobPage<T>> {
  return async (page, pageSize) => {
    const res = await fetch(
      `${base}/api/jobs?siteId=${encodeURIComponent(siteId)}&pageSize=${pageSize}&page=${page}`,
      { headers },
    );
    if (!res.ok) throw new Error(`GET /api/jobs page ${page}: ${res.status}`);
    return (await res.json()) as JobPage<T>;
  };
}
