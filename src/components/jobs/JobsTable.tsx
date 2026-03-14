"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

interface JobSite {
  id: string;
  siteUrl: string;
}

interface Job {
  id: string;
  title: string;
  description: string | null;
  requirements: string | null;
  location: string;
  department: string | null;
  externalJobId: string | null;
  publishDate: string | null;
  applicationInfo: string | null;
  rawData: Record<string, string> | null;
  validationStatus: string | null;
  createdAt: string;
  site: JobSite;
}

interface JobsTableProps {
  jobs: Job[];
  isLoading: boolean;
  hasFilter: boolean;
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

const PAGE_SIZE = 50;
const STANDARD_KEYS = new Set([
  "title", "description", "requirements", "location",
  "department", "externalJobId", "publishDate", "applicationInfo",
]);

function DetailSection({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value || !value.trim()) return null;
  return (
    <div>
      <span className="text-xs font-medium text-[#71717a]">{label}</span>
      <p className="text-sm text-[#d4d4d8] mt-0.5 whitespace-pre-line">{value}</p>
    </div>
  );
}

interface FormDataField {
  name: string;
  label: string;
  fieldType: string;
  required: boolean;
}

interface FormData {
  actionUrl: string;
  method: string;
  fields: FormDataField[];
}

function parseFormData(rawData: Record<string, string>): FormData | null {
  const raw = rawData["_formData"];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FormData;
  } catch {
    return null;
  }
}

function FormDataSection({ formData }: { formData: FormData }) {
  return (
    <div>
      <span className="text-xs font-medium text-[#71717a]">Application Form</span>
      <div className="mt-1 rounded-md border border-[#27272a] overflow-hidden">
        <div className="px-3 py-1.5 bg-[#18181b] flex items-center gap-2">
          <span className={`text-[10px] font-mono font-semibold uppercase px-1.5 py-0.5 rounded border ${
            formData.method === "POST"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
              : "border-blue-500/30 bg-blue-500/10 text-blue-400"
          }`}>
            {formData.method}
          </span>
          <a
            href={formData.actionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-[#3b82f6] hover:underline truncate"
          >
            {formData.actionUrl}
          </a>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] text-[#71717a] uppercase border-b border-[#27272a]">
              <th className="px-3 py-1 text-left font-medium">Name</th>
              <th className="px-3 py-1 text-left font-medium">Label</th>
              <th className="px-3 py-1 text-left font-medium">Type</th>
              <th className="px-3 py-1 text-center font-medium w-8">Req</th>
            </tr>
          </thead>
          <tbody>
            {formData.fields.map((f, i) => (
              <tr key={`${f.name}-${i}`} className="border-b border-[#1a1a1a] last:border-0">
                <td className="px-3 py-1 font-mono text-[#d4d4d8]">{f.name || "—"}</td>
                <td className="px-3 py-1 text-[#a1a1aa] truncate max-w-[150px]" title={f.label}>{f.label}</td>
                <td className="px-3 py-1 text-[#71717a]">{f.fieldType}</td>
                <td className="px-3 py-1 text-center">{f.required ? <span className="text-amber-400">*</span> : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExpandedDetail({ job }: { job: Job }) {
  const rawData = job.rawData ?? {};
  const hrefEntries = Object.entries(rawData).filter(
    ([k, v]) => k.endsWith("_href") && v?.trim(),
  );

  const extras = Object.entries(rawData).filter(
    ([k, v]) => !STANDARD_KEYS.has(k) && !k.startsWith("_") && !k.endsWith("_href") && v?.trim(),
  );

  const formData = parseFormData(rawData);

  return (
    <div className="px-4 py-3 space-y-3 bg-[#0a0a0a] border-t border-[#27272a]">
      <DetailSection label="Description" value={job.description} />
      <DetailSection label="Requirements / Skills" value={job.requirements} />
      <DetailSection label="Department" value={job.department} />
      <DetailSection label="Publish Date" value={job.publishDate} />
      <DetailSection label="Application Info" value={job.applicationInfo} />

      {hrefEntries.length > 0 && (
        <div>
          <span className="text-xs font-medium text-[#71717a]">Links</span>
          <div className="flex flex-wrap gap-3 mt-0.5">
            {hrefEntries.map(([key, url]) => (
              <a
                key={key}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#3b82f6] hover:underline capitalize"
              >
                {key.replace(/_href$/, "")}
              </a>
            ))}
          </div>
        </div>
      )}

      {extras.length > 0 && (
        <div>
          <span className="text-xs font-medium text-[#71717a]">Additional Fields</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
            {extras.map(([key, value]) => (
              <span key={key} className="text-xs text-[#a1a1aa]">
                <span className="font-medium text-[#71717a] capitalize">{key}:</span>{" "}
                {value.length > 120 ? value.slice(0, 120) + "…" : value}
              </span>
            ))}
          </div>
        </div>
      )}

      {formData && <FormDataSection formData={formData} />}

      {job.validationStatus && (
        <div className="text-xs text-[#52525b]">
          Validation: {job.validationStatus}
        </div>
      )}
    </div>
  );
}

export function JobsTable({
  jobs,
  isLoading,
  hasFilter,
  page,
  totalPages,
  total,
  onPageChange,
}: JobsTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (jobs.length === 0) {
    if (hasFilter) {
      return (
        <div className="text-center py-12">
          <p className="text-sm" style={{ color: "#71717a" }}>
            No jobs found for this site.
          </p>
        </div>
      );
    }

    return (
      <div className="text-center py-12">
        <p className="text-sm" style={{ color: "#71717a" }}>
          No jobs scraped yet. Complete a site review and save config to trigger a test scrape.{" "}
          <Link href="/review" className="underline" style={{ color: "#3b82f6" }}>
            Go to Review Queue
          </Link>
        </p>
      </div>
    );
  }

  const startItem = (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, total);

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[28px]" />
            <TableHead className="w-auto">Title</TableHead>
            <TableHead className="w-[160px]">Location</TableHead>
            <TableHead className="w-[120px]">Job ID</TableHead>
            <TableHead className="w-[140px]">Site</TableHead>
            <TableHead className="w-[100px]">Scraped</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => {
            const isExpanded = expandedId === job.id;
            return (
              <>
                <TableRow
                  key={job.id}
                  className="h-10 hover:bg-[#18181b] cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : job.id)}
                >
                  <TableCell className="text-xs text-[#71717a] px-2">
                    {isExpanded ? "▾" : "▸"}
                  </TableCell>
                  <TableCell className="text-sm">{job.title}</TableCell>
                  <TableCell className="text-sm">{job.location}</TableCell>
                  <TableCell className="text-sm font-mono text-[#a1a1aa]">
                    {job.externalJobId || "—"}
                  </TableCell>
                  <TableCell>
                    <Link
                      href="/sites"
                      className="font-mono text-[13px] hover:underline"
                      style={{ color: "#3b82f6" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {new URL(job.site.siteUrl).hostname}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm" style={{ color: "#a1a1aa" }}>
                    {new Date(job.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
                {isExpanded && (
                  <TableRow key={`${job.id}-detail`}>
                    <TableCell colSpan={6} className="p-0">
                      <ExpandedDetail job={job} />
                    </TableCell>
                  </TableRow>
                )}
              </>
            );
          })}
        </TableBody>
      </Table>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 px-2">
          <span className="text-xs" style={{ color: "#a1a1aa" }}>
            Showing {startItem}-{endItem} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
