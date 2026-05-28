"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

interface SiteSearchFiltersProps {
  companyNameSearch: string;
  urlSearch: string;
  onCompanyNameSearchChange: (value: string) => void;
  onUrlSearchChange: (value: string) => void;
}

const DEBOUNCE_MS = 250;

// Wraps a controlled input so the parent only sees the latest value after the
// user stops typing for DEBOUNCE_MS. Avoids a refetch per keystroke.
function DebouncedFilterInput({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  type?: string;
}) {
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);

  // Keep the ref pointed at the latest onChange so the debounce timer always
  // fires with the current callback (the timer's closure can't see prop
  // updates on its own). Writing the ref in an effect satisfies the
  // react-hooks/refs rule, which forbids mutating refs during render.
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Re-sync if the parent resets the filter (e.g. a "Clear" button later).
  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <Input
      type={type}
      value={local}
      onChange={(e) => {
        const next = e.target.value;
        setLocal(next);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          onChangeRef.current(next);
        }, DEBOUNCE_MS);
      }}
      placeholder={placeholder}
      className="text-[13px]"
    />
  );
}

export function SiteSearchFilters({
  companyNameSearch,
  urlSearch,
  onCompanyNameSearchChange,
  onUrlSearchChange,
}: SiteSearchFiltersProps) {
  return (
    <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
      <DebouncedFilterInput
        value={companyNameSearch}
        onChange={onCompanyNameSearchChange}
        placeholder="Filter by company name"
      />
      <DebouncedFilterInput
        value={urlSearch}
        onChange={onUrlSearchChange}
        placeholder="Filter by URL"
      />
    </div>
  );
}
