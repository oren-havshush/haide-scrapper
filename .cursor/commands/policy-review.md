---
name: 'policy-review'
description: 'Run the scraping policy review backfill on production. Enqueues POLICY_REVIEW jobs for sites. Supports --limit N, --dry-run, --force, --delay-ms N flags.'
---

# /policy-review — run policy review backfill on prod

Run the policy review backfill script on the production server. This enqueues `POLICY_REVIEW` worker jobs for sites that haven't been checked yet (or are stale).

## Execution

SSH into prod and run the backfill inside a one-off worker container with the scripts dir mounted:

```powershell
cmd.exe /c '"C:\Program Files\Git\bin\bash.exe" -lc "export PATH=/c/Users/shayo/msys2/usr/bin:$PATH; bash run-policy-backfill.sh {{flags}}" <NUL'
```

Replace `{{flags}}` with whatever the user passed (e.g. `--limit 5`, `--dry-run`, `--force`). If no flags are given, run with no flags (processes all eligible sites).

## Available flags

| Flag | Default | Description |
|------|---------|-------------|
| `--limit N` | all sites | Only process first N sites |
| `--dry-run` | off | Preview which sites would be queued without executing |
| `--force` | off | Re-check sites even if recently checked |
| `--delay-ms N` | 2000 | Milliseconds between job inserts |
| `--status X` | any | Only process sites with a specific current policy status |
| `--recheck-days N` | 90 | Override stale threshold |

## Notes

- The script enqueues jobs into the database. The worker container (already running) processes them one by one.
- Each job uses Playwright + OpenAI (`POLICY_REVIEW_MODEL` env var, default `gpt-4o-mini`) to discover and classify policy pages.
- Monitor results on the dashboard at https://scrapper.haide-jobs.co.il under "Policy Review Coverage".
