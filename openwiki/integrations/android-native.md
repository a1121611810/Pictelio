---
type: Concept
title: Android Native & Build
description: Native runtime for Pictelio's single-engine Lynx Android app, now living under packages/android-host. Documents the single-engine Gradle build, the LynxActivity host and its Lynx native module map, Keystore token storage, WebDAV backup, the download/export bridge, and system-bar/dark-mode behavior. The former Capacitor plugin layer, three-flavor build, and dual-engine fallback were removed with the WebView client (ADR-0203).
tags: [android, native, gradle, build, lynx, android-host, keystore, webdav]
verified:
  - by: openwiki/0.7.0
    at: 2026-10-04T18:40:18.128Z
sources:
  - id: openwiki-source-27198a2acf34a5fb56fcccbc
    resource: repo://docs/adr/ADR-0153-engine-availability-fallback.md
  - id: openwiki-source-6be57e83dcb9d7a5aaa71823
    resource: repo://docs/adr/ADR-0164-default-engine-lynx-bidirectional-fallback.md
  - id: openwiki-source-638aca70ff0d5527fe48d664
    resource: repo://docs/adr/ADR-0203-webview-client-source-removal.md
  - id: openwiki-source-0f2dc325834b2f7fe7051ab9
    resource: repo://packages/android-host/android/app/build.gradle
  - id: openwiki-source-e2ce1f7479dceb217713c7cb
    resource: repo://packages/android-host/android/app/proguard-rules.pro
  - id: openwiki-source-f30385b29088dcfec96689b0
    resource: repo://packages/android-host/android/app/src/lynx/java/io/pictelio/app/LynxActivity.java
  - id: openwiki-source-0d1f4bc8b760f74de18eac42
    resource: repo://packages/android-host/android/app/src/lynx/java/io/pictelio/app/LynxRuntimeInitializer.java
  - id: openwiki-source-cea6ad9ea049a9b602b8ce91
    resource: repo://packages/android-host/android/app/src/lynx/java/io/pictelio/app/PictelioApiModule.java
  - id: openwiki-source-4e44fe9911495c948a4a28f2
    resource: repo://packages/android-host/android/app/src/lynx/java/io/pictelio/app/PictelioAuthModule.java
  - id: openwiki-source-5898fe939d6d3d0487979870
    resource: repo://packages/android-host/android/app/src/lynx/java/io/pictelio/app/PictelioDownloaderModule.java
  - id: openwiki-source-c74c5350d4c128eeb868cc8d
    resource: repo://packages/android-host/android/app/src/lynx/java/io/pictelio/app/PictelioImageService.java
  - id: openwiki-source-414879f15154ff15c0adce7c
    resource: repo://packages/android-host/android/app/src/lynx/java/io/pictelio/app/PictelioTranslateCacheModule.java
  - id: openwiki-source-6ed2b2969c7c172dc572da05
    resource: repo://packages/android-host/android/app/src/lynx/java/io/pictelio/app/PictelioTranslateModule.java
  - id: openwiki-source-f74bf15db877f94d261db75d
    resource: repo://packages/android-host/android/app/src/lynx/java/io/pictelio/app/PictelioWebDavModule.java
  - id: openwiki-source-ab14d1bacab96d01892f4955
    resource: repo://packages/android-host/android/app/src/main/AndroidManifest.xml
  - id: openwiki-source-39a385dc8987322d75dd8580
    resource: repo://packages/android-host/android/app/src/main/java/io/pictelio/app/BackupCrypto.java
  - id: openwiki-source-edcd0adb3db75a6f6ff0c102
    resource: repo://packages/android-host/android/app/src/main/java/io/pictelio/app/GallerySaver.java
  - id: openwiki-source-5a67f083c40f2c6bdf720bb2
    resource: repo://packages/android-host/android/app/src/main/java/io/pictelio/app/ImageHostConfig.java
  - id: openwiki-source-fa0cb21eef88730b3e22ddbf
    resource: repo://packages/android-host/android/app/src/main/java/io/pictelio/app/NovelExporter.java
  - id: openwiki-source-08da93ea0b704ac6e4bf78d2
    resource: repo://packages/android-host/android/app/src/main/java/io/pictelio/app/PictelioDownloader.java
  - id: openwiki-source-3fdaadb0f882ee5a93597ec7
    resource: repo://packages/android-host/android/app/src/main/java/io/pictelio/app/PixivApiCore.java
  - id: openwiki-source-4e043f6717b4a5f938708fba
    resource: repo://packages/android-host/android/app/src/main/java/io/pictelio/app/PixivImageLoader.java
  - id: openwiki-source-ce426bf3476122e8e8432118
    resource: repo://packages/android-host/android/app/src/main/java/io/pictelio/app/SecureStorageCompat.java
  - id: openwiki-source-a4ed15fc78faba9aa43b31ce
    resource: repo://packages/android-host/android/app/src/main/java/io/pictelio/app/UgoiraExporter.java
  - id: openwiki-source-597196bdd1f75b54ae3a230f
    resource: repo://packages/android-host/android/app/src/main/java/io/pictelio/app/WebDavClient.java
  - id: openwiki-source-ce9b88c447ccbd81c7c90ea2
    resource: repo://packages/android-host/android/app/src/main/res/xml/data_extraction_rules.xml
  - id: openwiki-source-8d8053f2507ff96f02c58a19
    resource: repo://packages/android-host/android/variables.gradle
  - id: openwiki-source-7f3058d7ffb09ba613ce5aca
    resource: repo://packages/android-host/package.json
  - id: openwiki-source-c77a2d8f001277042a57526c
    resource: repo://packages/android-host/scripts/sync-android-version.mjs
  - id: openwiki-source-0ab469bf9e65f3e09caf90dc
    resource: repo://packages/android-host/scripts/sync-credentials.mjs
generated: { by: "openwiki/0.7.0", at: "2026-10-04T18:40:18.128Z" }
---

# Android Native & Build

Pictelio ships one rendering engine today: **Lynx**. The native side lives in the `packages/android-host` package (`@pictelio/android-host`), which packages the `@pictelio/app-lynx` bundle into an APK through a **single-variant Gradle project** plus a set of Java `LynxModule` bridges. The former Capacitor plugin layer, the three-flavor Gradle architecture (full/webview/lynx), the `packages/app` WebView client, and the OTA web-bundle channel were all deleted with the WebView client in [ADR-0203](../../docs/adr/ADR-0203-webview-client-source-removal.md). The 22,559 lines of Java production code were moved verbatim from `packages/app/android/` to `packages/android-host/android/`.

## Host-package boundary

`@pictelio/android-host` is explicitly **not a client**. Its `package.json` description says so: it is the Android *build host* (Gradle project, release scripts, native E2E, JVM unit tests), while the actual client is `@pictelio/app-lynx` under `packages/app-lynx` (ADR-0203). Two facts that previously lived in the deleted `packages/app` moved into `packages/app-lynx` as the single source of truth:

| Fact | Source of truth | Consumed by |
|------|-----------------|-------------|
| Pixiv OAuth credentials | `packages/app-lynx/credentials.json5` | `sync-credentials.mjs` → generates `io.pictelio.app.config.OAuthConfig` |
| Product version | `packages/app-lynx/package.json` `version` | `sync-android-version.mjs` → writes `versionName`/`versionCode` into `build.gradle` |

The native host holds no client source: `packages/app-lynx` builds the bundle, and `scripts/sync-android-assets.mjs` (in app-lynx) writes `main.lynx.bundle` into the host's `android/app/src/main/assets/`.

## Single-engine Gradle build

`packages/android-host/android/app/build.gradle` is a single `com.android.application` module with **no product flavors**. The former `lynx` flavor's source directory is promoted into `main` instead of being physically moved, so the class paths and package names are unchanged:

```groovy
sourceSets {
    main { java.srcDir 'src/lynx/java' }
    test { java.srcDir 'src/testLynx/java' }
}
```

Build configuration points:

- `namespace` and `applicationId` are both `io.pictelio.app`.
- `CLIENT_KINDS = {"lynx"}` is injected via `buildConfigField`; the mechanism and consumers are retained even though the value collapsed to a single engine, so a future WebView rebuild can reuse it (ADR-0062 / ADR-0164).
- `manifestPlaceholders = [launcherActivity: ".LynxActivity", appClass: ".PictelioAppLynx"]` resolves the launcher in `AndroidManifest.xml`.
- SDK/toolchain (from `variables.gradle`): `minSdkVersion = 28`, `compileSdkVersion = 36`, `targetSdkVersion = 36`, `buildToolsVersion = "36.1.0"`, Java 21. The old "minimum Android 11 (API 30)" figure is wrong; the host's real minSdk is **28**.
- `versionCode 60701` / `versionName "6.7.1"` are the checked-in values, but `pnpm sync:android-version` rewrites them from `app-lynx/package.json` using `major×10000 + minor×100 + patch`.
- Release signing uses `pictelio-release.keystore` with `PICTELIO_KEYSTORE_PASSWORD` / `PICTELIO_KEY_PASSWORD` env vars (key alias `pictelio`), validated only when a release task is in the Gradle task graph.
- An APK rename task produces `pictelio-{versionName}-{buildType}.apk`.
- The OTA Ed25519 public key is compiled in as a `buildConfigField` with a build-time length check (32 raw bytes).
- `minifyEnabled true` for release, with `proguard-rules.pro` (see [ProGuard / R8](#proguard--r8-keep-rules)).

<!-- openwiki: broken internal link [#pictelioimageservice] heading anchor "pictelioimageservice" does not exist in /openwiki/integrations/android-native.md. Fix the href or restore the target, then delete this comment. -->
Dependencies: AndroidX `appcompat` + `core-splashscreen:1.2.0`, OkHttp `4.12.0`, and the Lynx SDK `4.0.1` (`lynx`, `lynx-service-http`, `lynx-service-log`, `xelement`, `xelement-input`). Fresco's `lynx-service-image` is deliberately **not** included because it cannot forward the `Referer` header required by `i.pximg.net` (403s); the custom [`PictelioImageService`](#pictelioimageservice) replaces it.

## Engine availability & fallback (ADR-0153 / ADR-0164)

Both ADR-0153 ("WebView unavailable → Lynx") and ADR-0164 ("default engine Lynx + bidirectional fallback") describe the **removed dual-engine world**. They are archived decision history, not current behavior: with the WebView client gone in v6.3.0 (#610), there is no second engine to fall back to.

The surviving residue is the *availability probe* and the *single-engine failure funnel*:

- `LynxRuntimeInitializer.isAvailable(Application)` still implements ADR-0153's three-condition conjunct — `CLIENT_KINDS` contains `lynx` ∧ `ensureInitialized()` does not throw ∧ `LynxEnv.inst().isNativeLibraryLoaded()` — but it now exists only as an engine-capability check, not as a routing input.
- `LynxActivity.onFatal` converges four producers (init throw, bundle load failure, fatal render error, 10s load timeout) into `showErrorFallback`, which renders a single "退出应用" exit-only error page. There is no failure-memory key, no auto-switch, and no "back to WebView" button; a 10s timeout still never auto-switches (slow device ≠ unsupported).

```mermaid
flowchart TD
    A["LynxActivity.onCreate"] --> B["SplashScreen.installSplashScreen"]
    B --> C["LynxRuntimeInitializer.ensureInitialized"]
    C -->|throws| E["showErrorFallback exit only"]
    C -->|ok| D["build LynxView with XElement template modules"]
    D --> F["renderTemplateUrl main.lynx.bundle"]
    F --> G{"bundle loaded"}
    G -->|onLoadSuccess| H["bundleLoaded true cancel timeout"]
    G -->|onLoadFailed or fatal render or 10s timeout| E
    E --> I["errorShown first-wins exit button finish"]
```

*The single-engine boot decision: there is no fallback branch; any fatal failure lands on the exit-only error page.*

## Native module map

There are **13 `LynxModule` classes** in `src/lynx/java`, plus a custom image *service*, a template *provider*, and a pure-Java streaming *engine*. Eleven modules are registered globally by `LynxRuntimeInitializer`; the two translation modules are registered per-view in `LynxActivity`. Every module follows the ADR-0053 callback contract: `CallbackImpl` crashes on `null` arguments on real devices, so success callbacks use `cb()` / `cb(value)` forms and errors use a single non-null error string.

| Module (`NativeModules.*`) | Bridge for | Deep module / core |
|----------------------------|------------|--------------------|
| `PictelioSecureStorage` | Keystore token storage | `SecureStorageCompat` |
| `PictelioApp` | viewport, exit, system bars, dark mode, external URL, update-check GET, diag export | `LynxActivity` statics |
| `PictelioAuth` | OAuth refresh-token login, token clear | `PixivApiCore.oauthTokenExchange` |
| `PictelioApi` | Pixiv API forwarding + ugoira extract | `PixivApiCore`, `UgoiraStreamEngine` |
| `PictelioPrefs` | cross-client settings KV | `SharedPreferences("CapacitorStorage")` |
| `PictelioGallery` | save image to album | `GallerySaver`, `PixivImageLoader` |
| `PictelioDownloader` | download/export queue execution | `PictelioDownloader` |
| `PictelioShare` | system share | `ShareHelper` |
| `NetDiag` | network self-check | `NetDiagProbe` |
| `PictelioWebDav` | WebDAV backup transport + crypto | `WebDavClient`, `BackupCrypto` |
| `PictelioClipboard` | clipboard write | Android `ClipboardManager` |
| `PictelioTranslate` | LLM translation streaming | OkHttp SSE, `TranslationSseParser` |
| `PictelioTranslateCache` | native translation cache | filesystem LRU manifest |

Non-`LynxModule` pieces: `PictelioImageService` implements `ILynxImageService` and is registered with `LynxServiceCenter`; `PictelioTemplateProvider` (`AbsTemplateProvider`) serves `assets/main.lynx.bundle`; `UgoiraStreamEngine` is a pure-Java pull-mode state machine with no Lynx dependency.

## LynxActivity & runtime initialization

`LynxActivity` (`packages/android-host/android/app/src/lynx/java/io/pictelio/app/LynxActivity.java`) is the **sole launcher Activity** — a plain `AppCompatActivity` with no Capacitor bridge. Key responsibilities:

- **Splash:** `SplashScreen.installSplashScreen(this)` runs **before** `super.onCreate` (an AndroidX hard requirement now documented in ADR-0201); `setKeepOnScreenCondition(() -> !bundleLoaded.get())` holds the splash until bundle success/failure/timeout.
- **Edge-to-edge + insets:** `EdgeToEdge.enable(this)` establishes the base; a `setOnApplyWindowInsetsListener` records `systemBars() ∪ displayCutout()` into `sInsetTop`/`sInsetBottom`, recomputes the visible content area, and pushes the `pictelioInsets` global event only when the values change. `PictelioAppModule.getSafeAreaInsets` is the pull channel because the first insets dispatch fires before JS subscribes.
- **Content-area viewport (ADR-0131 / ADR-0168):** `contentSize` = LynxView bounds − visible system-bar insets; `PictelioAppModule.getViewportSize` returns `(-1, -1)` before layout so JS falls back to `SystemInfo`.
- **Fullscreen (ADR-0168):** `applySystemBarsHidden` uses `WindowInsetsControllerCompat` (`hide/show systemBars()` + `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`) and is re-applied on `onCreate` when `settings_fullscreen_mode == "true"` (only `"true"` is truthy).
- **Dark mode (ADR-0180):** a three-state `settings_dark_mode` (`light`/`dark`/`system`, default `system`) drives status-bar icon appearance and the splash theme (API 31+); `pictelioDarkMode` is emitted on `onConfigurationChanged` and re-checked in `onResume`.
- **System back (ADR-0066):** an `OnBackPressedCallback` forwards `pictelioBack` to JS when the bundle is ready; otherwise it finishes directly (including on the error page).
- **Render failure:** `onLoadFailed`, `onReceivedNativeError`, `onReceivedError`, and the 10s watchdog all funnel into `showErrorFallback` (first-wins via `errorShown`).
- **DEBUG-only dev hooks:** `am start` extras for refresh-token auto-login, force-R18, LLM endpoint seeding, and `benchNav` deep links; all gated behind `BuildConfig.DEBUG` so R8 removes them from release.
- **Lifecycle:** forwards `onEnterForeground`/`onEnterBackground`/`destroy()` to the `LynxView`, and resets its static viewport/inset/dark-mode sentinels in `onDestroy`.

`LynxRuntimeInitializer.ensureInitialized(Application)` is the shared, idempotent init point called by both `PictelioAppLynx.onCreate` (cold start) and `LynxActivity.onCreate` (process-reuse fallback). It registers the three services (`LynxHttpService`, `LynxLogService`, `PictelioImageService`), runs `LynxEnv.inst().init(...)`, globally registers the 11 modules, and enables `LynxDebug` in debug builds. Its `InitGate` only latches on success so a failed init remains retryable.

## API & auth: access_token Java-heap isolation

`PictelioApiModule` and `PictelioAuthModule` implement the ADR-0053 / ADR-0037 security model: the Pixiv `access_token` is held only in `PixivApiCore` static Java-heap fields and is **never returned to JS**.

- `PictelioAuthModule.loginWithRefreshToken(refreshToken, cb)` runs the OAuth refresh-token exchange on its own executor, writes `access_token` into `PixivApiCore.accessToken` (and a rotated `refresh_token` into `PixivApiCore.refreshToken`), then calls back with `userInfoJson` containing `userId`/`userName`/`userAccount`/`profileImageUrls`/`refreshToken` — never the access token. `setAccessToken` is the one-way JS→Java push for web-mode OAuth, and `clearTokens` nulls both heap fields on logout.
- `PictelioApiModule.request(method, path, body, cb)` constructs the absolute `https://app-api.pixiv.net` URL, reads `settings_language` to resolve an `Accept-Language` header (ADR-0200: `en` → `en`, everything else → `zh-CN`), and delegates to `PixivApiCore.executeRequest`. The callback is `cb(status, data, rotatedRefreshToken)` where `rotatedRefreshToken` is non-empty only if a 401 refresh rotated the token.
- `PixivApiCore.executeRequest` injects `Authorization: Bearer`, `Referer`, `User-Agent`, and (optionally) `Accept-Language`; on a first 401 it performs a `synchronized` refresh (with an `isRefreshing` guard and reference-identity token comparison to avoid redundant refreshes under concurrency) and retries once.

```mermaid
sequenceDiagram
    participant JS as app-lynx JS
    participant API as PictelioApiModule
    participant Core as PixivApiCore
    participant Http as OkHttp
    JS->>API: request(method, path, body, cb)
    API->>API: resolve Accept-Language from settings_language
    API->>Core: executeRequest on API_EXECUTOR
    Core->>Http: Bearer accessToken Referer UA Accept-Language
    Http-->>Core: 401
    Core->>Core: synchronized refreshAccessTokenCore
    Core->>Http: retry once with new accessToken
    Http-->>Core: status data
    Core-->>API: result
    API-->>JS: cb(status, data, rotatedRefreshToken)
```

*The native API forward: the access token is injected inside Java and never appears in the JS callback.*

`PictelioApiModule` also exposes the ugoira paths: `ugoiraExtract` (download zip → single-pass extract → write frames to `cache/ugoira/<illustId>/frame_N.{png|jpg}` with an LRU-style cap of 300 files / 50 MB, cache-hit short-circuit), and the ADR-0128 streaming trio `ugoiraExtractStream` / `ugoiraExtractStreamPoll` / `ugoiraExtractStreamCancel` built on `UgoiraStreamEngine`.

## Keystore storage & backup rules

`SecureStorageCompat` (`src/main`) is a pure-Java AES/GCM utility that is byte-compatible with `@aparajita/capacitor-secure-storage` 8.x (ADR-0050). It is the backend for `PictelioSecureStorageModule` (`getItem` / `setItem` / `removeItem`) and for the translate API-key key.

- **Algorithm:** AES/GCM/NoPadding, AndroidKeyStore, one AES key per storage key (`PURPOSE_ENCRYPT|DECRYPT`, `BLOCK_MODE_GCM`, `ENCRYPTION_PADDING_NONE`).
- **SharedPreferences file:** `WSSecureStorageSharedPreferences` (MODE_PRIVATE).
- **Storage key:** `capacitor-storage_` + key (e.g. `capacitor-storage_refresh_token`).
- **Ciphertext format:** `Base64(ciphertext) + "\u0010" + Base64(iv)` (NO_PADDING + NO_WRAP).
- `encryptString` / `decryptString` are static and key-injected so Robolectric tests run without AndroidKeyStore.

Because `android:allowBackup="true"`, backup is defended per ADR-0003: `res/xml/data_extraction_rules.xml` (Android 12+) and `res/xml/backup_rules.xml` (Android 11-) exclude `WSSecureStorageSharedPreferences.xml` and the historical plaintext residue `PictelioPrefs.xml` from both cloud backup and device transfer. The literal strings `capacitor-storage_` and `CapacitorStorage` must remain (ADR-0203 decision 8): renaming them would orphan every existing user's token and settings.

## WebDAV backup (ADR-0156)

Backup transport is a three-layer design: a single Java core plus a thin Lynx bridge plus a TS shared pure-function layer (the latter lives in app-lynx).

- **`WebDavClient`** (pure Java, no Android deps) implements the minimal WebDAV subset — MKCOL (409 treated as success), PUT, GET, PROPFIND Depth 0&1, DELETE — over OkHttp with HTTP Basic auth. PROPFIND multistatus parsing is lenient regex (href / `resourcetype:collection` / `getcontentlength`). Errors are classified into `Kind` (`AUTH_FAILED`/`FORBIDDEN`/`NOT_FOUND`/`QUOTA_EXCEEDED`/`CONFLICT`/`NETWORK`/`SERVER`). `uploadWithVerify` performs PUT → PROPFIND `getcontentlength` comparison (falling back to a GET byte compare when the server omits the field) with up to 3 retries; `prune` keeps the last 10 timestamp-named backups by filename order.
- **`BackupCrypto`** implements the v1 envelope: `PICTELIO-ENC1` magic (13 B) + salt (16 B) + iv (12 B) + AES-256-GCM ciphertext, with the key derived by PBKDF2-HMAC-SHA256 at 600k iterations from the user password. Passwords never enter the backup file.
- **`PictelioWebDavModule`** is the thin bridge: `ensureDir` / `upload` / `uploadWithVerify` / `download` / `list` / `stat` / `delete` / `prune` / `encrypt` / `decrypt` / `isEncrypted`. Bytes cross the bridge as base64, blocking IO runs on a module executor, and every callback is `cb(code, payload)` (code 0 success / code 1 failure with a JSON error object).

```mermaid
sequenceDiagram
    participant JS as app-lynx JS
    participant WV as PictelioWebDavModule
    participant Client as WebDavClient
    participant Server as WebDAV server
    JS->>WV: uploadWithVerify(url, user, pwd, base64, maxAttempts)
    WV->>Client: uploadWithVerify(url, bytes)
    loop up to maxAttempts
        Client->>Server: PUT
        Client->>Server: PROPFIND Depth 0
        Server-->>Client: getcontentlength
        alt length matches
            Client-->>WV: ok
        else mismatch or NETWORK SERVER
            Client->>Client: retry
        end
    end
    WV-->>JS: cb(0, "")
```

*The write-then-read-back verification loop inside WebDavClient.uploadWithVerify.*

## Download, save & export bridge

The data-management cluster (ADR-0145 / ADR-0146 / ADR-0154) keeps bytes in the Java heap (ADR-0037) while JS holds only metadata and progress.

- **`PictelioDownloaderModule`** (`start` / `pollProgress` / `cancel` / `deleteFile`) is a thin shell over the shared `PictelioDownloader` deep module. Progress is **pull-mode** (`pollProgress` returns `"done/total"`, or `"-1/0"` when idle) because a Lynx `Callback` is one-shot.
- **`PictelioDownloader`** executes one task at a time: `download` (image), `downloadUgoira` (zip → `UgoiraExporter`), and `downloadNovel` (payload → `NovelExporter`). It acquires bytes through `PixivImageLoader.loadFileWithProgress` (cache-first + image-host resolve + Referer/UA), lands them through `GallerySaver`, and supports per-`taskId` cancellation via an `AtomicBoolean` map.
- **`GallerySaver`** routes disk writes: API ≥ 29 → `MediaStore` (`Pictures/Pictelio`, `IS_PENDING` two-phase, no permission); API 28 (minSdk) → app-specific external dir + `MediaScannerConnection`. Non-image products (ugoira exports) go to `Downloads/Pictelio`. Filenames are generated in JS (`Pictelio_<illustId>[_p<N>].<ext>`), and Java only does defensive `sanitizeFileName` plus an optional author subdirectory (ADR-0192).
- **`NovelExporter`** implements 9 formats — `txt/html/md/rtf/json/fb2` string serialization, `epub`/`docx` via `ZipOutputStream`, and `pdf` via `android.graphics.pdf.PdfDocument` + `StaticLayout` (system CJK fonts, zero font payload). Cover/inline images are fetched through the injected `PixivImageLoader`; a single image failure is skipped with a warning while metadata/body contract failures throw.
- **`UgoiraExporter`** exports `zip`/`tar`/`apng` and delegates `gif`/`webp`/`mp4` to dedicated encoders (`GifEncoder`/`WebpEncoder`/`Mp4Encoder`).
- **`PictelioShareModule`** + **`ShareHelper`** build `ACTION_SEND` / `ACTION_SEND_MULTIPLE` intents, converting `file://` (API 28 fallback) to `content://` through `FileProvider`.
- **`PictelioClipboardModule`** writes to the system clipboard because the Lynx JS runtime has no `navigator`/clipboard API.

See [ADR-0145](../../docs/adr/ADR-0145-image-save-download.md), [ADR-0146](../../docs/adr/ADR-0146-download-queue-export.md), and [ADR-0154](../../docs/adr/ADR-0154-novel-export.md) for the spec-level behavior; the queue state machine and file naming stay in app-lynx.

## Image pipeline native side

- **`PixivImageLoader`** is the single source of truth for Pixiv image downloads: it rewrites `/pixiv-img/{path}` to `OAuthConfig.IMAGE_CDN_URL + "/" + path` (with URI normalization), downloads over the shared OkHttp client with `Referer`/`User-Agent` injection, and manages the `pictelio-images/` disk cache with Base64 URL-safe filenames, LRU eviction, and a per-URL lock. The cache key is always the **official URL**, never the resolved mirror URL.
- **`ImageHostConfig`** (ADR-0143) is the download-source decision module: `resolve(officialUrl)` picks `single` / `weighted` / `fastest-ip` / `race` (race explicitly degrades to weighted — native never implemented race). Its `RawProvider`/`Clock`/`Random`/`ProbeFn`/`Executor` seams are constructor-injected, and corrupt config is treated as "host off" with a visible warning.
- **`PictelioImageService`** implements `ILynxImageService` and is the only Lynx image backend. It delegates all download/cache logic to `PixivImageLoader`, registers `<image>`/`<inline-image>` behaviors in its constructor, decodes to `Bitmap` on a cached thread pool, and serves static images only (all animation callbacks return false — ugoira playback is the JS frame-swap loop). It delivers the cached `Bitmap` instance directly (zero-copy) with an `isRecycled()` guard fallback.
- **`ImageMemoryCache`** + **`LruCache`** provide a native decoded-`Bitmap` LRU for second renders.

## ProGuard / R8 keep rules

`proguard-rules.pro` carries release-only rules that are load-bearing for Lynx:

- `com.lynx.base.LynxBaseTrace` and `com.lynx.base.log.LynxLog` — `lynxbase.so` looks up their static methods by JNI `GetStaticMethodID` name; renaming causes a SIGABRT on real devices.
- `io.pictelio.app.PictelioImageService` — defensive keep (registered by interface, so renaming would be safe).
- `**$$PropsSetter` / `**$$PropsHolder` with `<init>()` and members — Lynx reflects these annotation-generated classes by name; stripping the no-arg constructors produces the `990200` white screen.
- `* extends androidx.room.RoomDatabase { <init>(); }` and `androidx.work.impl.WorkDatabase_Impl { <init>(); }` — ADR-0124, `work-runtime`'s `InitializationProvider` reflectively constructs `WorkDatabase_Impl`.
- `-dontwarn` for Fresco/Gson/Markdown classes that are statically referenced but unreachable (Fresco and Markdown are deliberately absent).

## Build scripts, version & credentials sync

The host package owns the Android build chain (see [Release & Deploy](../operations/release-and-deploy.md) for the full procedure, not duplicated here):

- `pnpm build:android` / `pnpm build:android:release` — `sync:android-version` + `sync:credentials` + build app-lynx + `sync-android-assets.mjs` + Gradle `assembleDebug`/`assembleRelease renameReleaseApk`.
- `pnpm test:android:unit` — `sync:credentials` then `./gradlew testDebugUnitTest`; the credentials sync must precede Gradle because Gradle compilation depends on the gitignored generated `OAuthConfig.java` (ADR-0203 decision 8's "clean checkout can grow itself" invariant).
- `pnpm dev:android` (`dev-android.mjs`) and `pnpm release` (`release.mjs`) round out the chain.
- `sync-credentials.mjs` reads `../app-lynx/credentials.json5` and generates `io.pictelio.app.config.OAuthConfig` (OAuth credentials, request-header disguises, endpoint URLs, timeouts, `MIN_WEBVIEW_VERSION`, `CACHE_DIR`/`CACHE_MAX_BYTES`).
- `sync-android-version.mjs` reads `../app-lynx/package.json` and rewrites `versionCode`/`versionName`.

## Focused tests

JVM/Robolectric tests live in `android/app/src/test/` (main modules) and `src/testLynx/` (Lynx modules, merged into `test`). Notable coverage: `SecureStorageCompatTest`, `PixivImageLoaderTest`, `ImageHostConfigTest`, `WebDavClientTest`, `BackupCryptoTest`, `PictelioWebDavModuleTest`, `PictelioApiModuleTest`, `PictelioDownloaderTest`, `GallerySaverTest`/`GallerySaverMediaStoreTest`, `NovelExporterTest` + per-encoder tests, `UgoiraExporter*Test`, `LynxSystemBarsTest`/`LynxDarkModeTest`/`LynxStatusBar*Test`, `PictelioAcceptLanguageTest`, and `TranslationSseParserTest`. Host-level TS invariants (including the WebView-removal invariant suite) live under `packages/android-host/tests/unit/`.

## Key source files

All paths are under `packages/android-host/android/app/src/`.

| Layer | Files |
|-------|-------|
| Entry points | `lynx/java/io/pictelio/app/LynxActivity.java`, `PictelioAppLynx.java`, `LynxRuntimeInitializer.java` |
| Lynx modules | `lynx/java/io/pictelio/app/Pictelio{Api,App,Auth,Clipboard,Downloader,Gallery,Prefs,SecureStorage,Share,Translate,TranslateCache,WebDav}Module.java`, `NetDiagModule.java` |
| Lynx services/engines | `PictelioImageService.java`, `PictelioTemplateProvider.java`, `UgoiraStreamEngine.java` |
| Shared deep modules | `main/java/io/pictelio/app/{PixivApiCore,PixivImageLoader,ImageHostConfig,SecureStorageCompat,WebDavClient,BackupCrypto,GallerySaver,PictelioDownloader,NovelExporter,UgoiraExporter,ShareHelper,NetDiagProbe,ImageMemoryCache,LruCache}.java` |
| Build/config | `../../packages/android-host/android/app/build.gradle`, `../../packages/android-host/android/variables.gradle`, `../../packages/android-host/android/app/proguard-rules.pro`, `src/main/AndroidManifest.xml`, `src/main/res/xml/{data_extraction_rules,backup_rules}.xml` |
