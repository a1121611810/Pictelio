---
type: Concept
title: Android Native & Build
description: The Capacitor Android native runtime layer — four custom Java plugins (AuthPlugin, ImageCachePlugin, OAuthPlugin, PixivApiPlugin), TypeScript bridge files, Gradle build pipeline, release signing, and WebView configuration. Updated in v3.18.0 with PixivApiPlugin gateway replacing PictelioHttpPlugin.
tags: [android, capacitor, native, gradle, build, plugins, pixiv-api-gateway]
---

# Android Native & Build

Pictelio packages the SolidJS SPA as a native Android app via Capacitor, with four custom native plugins and a comprehensive build pipeline.

## Native Plugin Architecture

Four custom Capacitor plugins bridge the TypeScript SPA to Android platform capabilities. Each has a Java implementation and a TypeScript wrapper:

```mermaid
flowchart LR
    subgraph TS[TypeScript / JavaScript]
        A[AuthPlugin.ts]
        I[ImageCache.ts]
        O[OAuthPlugin.ts]
        P[PixivApi.ts]
    end
    subgraph Java[Android Java]
        JA[AuthPlugin.java]
        JI[ImageCachePlugin.java]
        JO[OAuthPlugin.java]
        JP[PixivApiPlugin.java]
    end
    TS -->|Capacitor bridge| Java
```

### AuthPlugin

**Java:** `/packages/app/android/app/src/main/java/io/pictelio/app/AuthPlugin.java` (8.1 KB)
**TypeScript:** `/packages/app/src/native/AuthPlugin.ts`

Handles OAuth token refresh with Pixiv credentials **hidden from the JavaScript layer**, plus native splash screen control:

**Methods:**
- `setCredentials(credentials)` — stores Pixiv client credentials in native memory
- `refreshToken(refreshToken)` — performs the OAuth token refresh call natively, returning the new token pair
- `hideSplash()` — sets `MainActivity.keepSplashVisible` to `false`, triggering native Splash Screen exit. Called from `splashBridge.ts` when content is ready (v3.21.0+, see [Splash Screen JS Bridge](#splash-screen-js-bridge))

**Security:**
- Credentials are never exposed to the WebView, preventing credential theft via XSS

### ImageCachePlugin

**Java:** `/packages/app/android/app/src/main/java/io/pictelio/app/ImageCachePlugin.java` (6.3 KB)
**TypeScript:** `/packages/app/src/native/ImageCache.ts`

Android disk cache for Pixiv images, implementing **L3** of the [Image Loading Pipeline](/openwiki/architecture/image-pipeline.md):
- Intercepts image requests via `shouldInterceptRequest()` in the WebView
- Checks disk cache before making network requests
- Returns cached `WebResourceResponse` when available
- Configurable max disk cache size
- Periodic garbage collection for stale entries

### OAuthPlugin

**Java:** `/packages/app/android/app/src/main/java/io/pictelio/app/OAuthPlugin.java` (15.4 KB)
**TypeScript:** `/packages/app/src/native/OAuthPlugin.ts`

The largest native plugin, handling the PKCE authorization code flow:
- `startOAuth(url, redirectScheme)` — opens Pixiv login in a native WebView
- `onPageFinished` interceptor — captures redirect URL with authorization code
- Extracts the code from the redirect and returns it to JavaScript
- SSRF protection via URL whitelist (per ADR-0002)

### PixivApiPlugin (Gateway)

**Java:** `/packages/app/android/app/src/main/java/io/pictelio/app/PixivApiPlugin.java` (9 KB)
**TypeScript:** `/packages/app/src/native/PixivApi.ts`

Introduced in **v3.18.0** as the sole gateway for all Pixiv API communication (ADR-0037). Replaces the former PictelioHttpPlugin, which was deleted:

- `request({ method, path, params, body })` — all Pixiv App-API requests go through this single plugin method
- **access_token is never exposed to the JavaScript layer** — stored in a Java `volatile` field, injected into OkHttp requests internally
- **401 auto-refresh** — Java side detects 401 responses, uses `synchronized` + `isRefreshing` flag to refresh the token internally, then retries once. No JS-side Promise queue needed in production.
- **`prefetchImage({ url })`** — downloads images directly to the Android disk cache directory, zero bytes enter the JS heap
- Credentials and OAuth config live only in compiled Java bytecode

**Deprecated/Deleted:** PictelioHttpPlugin.java and PictelioHttp.ts — the dual-path transport for native HTTP is gone. All native API requests now route through PixivApiPlugin.

### Splash Screen JS Bridge

**TypeScript:** `/packages/app/src/native/splashBridge.ts` (new in v3.20.0, migrated in v3.21.0)
**Java:** `AuthPlugin.hideSplash()` method in `/packages/app/android/app/src/main/java/io/pictelio/app/AuthPlugin.java`

Controls the native Splash Screen via a custom Capacitor plugin bridge. `markContentReady()` calls `AuthPlugin.hideSplash()`, which sets `MainActivity.keepSplashVisible` `AtomicBoolean` to `false`, triggering the `SplashScreen.setKeepOnScreenCondition()` closure on the native AndroidX `SplashScreen` (compat library).

This replaced a prior attempt to use `@capacitor/splash-screen` npm package; the final implementation uses the existing AuthPlugin bridge to avoid adding a new dependency.

- **`markContentReady()`** — idempotent function that calls `AuthPlugin.hideSplash()`. After first call, a module-level `contentReady` flag prevents subsequent calls.
- Silently skipped in web/dev environments — `AuthPlugin.hideSplash()` catch handler logs a warning without crashing.
- No dynamic import needed; `AuthPlugin` is always registered as a Capacitor plugin.

**Architecture:**

```mermaid
sequenceDiagram
    participant JS as JS (splashBridge.ts)
    participant AP as AuthPlugin (Capacitor bridge)
    participant MA as MainActivity
    participant SS as AndroidX SplashScreen

    JS->>AP: markContentReady() → AuthPlugin.hideSplash()
    AP->>MA: keepSplashVisible.set(false)
    MA->>SS: setKeepOnScreenCondition → false
    SS-->>MA: Splash exits
```

**Call sites:**
| Location | When Called | Purpose |
|----------|-------------|---------|
| `Login.tsx` `onMount` | Login page renders | Closes splash when user needs to authenticate |
| `Feed.tsx` `createEffect` | First data load completes | Closes splash after feed content is visible |
| `__root.tsx` `onMount` | Auth init completes (fallback) | Closes splash for non-feed pages (age-confirmation, etc.) if Login/Feed haven't already |

**Android native:**
- `MainActivity.java`: retains `SplashScreen.installSplashScreen(this)` + `setKeepOnScreenCondition(() -> keepSplashVisible.get())`. The `keepSplashVisible` `AtomicBoolean` defaults to `true` and is set to `false` by `AuthPlugin.hideSplash()`
- `styles.xml`: `AppTheme.NoActionBarLaunch` inherits `Theme.SplashScreen` — splash background and icon defined in theme XML
- `build.gradle`: retains `androidx.core:core-splashscreen` dependency
- `variables.gradle`: retains `coreSplashScreenVersion = '1.2.0'`

## Main Activity & Application

### MainActivity.java

`/packages/app/android/app/src/main/java/io/pictelio/app/MainActivity.java` (11 KB)

The Android entry point. Key responsibilities:
- Registers all four custom plugins: **`ImageCachePlugin`**, **`AuthPlugin`**, **`OAuthPlugin`**, **`PixivApiPlugin`** (v3.18.0+, replaced PictelioHttpPlugin)
- Configures WebView settings (JavaScript enabled, DOM storage, mixed content)
- Sets up the back-gesture handler for predictive back navigation
- Initializes the image cache and auth plugin on startup
- Handles Android lifecycle events
- Intercepts `/pixiv-img/` WebView requests via `shouldInterceptRequest` for image caching (retained from previous architecture)

> **v3.20.0–v3.21.0:** Splash Screen dismiss moved from Android-only `core-splashscreen` API to JS-controlled via `AuthPlugin.hideSplash()` bridge. `MainActivity` retains `SplashScreen.installSplashScreen(this)` but defers exit to `keepSplashVisible` AtomicBoolean controlled by the plugin (see [Splash Screen JS Bridge](#splash-screen-js-bridge)).

### OAuthUtils

**Java:** `/packages/app/android/app/src/main/java/io/pictelio/app/OAuthUtils.java`

Extracted shared utility class (v3.18.0) containing helper methods used by native plugins:
- `md5Hex()` — MD5 hashing for OAuth code challenge verification
- `urlEncode()` — URL-safe encoding for OAuth parameters
- `URLSearchParams` — query string construction from key-value pairs

Previously duplicated across plugins; now centralized in a single utility class.

### PictelioApp.java

`/packages/app/android/app/src/main/java/io/pictelio/app/PictelioApp.java` (1.3 KB)

Custom `Application` class for app-level initialization.

## WebView Configuration

- **JavaScript:** Enabled
- **DOM Storage:** Enabled
- **Mixed Content:** Allowed (Pixiv API uses both HTTP and HTTPS)
- **User Agent:** Customized for Pixiv API compatibility
- **Image interception:** `shouldInterceptRequest` in MainActivity intercepts `/pixiv-img/` requests and serves from the Android disk cache (ImageCachePlugin) or proxies to the Pixiv CDN with proper Referer headers
- **shouldInterceptRequest:** ImageCachePlugin intercepts image URLs
- **SSRF Whitelist:** Only Pixiv domains and configured image hosts are accessible via WebView proxy (ADR-0002)

## Capacitor Configuration

`/packages/app/capacitor.config.ts` (678 bytes) — Capacitor project configuration:
- App ID: `io.pictelio.app`
- App Name: `Pictelio`
- Server URL: (varies by build — localhost for dev, none for production)
- Android-specific settings for back gesture and navigation
- `plugins.CapacitorHttp: { enabled: true }` — enables Capacitor's native HTTP plugin for API requests

## Build Pipeline

Pictelio uses an automated Android build pipeline with several scripts:

### Key Scripts

| Script | Purpose |
|--------|---------|
| `/packages/app/scripts/release.mjs` | Full release: version bump → build → sign → GitHub release |
| `/packages/app/scripts/release-github.mjs` | GitHub Releases upload |
| `/packages/app/scripts/dev-android.mjs` | One-command dev: Vite → Capacitor sync → Gradle → install |
| `/packages/app/scripts/sync-android-version.mjs` | Syncs version name from `package.json` to `build.gradle` |
| `/packages/app/scripts/sync-credentials.mjs` | Injects Pixiv API credentials for CI builds |
| `/packages/app/scripts/capture-screenshots.mjs` | Automated screenshot pipeline for store listings |

### Build Commands

| Command | What it does |
|---------|--------------|
| `pnpm build:android` | TypeScript check → Vite build → Capacitor sync → Gradle debug build |
| `pnpm build:android:release` | Full signed release APK build (requires signing env vars) |
| `pnpm dev:android` | Vite dev server → Wi-Fi IP detection → Capacitor sync → Gradle → install |
| `pnpm cap:sync` | Copy Web build output + update Capacitor configs |
| `pnpm cap:copy` | Copy Web build output only |
| `pnpm cap:open:android` | Open Android Studio |

### Release Signing

Release APKs are signed using Gradle configuration. Signing credentials are provided via environment variables (never committed). See `/docs/release-signing.md` for the full signing guide.

### Release Checklist

The full release process is documented in `/docs/release-checklist.md` (6.2 KB), covering:
1. Version bump and changelog update
2. Build verification
3. Obfuscation (ProGuard) verification
4. Screenshot capture
5. GitHub release creation
6. Store listing updates

## Platform Compatibility

- **Minimum Android:** 11.0 (API 30)
- **WebView:** ≥ 85 (older versions show upgrade prompt)
- See `/docs/platform-compatibility.md` for details

## Key Source Files

| Purpose | Path |
|---------|------|
| AuthPlugin (Java) | `/packages/app/android/app/src/main/java/io/pictelio/app/AuthPlugin.java` |
| ImageCachePlugin (Java) | `/packages/app/android/app/src/main/java/io/pictelio/app/ImageCachePlugin.java` |
| OAuthPlugin (Java) | `/packages/app/android/app/src/main/java/io/pictelio/app/OAuthPlugin.java` |
| PictelioHttpPlugin (Java) | `/packages/app/android/app/src/main/java/io/pictelio/app/PictelioHttpPlugin.java` |
| MainActivity (Java) | `/packages/app/android/app/src/main/java/io/pictelio/app/MainActivity.java` |
| PictelioApp (Java) | `/packages/app/android/app/src/main/java/io/pictelio/app/PictelioApp.java` |
| AuthPlugin TS bridge | `/packages/app/src/native/AuthPlugin.ts` |
| ImageCache TS bridge | `/packages/app/src/native/ImageCache.ts` |
| OAuthPlugin TS bridge | `/packages/app/src/native/OAuthPlugin.ts` |
| PictelioHttp TS bridge | `/packages/app/src/native/PictelioHttp.ts` |
| Splash Bridge | `/packages/app/src/native/splashBridge.ts` |
| Capacitor config | `/packages/app/capacitor.config.ts` |
| Dev Android script | `/packages/app/scripts/dev-android.mjs` |
| Release script | `/packages/app/scripts/release.mjs` |
| GitHub release script | `/packages/app/scripts/release-github.mjs` |
| Version sync script | `/packages/app/scripts/sync-android-version.mjs` |
| Credentials sync script | `/packages/app/scripts/sync-credentials.mjs` |
| Release checklist | `/docs/release-checklist.md` |
| Release signing guide | `/docs/release-signing.md` |
| Platform compat | `/docs/platform-compatibility.md` |
| GitHub release docs | `/docs/github-release.md` |
