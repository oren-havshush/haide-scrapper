/**
 * The fields a post-ACTIVE fix is filed under (Prisma enum FixField, addsite2
 * phase two, step 1a). Its own module so the dashboard can import it without
 * pulling in the server-side validators.
 */
export const FIX_FIELDS = [
  "JOB_ID",
  "APPLY",
  "TITLE",
  "DESCRIPTION",
  "DATE",
  "LOCATION",
  "COVERAGE",
  "COMPANY",
  "OTHER",
] as const;

export type FixFieldValue = (typeof FIX_FIELDS)[number];
