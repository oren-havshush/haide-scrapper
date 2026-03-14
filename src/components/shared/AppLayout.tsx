"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import {
  Home,
  Globe,
  ClipboardCheck,
  Briefcase,
  Activity,
} from "lucide-react";
import { StatusPill } from "@/components/shared/StatusPill";
import { useSiteStatusCounts } from "@/hooks/useSites";
import { useSSE } from "@/hooks/useSSE";

const navItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/sites", icon: Globe, label: "Sites" },
  { href: "/review", icon: ClipboardCheck, label: "Review Queue" },
  { href: "/jobs", icon: Briefcase, label: "Jobs" },
  { href: "/status", icon: Activity, label: "Status" },
];

interface StatusCountsData {
  data: {
    ACTIVE: number;
    REVIEW: number;
    FAILED: number;
    ANALYZING: number;
    SKIPPED: number;
    total: number;
  };
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Pulse animation state for the Failed pill
  const [failedPulse, setFailedPulse] = useState(false);

  // Called by useSSE when a new failure is detected via SSE events
  const handleFailureDetected = useCallback(() => {
    setFailedPulse(true);
    setTimeout(() => setFailedPulse(false), 3000);
  }, []);

  // Wire SSE connection so it is active on every dashboard page
  useSSE({ onFailureDetected: handleFailureDetected });

  // Fetch live status counts for top bar pills
  const { data: countsResponse } = useSiteStatusCounts() as {
    data: StatusCountsData | undefined;
  };
  const counts = countsResponse?.data;

  return (
    <div className="flex h-screen" style={{ background: "#0a0a0b" }}>
      {/* Sidebar */}
      <aside
        className="flex flex-col items-center py-4 gap-2"
        style={{
          width: 56,
          minWidth: 56,
          background: "#18181b",
          borderRight: "1px solid #3f3f46",
        }}
      >
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className="flex items-center justify-center rounded-md transition-colors"
              style={{
                width: 40,
                height: 40,
                color: isActive ? "#fafafa" : "#a1a1aa",
                background: isActive ? "rgba(255,255,255,0.1)" : "transparent",
              }}
            >
              <item.icon size={20} />
            </Link>
          );
        })}
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Top bar */}
        <header
          className="flex items-center px-6 shrink-0"
          style={{
            height: 48,
            background: "#18181b",
            borderBottom: "1px solid #3f3f46",
          }}
        >
          <h1 className="text-sm font-semibold" style={{ color: "#fafafa" }}>
            scrapnew
          </h1>

          {/* StatusPills -- right-aligned */}
          {counts && (
            <div className="flex items-center gap-2 ml-auto">
              <StatusPill
                count={counts.ACTIVE ?? 0}
                label="Active"
                color="#22c55e"
              />
              <StatusPill
                count={counts.REVIEW ?? 0}
                label="Review"
                color="#f59e0b"
              />
              <StatusPill
                count={counts.FAILED ?? 0}
                label="Failed"
                color="#ef4444"
                pulse={failedPulse}
              />
            </div>
          )}
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
