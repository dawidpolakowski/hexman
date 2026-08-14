# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Electron + React + TypeScript app scaffolded via `electron-vite` (`@quick-start/electron`, react-ts template). REST/GraphQL request functionality is not built yet — the app currently launches to a placeholder screen.

The GitHub repo (`dawidpolakowski/Hexman`) is public and Apache-2.0 licensed. It is a fork of `hexforest/Hexman`.

## Conventions

- New source files should carry an `SPDX-License-Identifier: Apache-2.0` header (see `CONTRIBUTING.md`).

## Intent (from README.md)

Hexman is planned as an API testing tool for testers, built with Electron:
- Easy-to-use interface for API testing
- Support for REST and GraphQL APIs
- Detailed reporting of test results

Licensed under Apache License 2.0.

## Architecture

- `src/main/` — Electron main process (window creation, app lifecycle).
- `src/preload/` — preload script, bridges main/renderer via `contextBridge`.
- `src/renderer/` — React + TypeScript UI (Vite-powered).
- `electron.vite.config.ts` — build config for all three (electron-vite wraps Vite).
- `electron-builder.yml` — packaging config for distributable builds.

## Working in this repo

```
npm install       # install deps (also downloads the Electron binary — see Gotchas)
npm run dev        # launch the app with HMR
npm run typecheck  # tsc --noEmit for both main/preload (node) and renderer (web) projects
npm run lint        # eslint --cache .
npm run format       # prettier --write .
npm run build         # typecheck + production build (output in out/)
npm run build:win      # build + package a Windows installer (electron-builder)
```

There is no test suite yet.

## Gotchas

- On this machine, `npm install`'s Electron postinstall (`node_modules/electron/install.js`) can silently no-op and leave `node_modules/electron/dist/` without `electron.exe`, even though `npm install` exits 0 and the zip is already sitting in the local Electron cache (`%LOCALAPPDATA%\electron\Cache\`). `npm run dev`/`build` then fails with `Error: Electron uninstall`. Fix: manually extract the matching version's cached zip into `node_modules/electron/dist/` and write `node_modules/electron/path.txt` containing `electron.exe`, or delete the cache entry and let it re-download.

## Theming

Renderer color tokens (`src/renderer/src/assets/base.css`) intentionally mirror the sibling `typewriterx` app's palette (dark background, gold/brass `--primary` accent) so the two apps read as one family. When touching UI colors, keep new components on the existing CSS custom properties (`--bg`, `--text`, `--primary`, `--card-*`, `--input-*`, `--accent-*`) rather than hardcoding hex values.
