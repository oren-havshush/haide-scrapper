# .claude/

This folder holds local-only credentials used by the `/addsite` skill.

## `scrap-token`

The prod scrapper API bearer token. Used as the `Authorization: Bearer <token>`
header against `https://scrapper.haide-jobs.co.il`.

Replace the placeholder line in `scrap-token` with the real token (single
line, no surrounding quotes, no `Bearer ` prefix). The file is gitignored
via the repo's top-level `.gitignore`.

If `scrap-token` still contains `REPLACE_ME_*`, the skill will refuse to
run.
