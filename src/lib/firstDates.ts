import { prisma } from "./prisma";

/**
 * Site.firstActiveAt and Site.firstScrapedAt (step A): each written once, where
 * still NULL, and never again. The condition is in the WHERE, so two writers
 * racing cannot overwrite each other and a later call is a no-op.
 *
 * Bookkeeping, not a site change: no status, note or listing is touched, which
 * is why the worker may call these on a scheduled run too.
 */

export async function markFirstActive(siteId: string, at: Date): Promise<void> {
  await prisma.site.updateMany({ where: { id: siteId, firstActiveAt: null }, data: { firstActiveAt: at } });
}

export async function markFirstScraped(siteId: string, at: Date): Promise<void> {
  await prisma.site.updateMany({ where: { id: siteId, firstScrapedAt: null }, data: { firstScrapedAt: at } });
}
