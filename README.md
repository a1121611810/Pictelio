<div align="center">
  <img src="packages/app/assets/logo/pictelio-logo.svg" width="120" height="120" alt="Pictelio Logo">
  <h1 align="center">Pictelio</h1>
  <p align="center">
    <strong>A third-party Pixiv illustration browser built with SolidJS</strong>
    <br>
    Packaged as a native Android app with Capacitor
  </p>
  <p align="center">
    <a href="https://github.com/a1121611810/pixivizer/blob/main/LICENSE">
      <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT">
    </a>
    <img src="https://img.shields.io/badge/SolidJS-1.9.14-2c4f7c?logo=solid" alt="SolidJS">
    <img src="https://img.shields.io/badge/TypeScript-6.0.3-3178C6?logo=typescript" alt="TypeScript">
    <img src="https://img.shields.io/badge/UnoCSS-66.7.5-333333?logo=unocss" alt="UnoCSS">
    <img src="https://img.shields.io/badge/Capacitor-8.4.2-119EFF?logo=capacitor" alt="Capacitor">
    <img src="https://img.shields.io/badge/Vite-8.1.5-646CFF?logo=vite" alt="Vite">
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
      <td align="center"><strong>Settings</strong></td>
      <td align="center"><strong>Login</strong></td>
    </tr>
    <tr>
      <td><img src="packages/website/public/screenshots/01_feed.png" width="180" alt="Feed"></td>
      <td><img src="packages/website/public/screenshots/02_detail.png" width="180" alt="Detail"></td>
      <td><img src="packages/website/public/screenshots/03_settings.png" width="180" alt="Settings"></td>
      <td><img src="packages/website/public/screenshots/04_login.png" width="180" alt="Login"></td>
    </tr>
  </table>
</div>

---

## Features

- **Browse** — Recommended and Following feeds for both illustrations and novels
- **Illust Detail** — Full-resolution images, multi-page support, Ugoira animated playback
- **Novel Reader** — Virtualized text layout, keyword search, series navigation with reading progress
- **Layout Modes** — Waterfall masonry, single column, or grid
- **Social** — Bookmark, comment, follow/unfollow artists
- **Content Control** — Age gate on first launch, R18/R18G blurred filtering
- **Theme** — Light, Dark, and System-follow themes

---

## Quick Start

**Prerequisites:** Node.js 20.19+, pnpm 11.9.0

```bash
pnpm install
pnpm dev          # Vite dev server at localhost:5173
```

> Web dev needs an HTTP proxy to reach Pixiv. The project reads `https_proxy` / `HTTP_PROXY` env vars and falls back to `http://127.0.0.1:10808`.

```
https_proxy=http://127.0.0.1:7890 pnpm dev
```

**Build APK:** Requires Android Studio, JDK 21, Android SDK (minSdkLevel=30, WebView≥85).

```bash
pnpm build:android          # Debug APK
pnpm build:android:release  # Signed Release APK
pnpm dev:android            # Hot-reload development
```

See [`docs/platform-compatibility.md`](docs/platform-compatibility.md) for platform requirements and [`docs/release-signing.md`](docs/release-signing.md) for release signing.

---

## Tech Stack

**Framework** SolidJS · **Routing** TanStack Router · **Data** TanStack Query · **DB** TanStack DB · **Virtual** TanStack Virtual · **Build** Vite + vite-plus · **Style** UnoCSS + Fluent Design 2 · **Mobile** Capacitor · **Test** Vitest · **Type** TypeScript 6 (strict)

---

## Project Structure

```
pixivizer/
├── packages/
│   ├── app/               # SolidJS SPA (src/ → api, components, routes, stores, styles, utils, native)
│   └── website/           # Astro landing page (src/ → pages, layouts, styles)
├── docs/                  # Architecture docs, release guides, privacy policy
├── scripts/               # Deploy & utility scripts
└── openwiki/              # Auto-generated architectural documentation
```

---

## Available Scripts

<details>
<summary>Click to expand</summary>

| Command | Description |
|:--------|:------------|
| `pnpm dev` | Start Vite dev server |
| `pnpm build` | TypeScript check + Vite build |
| `pnpm check` | TypeScript type-check only |
| `pnpm preview` | Preview production build |
| `pnpm test` | Run Vitest tests |
| `pnpm test:agent-browser` | Run AI-driven E2E browser tests |
| `pnpm test:all` | Run all tests |
| `pnpm lint` | Run oxlint |
| `pnpm fmt` | Run oxfmt formatter |
| `pnpm build:android` | Build Debug APK |
| `pnpm build:android:release` | Build signed Release APK |
| `pnpm dev:android` | Hot-reload Android development |
| `pnpm cap:*` | Capacitor sync / copy / open |
| `pnpm release:github` | Publish APK to GitHub Releases |
| `pnpm deploy` | Preview landing page to `_site/` |
| `pnpm openwiki:update` | Sync OpenWiki docs from source |

</details>

---

Pictelio is not affiliated with Pixiv Inc. All content displayed is sourced from [Pixiv](https://www.pixiv.net) public API and belongs to their respective creators.

## License

[MIT](LICENSE) © 2026
