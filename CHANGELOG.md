# Changelog

All notable changes to Hexman. Versions follow [semantic versioning](https://semver.org/).

## 0.2.0 — 2026-10-29

Safe to hand to other testers: your data survives updates, can leave the app, and the app works behind corporate networks.

### Added

- **Export / Import** of the workspace (saved requests, folders, suites, environments) as one JSON file. Import shows what it adds or replaces before changing anything.
- **Settings**: request timeout, TLS verification on/off (for self-signed test servers), and a proxy (explicit URL, or `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` from the environment).
- **Cancel** a running request: Send turns into Cancel while it runs.
- Certificate errors explain how to allow self-signed certificates.
- CI on every push and PR: lint, formatting, types, unit tests and the end-to-end run on Windows.

### Changed

- Stored data has a schema version. Upgrades back up the old data first, and data from a newer Hexman is never overwritten.
- Requests are sent with undici, so proxies and TLS options are supported.

### Security

- The renderer is sandboxed, with context isolation. It sees only a narrow `window.api`, and IPC answers only the app's own page.
- Navigation away from the app is blocked, only web and mail links open externally, and all browser permissions are denied.
- macOS builds no longer declare camera, microphone, Documents or Downloads access.

## 0.1.0 — 2026-10-22

First working version: request tiles and folders, Form / cURL / JSON views, header suggestions, environments with `{{variables}}`, and JMeter-style suites with assertions and a summary report.
