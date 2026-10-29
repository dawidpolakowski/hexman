# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Electron + React + TypeScript app (scaffolded via `electron-vite`, react-ts template). Working features: REST and GraphQL requests sent from the main process, a tile-based sidebar with folders, Form/cURL/JSON request views kept in sync, header suggestions, environments with `{{variables}}`, and JMeter-style suites (thread group, assertions, summary report).

The GitHub repo (`dawidpolakowski/Hexman`) is public and Apache-2.0 licensed. It is a fork of `hexforest/Hexman`.

## Conventions

- New source files should carry an `SPDX-License-Identifier: Apache-2.0` header (see `CONTRIBUTING.md`).
- UI text is English. The tagline is "From testers to testers".

## Product direction

Hexman is deliberately **not** a Postman/Bruno clone. The owner uses Bruno at work and dislikes Postman-style navigation:

- **Tiles, not tabs.** Requests are sidebar tiles. Unsaved drafts get a numbered name (`Request N`) and stay at the bottom under "Unsaved". Saved requests get a framed tile and live in their folder or the root.
- **Text-first requests.** The same request can be edited as Form, cURL or JSON (two-way). Pasting `curl …` into the URL field imports it.
- Suites follow JMeter's model (thread group → steps → assertions → summary report), not Postman's collection runner.

## Architecture

- `src/main/` — Electron main process. `http.ts` sends requests with undici's `fetch` (http/https only) behind `http:send`, using the `NetworkSettings` sent along with each request (timeout, TLS verification, proxy; one dispatcher per TLS/proxy combo). It also handles `http:cancel` by request id. Its tests use a self-signed cert from `src/main/fixtures/`. `files.ts` handles the `file:save`/`file:open` dialogs (50 MB cap).
- `src/main/security.ts` — the renderer is sandboxed (`sandbox: true`, context isolation). Navigation away from the app page is blocked, only http(s)/mailto links open externally, and all browser permissions are denied. Every IPC handler goes through `handle()` in `index.ts`, which rejects senders other than the app's top-level page; validate IPC arguments in the main process.
- `src/preload/` — exposes the narrow `window.api` (`sendRequest`, `cancelRequest`, `saveFile`, `openFile`) via `contextBridge`. Because it runs sandboxed, it may import only `electron` (no npm packages); its type is `Api`.
- `src/shared/http.ts` — request/response types shared by main and renderer (included in both tsconfigs).
- `src/renderer/src/`:
  - `model.ts` — requests, folders, environments (`{{var}}` substitution), header helpers, `localStorage` persistence.
  - `formats.ts` — cURL and JSON serialize/parse (the `FORMATS` registry used by the editor views).
  - `suite.ts` — suite model, runner, assertions and report. `useSuiteRuns.ts` runs suites in the background.
  - `workspace.ts` — stored-data schema version (`SCHEMA_VERSION`, `MIGRATIONS`, backup before migrating; run in `main.tsx` before `App` mounts) and the workspace export/import file format. When stored data changes shape, bump `SCHEMA_VERSION` and add a migration instead of silently reading both shapes.
  - `App.tsx` holds all state. Saved requests only reach disk on Save, via the `snapshots` ref; folders, suites and environments autosave.
- `electron.vite.config.ts` — build config for all three (electron-vite wraps Vite).
- `electron-builder.yml` — packaging config for distributable builds.

## Working in this repo

```
npm install        # install deps (also downloads the Electron binary — see Gotchas)
npm run dev        # launch the app with HMR
npm test           # unit tests (Vitest): model, formats, suite, main-process http
npm run test:e2e   # build + drive the real app over CDP against a local demo API; rewrites docs/screenshot*.png
npm run typecheck  # tsc --noEmit for both main/preload (node) and renderer (web) projects
npm run lint       # eslint --cache .
npm run format     # prettier --write . (CI runs format:check)
npm run build      # typecheck + production build (output in out/)
npm run build:win  # build + package a Windows installer (electron-builder)
```

CI (`.github/workflows/ci.yml`) runs lint, format:check, typecheck and unit tests on Ubuntu, and the e2e run on Windows, for pushes to `main`/`develop` and for PRs.

`scripts/e2e.mjs` launches Electron with `--user-data-dir` set to a temp profile, so it never touches the real `%APPDATA%\hexman` data. When it fails, it prints the path of a failure screenshot. It also attaches to the main process through `--inspect`, so `stubDialog()` can answer native save/open dialogs with a file path. In e2e helpers, never mutate React-owned DOM nodes (e.g. `.remove()`); mark them with attributes instead, or React crashes on the next render.

## Gotchas

- On this machine, `npm install`'s Electron postinstall (`node_modules/electron/install.js`) can silently no-op and leave `node_modules/electron/dist/` without `electron.exe`, even though `npm install` exits 0 and the zip is already sitting in the local Electron cache (`%LOCALAPPDATA%\electron\Cache\`). `npm run dev`/`build` then fails with `Error: Electron uninstall`. Fix: manually extract the matching version's cached zip into `node_modules/electron/dist/` and write `node_modules/electron/path.txt` containing `electron.exe`, or delete the cache entry and let it re-download.

## Theming

Renderer color tokens live in `src/renderer/src/assets/base.css`: a GitHub-dark base with neon blue/violet accents. They match the sibling `typewriterx` app's `github-dark` variant. This replaced the earlier gold palette at the owner's request (2026-10-22). Keep new components on the existing CSS custom properties (`--bg`, `--text`, `--primary`, `--violet`, `--success`/`--warn`/`--danger`, `--card-*`, `--input-*`, `--accent-*`) rather than hardcoding hex values.
