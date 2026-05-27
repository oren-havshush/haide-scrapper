# sites/&lt;name&gt;/ — per-site onboarding library

This folder holds one bucket per onboarded jobs site. Together they form a
committed reference library: the `/addsite` skill writes here while a site is
being onboarded, and the bucket stays around afterwards so future
re-onboardings, debugging, or worker-side investigations have a starting
point. At 5,000 sites this directory is expected to be the largest part of
the repo — keep each bucket small and disciplined.

`_shared/` is a sibling bucket for generic helpers and sample data that
aren't tied to one site.

## What belongs in `sites/<name>/`

Each site directory should contain the small, durable artifacts that
describe the site. Anything large or single-use goes in
`sites/<name>/.scratch/` (gitignored).

### Committed (small, durable)

| File | Contents |
| --- | --- |
| `notes.md` | Short README: listing URL, status (`ACTIVE` / `SKIPPED` with reason), gotchas, links to issues. The single source of truth for "what's weird about this site." |
| `config.json` | The final config that was PUT to the prod scrapper API — the canonical snapshot. Useful when the worker's auto-analyzer regresses and you need to repair. |
| `probe.ts`, `dryrun.ts`, `scrap.ts` | Playwright onboarding scripts (renamed from old `.scrap-<site>.ts` / `.one1-probe*.ts` patterns). Keep one per concern; delete dead variants. |
| `setup-script.js` | Per-site `setupScript` payload, if the site needs the DOM-mutation escape hatch. Stays as a `.js` file so it diffs cleanly. |
| `sample-jobs.json` | ≤ 3 jobs from the last successful scrape, for eyeball verification. |
| `setup.js` | The full `setupScript` from `fieldMappings._meta.setupScript`, if the site needs DOM-mutation hacks. |

### Gitignored (large, single-use) — `sites/<name>/.scratch/`

- Rendered listing HTML > ~200 KB (`page.html`, `*-rendered.html`).
- Full API JSON dumps > ~200 KB (anything ending in `-raw.json`, `*-all.json`, `*-api-<id>.json`).
- Screenshots (`*.png`).
- Browser binary dumps (`*.bin`, `*.pma`).
- Browser user-data-dir traces.

These match the patterns in [.gitignore](../.gitignore):

```
sites/**/.scratch/
sites/**/*.png
sites/**/*.bin
sites/**/raw-*.json
sites/**/*-raw*.json
```

If you need to keep one of those locally for a debugging session, drop it
in `sites/<name>/.scratch/` and don't worry about it polluting git.

## What belongs in `_shared/`

- Generic Playwright probes that take the target URL via `process.argv[2]`
  (e.g. `scrap-fetch.ts`, `scrap-reach.ts`, `dryrun.ts`, `count*.ts`,
  `skip-audit*.ts`, `smoke-ua.ts`).
- Shell utilities for cross-site operations
  (`audit.sh`, `onboard.sh`, `reactivate.sh`, `fix-config.sh`).
- `_shared/probes/` — orphan probe artifacts keyed by Prisma `siteId`
  rather than site name (e.g. `cmp05qxto....config.json`); the workflow
  that produced these no longer runs but the data is occasionally useful.
- `_shared/sample-data/` — cross-site catalog dumps:
  `all-sites.json` (snapshot of `GET /api/sites`), `jobs-all.json`,
  `sample-jobs*.json`, `sites-p1.json`, etc.

## Onboarding flow ↔ this folder

The `/addsite` skill (see [addsite.md](../addsite.md)) currently writes to
the top-level `.scratch/` directory during a run. When a site finishes
onboarding successfully, the recommended follow-up is to:

1. `mkdir sites/<new-site-name>/`
2. Move the durable artifacts in (`scrap-fetch.ts`, `scrap-dryrun.ts`,
   `scrap-config.json`, `sample-jobs.json`, etc.) — rename to drop any
   per-onboarding suffixes.
3. Add a short `notes.md` capturing anything non-obvious that future-you
   will want to remember.
4. Leave the large HTML / API dumps behind in `sites/<new-site-name>/.scratch/`
   (gitignored) or delete them.

If the site was SKIPPED (UA-keyed WAF, IL-IP-only, etc.), still create
`sites/<name>/notes.md` with the skip reason and the `siteId` so the next
person looking doesn't redo the investigation from scratch.

## Naming

- Site directory name = the host's stable short name (no `www.`, no TLD).
  Examples: `bezeq` for `bezeq.co.il`, `one1` for `one1.co.il`,
  `unitask` for `unitask-inc.com`.
- For Hebrew-named sites, use a Latin transliteration that matches the
  domain (e.g. `tikshoov` for `tikshoov.co.il`).
- If a parent site has multiple boards (rare), use `parent--board/`
  (double-dash separator). Avoid nested directories.
