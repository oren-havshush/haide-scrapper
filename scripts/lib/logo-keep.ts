/**
 * scripts/lib/logo-keep.ts — the capture keeps a stored logo (owner, 2026-10-07).
 *
 * scripts/company-profile.ts never looked at the logo already on the row: it
 * uploaded the first candidate that passed the 64 px floor. oneline.co.il had a
 * correct header logo stored by hand through the operator route (247x44, under
 * the 32 px operator floor). Its own file fails the automatic floor, so the
 * next candidate that passed — Hurt.png, a sector illustration whose alt text
 * says "לוגו" — would have replaced it. Every hand-set logo below 64 px was
 * exposed the same way on any --force recapture.
 *
 * So a stored logo is kept and the logo step does not run at all (nothing is
 * fetched, nothing uploaded). --replace-logo re-enables it for a deliberate
 * replacement; --force alone does not, because --force is about the PROFILE
 * columns and says nothing about the logo.
 *
 * Note a replacement lands on the same path (/logos/<siteId>.<ext>), so the
 * source URL — not the path — is what shows a logo was replaced.
 */

export interface StoredLogo {
  companyLogoPath?: string | null;
  companyLogoSourceUrl?: string | null;
}

/** The shape of company-profile.ts's LogoOutcome, plus whether it was kept. */
export interface LogoStepOutcome {
  logoPath: string | null;
  sourceUrl: string | null;
  candidateUrl: string | null;
  visibility: unknown;
  attempts: { url: string; source: string; result: string }[];
  kept?: boolean;
}

export async function keepStoredLogo<T extends LogoStepOutcome>(
  stored: StoredLogo,
  replaceLogo: boolean,
  run: () => Promise<T>,
): Promise<T> {
  if (!stored.companyLogoPath || replaceLogo) return run();
  const sourceUrl = stored.companyLogoSourceUrl ?? null;
  return {
    logoPath: stored.companyLogoPath,
    sourceUrl,
    candidateUrl: null,
    visibility: null,
    attempts: [{ url: sourceUrl ?? stored.companyLogoPath, source: "stored", result: "kept the stored logo" }],
    kept: true,
  } as T;
}
