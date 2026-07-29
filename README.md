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
  <p>
    🌐 <b>English</b> · <a href="#中文">中文</a>
  </p>
</div>

---

<a id="中文"></a>

<details>
  <summary><strong>中文</strong> — 简体中文版本</summary>

  <div align="center">
    <img src="packages/app/assets/logo/pictelio-logo.svg" width="80" height="80" alt="Pictelio Logo">
    <h2>Pictelio</h2>
    <p>基于 SolidJS 的第三方 Pixiv 客户端，通过 Capacitor 打包为 Android 原生应用</p>
  </div>

  **功能一览**

  - 推荐 / 关注 / 搜索插画与小说瀑布流
  - 作品详情（大图、多页、Ugoira 动图播放）
  - 小说阅读（虚拟化排版、关键词搜索、系列导航）
  - 收藏 / 评论 / 关注 / 屏蔽 / 举报
  - 浏览历史自动追踪
  - 亮/暗主题切换，R18 内容分级过滤
  - 图片 CDN 代理缓存、PWA 离线支持

  **技术栈：** SolidJS + TypeScript + Vite + UnoCSS + Capacitor + TanStack Router/Query/Virtual + Fluent Design 2

  **快速开始：**

  ```bash
  pnpm install   # 安装依赖
  pnpm dev       # 启动开发服务器
  ```

  > 开发阶段需配置 HTTP 代理（环境变量 `https_proxy`），默认回退 `http://127.0.0.1:10808`

  详情参见[英文版](#english)。

</details>

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
      <td><img src="packages/website/docs/public/screenshots/01_feed.png" width="180" alt="Feed"></td>
      <td><img src="packages/website/docs/public/screenshots/02_detail.png" width="180" alt="Detail"></td>
      <td><img src="packages/website/docs/public/screenshots/03_settings.png" width="180" alt="Settings"></td>
      <td><img src="packages/website/docs/public/screenshots/04_login.png" width="180" alt="Login"></td>
    </tr>
  </table>
</div>

---

## Features

| Browsing | Utilities | Native |
|:---------|:----------|:-------|
| Recommended & Following feeds | Bookmarks management | Predictive back gesture |
| Illust detail with Ugoira playback | User pages & follow/unfollow | Bottom navigation bar |
| Novel reader (virtualized, search) | Report & Block | Pull-to-refresh & auto-hide nav |
| Waterfall / single / grid layouts | Browsing history | Android Keystore secure storage |
| Novel discovery feed | Comment browsing | PWA offline cache |
| Age gate & R18 filtering | Update check via GitHub Releases | Theme switching (light/dark/system) |

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

## ⚠️ Disclaimer

Pictelio is **not affiliated with** Pixiv Inc. All illustrations are sourced from the [Pixiv](https://www.pixiv.net) public API and belong to their respective creators. This project is for **educational purposes only**. Users must comply with Pixiv's Terms of Service and applicable laws.

## 📄 License

[MIT](LICENSE) © 2026
