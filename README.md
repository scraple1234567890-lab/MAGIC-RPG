# Tiny Turn RPG (standalone)

This is a standalone, database-free version of the Tiny Turn RPG page.

## What changed vs the full Dragonstone site
- Removed all Supabase/database authentication.
- `login.html` is now a **local-only profile** page (stored in your browser via `localStorage`).
- Game progress (hero saves, perks, etc.) is still stored locally by the game itself.

## Deploy
Because this is static, you can host it anywhere (GitHub Pages, Netlify, etc.).

- Local testing: run any simple static server (recommended):
  - `python3 -m http.server 8080`
  - open `http://localhost:8080`

## Notes
- Local profiles are not real accounts (no passwords, no syncing).
- If you clear your browser storage, the local profile and saves will reset.
