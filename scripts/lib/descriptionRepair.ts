// The per-row decision of scripts/backfill-description-structure.ts, pure so it
// can be tested without a database. A run-on description or requirements text
// is rebuilt with line breaks (worker/lib/descriptionStructure.ts); a row whose
// description is rewritten also gets the contentHash of its new text
// (worker/lib/contentHash.ts), since the public site compares that hash.
// Requirements are not in the hash, so a requirements-only rewrite leaves it.

import { isBlob, structureDescription } from "../../worker/lib/descriptionStructure";
import { jobContentHash } from "../../worker/lib/contentHash";

export type DescriptionRepair = { description?: string; requirements?: string; contentHash?: string };

export function planDescriptionRepair(job: {
  title: string;
  description: string | null;
  requirements: string | null;
}): DescriptionRepair | null {
  const data: DescriptionRepair = {};

  const d = job.description ?? "";
  if (isBlob(d)) {
    const fixed = structureDescription(d);
    if (fixed !== d) data.description = fixed;
  }

  const r = job.requirements ?? "";
  if (isBlob(r)) {
    const fixed = structureDescription(r);
    if (fixed !== r) data.requirements = fixed;
  }

  if (data.description !== undefined) data.contentHash = jobContentHash(job.title, data.description);
  return Object.keys(data).length === 0 ? null : data;
}
