import { getSweeps } from "@/services/sweepService";

export const dynamic = "force-dynamic";

const MUTED = "#a1a1aa";
const TEXT = "#fafafa";

function statusColour(status: string): string {
  if (status === "COMPLETED") return "#4ade80";
  if (status === "HALTED") return "#fbbf24";
  if (status === "FAILED") return "#f87171";
  return MUTED; // RUNNING
}

function outcomeColour(outcome: string): string {
  if (outcome === "success") return "#4ade80";
  if (outcome === "hard_failure") return "#f87171";
  if (outcome === "soft_failure") return "#fbbf24";
  return MUTED;
}

/**
 * Sweep history. Read-only.
 *
 * The report shown is `logText` exactly as the driver stored it — the same text
 * `journalctl` has. It is not re-rendered here: the driver knew things the item
 * rows cannot carry (per-site defects), so re-rendering would show a quietly
 * shorter report than the journal's for the same night.
 */
export default async function StatusPage() {
  const { data: sweeps } = await getSweeps({ limit: 20 });

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4" style={{ color: TEXT }}>
        System Status
      </h2>

      {sweeps.length === 0 ? (
        <p style={{ color: MUTED }}>
          No sweeps have run yet. The nightly writes one row per run here.
        </p>
      ) : (
        <div className="space-y-6">
          {sweeps.map((sweep) => (
            <section
              key={sweep.id}
              className="rounded-lg border p-4"
              style={{ borderColor: "#27272a", background: "#18181b" }}
            >
              <header className="mb-3">
                <h3 className="text-base font-medium" style={{ color: TEXT }}>
                  {sweep.verdictLine ?? `${sweep.kind} sweep ${sweep.startedAt.toISOString()}`}
                </h3>
                <p className="text-xs mt-1" style={{ color: MUTED }}>
                  <span style={{ color: statusColour(sweep.status) }}>{sweep.status}</span>
                  {" · "}
                  {sweep.trigger}
                  {" · "}
                  {sweep.startedAt.toISOString()}
                  {sweep.finishedAt
                    ? ` → ${Math.round(
                        (sweep.finishedAt.getTime() - sweep.startedAt.getTime()) / 60_000,
                      )}m`
                    : " · still running"}
                </p>
                {sweep.haltReason && (
                  <p className="text-xs mt-1" style={{ color: "#fbbf24" }}>
                    halted: {sweep.haltReason}
                  </p>
                )}
              </header>

              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-xs">
                {[
                  ["selected", sweep.selectedCount],
                  ["ok", sweep.ok],
                  ["failed", sweep.failed],
                  ["silent drift", sweep.silentDrift],
                  ["listings protected", sweep.listingsProtected],
                  ["would promote", sweep.wouldHavePromoted],
                  ["would demote", sweep.wouldHaveDemoted],
                  ["conflicts", sweep.skippedConflict],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt style={{ color: MUTED }}>{label}</dt>
                    <dd style={{ color: TEXT }}>{String(value)}</dd>
                  </div>
                ))}
              </dl>

              {sweep.logText && (
                <details open>
                  <summary className="text-xs cursor-pointer" style={{ color: MUTED }}>
                    report
                  </summary>
                  <pre
                    className="mt-2 p-3 rounded text-xs overflow-x-auto whitespace-pre-wrap"
                    style={{ background: "#09090b", color: "#d4d4d8" }}
                  >
                    {sweep.logText}
                  </pre>
                </details>
              )}

              {sweep.items.length > 0 && (
                <details className="mt-3">
                  <summary className="text-xs cursor-pointer" style={{ color: MUTED }}>
                    {sweep.items.length} site{sweep.items.length === 1 ? "" : "s"}
                  </summary>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ color: MUTED }}>
                          <th className="text-left py-1 pr-3">site</th>
                          <th className="text-left py-1 pr-3">outcome</th>
                          <th className="text-left py-1 pr-3">category</th>
                          <th className="text-right py-1 pr-3">before</th>
                          <th className="text-right py-1 pr-3">after</th>
                          <th className="text-left py-1 pr-3">status</th>
                          <th className="text-left py-1">withheld</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sweep.items.map((item) => (
                          <tr key={`${item.siteId}-${item.phase}`} style={{ color: "#d4d4d8" }}>
                            <td className="py-1 pr-3 break-all">{item.siteUrl}</td>
                            <td className="py-1 pr-3" style={{ color: outcomeColour(item.outcome) }}>
                              {item.outcome}
                            </td>
                            <td className="py-1 pr-3">{item.failureCategory ?? "—"}</td>
                            <td className="py-1 pr-3 text-right">{item.jobsBefore}</td>
                            <td className="py-1 pr-3 text-right">{item.jobsAfter}</td>
                            <td className="py-1 pr-3">{item.siteStatus}</td>
                            <td className="py-1">
                              {item.wouldPromoteTo
                                ? `promote → ${item.wouldPromoteTo}`
                                : item.wouldDemoteTo
                                  ? `demote → ${item.wouldDemoteTo}`
                                  : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
