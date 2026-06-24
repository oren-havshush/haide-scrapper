export type PolicyStatusValue =
  | "NOT_CHECKED"
  | "POLICY_NOT_FOUND"
  | "NO_EXPLICIT_RESTRICTION"
  | "RESTRICTED"
  | "REQUIRES_WRITTEN_PERMISSION"
  | "UNCLEAR_NEEDS_REVIEW"
  | "CHECK_FAILED";

interface PolicyStatusBadgeProps {
  status: PolicyStatusValue;
  className?: string;
}

export const POLICY_STATUS_LABELS: Record<PolicyStatusValue, string> = {
  NOT_CHECKED: "Not checked yet",
  POLICY_NOT_FOUND: "Policy not found",
  NO_EXPLICIT_RESTRICTION: "No explicit restriction found",
  RESTRICTED: "Restriction found",
  REQUIRES_WRITTEN_PERMISSION: "Requires written permission",
  UNCLEAR_NEEDS_REVIEW: "Unclear / needs manual review",
  CHECK_FAILED: "Failed to check",
};

const policyStatusStyles: Record<PolicyStatusValue, { color: string; background: string }> = {
  NOT_CHECKED: { color: "#6b7280", background: "rgba(107,114,128,0.12)" },
  POLICY_NOT_FOUND: { color: "#a1a1aa", background: "rgba(161,161,170,0.12)" },
  NO_EXPLICIT_RESTRICTION: { color: "#22c55e", background: "rgba(34,197,94,0.12)" },
  RESTRICTED: { color: "#ef4444", background: "rgba(239,68,68,0.15)" },
  REQUIRES_WRITTEN_PERMISSION: { color: "#f97316", background: "rgba(249,115,22,0.15)" },
  UNCLEAR_NEEDS_REVIEW: { color: "#f59e0b", background: "rgba(245,158,11,0.15)" },
  CHECK_FAILED: { color: "#6b7280", background: "rgba(107,114,128,0.12)" },
};

export function PolicyStatusBadge({ status, className }: PolicyStatusBadgeProps) {
  const style = policyStatusStyles[status] ?? policyStatusStyles.NOT_CHECKED;
  const label = POLICY_STATUS_LABELS[status] ?? status;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${className ?? ""}`}
      style={{ color: style.color, backgroundColor: style.background }}
    >
      {label}
    </span>
  );
}
