# Capacitor Image Handling — Official Best Practices

> **Context**: Hybrid mobile app (Pixiv image viewer) using Capacitor.  
> **Capacitor version documented**: v8 (current as of July 2025).  
> **Primary Source Docs**: [capacitorjs.com/docs](https://capacitorjs.com/docs)

---

## Table of Contents

1. [Version Context](#1-version-context)
2. [Image Loading Strategies](#2-image-loading-strategies)
3. [Local Image Storage & Caching](#3-local-image-storage--caching)
4. [Displaying Images in WebView](#4-displaying-images-in-webview)
5. [Memory Management](#5-memory-management)
6. [Android-specific: Image Proxy (shouldInterceptRequest)](#6-android-specific-image-proxy-shouldinterceptrequest)
7. [Performance Anti-patterns](#7-performance-anti-patterns)
8. [Summary Decision Matrix](#8-summary-decision-matrix)

---

## 1. Version Context

| Item | Value |
|---|---|
| Current Capacitor version | **v8** |
| Plugin ecosystem | `@capacitor/filesystem`, `@capacitor/file-transfer`, `@capacitor/camera`, `@capacitor/http`, `@capacitor/preferences` |
| Key deprecations (v7.1.0+) | `Filesystem.downloadFile()` → use `@capacitor/file-transfer` |
| New APIs (v7.1.0+) | `Filesystem.readFileInChunks()`, `Directory.Temporary`, `Directory.LibraryNoCloud`, `Directory.ExternalCache` |
| Structured errors (v7.1.0+) | Error codes like `OS-PLUG-FILE-XXXX`, `OS-PLUG-FLTR-XXXX`, `OS-PLUG-CAMR-XXXX` |

> Source: [Filesystem docs](https://capacitorjs.com/docs/apis/filesystem), [File Transfer docs](https://capacitorjs.com/docs/apis/file-transfer)

---

## 2. Image Loading Strategies

### 2.1 Network → Memory (Direct Fetch)

**Capacitor does NOT have an image-specific loading plugin.** Images can be loaded into the WebView via:

- A standard `<img src="https://...">` tag (WebView handles HTTP natively)
- `fetch()` / `XMLHttpRequest` + `URL.createObjectURL()` (JavaScript-land)
- `CapacitorHttp` (native HTTP via bridge)

**Key difference from web development**: The WebView serves content from `http://localhost` (or a custom scheme), so **direct `<img>` tags to remote URLs** work transparently — the WebView's networking stack handles them. No special handling needed.

> Source: [CapacitorHttp docs](https://capacitorjs.com/docs/apis/http#large-file-support)

### 2.2 Network → Local File (Download for Offline)

**Recommended approach (v7.1.0+):** Use `@capacitor/file-transfer` + `@capacitor/filesystem`.

```ts
import { FileTransfer } from '@capacitor/file-transfer';
import { Filesystem, Directory } from '@capacitor/filesystem';

// Step 1: Get a valid file URI
const fileInfo = await Filesystem.getUri({
  directory: Directory.Data,
  path: 'images/illust123.jpg'
});

// Step 2: Download via File Transfer plugin
await FileTransfer.downloadFile({
  url: 'https://example.com/illust.jpg',
  path: fileInfo.uri,
  progress: true   // emits progress events
});

// Step 3: Listen to progress
FileTransfer.addListener('progress', (progress) => {
  console.log(`Downloaded ${progress.bytes} of ${progress.contentLength}`);
});
```

**Deprecated (v7.1.0):** `Filesystem.downloadFile()` — still functions but should be migrated.

**Error handling (v7.1.0+):** Structured error codes:

| Code | Meaning |
|---|---|
| `OS-PLUG-FLTR-0008` | Failed to connect to server |
| `OS-PLUG-FLTR-0009` | HTTP 304 Not Modified (check caching headers) |
| `OS-PLUG-FLTR-0010` | HTTP error — inspect `error.data.httpStatus` and `error.data.body` |

> Source: [File Transfer docs](https://capacitorjs.com/docs/apis/file-transfer#download), [Filesystem docs](https://capacitorjs.com/docs/apis/filesystem#migrating-from-downloadfile-to-file-transfer-plugin)

### 2.3 Camera / Gallery Images

The `@capacitor/camera` plugin (v8.1.0+) provides `takePhoto()` and `chooseFromGallery()`.

**Key image quality options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `quality` | number (0–100) | 100 (v8) / 92 (legacy) | JPEG quality; only Android/iOS |
| `targetWidth` / `targetHeight` | number | — | Resize before returning; only Android/iOS |
| `correctOrientation` | boolean | true | Auto-rotate up to correct orientation |
| `resultType` | `'uri'` | `'base64'` | **Always use `CameraResultType.Uri`** for large images |

**Critical recommendation**: Use `resultType: 'uri'` (or `'dataUrl'` for small previews). **Never use `CameraResultType.Base64`** for full-resolution photos — the base64 string can be many MB, causing bridge serialization bottlenecks and memory pressure.

The `webPath` property on the result can be set directly as `<img src>`.

```ts
const result = await Camera.takePhoto({ quality: 85, resultType: CameraResultType.Uri });
imageElement.src = result.webPath;
```

> Source: [Camera docs](https://capacitorjs.com/docs/apis/camera)

---

## 3. Local Image Storage & Caching

### 3.1 Available Storage Directories

The `Filesystem` API provides these directory scopes (`Directory` enum):

| Directory | iOS | Android | Persistence | Notes |
|---|---|---|---|---|
| `Data` | Documents dir | App internal dir | Survives uninstall cleared | Best for app-private cached images |
| `Documents` | App's Documents dir | Public Documents (API < 30) | User-visible content | Requires permissions on Android |
| `Cache` | Cache dir | Cache dir | May be cleared by OS | Best for temporary image cache |
| `Library` | Library dir | App internal dir | Survives uninstall cleared | v1.1.0+ |
| `LibraryNoCloud` | Library (no iCloud backup) | App internal dir | Not backed up | v7.1.0+ |
| `Temporary` | iOS temp dir | App cache dir | May be cleared any time | v7.1.0+ |
| `External` | Documents dir | External shared storage | Survives uninstall | Not visible to media scanners |
| `ExternalStorage` | Documents dir | Primary shared storage | Public | Android ≤ 9 only; needs permissions |
| `ExternalCache` | Documents dir | Shared cache storage | Public | v7.1.0+ |

**Recommendation for image caching**: Use `Directory.Cache` or `Directory.Data` for cached images that the app manages. These are scoped to the app and don't require runtime permissions.

> Source: [Filesystem docs — Directory enum](https://capacitorjs.com/docs/apis/filesystem#directory)

### 3.2 Reading / Writing Image Files

Images are stored as binary data. The plugin expects **base64-encoded strings** for binary data.

```ts
// Write image (binary) — data must be base64
await Filesystem.writeFile({
  path: 'images/illust.jpg',
  data: base64EncodedImageData,   // <- must be base64!
  directory: Directory.Cache
});

// Read image (binary) — returns base64 string
const result = await Filesystem.readFile({
  path: 'images/illust.jpg',
  directory: Directory.Cache
});
// result.data is base64 string
```

**New in v8.1.0**: Partial file reading with `offset` and `length`:

```ts
const result = await Filesystem.readFile({
  path: 'huge-image.jpg',
  directory: Directory.Cache,
  offset: 0,
  length: 65536  // read first 64KB
});
```

**New in v7.1.0**: Chunked reading via `readFileInChunks()`:

```ts
// Read a large file in 1MB chunks to avoid memory pressure
await Filesystem.readFileInChunks({
  path: 'large-image.jpg',
  directory: Directory.Cache,
  chunkSize: 1024 * 1024  // 1 MB per chunk
}, (chunk, error) => {
  if (chunk) {
    // Process base64 chunk
    // chunk.data is base64 string (or Blob on web)
  }
});
```

> Source: [Filesystem docs — readFile, readFileInChunks](https://capacitorjs.com/docs/apis/filesystem#readfileinchunks)

### 3.3 LRU Cache Implementation Considerations

Capacitor does **not** provide an official LRU cache. To implement one:

1. **Use `Directory.Cache`** for the cache store (OS may evict under memory pressure)
2. **Track file metadata** via `Filesystem.stat()` (returns `size`, `mtime`, `ctime`)
3. **Enforce capacity** by listing a cache directory with `Filesystem.readdir()` and deleting oldest files with `Filesystem.deleteFile()`
4. **Consider SQLite** (e.g., `capacitor-sqlite` community plugin) for indexed cache metadata
5. **Avoid storing cache index in Preferences** — Preferences is for lightweight key/value data only

> Source: [Storage guide](https://capacitorjs.com/docs/guides/storage), [Preferences docs](https://capacitorjs.com/docs/apis/preferences)

### 3.4 Preferences — NOT for Image Data

The `@capacitor/preferences` plugin stores only **string values**. It is backed by `UserDefaults` (iOS) or `SharedPreferences` (Android).

> "This API is not meant to be used as a local database. If your app stores a lot of data, has high read/write load, or requires complex querying, we recommend a SQLite-based solution."

**Do NOT use Preferences for:**
- Image data (base64 strings)
- Large JSON blobs (>100KB)
- High-frequency writes

> Source: [Preferences docs](https://capacitorjs.com/docs/apis/preferences)

---

## 4. Displaying Images in WebView

### 4.1 `Capacitor.convertFileSrc()` — Critical for Local Images

This is the **most important utility** for displaying locally stored images.

**What it does**: Converts a native `file://` path into a WebView-compatible URL.

**Why it's needed**: Capacitor apps serve WebView content over `http://localhost` (or a custom scheme). Native file paths (`file:///data/...`) are on a different protocol and the WebView's same-origin policy blocks them. `convertFileSrc()` rewrites the path to `http://localhost/_capacitor_file_/...` which the WebView can access.

```ts
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';

// Write image
const result = await Filesystem.writeFile({
  path: 'photos/photo.jpg',
  data: base64Data,
  directory: Directory.Data
});

// Convert to WebView-compatible URL
// On Android:  http://localhost/_capacitor_file_/data/.../photo.jpg
// On iOS:      http://localhost/_capacitor_file_/var/.../photo.jpg
const imageUrl = Capacitor.convertFileSrc(result.uri);

// Use directly as src
imageElement.src = imageUrl;
```

**Performance implications**: `convertFileSrc()` is a **pure string transformation** — it doesn't copy or decode the file. The WebView loads the file via the local Capacitor file server (a lightweight HTTP server running on localhost). This has **zero bridge overhead** and is the most efficient way to display local images.

> Source: [Utilities docs](https://capacitorjs.com/docs/basics/utilities#capacitorconvertfilesrc)

### 4.2 Comparison: Image Display Methods

| Method | Bridge Overhead | Memory Impact | Best For |
|---|---|---|---|
| `convertFileSrc()` + `<img src>` | **None** (WebView loads directly) | **Low** (WebView decodes natively) | **All local images (preferred)** |
| Base64 data URI + `<img src>` | **High** (serialize entire file across bridge) | **High** (base64 = 4/3× original size) | Tiny thumbnails only |
| `readFile()` + `URL.createObjectURL()` | Medium (read across bridge, then Blob) | Medium | Special cases where JS needs pixel data |
| Direct `<img src="https://...">` | None | Low | Remote images (no caching needed) |

### 4.3 WebView Asset Loading (Android)

On Android, Capacitor's WebView (`com.getcapacitor.BridgeWebViewClient`) intercepts requests to `http://localhost/_capacitor_file_/...` and serves files from the device. This is handled automatically by the Capacitor Android bridge — no custom code needed.

The iOS bridge uses WKWebView's `customSchemeHandler` for the same purpose.

> Source: [Android bridge docs](https://capacitorjs.com/docs/core-apis/android), [iOS bridge docs](https://capacitorjs.com/docs/core-apis/ios)

---

## 5. Memory Management

### 5.1 `android:largeHeap="true"`

**Explicitly documented** in the Filesystem plugin docs:

> "Working with large files may require you to add `android:largeHeap="true"` to the `<application>` tag in AndroidManifest.xml."

**What it actually does**: Requests a larger heap from the Android OS. On most modern devices (≥ 2GB RAM), this increases the per-app heap limit from ~192MB to ~512MB+.

**Important caveats:**
- It's a **request**, not a guarantee — the OS may still enforce lower limits on low-RAM devices
- It does **not** bypass per-App VM heap limits on Android
- Does **not** help with native OOM from bitmap allocations — those are outside the Java heap
- Consider it a **baseline safety net**, not a solution for memory leaks

> Source: [Filesystem docs — Android section](https://capacitorjs.com/docs/apis/filesystem#android)

### 5.2 Base64 Bridge Overhead

Every byte of data crossing the Capacitor bridge is **serialized as JSON** (plugin calls) or **passed as a string** (file data). A 10MB JPEG encoded as base64 becomes ~13.3MB of string data, which must be:
1. Base64-decoded on native side (for writes)
2. Serialized in JSON and transferred over the bridge
3. Base64-decoded in JavaScript (for reads)

**This is the #1 performance anti-pattern** — see Section 7.

### 5.3 WKWebView Image Memory (iOS)

Capacitor's WKWebView (iOS) shares the same memory constraints as Safari on iOS:
- iOS may terminate the WebView process if it exceeds ~1GB total memory (varies by device)
- Each decoded bitmap occupies significant memory: a 4000×3000 JPEG decodes to ~48MB in RGBA8888
- WKWebView's `_experimental` features for image decoding (iOS 15+) are not directly configurable in Capacitor

**Recommendations for iOS:**
- Display images at display-resolution sizes (downscale before display)
- Use `convertFileSrc()` — never pass full-resolution base64 through the bridge
- Lazy-load off-screen images

### 5.4 No Official Image Decoding Guidance

Capacitor's official documentation does **not** provide specific guidance on:
- Bitmap pooling / reuse patterns
- Downsampling images before loading into WebView
- WebP vs JPEG vs PNG recommendations

These concerns are **outside Capacitor's scope** — they are standard WebView/image concerns. For heavy image use, consider:
- A canvas-based downscaling pipeline in JavaScript
- Server-side thumbnails / multiple resolution URLs
- IntersectionObserver for lazy loading

---

## 6. Android-specific: Image Proxy (`shouldInterceptRequest`)

### 6.1 The Pattern (Used in Pictelio)

Capacitor does **not** officially document or provide guidance on `shouldInterceptRequest`. However, analyzing the existing Pictelio codebase reveals a well-established pattern:

```java
// MainActivity.java (Pictelio)
WebView.setWebViewClient(new WebViewClient() {
    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        String url = request.getUrl().toString();
        if (url.contains("/pixiv-img/")) {
            // Intercept: fetch from i.pximg.net with auth headers
            return proxyImageRequest(url);
        }
        return originalClient.shouldInterceptRequest(view, request);
    }

    @Override
    @SuppressWarnings("deprecation")
    public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
        // Deprecated overload — needed for older WebView versions
        if (url.contains("/pixiv-img/")) {
            return proxyImageRequest(url);
        }
        return super.shouldInterceptRequest(view, url);
    }
});
```

**Why both overloads?** The single-argument `shouldInterceptRequest(WebView, String)` is deprecated in API 21+ but still required for WebView implementations that don't call the new overload. Providing both ensures coverage across all Android versions.

### 6.2 Pros vs. Direct fetch/XHR

| Aspect | `shouldInterceptRequest` | JavaScript `fetch()` + proxy |
|---|---|---|
| **CORS** | No CORS issues (native HTTP) | Must handle CORS in proxy |
| **Headers** | Can inject `Referer`, `User-Agent` etc. | Limited by CORS preflight |
| **Cookies** | WebView cookies automatically attached | May need manual cookie management |
| **Cache** | Hits WebView's HTTP disk cache automatically | Must implement caching in JS |
| **Complexity** | Requires native Android code | All in JavaScript |
| **Maintenance** | Platform-specific | Cross-platform code |
| **Streaming** | WebView-native streaming (memory efficient) | Full response buffered in JS |
| **DOM integration** | `<img src="...">` just works | Must set `src` after fetch → blob URL |

**Key advantage for Pixiv images**: Pixiv's CDN (`i.pximg.net`) requires specific HTTP headers (`Referer: https://www.pixiv.net/`) to serve images — a browser-level restriction. `shouldInterceptRequest` can inject these headers at the native layer, bypassing the WebView's same-origin restrictions on headers.

### 6.3 Official Capacitor Guidance

Capacitor's official docs do **not** mention `shouldInterceptRequest` at all. The Android Plugin Guide only mentions [`shouldOverrideLoad`](https://capacitorjs.com/docs/plugins/android#override-navigation) for navigation control. The `shouldInterceptRequest` approach is a **standard Android WebView technique** used in many hybrid apps, but it operates outside Capacitor's plugin architecture.

**Implications:**
- You're working directly with the Android `WebViewClient`, bypassing Capacitor's bridge
- You can still use Capacitor plugins alongside it
- The Capacitor file server (`_capacitor_file_` requests) goes through the same `WebViewClient`, so you must be careful not to intercept those
- Always fall through to `originalClient.shouldInterceptRequest()` for non-image URLs

> Source: [Android Plugin Guide](https://capacitorjs.com/docs/plugins/android), [Custom Native Android Code](https://capacitorjs.com/docs/android/custom-code)

### 6.4 Deep Links — No Image Relevance

The [Deep Links guide](https://capacitorjs.com/docs/guides/deep-links) covers Universal Links (iOS) and App Links (Android) for navigation routing. There is **no image-specific deep linking guidance**.

---

## 7. Performance Anti-patterns

### 7.1 What NOT to Do

| Anti-pattern | Why It's Bad | Better Alternative |
|---|---|---|
| `CameraResultType.Base64` for full photos | Bridge serialization of multi-MB strings; JS memory spike | Use `CameraResultType.Uri` + `convertFileSrc()` |
| Storing images in `Preferences` | Key/value store not designed for large data; will block UI | Use `Filesystem.writeFile()` to `Directory.Cache` |
| Reading full images with `readFile()` then setting as base64 data URI | Double base64 decode overhead; bridge transfer of entire file | Use `convertFileSrc()` for display |
| Using `localStorage` or `IndexedDB` for image data | OS may evict WebView storage under memory pressure | Use native Filesystem API |
| Repeated `readFile()` calls on the same image | Each call crosses the bridge; no caching | Cache the `convertFileSrc()` URL in JS |
| Using `CapacitorHttp` to download large files | Bridge parsing of large responses causes issues | Use `@capacitor/file-transfer` |
| Storing cache index in `Preferences` with frequent writes | SharedPreferences / UserDefaults not designed for high write load | Use SQLite-based store |
| Loading all images at once in a long scroll list | Massive memory pressure; OOM risk | Use virtual scrolling + IntersectionObserver |

### 7.2 Bridge Overhead for Base64

The Capacitor bridge (iOS WKWebView message handler or Android JavaScriptInterface) serializes all data as JSON strings. For a 5MB image:

```
Base64 encoded size: ~6.7MB  (4/3 × original)
JSON wrapper overhead: ~100 bytes
Bridge transfer: ~6.7MB serialized string
JS memory: ~6.7MB string + decode buffer
```

Compare with `convertFileSrc()`:

```
WebView loads file directly via file:// → http://localhost mapping
Bridge overhead: ZERO
JS memory: Just the URL string
```

### 7.3 Large File Support Warning

> **From CapacitorHttp docs**: "Due to the nature of the bridge, parsing and transferring large amount of data from native to the web can cause issues. Support for downloading and uploading files has been added to the @capacitor/file-transfer plugin."

This applies to all image-heavy workflows. **Always prefer file-based operations over data-transfer operations** for images.

> Source: [CapacitorHttp docs](https://capacitorjs.com/docs/apis/http#large-file-support)

---

## 8. Summary Decision Matrix

| Scenario | Recommended Approach | Key APIs | Bridge Overhead |
|---|---|---|---|
| Display a remote image | `<img src="https://...">` | Standard HTML | None |
| Display a locally cached image | `convertFileSrc()` + `<img src>` | `Filesystem.getUri()`, `Capacitor.convertFileSrc()` | **None** |
| Download an image for offline | `FileTransfer.downloadFile()` + `Filesystem.getUri()` | `@capacitor/file-transfer`, `@capacitor/filesystem` | Low (native-to-native) |
| Take a photo and display it | `Camera.takePhoto({ resultType: 'uri' })` + `convertFileSrc()` | `@capacitor/camera`, `Capacitor.convertFileSrc()` | Low (just the URI string) |
| Cache images with LRU eviction | `Filesystem` to `Directory.Cache` + manual metadata management | `readdir()`, `stat()`, `deleteFile()`, `getUri()` | Low |
| Display images from protected CDN (Pixiv) | Android `shouldInterceptRequest` + native `HttpURLConnection` | Android `WebViewClient` | **None** (native HTTP → WebView) |
| Store small metadata (cache index) | `Preferences` or SQLite | `@capacitor/preferences` or `capacitor-sqlite` | Low |
| Read a huge image in chunks | `Filesystem.readFileInChunks()` | v7.1.0+ chunked API | Moderate (chunked) |
| Upload an image | `FileTransfer.uploadFile()` | `@capacitor/file-transfer` | Low (native-to-network) |
| Edit a photo (crop/resize) | `Camera.editPhoto()` (v8.1.0+) or server-side | `@capacitor/camera` | Low |

---

## References

| Source | URL |
|---|---|
| Filesystem plugin | https://capacitorjs.com/docs/apis/filesystem |
| File Transfer plugin | https://capacitorjs.com/docs/apis/file-transfer |
| CapacitorHttp plugin | https://capacitorjs.com/docs/apis/http |
| Camera plugin | https://capacitorjs.com/docs/apis/camera |
| Preferences plugin | https://capacitorjs.com/docs/apis/preferences |
| JavaScript API / Utilities | https://capacitorjs.com/docs/basics/utilities |
| iOS Bridge API | https://capacitorjs.com/docs/core-apis/ios |
| Android Bridge API | https://capacitorjs.com/docs/core-apis/android |
| Android Plugin Guide | https://capacitorjs.com/docs/plugins/android |
| Deep Links Guide | https://capacitorjs.com/docs/guides/deep-links |
| Storage Guide | https://capacitorjs.com/docs/guides/storage |
