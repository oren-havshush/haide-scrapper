"use client";

/**
 * Site.companyProfileStatus, as a chip.
 *
 * The column is TEXT rather than an enum on purpose (see prisma/schema.prisma),
 * so an unrecognised value must render rather than throw — hence the fallback
 * branch instead of an exhaustive Record lookup.
 *
 * NULL is meaningful and distinct from FAILED: it means the capture was never
 * attempted, which is what separates "we tried and this company publishes
 * nothing" from "we have not looked yet".
 */

export type CompanyProfileStatusValue = "COMPLETE" | "PARTIAL" | "FAILED" | null;

const STYLES: Record<string, { label: string; color: string; border: string; bg: string }> = {
  COMPLETE: {
    label: "Complete",
    color: "#4ade80",
    border: "rgba(74,222,128,0.3)",
    bg: "rgba(74,222,128,0.1)",
  },
  PARTIAL: {
    label: "Partial",
    color: "#fbbf24",
    border: "rgba(251,191,36,0.3)",
    bg: "rgba(251,191,36,0.1)",
  },
  FAILED: {
    label: "Failed",
    color: "#f87171",
    border: "rgba(248,113,113,0.3)",
    bg: "rgba(248,113,113,0.1)",
  },
};

const NOT_CAPTURED = {
  label: "Not captured",
  color: "#71717a",
  border: "#27272a",
  bg: "transparent",
};

export function CompanyProfileBadge({
  status,
  title,
}: {
  status: CompanyProfileStatusValue | string;
  title?: string;
}) {
  const style =
    status == null
      ? NOT_CAPTURED
      : (STYLES[status] ?? { ...NOT_CAPTURED, label: String(status) });

  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{ color: style.color, borderColor: style.border, backgroundColor: style.bg }}
      title={title}
    >
      {style.label}
    </span>
  );
}
