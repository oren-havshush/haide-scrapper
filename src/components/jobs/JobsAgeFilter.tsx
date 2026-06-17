"use client";

const AGE_OPTIONS = [
  { value: "", label: "All publish dates" },
  { value: "fresh", label: "Fresh (< 90 days)" },
  { value: "over90", label: "Older than 90 days" },
  { value: "over180", label: "Older than 180 days" },
  { value: "over365", label: "Older than 365 days" },
  { value: "none", label: "No date" },
] as const;

interface JobsAgeFilterProps {
  value: string;
  onChange: (value: string) => void;
}

export function JobsAgeFilter({ value, onChange }: JobsAgeFilterProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border border-[#27272a] bg-[#09090b] px-3 text-sm text-[#fafafa] focus:outline-none focus:ring-1 focus:ring-[#3b82f6] w-full"
    >
      {AGE_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
