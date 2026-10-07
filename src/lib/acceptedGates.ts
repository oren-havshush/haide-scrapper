/**
 * Accepted gates (owner, 2026-10-07). A site the owner set ACTIVE below an
 * activation gate — naya-tech (description fill 20%), mor (57%), allegronet
 * (50%), each recorded in its adminNote — printed "would have demoted to
 * REVIEW" under the nightly's Needs attention every night. `_meta.acceptedGates`
 * records the decision, keyed by gate, with the fill it was accepted at and a
 * note. The nightly then lists the site under "Accepted below gate (n)" with
 * its current fill, until the fill falls ACCEPTED_GATE_FURTHER_FALL or more
 * below the accepted level, when the Tier-A line is back under Needs attention.
 *
 * Setting it is not a scrape change (onlyAcceptedGatesChanged): the write keeps
 * the site's status and savedAt, opens no fix item, and needs no guarded run.
 *
 * Pure, and free of server imports: the worker's report reads it too.
 */

export const ACCEPTABLE_GATES = ["description_fill"] as const;
export type AcceptableGate = (typeof ACCEPTABLE_GATES)[number];
export type AcceptedGate = { fill: number; note: string };
export type AcceptedGates = Partial<Record<AcceptableGate, AcceptedGate>>;

/** The Tier-A line is back once the fill is this far below the accepted level. */
export const ACCEPTED_GATE_FURTHER_FALL = 0.2;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

function isAcceptedGate(v: unknown): v is AcceptedGate {
  return (
    isRecord(v) &&
    typeof v.fill === "number" &&
    v.fill >= 0 &&
    v.fill <= 1 &&
    typeof v.note === "string" &&
    v.note.trim().length > 0
  );
}

/** `_meta.acceptedGates` of a site's fieldMappings; null when absent or unusable. */
export function readAcceptedGates(fieldMappings: unknown): AcceptedGates | null {
  if (!isRecord(fieldMappings) || !isRecord(fieldMappings._meta)) return null;
  const raw = fieldMappings._meta.acceptedGates;
  if (!isRecord(raw)) return null;
  const out: AcceptedGates = {};
  for (const gate of ACCEPTABLE_GATES) {
    if (isAcceptedGate(raw[gate])) out[gate] = { fill: raw[gate].fill, note: raw[gate].note };
  }
  return Object.keys(out).length > 0 ? out : null;
}

const GATE_REASON = /^Tier-A gate: (.*) — sampled \d+ jobs? from current run$/;
const DESCRIPTION_ITEM = /^description fill (\d+)% < \d+%$/;

/**
 * The description fill the activation gate demoted on, read from its reason
 * (decideActivationStatus in worker/jobs/scrape.ts) — but only when that was
 * the gate's sole failing item. Any other Tier-A failure returns null, so an
 * accepted description gate never hides it.
 */
export function descriptionFillFromGateReason(reason: string | null | undefined): number | null {
  const m = (reason ?? "").trim().match(GATE_REASON);
  if (!m) return null;
  const items = m[1].split("; ");
  if (items.length !== 1) return null;
  const d = items[0].match(DESCRIPTION_ITEM);
  return d ? Number(d[1]) / 100 : null;
}

/**
 * A withheld demotion that the site's accepted gate covers: the description
 * fill was the only failing item, and it has not fallen
 * ACCEPTED_GATE_FURTHER_FALL or more below the accepted level.
 */
export function acceptedBelowGate(
  item: { wouldDemoteTo: string | null; gateReason?: string | null },
  gates: AcceptedGates | null | undefined,
): { fill: number; acceptedFill: number } | null {
  const accepted = gates?.description_fill;
  if (!item.wouldDemoteTo || !accepted) return null;
  const fill = descriptionFillFromGateReason(item.gateReason);
  if (fill === null) return null;
  // Whole percentage points, as the gate prints them, so 0.5 - 0.3 is a fall
  // of exactly 20 and not 19.999.
  const fallPoints = Math.round(accepted.fill * 100) - Math.round(fill * 100);
  if (fallPoints >= Math.round(ACCEPTED_GATE_FURTHER_FALL * 100)) return null;
  return { fill, acceptedFill: accepted.fill };
}

/** Sorted-key JSON with null and undefined dropped, so key order and explicit nulls are no change. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isRecord(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined && v[k] !== null)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Everything the scrape reads: the config without acceptedGates and the savedAt stamp. */
function scrapeShape(c: { fieldMappings: unknown; pageFlow: unknown }): string {
  const fm = isRecord(c.fieldMappings) ? { ...c.fieldMappings } : {};
  const meta = isRecord(fm._meta) ? { ...fm._meta } : {};
  delete meta.acceptedGates;
  delete meta.savedAt;
  return canonical({ ...fm, _meta: meta, __pageFlow: c.pageFlow ?? [] });
}

const gatesOf = (c: { fieldMappings: unknown }) =>
  canonical(isRecord(c.fieldMappings) && isRecord(c.fieldMappings._meta) ? c.fieldMappings._meta.acceptedGates : null);

/** True when acceptedGates changed and nothing the scrape reads did. */
export function onlyAcceptedGatesChanged(
  before: { fieldMappings: unknown; pageFlow: unknown },
  after: { fieldMappings: unknown; pageFlow: unknown },
): boolean {
  return gatesOf(before) !== gatesOf(after) && scrapeShape(before) === scrapeShape(after);
}
