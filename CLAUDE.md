# Tiramisu inventory manager

A small Arabic (RTL) web app for tracking tiramisu ingredient stock, production, and restocks.

- Live site: https://tiramisu-project.pages.dev (Cloudflare Pages, password-protected)
- Repo: https://github.com/mohamedgamill/tiramisu-project (public: never commit secrets)
- Owner is a beginner: explain everything simply, step by step, in Egyptian Arabic.

## Structure
- `index.html`: the whole UI. Loads/saves state via `/api/state`, auto-refreshes every 30s.
- `functions/_middleware.js`: password gate (`APP_PASSWORD` secret, 30-day cookie). Also accepts
  `Authorization: Bearer <API_TOKEN>` for `/api/state` only (Claude's access).
- `functions/api/state.js`: GET/PUT the single state row in Cloudflare D1 (binding `DB`), with
  optimistic `version` check (409 on conflict).
- `tools/site_data.py`: CLI to pull/push live data with the API token.

## Deploying code changes
Commit and `git push` to `main`; Cloudflare Pages auto-deploys in ~1 min. `gh` lives at
`~/.local/bin/gh` (not on PATH). Changing Cloudflare env vars/bindings needs a new deploy
(an empty commit works).

## Editing live data (stock numbers, production, etc.)
Token: `~/.config/tiramisu/api_token` (local only, chmod 600). Never print it, commit it, or
paste it in chat.

1. `python3 -I tools/site_data.py pull <scratch>/data.json`
2. Edit `state` in that file. For every change, keep the app's history format so the owner can
   see and undo it:
   - Push a history entry to the FRONT of `state.history` with `snapshot` = a deep copy of
     `state.items` BEFORE the change, `time` = Arabic-Egypt formatted local time, and
     `"by": "Claude"`.
   - Types: `produce` (`count`, `price`, `cost`, `profit` = count*(price-cost), plus
     `settingsSnapshot`; subtract `perBox*count` from each item, floor at 0, add `count` to
     `totalProduced` and `profit` to `totalProfit`; tell the owner the net profit), `restock` (`text`: "إضافة <qty> <unit> (<name>)"), `edit`
     (`text`: "تعديل <name>: من <old> إلى <new> <unit>").
   - Round stock to 2 decimals. Keep history at most 300 entries.
3. Before pushing, show the owner a short before → after summary; confirm first for anything
   destructive (resets, deleting items, big corrections).
4. `python3 -I tools/site_data.py push <scratch>/data.json`. On CONFLICT, pull again and redo.

State also has `totalProfit` and `settings: {pricePerBox, costPerBox}` (selling price and cost per
box in EGP; cost defaults to 55).

Item fields: `id, name, unit, perBox, stock, packs` where `packs` = `[{size, label}]` (quick-add pack sizes, user-editable in the UI). Older data may still have `packSize`/`packLabel`; the UI converts them to `packs` on load.
