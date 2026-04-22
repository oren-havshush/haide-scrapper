# Scrapnew

A Next.js web app with a background worker (Playwright-based) and an optional browser extension. Postgres is used as the database via Prisma.

## Architecture

- **web** — Next.js app (`src/`), served on http://localhost:3000
- **worker** — Background job processor (`worker/`), uses Playwright
- **db** — Postgres 16 (runs in Docker)
- **extension** — Optional browser extension (`extension/`, built with wxt)

## Prerequisites

- Node.js 20+
- npm (or pnpm)
- Docker Desktop (for the Postgres DB)

## First-time setup

From the repo root:

```bash
# 1. Install dependencies (also runs `prisma generate` via postinstall)
npm install

# 2. Install Chromium for the worker (Playwright)
npm run playwright:install

# 3. Create a local .env (see template below)
cp .env.example .env   # if you have an example file; otherwise create .env manually
```

### `.env`

Create a `.env` file in the repo root with:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/scrapnew?schema=public"
API_TOKEN="dev-token-change-me"
NEXT_PUBLIC_API_TOKEN="dev-token-change-me"
POSTGRES_PASSWORD=postgres
```

### Database

Start Postgres and apply migrations:

```bash
# Start Postgres in the background
docker compose up -d db

# Apply Prisma migrations (first time + whenever new migrations are added)
npx prisma migrate deploy

# (Optional) Seed the DB with a few sample sites
npm run db:seed
```

## Running locally

You'll need **two terminals**:

**Terminal 1 — Web app**
```bash
npm run dev
```
Opens on http://localhost:3000

**Terminal 2 — Worker**
```bash
npm run worker:dev
```

That's it. The web app talks to Postgres via Prisma, and the worker polls the DB for jobs.

## Optional: Browser extension

If you're working on the extension:

```bash
cd extension
npm install
npm run dev
```

Then load the built extension from `extension/.output/` in your browser's extension developer mode.

## Running everything in Docker (alternative)

Instead of running web/worker locally, you can run the whole stack in Docker:

```bash
docker compose up --build
```

This starts `db`, `web`, `worker`, and `caddy` (reverse proxy on :80/:443).

## Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Build the Next.js app |
| `npm run start` | Run the production Next.js build |
| `npm run worker:dev` | Start the worker with file watching |
| `npm run worker:start` | Run the worker once (no watch) |
| `npm run playwright:install` | Install Chromium for Playwright |
| `npm run lint` | Run ESLint |
| `npm run db:seed` | Insert sample sites into the DB |
| `npx prisma migrate deploy` | Apply pending migrations |
| `npx prisma migrate dev --name <name>` | Create a new migration |
| `npx prisma studio` | Open Prisma Studio (DB GUI) |
| `docker compose up -d db` | Start only the Postgres container |
| `docker compose down` | Stop all containers |

## Troubleshooting

**`ECONNREFUSED` on `localhost:5432`**
The DB container isn't running or isn't publishing port 5432. Run:
```bash
docker compose up -d db
docker compose ps    # confirm it's healthy and 5432 is exposed
```

**Prisma errors about missing tables**
Migrations haven't been applied yet:
```bash
npx prisma migrate deploy
```

**Worker crashes on startup about Playwright / browser not found**
```bash
npm run playwright:install
```

**Port 3000 already in use**
Stop whatever is using it, or run Next.js on another port:
```bash
npm run dev -- -p 3001
```
