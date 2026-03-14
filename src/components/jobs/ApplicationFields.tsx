"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetch";

interface FormFieldInfo {
  name: string;
  label: string;
  fieldType: string;
  required: boolean;
}

interface FormCapture {
  formSelector: string;
  actionUrl: string;
  method: string;
  fields: FormFieldInfo[];
}

interface SiteConfig {
  fieldMappings: {
    _meta?: {
      formCapture?: FormCapture;
    };
  } | null;
}

export function ApplicationFields({ siteId }: { siteId: string }) {
  const { data } = useQuery<{ data: SiteConfig }>({
    queryKey: ["site-config", siteId],
    queryFn: () => apiFetch(`/api/sites/${siteId}/config`),
    enabled: !!siteId,
  });

  const form = data?.data?.fieldMappings?._meta?.formCapture;
  if (!form || form.fields.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-[#27272a] bg-[#0a0a0a] p-3">
      <h3 className="text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider mb-2">
        Application Form (Site-level)
      </h3>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-mono font-semibold uppercase px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400">
          {form.method}
        </span>
        <a
          href={form.actionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-mono text-[#3b82f6] hover:underline truncate"
        >
          {form.actionUrl}
        </a>
      </div>
      <div className="flex flex-wrap gap-2">
        {form.fields.map((f, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#18181b] border border-[#27272a]"
          >
            <span className="text-[10px] uppercase font-medium text-[#71717a]">
              {f.fieldType}
            </span>
            <span className="text-xs text-[#d4d4d8]">{f.name || f.label}</span>
            {f.required && <span className="text-[10px] text-amber-400">*</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
