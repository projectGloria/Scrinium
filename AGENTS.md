# AGENTS.md — Scrinium

Read-only, fast Windows desktop browser for GitHub repositories built with Tauri v2, Rust (SQLite/reqwest), React 19, Vite 8, Tailwind CSS v4, and Zustand.

## Commands
- Run / Dev: `npm run tauri dev` (starts Vite on `http://localhost:1420` and launches Tauri)
- Test (all): `cargo test --manifest-path src-tauri/Cargo.toml`
- Test (single): `cargo test --manifest-path src-tauri/Cargo.toml guard_test`
- Typecheck / Check: `npm run typecheck` and `cargo check --manifest-path src-tauri/Cargo.toml`
- Build: `npm run build` (frontend) or `npm run tauri build` (desktop app)

## Architecture
- `src-tauri/src/lib.rs` — Tauri v2 entry point: opens SQLite (`scrinium.db`), starts `SyncEngine`, registers `scrblob` URI protocol, and wires IPC handlers.
- `src-tauri/src/github/` — GitHub GraphQL/REST client (`queries/*.graphql`, `http.rs`, `rate_limit.rs`) and `write.rs` (sole allowlisted module for mutating GitHub calls).
- `src-tauri/src/db/` & `src-tauri/src/sync/` — Bundled SQLite store with numbered migrations (`0001`–`0005`) and background sync jobs (`repos`, `readme`, `icons`, `files`, `issues`, `actions`).
- `src-tauri/src/commands/` & `src/ipc/` — Typed Tauri IPC boundary (`commands.ts`, `events.ts`, `types.ts`); frontend never calls GitHub directly.
- `src/App.tsx`, `src/stores/`, `src/features/` — React 19 + Zustand UI; Rust owns sync and pushes change events to frontend stores.
- **Version Manifests:** `gloria.toml`, `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` (keep versions synced across all listed files).

## Personal Rules (Brain)
- **Commit Format:** Write one plain sentence stating what changed and why; do not use `feat:`/`fix:`/`chore:` conventional-commit prefixes.
- **Commit & Push Policy:** Never run `git commit`, `git tag`, or `git push` unless explicitly asked; never force-push to `main`. When the user says "commit and push", verify the build and tests pass, commit on `main`, and push to `origin main`. Pushing never releases anything.
- **Releases:** Releases happen only through `/monjita-github-release`, which bumps the version, pushes, runs `gh workflow run release.yml`, and watches it until the GitHub Release is live. Never create release tags or releases by hand.
- **Path Privacy:** Always use `C:\Users\you` in documentation, comments, and examples—never hardcode the local machine's real username.
- **Release Workflow:** `.github/workflows/release.yml` must be a copy of `GloriaSetup/templates/release.yml` (shared `check`/`release` jobs from `projectGloria/GloriaSetup/.github/workflows/app-{check,release}.yml@main`, plus this repo's own `build` job). Don't hand-write release workflows or pin `gloria-setup`; see `.brain/github-actions.md`.
- **Window Chrome:** Disable native OS titlebars; build an integrated frameless titlebar with drag region, double-click maximize, and custom min/max/close controls.
- **Desktop Shell Lock:** Lock the app shell to `100vw x 100vh` (`overflow: hidden`) with internal scroll panes and `user-select: none` on UI chrome.
- **Scrollbars:** Ban raw OS scrollbars; use thin (4–6px) themed scrollbars with transparent tracks and zero layout shift.
- **Interactive Controls:** Custom-style all form controls; define explicit `hover`, `active`, `focus-visible`, and `disabled` states with snappy 120–180ms transitions.
- **Git Branching:** Never create new branches or git worktrees. Always work directly on `main` until explicitly told otherwise.
- **Versioning:** Never bump versions during normal work. The user picks the version at release time and `/monjita-github-release` sets it in every version file at once; keep version files in sync with each other otherwise.

## Playbooks (Read Before Task)
- **Building & Packaging:** Read `.brain/building-the-project.md` before packaging, compiling release binaries, or building an installer.
- **GitHub Actions & Releases:** Read `.brain/github-actions.md` before creating/modifying `.github/workflows/*.yml`, setting up release automation, or debugging a failed release.

## Repo Guardrails & Gotchas
- **Write-Guard Allowlist:** `src-tauri/src/github/guard_test.rs` scans all Rust sources and fails if `.post(`/`.put(`/`.patch(`/`.delete(`/`.request(` or HTTP client constructors appear outside its allowlist; mutating GitHub API calls belong only in `src-tauri/src/github/write.rs` targeting allowlisted endpoints.
- **Blob Protocol & CSP:** Cached repo icons and README images are served read-only from SQLite via `scrblob://localhost/<sha>` (`http://scrblob.localhost/<sha>` on Windows) under the strict CSP in `src-tauri/tauri.conf.json`.
- **Window Startup Reveal:** Main window starts with `visible: false` and `decorations: false` in `src-tauri/tauri.conf.json` and is shown after frontend first paint via `app_ready` (with a 3s Rust safety-net timer).

## Done Criteria
Run `npm run typecheck`, `npm run build`, and `cargo test --manifest-path src-tauri/Cargo.toml` (including `guard_test`), and verify versions agree across `gloria.toml`, `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.

<!-- brain-sync: 31e69a675214 -->
