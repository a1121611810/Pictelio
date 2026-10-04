---
type: Quickstart
title: Pictelio — OpenWiki Quickstart
description: Entrypoint and task-routing map for the Pictelio (pixivizer) repository — a single-engine Lynx (vue-lynx) Pixiv client packaged into an APK by the @pictelio/android-host build host.
tags: [pictelio, pixiv, lynx, vue-lynx, android, monorepo]
verified:
  - by: openwiki/0.7.0
    at: 2026-10-04T18:40:18.128Z
sources:
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-3308c9211dcd0235ba53208e
    resource: repo://docs/adr/ADR-0202-ota-web-bundle-channel-retirement.md
  - id: openwiki-source-638aca70ff0d5527fe48d664
    resource: repo://docs/adr/ADR-0203-webview-client-source-removal.md
  - id: openwiki-source-37a3826cac55e1a6765ded76
    resource: repo://docs/adr/ADR-0204-root-command-naming.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-7f3058d7ffb09ba613ce5aca
    resource: repo://packages/android-host/package.json
  - id: openwiki-source-27ad4aacc4aecfa67f873e90
    resource: repo://packages/app-lynx/package.json
  - id: openwiki-source-40275cb92c3610938f16ade3
    resource: repo://pnpm-workspace.yaml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "openwiki/0.7.0", at: "2026-10-04T18:40:18.128Z" }
---

# Pictelio — OpenWiki Quickstart

**Pictelio** (repository name `pixivizer`) is a third-party [Pixiv](https://www.pixiv.net) illustration and novel browser built on a **single Lynx engine**. It has exactly one runtime client and one build host:

- **[`pictelio-app-lynx`](../packages/app-lynx/)** — the vue-lynx client (Vue 3 custom renderer on the ReactLynx runtime). This is the **only application client**.
- **[`@pictelio/android-host`](../packages/android-host/)** — the Android **build host**: Gradle project, release scripts, and native E2E that package the Lynx bundle into an APK. It is **not** a client.

The former SolidJS + Capacitor WebView client (`pictelio-app` / `packages/app`) was **deleted** in [ADR-0203](../docs/adr/ADR-0203-webview-client-source-removal.md) (2026-09-29). Its runtime had already gone offline at v6.3.0, and the OTA web-bundle channel was retired in [ADR-0202](../docs/adr/ADR-0202-ota-web-bundle-channel-retirement.md). Root commands were re-pointed at the Lynx client in [ADR-0204](../docs/adr/ADR-0204-root-command-naming.md).

This page is the entry point for humans and agents. Orient here, then follow the documentation map below.

## Quick Facts

| Attribute | Value |
|-----------|-------|
| Client version | 6.7.1 (`pictelio-app-lynx`) |
| Engine / framework | Lynx single engine — vue-lynx 0.5.1 (Vue 3.5.40) on the ReactLynx runtime |
| Bundler | rspeedy (`@lynx-js/rspeedy`) for `dev` / `build` / `preview` |
| Routing | vue-router 5.3.1 (`createMemoryHistory`) |
| Data fetching | @tanstack/vue-query 5.103 |
| State | Pinia 4 setup stores |
| Styling | Tailwind CSS 3.4 + Material Design 3 tokens (spacing=`vw`, fontSize=`rpx`) |
| Language | TypeScript (strict); `check` = `vue-tsc -p src/tsconfig.json` + `tsc -p tsconfig.node.json` |
| Native host | Java 21 / AGP 9.2.1 / Lynx SDK 4.0.1; minSdkVersion 28 |
| Package manager | pnpm 11.9.0 (Node ≥ 22.22.2, enforced via `devEngines`) |

## Documentation Map

### Architecture

| Page | What it covers |
|------|----------------|
| [Architecture Overview](architecture/overview.md) | Monorepo layout, rspeedy build tooling, Lynx boot sequence, and the app-lynx layering (api / stores / pages+components / primitives / composables / router) |
| [API Layer & Authentication](architecture/api-layer.md) | Pixiv API gateway, OAuth flows, token storage/restore, 401 refresh retry, rate-limit backoff |
| [Image Loading Pipeline](architecture/image-pipeline.md) | Three-tier cache, image host selection, shared `PixivImageLoader`, ugoira playback |

### Domains & Workflows

| Page | What it covers |
|------|----------------|
| [Feed & Browsing](domain/feed-and-browsing.md) | Recommended feeds, unified `createMixFeed` pagination, search, ranking, bookmarks, content control (R18/AI/tag mute) |
| [Novel Reader](domain/novel-reader.md) | Novel detail layout, reading progress, text-selection search, AI translation, multi-format export |

### Integrations & Operations

| Page | What it covers |
|------|----------------|
| [Android Native Integration & Build](integrations/android-native.md) | `LynxActivity`, the `Pictelio*` native modules, single-engine Gradle build, Keystore storage, system bars |
| [Operations: Release, Deploy & Runbook](operations/release-and-deploy.md) | Local dev prerequisites, APK build + release/signing flow, website deploy, version sync, platform compatibility |

### Testing

| Page | What it covers |
|------|----------------|
| [Testing Strategy](testing/overview.md) | Test pyramid and CI gate boundaries: app-lynx Vitest, android-host contract/JVM tests, emulator E2E |

## Development Quick Start

**Prerequisites:** Node.js ≥ 22.22.2, pnpm 11.9.0, Android Studio, JDK 21, Android SDK (minSdk 28).

```bash
pnpm install

# Lynx client — bare names target pictelio-app-lynx (ADR-0204)
pnpm dev       # rspeedy dev server
pnpm build     # production bundle
pnpm check     # vue-tsc + tsc type-check
pnpm test      # Vitest unit tests

# Android — host actions are always explicitly named (:android-host)
pnpm build:android-host           # debug APK (bundle → Gradle assembleDebug)
pnpm build:android-host:release   # signed release APK
pnpm dev:android-host             # build + install debug APK on device
pnpm release:android-host         # interactive release to GitHub Releases

# Repo-wide gates
pnpm check:all
pnpm lint:all
pnpm test:all
```

> **Proxy:** Pixiv and GitHub are reached through a local HTTP proxy. The tooling reads `https_proxy` / `HTTPS_PROXY` / `http_proxy` / `HTTP_PROXY`, falling back to `http://127.0.0.1:7897`. Set it before `pnpm dev`.

## Key Decisions

Architecture Decision Records live in [`docs/adr/`](../docs/adr/). The single-engine consolidation is the most recent major structural change:

| ADR | Topic |
|-----|-------|
| [0201](../docs/adr/ADR-0201-single-engine-facade-consolidation.md) | Single-engine facade consolidation — the codebase speaks one engine |
| [0202](../docs/adr/ADR-0202-ota-web-bundle-channel-retirement.md) | OTA web-bundle update channel retired; only APK update-check remains |
| [0203](../docs/adr/ADR-0203-webview-client-source-removal.md) | WebView client source removal — `packages/app` deleted; Android host moved to `packages/android-host`; OAuth credentials + product version moved to `packages/app-lynx`; client switching removed |
| [0204](../docs/adr/ADR-0204-root-command-naming.md) | Root bare commands re-pointed to `pictelio-app-lynx`; host actions use an `:android-host` suffix |

Per-topic decisions are covered in the linked wiki pages rather than enumerated here.

## Key Source Files

| Purpose | Path |
|---------|------|
| Client entry | [`packages/app-lynx/src/index.ts`](../packages/app-lynx/src/index.ts) |
| Root component / router | [`packages/app-lynx/src/App.vue`](../packages/app-lynx/src/App.vue) · [`src/router.ts`](../packages/app-lynx/src/router.ts) |
| Android Gradle project | [`packages/android-host/android/`](../packages/android-host/android/) |
| Native modules / shared core | [`packages/android-host/android/app/src/`](../packages/android-host/android/app/src/) |
| Release script | [`packages/android-host/scripts/release.mjs`](../packages/android-host/scripts/release.mjs) |
