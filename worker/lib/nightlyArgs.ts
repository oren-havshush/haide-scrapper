// The sweep driver's command line (worker/sweep/nightly.ts).
//
// Pulled out of the driver because nightly.ts runs on import, so its parsing
// could not be tested — and the defaults below ARE the detail-fetch policy:
//
//   --now                        the timer's form. Incremental, except on the
//                                run that starts on a Saturday in Jerusalem.
//   --site <id> --now            the check after a config change: FULL, so the
//                                new detail selectors are exercised at once.
//   --site <id> --dry-run-details  read-only rehearsal of one site's
//                                fetch-or-carry split, in the night's own mode.
//   --full-details / --incremental-details   override any of the above.
//   --email                      a --site run sends its report by email; without
//                                it, it does not (owner, 2026-10-01). The timer's
//                                runs always send.
//   --test-email                 one-off: email the latest stored report, then exit.

import { detailModeFor, type DetailMode } from "./detailPlan";

export type NightlyMode =
  | { kind: "dry-run" }
  | { kind: "test-email" }
  | { kind: "dry-run-details"; siteId: string; detailOverride: DetailMode | null }
  | { kind: "single"; siteId: string; detailOverride: DetailMode | null; email: boolean }
  | { kind: "fleet"; detailOverride: DetailMode | null };

export function parseNightlyArgs(argv: string[]): NightlyMode {
  const dryRun = argv.includes("--dry-run");
  const testEmail = argv.includes("--test-email");
  const dryRunDetails = argv.includes("--dry-run-details");
  const now = argv.includes("--now");
  const full = argv.includes("--full-details");
  const incremental = argv.includes("--incremental-details");
  const siteIdx = argv.indexOf("--site");
  const siteId = siteIdx >= 0 ? argv[siteIdx + 1] : undefined;
  const email = argv.includes("--email");
  if (email && !(siteId && now)) {
    throw new Error("--email applies to --site <id> --now only; the timer's runs always send their report");
  }

  if (full && incremental) throw new Error("--full-details and --incremental-details are exclusive");
  const detailOverride: DetailMode | null = full ? "full" : incremental ? "incremental" : null;

  if (siteIdx >= 0 && (!siteId || siteId.startsWith("--"))) {
    throw new Error("--site needs a site id");
  }

  if (testEmail) {
    if (dryRun || dryRunDetails || now || siteIdx >= 0 || detailOverride) {
      throw new Error("--test-email stands alone: it sends the latest stored report and exits");
    }
    return { kind: "test-email" };
  }
  if (dryRun) {
    if (detailOverride) throw new Error("--dry-run has no detail phase; use --site <id> --dry-run-details");
    return { kind: "dry-run" };
  }
  if (dryRunDetails) {
    if (!siteId) throw new Error("--dry-run-details needs --site <id>");
    if (now) throw new Error("--dry-run-details writes nothing; it cannot be combined with --now");
    return { kind: "dry-run-details", siteId, detailOverride };
  }
  if (siteId) {
    if (!now) throw new Error("--site requires --now (it runs the scheduled path for real)");
    return { kind: "single", siteId, detailOverride, email };
  }
  if (now) return { kind: "fleet", detailOverride };
  throw new Error("one of --dry-run, --now, --site <id> --now, or --site <id> --dry-run-details is required");
}

/** The detail mode an invocation runs in. `startedAt` decides the fleet's default. */
export function resolveDetailMode(mode: NightlyMode, startedAt: Date): DetailMode {
  if (mode.kind === "dry-run" || mode.kind === "test-email") return detailModeFor(startedAt);
  if (mode.detailOverride) return mode.detailOverride;
  if (mode.kind === "single") return "full";
  return detailModeFor(startedAt);
}

/**
 * `--trigger <label>`: who started this sweep, recorded on the ScrapeSweep row
 * and printed on the report's trigger line. Absent means "manual" — a human
 * at a shell. The systemd units pass `--trigger timer`; night one, before
 * this, recorded its timer run as "manual". Shared by nightly.ts and policy.ts.
 */
export function parseTriggerLabel(argv: string[]): string {
  const idx = argv.indexOf("--trigger");
  if (idx < 0) return "manual";
  const label = argv[idx + 1];
  if (!label || label.startsWith("--")) throw new Error("--trigger needs a label, e.g. --trigger timer");
  if (!/^[a-z0-9_-]{1,32}$/.test(label)) throw new Error(`--trigger label must be a-z0-9_- (got ${JSON.stringify(label)})`);
  return label;
}
