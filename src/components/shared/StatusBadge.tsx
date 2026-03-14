type SiteStatusValue = "ANALYZING" | "REVIEW" | "ACTIVE" | "FAILED" | "SKIPPED";

interface StatusBadgeProps {
  status: SiteStatusValue;
  className?: string;
}

const statusStyles: Record<string, { color: string; background: string }> = {
  ANALYZING: { color: "#3b82f6", background: "rgba(59,130,246,0.15)" },
  REVIEW: { color: "#f59e0b", background: "rgba(245,158,11,0.15)" },
  ACTIVE: { color: "#22c55e", background: "rgba(34,197,94,0.15)" },
  FAILED: { color: "#ef4444", background: "rgba(239,68,68,0.15)" },
  SKIPPED: { color: "#6b7280", background: "rgba(107,114,128,0.15)" },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const style = statusStyles[status] ?? statusStyles.SKIPPED;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className ?? ""}`}
      style={{ color: style.color, backgroundColor: style.background }}
    >
      {status}
    </span>
  );
}
