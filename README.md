<div align="center">
  <img src="assets/brand/pictelio-logo.svg" width="120" height="120" alt="Pictelio Logo">
  <h1 align="center">Pictelio</h1>
  <p align="center">
    <strong>A third-party Pixiv browser</strong>
    <br>
    Pictelio 是 <strong>Lynx 单引擎</strong>客户端。WebView 客户端的运行时随 #610 下线，
    <br>
    其源码与依赖随 ADR-0203 删除，仓库中不再保留。
  </p>
  <p align="center">
    <a href="https://github.com/a1121611810/pixivizer/blob/main/LICENSE">
      <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT">
    </a>
    <img src="https://img.shields.io/badge/vue--lynx-0.5.1-2BA471" alt="vue-lynx">
    <img src="https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript" alt="TypeScript">
    <img src="https://img.shields.io/badge/Vitest-5.0.1-FFD343?logo=vitest" alt="Vitest">
    <br>
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs Welcome">
  </p>
</div>

---

## Screenshots

<div align="center">
  <table>
    <tr>
      <td align="center"><strong>Feed</strong></td>
      <td align="center"><strong>Detail</strong></td>
      <td align="center"><strong>Novel</strong></td>
    </tr>
    <tr>
      <td><img src="packages/website/public/screenshots/01_feed.png" width="180" alt="Feed"></td>
      <td><img src="packages/website/public/screenshots/02_detail.png" width="180" alt="Detail"></td>
      <td><img src="packages/website/public/screenshots/03_novel.png" width="180" alt="Novel"></td>
    </tr>
    <tr>
      <td align="center"><strong>Settings</strong></td>
      <td align="center"><strong>Login</strong></td>
    </tr>
    <tr>
      <td><img src="packages/website/public/screenshots/06_settings.png" width="180" alt="Settings"></td>
      <td><img src="packages/website/public/screenshots/07_login.png" width="180" alt="Login"></td>
    </tr>
  </table>
</div>

---

## Features

- **Browse** — Recommended and Following feeds for both illustrations and novels
- **Illust Detail** — Full-resolution images, multi-page support, Ugoira animated playback
- **Novel Reader** — Virtualized text layout, text-selection search, series navigation with reading progress
- **Feed Layouts** — Two-column waterfall on illustration feeds, single column on list feeds (ranking, watchlist, novels)
- **Social** — Bookmark, comment, follow/unfollow artists
- **Content Control** — Per-account R18 / R18G visibility, tag muting, AI-restricted content handling
- **Theme** — Light, Dark, and System-follow themes

---

## Quick Start

**Prerequisites:** Node.js 22.22.2+, pnpm 11.9.0

```bash
pnpm install
pnpm dev          # Lynx 客户端开发服务器
```

> 裸命令（`dev` / `build` / `check` / `test` / `preview`）一律指向唯一客户端 `pictelio-app-lynx`（ADR-0204）。
> 客户端经 HTTP 代理访问 Pixiv：项目读取 `https_proxy` / `HTTP_PROXY` 环境变量，
> 回退 `http://127.0.0.1:7897`。

```
https_proxy=http://127.0.0.1:7890 pnpm dev
```

**Build APK:** Requires Android Studio, JDK 21, Android SDK (minSdkLevel=28).

```bash
pnpm build:android-host          # Debug APK
pnpm build:android-host:release  # Signed Release APK
pnpm dev:android-host            # 构建并安装调试包到设备
```

See [`docs/platform-compatibility.md`](docs/platform-compatibility.md) for platform requirements and [`docs/release-signing.md`](docs/release-signing.md) for release signing.

---

## Tech Stack

**Client** Vue 3 + vue-lynx (Lynx) · **Routing** vue-router · **Data** TanStack Vue Query · **Build** Rspeedy (rsbuild) + Gradle · **Style** Tailwind CSS + Material Design 3 · **Tooling** vite-plus (lint / fmt / test) · **Test** Vitest · **Type** TypeScript (strict)

---

## Project Structure

```
pixivizer/
├── packages/
│   ├── app-lynx/          # pictelio-app-lynx — vue-lynx 客户端，唯一运行时形态（登录 / 推荐 / 小说 / 我的）
│   ├── android-host/      # @pictelio/android-host — 构建宿主：Gradle 工程 / 发布脚本 / 原生 E2E（不是客户端）
│   ├── ugoira/            # @pictelio/ugoira — Ugoira (Pixiv animated illust) zip frame-processing pure functions
│   ├── update-check/      # @pictelio/update-check — shared update-check library (version compare / version.json fetch)
│   ├── novel-export/      # @pictelio/novel-export — shared novel multi-format export library (extract / block parse / payload)
│   ├── search-core/       # @pictelio/search-core — shared search core (filter state → request params / URL codec / cache keys)
│   ├── ranking-core/      # @pictelio/ranking-core — shared ranking core (dimension catalog / request builder / cache keys)
│   ├── net-diagnostics/   # @pictelio/net-diagnostics — shared network self-check library (check plan / verdict / report)
│   └── website/           # pictelio-website — Astro landing page (src/ → pages, layouts, styles)
├── docs/                  # Architecture docs, release guides, privacy policy
├── scripts/               # Deploy & utility scripts
└── openwiki/              # Auto-generated architectural documentation
```

---

## Available Scripts

<details>
<summary>Click to expand</summary>

Command convention (see `docs/adr/ADR-0204-root-command-naming.md`): the root `package.json` is the authoritative
script list. The five **bare** commands (`dev` / `build` / `check` / `test` / `preview`) target the only client,
`pictelio-app-lynx`. Host-package actions are **always explicitly named** with an `:android-host` suffix and never take
a bare name — building an APK is not "developing the app", and the command name should say so.
`<command>:<package-dir>` targets the matching workspace package, and `<command>:all` runs every package that has that
script, in parallel. `lint` / `fmt` / `fmt:check` / `outdated` are repo-wide single commands with no package variant.

| Command | Description |
|:--------|:------------|
| `pnpm dev` | Start the `pictelio-app-lynx` dev server (the only client) |
| `pnpm dev:app-lynx` | Same as `pnpm dev` (explicit alias) |
| `pnpm dev:website` | Start landing page (Astro) dev server |
| `pnpm dev:all` | Start all dev servers in parallel |
| `pnpm build` | Build `pictelio-app-lynx` |
| `pnpm build:website` | Build landing page |
| `pnpm check` | Type-check `pictelio-app-lynx` |
| `pnpm check:android-host` | Type-check the host package |
| `pnpm check:all` | Type-check all packages in parallel |
| `pnpm preview` | Preview the production build of `pictelio-app-lynx` |
| `pnpm test` | Run `pictelio-app-lynx` Vitest unit tests |
| `pnpm test:android-host` | Run host package unit tests (incl. the repo-invariant contract gate) |
| `pnpm test:android-host:unit` | Run JVM / Robolectric native unit tests |
| `pnpm test:android-host:e2e` | Run Appium E2E tests on the Android emulator (manual) |
| `pnpm test:all` | Run all packages' unit tests in parallel |
| `pnpm lint` | Run oxlint across the repo (single config source: root `vite.config.ts`) |
| `pnpm fmt` | Run oxfmt formatter across the repo |
| `pnpm build:android-host` | Build Debug APK |
| `pnpm build:android-host:release` | Build signed Release APK |
| `pnpm dev:android-host` | Build the debug APK and install it on the connected device |
| `pnpm release:android-host` | Interactive release flow |
| `pnpm sync:app-lynx-bundle` | Sync lynx bundle into Android assets |
| `pnpm deploy` | Preview landing page to `_site/` |

</details>

---

Pictelio is not affiliated with Pixiv Inc. All content displayed is sourced from [Pixiv](https://www.pixiv.net) public API and belongs to their respective creators.

This project is for learning and research purposes only. If you are evaluating it, please delete the app and all cached content within 24 hours. Do not use it for any purpose that violates Pixiv's Terms of Service or applicable laws.

## License

[MIT](LICENSE) © 2026
