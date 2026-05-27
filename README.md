# Haide scrapper

A Next.js web app, a Playwright-driven background worker, and a browser
extension that together scrape job listings from Israeli company career
pages into Postgres. Onboarding new sites is automated via the
[`/addsite` Cursor skill](addsite.md) (Windows / PowerShell edition).

The medium-term goal is 5,000 onboarded sites; the per-site reference
library lives under [`sites/`](sites/) and is documented in
[docs/sites-layout.md](docs/sites-layout.md).

## Architecture

- **web** — Next.js app (`src/`), served on http://localhost:3000.
- **worker** — Background job processor (`worker/`), uses Playwright;
  see [`worker/jobs/scrape.ts`](worker/jobs/scrape.ts) and
  [`worker/jobs/analyze.ts`](worker/jobs/analyze.ts).
- **db** — Postgres 16 (runs in Docker via `docker compose up -d db`).
- **extension** — Browser extension (`extension/`, built with wxt).
- **/addsite skill** — [addsite.md](addsite.md): the onboarding agent
  that takes a single URL all the way from "never seen" to
  "first successful scrape" against the prod API. The agent writes
  per-onboarding artifacts to `.scratch/` (gitignored).
- **sites/** — committed per-site reference library; one bucket per
  onboarded host. See [docs/sites-layout.md](docs/sites-layout.md).

## Deploy

```bash
./deploy.sh root@194.88.110.149
```

## Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- Docker Desktop (for the Postgres DB)
- Chromium via Playwright (installed below)
- On Windows: PowerShell 5.1 or PowerShell 7+, `curl.exe` on `PATH`
  (PowerShell's `curl` alias is `Invoke-WebRequest` and is the wrong
  binary for the `/addsite` skill).

## First-time setup

From the repo root:

```bash
pnpm install                  # installs deps + runs `prisma generate` via postinstall
pnpm playwright:install       # installs Chromium for the worker
cp .env.example .env          # or create .env manually with the values below
```

### `.env`

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/scrapnew?schema=public"
API_TOKEN="dev-token-change-me"
NEXT_PUBLIC_API_TOKEN="dev-token-change-me"
POSTGRES_PASSWORD=postgres
```

### `.claude/scrap-token` (for the `/addsite` skill only)

Paste the prod scrapper API bearer token into `.claude/scrap-token`
(single line, no `Bearer ` prefix, no surrounding quotes). The file is
gitignored. See [.claude/README.md](.claude/README.md) for context.

### Database

```bash
docker compose up -d db
npx prisma migrate deploy
pnpm db:seed                  # optional sample data
```

## Running locally

You need **two terminals**.

**Terminal 1 — Web app**

```bash
pnpm dev                      # opens on http://localhost:3000
```

**Terminal 2 — Worker**

```bash
pnpm worker:dev               # watches worker/ and re-runs on changes
```

## Running the /addsite skill

In Cursor or Claude Code, with this folder open as the workspace, after
`.claude/scrap-token` is populated and `pnpm doctor` is green:

```
/addsite https://www.tikshoov.co.il/come-work-with-us/careers-list/?areaID=&jobType=
```

The agent will (full spec in [addsite.md](addsite.md)):

1. Hit `GET /api/sites?siteUrl=...` to dedupe.
2. `POST /api/sites` if new.
3. Run the worker-parity reachability gate against the live page.
4. Render the page with Playwright into `.scratch/scrap-page.html`.
5. Propose selectors based on the rendered HTML.
6. Dry-run them with `.scratch/scrap-dryrun.ts`.
7. `PUT /api/sites/<id>/config` twice (races the auto-analyzer).
8. `PATCH /api/sites/<id>` to `ACTIVE`.
9. `POST /api/sites/<id>/scrape` and poll until `COMPLETED`.
10. Sample 3 jobs and print a dashboard URL.

Per-site artifacts that are worth keeping after onboarding should be
promoted from `.scratch/` into `sites/<name>/` per the
[sites layout convention](docs/sites-layout.md).

## Running everything in Docker (alternative)

```bash
docker compose up --build     # db + web + worker + caddy
```

## Optional: Browser extension

```bash
cd extension
pnpm install
pnpm dev                      # then load extension/.output/ in your browser
```

## Useful commands

| Command                                | What it does                              |
| -------------------------------------- | ----------------------------------------- |
| `pnpm dev`                             | Start Next.js dev server                  |
| `pnpm build`                           | Build the Next.js app                     |
| `pnpm start`                           | Run the production Next.js build          |
| `pnpm worker:dev`                      | Start the worker with file watching       |
| `pnpm worker:start`                    | Run the worker once (no watch)            |
| `pnpm playwright:install`              | Install Chromium for Playwright           |
| `pnpm lint`                            | Run ESLint                                |
| `pnpm db:seed`                         | Insert sample sites into the DB           |
| `pnpm doctor`                          | Pre-flight check for the `/addsite` skill |
| `pnpm enrich`                          | Enrich an Israeli-careers CSV via Playwright detectors |
| `npx prisma migrate deploy`            | Apply pending migrations                  |
| `npx prisma migrate dev --name <name>` | Create a new migration                    |
| `npx prisma studio`                    | Open Prisma Studio (DB GUI)               |
| `docker compose up -d db`              | Start only the Postgres container         |
| `docker compose down`                  | Stop all containers                       |

## Docs

- [addsite.md](addsite.md) — the `/addsite` skill spec (753 lines)
- [docs/sites-layout.md](docs/sites-layout.md) — `sites/<name>/` convention
- [docs/engineer-notes-pagination.md](docs/engineer-notes-pagination.md)
- [docs/engineer-notes-auto-apply.md](docs/engineer-notes-auto-apply.md)
- [docs/engineer-notes-spa-and-async-setupscript.md](docs/engineer-notes-spa-and-async-setupscript.md)

## Troubleshooting

**`ECONNREFUSED` on `localhost:5432`** — start the DB:

```bash
docker compose up -d db
docker compose ps
```

**Prisma errors about missing tables** — apply migrations:

```bash
npx prisma migrate deploy
```

**Worker crashes on startup about Playwright / browser not found**:

```bash
pnpm playwright:install
```

**Port 3000 already in use** — pick another:

```bash
pnpm dev -- -p 3001
```

**`/addsite` says token is missing/placeholder** — populate
`.claude/scrap-token`. Run `pnpm doctor` to verify.

**`curl` in PowerShell returns `Invoke-WebRequest`-flavoured output** —
use `curl.exe` (with the extension) or `Invoke-RestMethod`.
