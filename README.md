# Hexman

**From testers to testers.** Hexman is a desktop API testing tool for REST and GraphQL, built with Electron. It's built for people who test APIs every day and are tired of tools that all copy Postman.

![Hexman: requests as tiles, environments, response viewer](docs/screenshot.png)

## What makes it different

- **Tiles, not tabs.** Every request is a tile in the sidebar. A new request gets a numbered name (`Request 3`) right away and sits at the bottom while it's unsaved. Once you save it, it gets a frame and moves up into its folder.
- **One request, three languages.** Edit a request as a **form**, as a **cURL** command or as a **JSON** document. All three stay in sync, and every edit flows back into the request. If you paste a `curl …` command into the URL field, Hexman imports the whole request.
- **Suites, like JMeter.** A suite has a thread group (threads, ramp-up, loops) that runs a chain of saved requests. Each step can assert on status, response time and body content. The summary report shows avg/min/max/P90 and error % per step, plus the failed samples and why each one failed.
- **Environments.** Use `{{baseUrl}}`, `{{token}}` and other variables per environment, switched from the sidebar. Built-in dynamic values: `{{$uuid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`. The URL field shows a preview of the resolved address.
- **Header suggestions.** The **+** next to Headers lists the headers your saved requests already use (most used first), then common ones. You can filter the list, or type `Name: value` and press Enter.
- **Folders.** Group saved requests into folders. Drag tiles between folders or pick a folder in the editor.

| cURL view                                                            | Suite report                                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| ![The request as an editable cURL command](docs/screenshot-curl.png) | ![A suite run with its summary report](docs/screenshot-suite.png) |

![Header suggestions from saved requests](docs/screenshot-headers.png)

## Getting started

```
git clone https://github.com/dawidpolakowski/Hexman.git
cd Hexman
npm install
npm run dev
```

Shortcuts: **Ctrl+S** saves the request, **Ctrl+Enter** (or Enter in the URL field) sends it.

## Reference

### Request as JSON

```json
{
  "name": "Create user",
  "method": "POST",
  "url": "{{baseUrl}}/api/users",
  "headers": { "Content-Type": "application/json" },
  "body": { "name": "Grace Hopper", "role": "tester" }
}
```

`body` can be a JSON value or a string. A GraphQL request uses `query` (and optional `variables`) instead of `body`. Unknown fields are rejected, so a typo like `"header"` doesn't get silently ignored.

### cURL support

Supported options: `-X`, `-H`, `-d`/`--data`/`--data-raw`/`--data-binary`/`--data-urlencode`, `--json`, `-u`, `-A`, `-e`, `-b`, `-G`, `-I`, and `--url`. Both bash-style copies and Windows `cmd` copies (`^` escapes) work, so Chrome's _Copy as cURL_ output can be pasted directly. Options that don't change the request itself, such as `-s`, `-L`, `-k` and `--compressed`, are ignored. Multipart forms (`-F`), uploads (`-T`) and `@file` bodies are not supported yet.

### Suite assertions

| Field         | Examples                                         |
| ------------- | ------------------------------------------------ |
| Status        | `2xx`, `200`, `200, 201`, `200-299`; empty = any |
| Max ms        | `500`: fails when the response is slower         |
| Body contains | any text the response body must include          |

Suites run against the active environment. A request that is missing or can't be resolved (for example, an undefined variable) is reported as a failed sample instead of being sent.

### Where data lives

Saved requests, folders, suites and environments are stored locally in the app's user-data folder, unencrypted. Unsaved drafts live only in memory.

## Development

| Command                              | What it does                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                        | Run the app with hot reload                                                                                      |
| `npm test`                           | Unit tests (Vitest)                                                                                              |
| `npm run test:e2e`                   | Build, then drive the real app against a local demo API on a throwaway profile; refreshes `docs/screenshot*.png` |
| `npm run typecheck` / `npm run lint` | Static checks                                                                                                    |
| `npm run build:win`                  | Build a Windows installer                                                                                        |

## Contributing

We welcome contributions! Please read our [Contributing Guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

To report a security vulnerability, please see [SECURITY.md](SECURITY.md) rather than opening a public issue.

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.
