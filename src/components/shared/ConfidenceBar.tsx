interface ConfidenceBarProps {
  confidence: number;
  compact?: boolean;
  className?: string;
}

function getColor(confidence: number): string {
  if (confidence >= 90) return "#16a34a";
  if (confidence >= 70) return "#22c55e";
  if (confidence >= 41) return "#f59e0b";
  return "#ef4444";
}

export function ConfidenceBar({
  confidence,
  compact = false,
  className,
}: ConfidenceBarProps) {
  const clampedConfidence = Math.max(0, Math.min(100, confidence));
  const barHeight = compact ? 4 : 6;

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <div
        className="w-full rounded-full overflow-hidden"
        style={{ height: barHeight, backgroundColor: "#27272a" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${clampedConfidence}%`,
            backgroundColor: getColor(clampedConfidence),
          }}
        />
      </div>
      {!compact && (
        <span className="text-xs tabular-nums" style={{ color: "#a1a1aa" }}>
          {Math.round(clampedConfidence)}%
        </span>
      )}
    </div>
  );
}
