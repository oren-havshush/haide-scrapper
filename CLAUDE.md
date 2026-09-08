# Working in this repo

An Israeli jobs scraper: a Next.js dashboard, a Playwright worker, and CLI scripts.
Jobs are scraped per site; company identity is captured once per site. The public
jobs site reads this database **directly**, so a wrong value is not a display bug —
it is published data that nothing downstream repairs.

## The rule everything else follows from

**A wrong value is worse than a missing one.** Coverage is never the goal. A field
that cannot be established honestly stays NULL. Two gates enforce this and neither
is optional:

- **Every city is VERBATIM from `CSV files/city.csv`.** Never a near-miss, never a
  normalised variant. A wrong city fragments the dashboard's city filter and nothing
  repairs it (LRN-LOC-4).
- **Every logo passes magic-byte validation** before it is stored.

## Deploy

```bash
./deploy.sh haide-prod          # SSH alias; also: ./deploy.sh root@194.88.110.149
```

Builds, runs `prisma migrate deploy`, restarts with rollback. **This is the only way
migrations reach the database** — there is no migrate step in CI or the Dockerfile.

`git push` is NOT a deploy. It updates GitHub and nothing else.

**There is no `DATABASE_URL` locally.** The database lives on the server, inside the
compose network. Scripts reach it only through the API at
`https://scrapper.haide-jobs.co.il` with the token in `.claude/scrap-token`. Anything
needing direct DB access has to run on the box.

Note `scrapper.haide-jobs.co.il` resolves to **Cloudflare**, not the origin — the
real host is in `~/.ssh/config` as `haide-prod`.

## Skills are code, and they are checked

`addsite2.md` and `company-profile.md` at the **repo root** are canonical. The copies
in `.claude/commands/` are generated.

```bash
pnpm sync:skills     # regenerate copies after editing a canonical file
pnpm check:skills    # what CI runs; drift BLOCKS the build
```

Editing `.claude/commands/*.md` directly is always wrong — it will be overwritten and
CI will fail.

## Tests

There is no `pnpm test`. Each suite is a standalone script that exits non-zero on
failure:

```bash
npx tsx scripts/lib/company-extract.test.ts    # extraction rules + the city gate
npx tsx src/lib/locations.test.ts              # location vocabulary (runs in CI)
npx tsx worker/lib/<name>.test.ts              # ~10 more under worker/lib/
```

Only `test:locations` and `check:addsite2` run in CI, alongside `lint` and the
builds. Run the suite for anything you touch — nothing else will.

**A test that passes without the fix is not a test.** Break the code deliberately and
confirm the test fails. Two tests written in this repo looked correct and asserted
nothing until that check was applied.

## Things that have already gone wrong here

- **Never edit a regex through `node -e` string replacement.** It ate `\b` into a raw
  backspace character and dropped `\s`/`\d` backslashes, silently disabling a guard
  that had never fired since. Use a real editor.
- **A vendor is never the employer.** ATS hosts, accessibility widgets, marketing
  hosts. Deriving identity from a careers board has stored a vendor's homepage, logo
  and prose as the employer's three separate times. `src/lib/ats-hosts.ts` is the one
  list; never duplicate it.
- **`\b` does not fire after a Hebrew letter**, and final letters differ (`סניף` ends
  in ף, `סניפים` uses פ). Hebrew city names also hide inside ordinary words — `כנות`
  inside `הסוכנות`, `משמרות` meaning "shifts". Scanning prose for city names was
  tried and removed for this reason.
- **Presence-based writes**: in `saveCompanyProfile`, a key present as `null` CLEARS
  the column. Omit a key you have nothing to say about.

## Windows / Dropbox

The working copy is inside Dropbox, which holds file handles.

- `sed -i` fails with `Device or resource busy` — use the editor tools.
- Deleting directories may need two passes, or PowerShell `Remove-Item -Recurse`.
- `git status` prints a long-path warning about a directory named after the Windows
  banner. It is noise; ignore it.
- Use `curl.exe` explicitly, and send JSON bodies from a file (`-d "@body.json"`) —
  PowerShell mangles inline quotes.

## Git

- Commit **directly to main**. No feature branches; the history is all direct.
- **Never commit or push without explicit approval, every time** — including in auto
  mode.
