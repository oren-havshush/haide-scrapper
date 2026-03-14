"use client";

interface StatusPillProps {
  count: number;
  label: string;
  color: string;
  pulse?: boolean;
}

/**
 * Compact rounded pill showing a live count and status label.
 * Used in the top bar to display Active, Review, and Failed counts.
 *
 * The `pulse` prop triggers a subtle CSS animation (e.g. for Failed pill
 * when a new failure is detected).
 */
export function StatusPill({ count, label, color, pulse = false }: StatusPillProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium${pulse ? " status-pulse" : ""}`}
      style={{
        color,
        backgroundColor: `${color}26`, // ~15% opacity (hex 26 = 0.15 * 255)
      }}
    >
      {count} {label}

      {/* Inject keyframes via inline style tag if pulse is active */}
      {pulse && (
        <style>{`
          @keyframes status-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
          }
          .status-pulse {
            animation: status-pulse 1s ease-in-out 3;
          }
        `}</style>
      )}
    </span>
  );
}
