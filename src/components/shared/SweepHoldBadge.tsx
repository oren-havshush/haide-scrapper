import { holdBadgeText, holdBadgeTitle, type HoldView } from "@/lib/sweepHold";

// A site held or paused out of the sweeps (src/lib/sweepHold.ts). Its status
// stays as it is, so the hold is shown beside the status, never instead of it.
// The words and the vendor come from holdBadgeText, the same reading of the
// note the morning email uses.

const holdStyle = { color: "#f59e0b", background: "rgba(245,158,11,0.15)" };
const pauseStyle = { color: "#38bdf8", background: "rgba(56,189,248,0.15)" };

export function SweepHoldBadge({ site, className }: { site: HoldView & { id: string }; className?: string }) {
  const text = holdBadgeText(site);
  if (!text) return null;
  const style = site.sweepHold === "CHALLENGE_RETRY_SATURDAY" ? pauseStyle : holdStyle;
  return (
    <span
      title={holdBadgeTitle(site)}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${className ?? ""}`}
      style={{ color: style.color, backgroundColor: style.background }}
    >
      {text}
    </span>
  );
}
