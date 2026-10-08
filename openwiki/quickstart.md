---
type: Quickstart
title: Pictelio — OpenWiki Quickstart
description: Entry point and task-routing map for the single-engine Pictelio monorepo — the one vue-lynx client plus the @pictelio/android-host build host, the six shared pure-logic packages and the Astro site, the root command surface, the ADR-first and workflow rules, and the CI-owned OpenWiki contract.
tags: [pictelio, pixiv, lynx, vue-lynx, android, monorepo, quickstart]
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-6d4b4e707b8d60b6ccfa3425
    resource: repo://.github/workflows/openwiki-update.yml
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-f9cfb243e2af63b22910dffd
    resource: repo://CONTEXT-MAP.md
  - id: openwiki-source-3402d7277fc710d22f072ad2
    resource: repo://docs/adr/ADR-0099-local-openwiki-disable.md
  - id: openwiki-source-af98b36e6440cac152de8efd
    resource: repo://docs/adr/ADR-0185-vite-plus-1rc-toolchain.md
  - id: openwiki-source-3308c9211dcd0235ba53208e
    resource: repo://docs/adr/ADR-0202-ota-web-bundle-channel-retirement.md
  - id: openwiki-source-638aca70ff0d5527fe48d664
    resource: repo://docs/adr/ADR-0203-webview-client-source-removal.md
  - id: openwiki-source-37a3826cac55e1a6765ded76
    resource: repo://docs/adr/ADR-0204-root-command-naming.md
  - id: openwiki-source-ab28a0d87e373c670b157ced
    resource: repo://docs/adr/ADR-0221-row-action-leaves-trailing-band.md
  - id: openwiki-source-637b93868ecea96ea727b82c
    resource: repo://docs/adr/glossary-fluent-design-chapter-archive.md
  - id: openwiki-source-ecf35e9c1ed01d76c4d88a9b
    resource: repo://docs/adr/glossary-toolchain-regression.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-0f2dc325834b2f7fe7051ab9
    resource: repo://packages/android-host/android/app/build.gradle
  - id: openwiki-source-1183cdf2a4b6da6dbfbfe3f1
    resource: repo://packages/android-host/android/build.gradle
  - id: openwiki-source-8d8053f2507ff96f02c58a19
    resource: repo://packages/android-host/android/variables.gradle
  - id: openwiki-source-7f3058d7ffb09ba613ce5aca
    resource: repo://packages/android-host/package.json
  - id: openwiki-source-c77a2d8f001277042a57526c
    resource: repo://packages/android-host/scripts/sync-android-version.mjs
  - id: openwiki-source-720973935af6ee0acf5c8618
    resource: repo://packages/android-host/tests/unit/openwikiGateDeadlock.test.ts
  - id: openwiki-source-76f42986ee5e8b672e9a9f62
    resource: repo://packages/android-host/vitest.config.ts
  - id: openwiki-source-1a2f2bb2203c560331e95f34
    resource: repo://packages/app-lynx/lynx.config.ts
  - id: openwiki-source-27ad4aacc4aecfa67f873e90
    resource: repo://packages/app-lynx/package.json
  - id: openwiki-source-dd8e77e92dee3762f1cf1359
    resource: repo://packages/app-lynx/README.md
  - id: openwiki-source-40275cb92c3610938f16ade3
    resource: repo://pnpm-workspace.yaml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-5e1b077422a94ae165e88e4e
    resource: repo://vite.config.ts
  - id: openwiki-source-ef4ef42dc4e88b6541eb6f3f
    resource: repo://workflows/review-fix-loop.md
generated: { by: "openwiki/0.7.1", at: "2026-10-08T02:38:27.827Z" }
verified:
  - by: openwiki/0.7.1
    at: 2026-10-08T02:38:27.827Z
---

# Pictelio — OpenWiki Quickstart

**Pictelio** (repository directory `pixivizer`) is a third-party [Pixiv](https://www.pixiv.net) illustration and novel client for Android, built on **exactly one engine**. The pnpm workspace ([`pnpm-workspace.yaml`](../pnpm-workspace.yaml)) holds nine packages:

- **[`pictelio-app-lynx`](../packages/app-lynx/)** — the vue-lynx client (Vue 3 custom renderer on the ReactLynx runtime). It is the **only application client**, and the target of every bare root command.
- **[`@pictelio/android-host`](../packages/android-host/)** — the Android **build host**: Gradle project, Lynx native modules, release scripts, JVM/Robolectric tests and emulator E2E. It packages the client bundle into an APK; it is **not** a client.
- **Six shared pure-logic packages** — `@pictelio/ugoira`, `@pictelio/update-check`, `@pictelio/novel-export`, `@pictelio/search-core`, `@pictelio/ranking-core`, `@pictelio/net-diagnostics`.
- **[`pictelio-website`](../packages/website/)** — the Astro landing page deployed to GitHub Pages.

The earlier SolidJS + Capacitor WebView client was **removed**: its runtime went offline at v6.3.0, its OTA web-bundle channel was retired in [ADR-0202](../docs/adr/ADR-0202-ota-web-bundle-channel-retirement.md), and its source was deleted in [ADR-0203](../docs/adr/ADR-0203-webview-client-source-removal.md) (2026-09-29), which also moved the surviving Gradle project into `packages/android-host` and made `packages/app-lynx/credentials.json5` plus the client `version` the single sources of truth. Root command names were re-pointed at the Lynx client in [ADR-0204](../docs/adr/ADR-0204-root-command-naming.md); terminology is fixed by [`glossary-webview-client-removal.md`](../docs/adr/glossary-webview-client-removal.md). There is no dual-engine or client-switch behavior left to reason about.

## Ground rules before you touch anything

| Question | Where the answer lives |
|---|---|
| What rules govern a change here (tool routing, tests, conventions, agent behavior)? | [`AGENTS.md`](../AGENTS.md) — read it first. [`NOTES.md`](../NOTES.md) records only what `AGENTS.md` does not (known gaps, extra scripts, terminology). |
| Has a decision already been made about this behavior? | [`docs/adr/`](../docs/adr/) — the ADR corpus, numbered past ADR-0221. System-level decisions live there; context-level decisions live in `packages/<context>/docs/adr/`. |
| Which package's language and domain terms apply? | [`CONTEXT-MAP.md`](../CONTEXT-MAP.md) routes to each package's `CONTEXT.md` (for example [`packages/app-lynx/CONTEXT.md`](../packages/app-lynx/CONTEXT.md)); a missing `CONTEXT.md` is silently skipped, not created on the fly. |
| How do I make and prove a change end to end? | [Change & Verification Loop](workflows/change-and-verification-loop.md) — it routes to the mandatory Grill → to-spec → to-tickets → implement pipeline, the review–fix loop, the git hooks, and the three CI jobs. |
| What counts as a proven change? | [Testing & Quality Gates](testing/overview.md) plus the detail doc [`docs/testing/conventions.md`](../docs/testing/conventions.md). |

Three conventions are worth internalizing because they are easy to violate:

- **ADR-first.** Design details are double-anchored to a wiki page *and* an ADR; when they disagree, the ADR and the source win (this wiki is regenerated from source on a schedule, so it can lag). Look for an existing ADR before editing behavior, and do not restate its content here.
- **The gate freeze line lives outside `AGENTS.md`.** `AGENTS.md` §工作流强制规范 now only points at the review–fix loop; the loop's rules, exit conditions, and 门禁冻结线 (gate freeze line) are entirely in [`workflows/review-fix-loop.md`](../workflows/review-fix-loop.md) §门禁冻结线. Repo references to "`AGENTS.md` 门禁冻结线 #N" mean that section.
- **Material Design 3 is the only current design contract.** `AGENTS.md`'s Fluent Design chapter is an explicitly **archived** section that served the deleted WebView client and carries no constraint for app-lynx; the archive record is [`glossary-fluent-design-chapter-archive.md`](../docs/adr/glossary-fluent-design-chapter-archive.md). Read [MD3 Design System & Token Contract](concepts/md3-design-system.md) instead.

For tool routing, `AGENTS.md` mandates a first step depending on the question: architecture / domain / integration / testing intent starts from this wiki (use the Documentation Map below, or `openwiki_search` when available), concrete symbols and call chains go through CodeGraph, and third-party or browser-standard documentation goes through Context7 or MDN. The authoritative wording, the allowed degradations, and the task-completion checklist are in [`AGENTS.md`](../AGENTS.md).

## Quick Facts

| Attribute | Value |
|-----------|-------|
| Client version | 6.8.0 — source of truth [`packages/app-lynx/package.json`](../packages/app-lynx/package.json) |
| Android version | `versionName "6.8.0"` / `versionCode 60800`, derived as major×10000 + minor×100 + patch and written back by `sync:android-version` |
| Engine / framework | Lynx single engine — vue-lynx 0.5.1 on Vue 3.5.40 (ReactLynx runtime) |
| Bundler / tests | rspeedy (`@lynx-js/rspeedy` ^0.13.6) for `dev` / `build` / `preview`; Vitest 5.0.1 |
| Routing · state · data | vue-router 5.3.1 (memory history) · Pinia 4 setup stores · `@tanstack/vue-query` 5.103 |
| Styling | Tailwind CSS 3.4 + Material Design 3 tokens (spacing in `vw`, fontSize in `rpx`) |
| Language | TypeScript strict — shared packages 7.0.2, app-lynx pinned to 5.9.3 (ADR-0144, ADR-0184 D5) |
| Native host | Java 21 · AGP 9.2.1 · Lynx SDK 4.0.1 · `minSdkVersion 28` (Android 9+) |
| Toolchain | pnpm 11.9.0, Node ≥ 22.22.2, enforced by `devEngines` in the root [`package.json`](../package.json) |
| CI gates | `check:all` + `lint:all`, `test:all`, and Gradle `testDebugUnitTest` (Robolectric); emulator E2E stays manual |

## Documentation Map

Route by task: each row says what you are about to change and which page owns the constraints for it. When a page and its cited ADR disagree, the ADR and the source win.

### Architecture & concepts

| If you are about to… | Start here |
|---|---|
| Orient in the repository — package layout, Lynx boot sequence, `App.vue` shell, layer map, store inventory, route topology, startup update check | [Architecture Overview](architecture/overview.md) |
| Change routes, the memory-history route table, the back stack / system-back decision chain, page chrome, bottom sheets and modal stack, the radial-nav FAB | [App Shell & Navigation](architecture/app-shell-and-navigation.md) |
| Change how Pixiv is reached — the API gateway and its native versus dev-proxy transport, OAuth and refresh-token persistence, the auth-ready gate, 401 single-flight retry, 429 backoff | [API Layer & Authentication](architecture/api-layer.md) |
| Change image loading — URL/quality construction, cache keys and layers, image-host routing, the native image service, ugoira extract versus streaming | [Image Loading Pipeline](architecture/image-pipeline.md) |
| Change any color, spacing, type, shape, state-layer or icon decision, or add an M3 component | [MD3 Design System & Token Contract](concepts/md3-design-system.md) |
| Change insets, safe areas, occlusion bands, spacing units, or any motion/transition | [Viewport Geometry, Insets & Motion Contract](concepts/viewport-geometry-and-motion.md) |

### Domains

| If you are about to… | Start here |
|---|---|
| Change feeds, pagination, search, ranking, bookmarks, watch-later, or R18 / AI / muted-tag content control | [Feed & Browsing](domain/feed-and-browsing.md) |
| Change the novel list, intro gate, virtualized reader, in-chapter search, text-selection actions, BYOK translation, or novel export | [Novel Reader](domain/novel-reader.md) |
| Change `/continue`, browsing-history rows, resume positions, or the row-head remove action | [Continue Reading & Browsing History](domain/continue-reading-and-history.md) |
| Change the download queue, gallery save, share hand-off, ugoira/novel file naming, or the `/downloads` page and its delete semantics | [Downloads, Gallery Save & Export](domain/downloads-and-export.md) |
| Change settings keys, the storage layers, credential isolation, or WebDAV backup/restore | [Settings, Persistence & WebDAV Backup](domain/settings-and-backup.md) |
| Change the notification center, unread badge, or the local notification delivery probe | [Notifications & Delivery Probe](domain/notifications-and-delivery-probe.md) |

### Integrations, operations, testing & workflow

| If you are about to… | Start here |
|---|---|
| Change native modules, `LynxActivity`, the Gradle variant/source-set layout, Keystore-backed storage, system bars, or the notification channel | [Android Native Integration & Build](integrations/android-native.md) |
| Sign, version, release, or deploy — keystore and env-var rules, the interactive release and overwrite flows, version/credential sync, the GitHub Pages site | [Release, Deploy & Runbook](operations/release-and-deploy.md) |
| Decide what must be tested and which gate proves it — CI boundaries, manual device tiers, the test hard constraints, the repo-invariant guards | [Testing & Quality Gates](testing/overview.md) |
| Make a change, run the review–fix loop, understand the hooks and CI jobs, or check how and when OpenWiki is regenerated | [Change & Verification Loop](workflows/change-and-verification-loop.md) |

Per-topic design decisions are deliberately not enumerated here; each page above links the ADRs it depends on, and [`docs/adr/`](../docs/adr/) holds the rest.

## Development Quick Start

**Prerequisites:** Node.js ≥ 22.22.2, pnpm 11.9.0, JDK 21, and the Android SDK for host work (`minSdkVersion 28`); Android Studio is the practical way to get the SDK. Platform requirements are in [`docs/platform-compatibility.md`](../docs/platform-compatibility.md).

```bash
pnpm install

# Bare names target the client, pictelio-app-lynx (ADR-0204)
pnpm dev        # rspeedy dev server (needs the local proxy, see below)
pnpm build      # production Lynx bundle
pnpm preview    # rspeedy preview / web-core preview entries
pnpm check      # vue-tsc -p src/tsconfig.json && tsc -p tsconfig.node.json
pnpm test       # Vitest: default config, then vitest.fallback.config.ts

# Host actions are always explicitly named (:android-host)
pnpm dev:android-host             # build and install a debug APK on a device
pnpm build:android-host           # sync version + credentials → bundle → Gradle assembleDebug
pnpm build:android-host:release   # signed release APK (keystore passwords from env)
pnpm test:android-host            # host-side unit tests (scripts, contracts)
pnpm test:android-host:unit       # Gradle testDebugUnitTest (Robolectric / JVM)
pnpm test:android-host:e2e        # emulator E2E — manual, pre-release only
pnpm release:android-host         # interactive release to GitHub Releases

# Repo-wide gates and the single-config lint/format surface
pnpm check:all   # type-check every package (this one runs with --cache)
pnpm lint:all    # root vite-plus lint — repo-level single config, no :package variants
pnpm test:all    # unit tests across all packages (never cached)
pnpm fmt:all     # format
pnpm deploy:dry  # landing-page preview
```

Three command-surface facts that surprise readers:

- **`:all` aggregates are bounded.** They fan out across all nine packages with a concurrency limit; `RUN_CONCURRENCY` overrides the default of 2 locally (CI sets it to 9). The full list, including `dev:all` / `build:all` / `preview:all` / `test:mutation`, is in the root [`package.json`](../package.json) — `AGENTS.md` covers only the common ones.
- **`check:all` is cached, `test:all` is not** — deliberately, so a cache hit can never turn a test gate into a replayed log.
- **`lint` / `fmt` have no per-package variants**; they are one repo-level vite-plus command whose only configuration source is the root [`vite.config.ts`](../vite.config.ts). The app-lynx package's own `lint` and `fmt` scripts are intentional no-op echoes while its style debt is repaid (ADR-0185), so a green `lint:all` does not mean app-lynx was linted.

> **Proxy.** The client dev server requires a local HTTP proxy: [`packages/app-lynx/lynx.config.ts`](../packages/app-lynx/lynx.config.ts) reads `https_proxy` / `HTTPS_PROXY` / `http_proxy` / `HTTP_PROXY` and falls back to `http://127.0.0.1:7897`, logging only the redacted host. Without it, Pixiv and GitHub calls black-hole. Emulator E2E needs the equivalent device-level setting
> (`adb shell settings put global http_proxy 10.0.2.2:7897`), and a dead proxy there shows up as a hung splash or a login timeout rather than an obvious network error — see [`glossary-toolchain-regression.md`](../docs/adr/glossary-toolchain-regression.md).

## Key Decisions

Decision records live in [`docs/adr/`](../docs/adr/) and its sibling glossaries; numbering continues past ADR-0221. The single-engine consolidation is the largest structural change, and the newest records are mostly MD3/geometry and domain work:

| ADR | Topic |
|-----|-------|
| [0201](../docs/adr/ADR-0201-single-engine-facade-consolidation.md) | Single-engine facade consolidation — the codebase speaks one engine |
| [0202](../docs/adr/ADR-0202-ota-web-bundle-channel-retirement.md) | OTA web-bundle update channel retired; only the APK update check remains |
| [0203](../docs/adr/ADR-0203-webview-client-source-removal.md) | WebView client source removal — `packages/app` deleted, host moved to `packages/android-host`, credentials and version moved to `packages/app-lynx` |
| [0204](../docs/adr/ADR-0204-root-command-naming.md) | Root bare commands re-pointed at `pictelio-app-lynx`; host actions carry an `:android-host` suffix |
| [0205](../docs/adr/ADR-0205-md3-baseline-and-scope.md)–[0209](../docs/adr/ADR-0209-md3-filled-text-field-alignment.md) | MD3 baseline and scope, type scale, shape and state-layer guardrails, icons, filled text fields — the current design contract |
| [0211](../docs/adr/ADR-0211-ui-continuity-motion-contract.md) · [0212](../docs/adr/ADR-0212-tonal-elevation-surface-over-shadow.md) · [0213](../docs/adr/ADR-0213-immersive-media-view.md) | UI continuity motion, tonal elevation over shadow, the immersive media view |
| [0219](../docs/adr/ADR-0219-lynx-continue-reading.md) | Continue-reading and browsing-history design for `/continue` |
| [0220](../docs/adr/ADR-0220-notification-delivery-channel-probe.md) | Notification delivery-channel probe and its interpretation rules |
| [0221](../docs/adr/ADR-0221-row-action-leaves-trailing-band.md) | Row actions must leave the trailing band the floating action button occupies |

Glossary files (`glossary-*.md`) hold the terminology and the row-by-row applicability judgments that ADRs cite; when a rule's exact semantics matter, read the glossary the ADR names.

## Key Source Files

| Purpose | Path |
|---------|------|
| Client entry | [`packages/app-lynx/src/index.ts`](../packages/app-lynx/src/index.ts) |
| Root component / router | [`packages/app-lynx/src/App.vue`](../packages/app-lynx/src/App.vue) · [`src/router.ts`](../packages/app-lynx/src/router.ts) |
| Bundle and dev-server config (credentials, version injection, proxy) | [`packages/app-lynx/lynx.config.ts`](../packages/app-lynx/lynx.config.ts) |
| Android Gradle project | [`packages/android-host/android/`](../packages/android-host/android/) |
| Lynx native modules / shared Java core | [`packages/android-host/android/app/src/lynx/java/`](../packages/android-host/android/app/src/lynx/java/) · [`src/main/java/`](../packages/android-host/android/app/src/main/java/) |
| Release and version/credential sync | [`packages/android-host/scripts/release.mjs`](../packages/android-host/scripts/release.mjs) · [`sync-android-version.mjs`](../packages/android-host/scripts/sync-android-version.mjs) |
| Root command surface | [`package.json`](../package.json) |

## How this wiki is maintained

`openwiki/` is **generated**, never hand-written. The scheduled workflow [`.github/workflows/openwiki-update.yml`](../.github/workflows/openwiki-update.yml) reruns generation on a daily cron (`10 10 * * *`, plus manual `workflow_dispatch`), commits the result to the `openwiki/update` branch, and opens a `docs: update OpenWiki` pull request. Whether that PR merges itself is decided by two gates, and the first one is deliberately an indirection:

- **`Run OpenWiki` (L105–L129) is `continue-on-error: true`**, so a run that dies halfway keeps every page it finished; the job is later marked red by `Propagate OpenWiki failure` (L288–L290) while the job itself is capped at 150 minutes (L24–L28) so a hung run fails loudly instead of burning runner time.
- **`Snapshot post-run OpenWiki state` (id `poststate`, L131–L156) reads `openwiki/.last-update.json` *before* `Create OpenWiki update pull request` (L221–L244)** and publishes `exists` / `status` / `gitHead` as step outputs. The ordering is the whole point: `peter-evans/create-pull-request` restores the workspace to `main`, so a gate reading the file afterwards sees the *previous* run's values — the shape of the deadlock that once kept the gate red forever.
- **`Gate auto-merge on a complete run` (L246–L270) consumes `steps.poststate.outputs.exists/status/gitHead` through `env:`**, never the file, and refuses auto-merge unless a parsable state file exists and its `status` is `complete`. `Enforce no-op detection` (L272–L286) separately refuses it when `gitHead` advanced and source changed while `openwiki/` produced zero content diff (detector: L175–L219). Only then is auto-merge enabled, by branch lookup on `openwiki/update` (L292–L304).

An interrupted or empty run therefore still leaves its finished pages as a **hand-reviewable pull request** and is never auto-merged: the gates block the unattended merge, they do not discard partial progress. That step order and the step-output indirection are pinned by [`openwikiGateDeadlock.test.ts`](../packages/android-host/tests/unit/openwikiGateDeadlock.test.ts), a repo-invariant test that runs inside `pnpm test:all` — so a workflow edit that re-breaks the gate fails CI. [Change & Verification Loop](workflows/change-and-verification-loop.md) carries the full step list.

Consequences for contributors and agents:

- **Do not hand-edit anything under `openwiki/`.** Change the source, the ADR, or a package `CONTEXT.md`, and let CI regenerate the page. Page content is a derived view; a manual edit is overwritten.
- **Do not run `pnpm openwiki:update` locally**, including after changing `src/` or `packages/`; regeneration is CI-owned by design ([ADR-0099](../docs/adr/ADR-0099-local-openwiki-disable.md)), and the root script survives only for deliberate human use.
- A failed or delayed regeneration does not block local work or commits — CI converges on the next run. `CLAUDE.md` is deliberately not kept in the repository; the workflow deletes it (L164–L167).
- The PR's `add-paths` covers `openwiki`, `AGENTS.md`, **and the workflow file itself** (L169–L173), so an OpenWiki run can rewrite the very gate that governs it — which is why the invariant is enforced by a test rather than by comment discipline.
