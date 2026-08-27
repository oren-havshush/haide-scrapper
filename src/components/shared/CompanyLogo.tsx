"use client";

/**
 * A captured company logo, always on a dark chip.
 *
 * The backdrop is not decoration. A large share of captured logos are the
 * light-on-dark variant a site uses in its own header — flying-cargo.com and
 * biopharmax.com both score 0% of pixels clearing 3:1 contrast against white —
 * and scripts/company-profile.ts deliberately stores those bytes UNALTERED
 * rather than compositing a background into the file (decision 2026-08-26:
 * companyLogoPath is write-once, so a baked-in background is irreversible).
 *
 * Rendering on a dark chip is the other half of that decision. Without it these
 * logos are invisible here, which would make the review pass useless for
 * exactly the sites that most need checking.
 *
 * A plain <img> rather than next/image: these are arbitrary runtime paths off a
 * Docker volume, not build-time assets, and they need no optimisation at 24px.
 */

export function CompanyLogo({
  path,
  size = 24,
  alt = "",
}: {
  path: string | null;
  size?: number;
  alt?: string;
}) {
  if (!path) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded border"
        style={{
          width: size,
          height: size,
          borderColor: "#27272a",
          backgroundColor: "#0a0a0a",
          color: "#3f3f46",
          fontSize: Math.max(9, Math.round(size / 2.6)),
        }}
        title="No logo captured"
        aria-hidden
      >
        &mdash;
      </div>
    );
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded border overflow-hidden"
      style={{
        width: size,
        height: size,
        borderColor: "#27272a",
        // Near-black, not pure black: keeps a dark-but-not-white logo readable.
        backgroundColor: "#111111",
        padding: Math.max(1, Math.round(size / 12)),
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={path}
        alt={alt}
        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
        loading="lazy"
      />
    </div>
  );
}
