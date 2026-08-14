# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repository currently contains no application source code — only project metadata and open-source governance files (`README.md`, `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/`). There is no `package.json`, build tooling, or Electron scaffolding yet.

The GitHub repo (`dawidpolakowski/Hexman`) is public and Apache-2.0 licensed. It is a fork of `hexforest/Hexman`.

## Conventions

- New source files should carry an `SPDX-License-Identifier: Apache-2.0` header (see `CONTRIBUTING.md`).

## Intent (from README.md)

Hexman is planned as an API testing tool for testers, built with Electron:
- Easy-to-use interface for API testing
- Support for REST and GraphQL APIs
- Detailed reporting of test results

Licensed under Apache License 2.0.

## Working in this repo

Since the project has no code yet, there are no build/lint/test commands to document. When scaffolding the initial Electron app (e.g. `package.json`, main/renderer process structure, bundler config), update this file with the real commands (install, dev, build, lint, test) and the actual architecture once they exist — do not invent them beforehand.
