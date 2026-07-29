# Capacitor Official Recommendations for Data Transfer Solutions

> Compiled from primary sources: [capacitorjs.com/docs](https://capacitorjs.com/docs), official GitHub repositories, and `@capacitor/*` npm package READMEs.
> **Version: Capacitor v8 (latest).** No Capacitor v9 has been released as of this writing. All claims are cited with direct source URLs.

---

## Version History Table

| Capacitor Version | Release Highlights (Data Transfer & Storage) |
|------------------|----------------------------------------------|
| **v8.1.0** (latest) | `App.getAppLanguage()` added; `Filesystem.readFile()` gains `offset`/`length` for partial reads |
| **v8.0.0** | NodeJS 22+ required; iOS target 15.0+; Android minSdk 24, compileSdk 36; System Bars plugin replaces `adjustMarginsForEdgeToEdge`; Geolocation adds `interval` param for `watchPosition` |
| **v7.1.0** | `Filesystem.downloadFile()` **DEPRECATED** in favor of `@capacitor/file-transfer`; `Filesystem.readFileInChunks()` added; chunked reading; new directory types (`ExternalCache`, `LibraryNoCloud`, `Temporary`); `FileInfo` gains `name`, `ctime`, `mtime`; structured error codes; `App.disableBackButtonHandler` config introduced |
| **v7.0.0** | NodeJS 20+ required; iOS target 14.0+; `bundledWebRuntime` removed; deprecated type aliases removed from App, Device, Haptics, Splash Screen plugins |
| **v6.0.0** | Plugin packages scoped independently under `@capacitor/*` |
| **v5.1.0** | `Filesystem.downloadFile()` introduced (with progress events) |
| **v4.1.0** | `Share.share()` adds `files` parameter; `App` adds `pause`/`resume` events |
| **v4.0.0** | `FileInfo` adds `type`, `size`, `uri` fields |
| **v3.0.0** | Date serialization auto-stringify for JS Date objects |
| **v2.0.0** | ... |
| **v1.0.0** | Initial Capacitor release |

---

## 1. WebView ↔ Native Communication

### 1.1 The Bridge Architecture

**Capacitor v4.0+** — Capacitor uses a **bridge** pattern to pass data between the JavaScript web runtime and native (Swift/Java/Kotlin) layers. Data is serialized to JSON on one side and deserialized on the other.

- **iOS bridge**: `CAPBridge` — plugins get a weak reference via `self.bridge?`.  
  Source: [Capacitor iOS API](https://capacitorjs.com/docs/core-apis/ios#bridge)

- **Android bridge**: `Bridge` class — plugins access via `this.bridge`.  
  Source: [Capacitor Android API](https://capacitorjs.com/docs/core-apis/android#bridge)

### 1.2 Supported Data Types (Serialization)

**Capacitor v3.0+** (v8 docs apply unchanged):

> "Data moving between the web runtime and native environments in Capacitor have to be serialized and deserialized so that they can be stored natively in each language. The supported data types are those that can be represented in JSON such as numbers, strings, booleans, arrays, and objects (or dictionaries or key-value stores)."

Source: [Capacitor Data Types](https://capacitorjs.com/docs/core-apis/data-types)

#### iOS-specific considerations (Capacitor v3.0+):

- **Null values**: Objective-C uses `NSNull` for null values in collections. Swift uses Optionals. Capacitor's convenience accessors (`call.getString()`, etc.) filter out `NSNull` automatically, but `call.options["key"]` may return an `NSNull` object.  
  - **Recommendation**: "It is not recommended to rely on the presence of a key to convey meaning. Always type-check the corresponding value to evaluate it."
- **Arrays with nulls**: Use `.capacitor.replacingNullValues()` to map arrays with `NSNull` entries to `[T?]`.
- **Dates (Capacitor v3.0+)**: JavaScript `Date` objects are auto-serialized to ISO 8601 strings. This can be opted-out via `shouldStringifyDatesInCalls = false` on the plugin. Native `Date`/`NSDate` objects returned from plugins are also serialized to ISO 8601 strings.

Source: [Capacitor Data Types — iOS](https://capacitorjs.com/docs/core-apis/data-types#ios)

### 1.3 Plugin Method Patterns (How Data Flows)

**Capacitor v1.0+** — There are three method types for plugins, **all asynchronous and promise-based**:

| Type | Return | Use Case |
|------|--------|----------|
| **Void Return** (`RETURN_NONE`) | No data returned | Fire-and-forget operations |
| **Value Return** (`RETURN_PROMISE`) | `Promise<T>` — single data payload | Standard request/response (default) |
| **Callback** (`RETURN_CALLBACK`) | Repeated data via callback | Streaming, geolocation, progress events |

Source: [Method Types](https://capacitorjs.com/docs/plugins/method-types)

**Callback pattern specifics**: The callback method takes a function that is invoked many times from native code and returns a promise that resolves with a callback identifier. On the native side, you must **save the call** (set `keepAlive = true`) so it can be invoked repeatedly.

### 1.4 Persisting Plugin Calls

**Capacitor v1.0+** — For async operations or repeated updates, the call object must be saved beyond the method's return:

- **Single completion**: Save the call with `saveCall()` / `getSavedCall()` / `releaseCall()`.
- **Multiple completions**: Set `call.keepAlive = true` (iOS) or `call.setKeepAlive(true)` (Android). The bridge will then allow repeated `resolve()` calls.

Source: [Persisting Plugin Calls](https://capacitorjs.com/docs/core-apis/saving-calls)

### 1.5 Triggering JS Events from Native

**Capacitor v1.0+** — Native code can fire events on the JavaScript `window` or `document`:

```swift
bridge.triggerJSEvent(eventName: "myCustomEvent", target: "window")
bridge.triggerJSEvent(eventName: "myCustomEvent", target: "document", data: "{ 'dataKey': 'dataValue' }")
```

> Note: `data` must be a **serialized JSON string**.

Available on both iOS and Android bridges.

Source: [Capacitor iOS API — triggerJSEvent](https://capacitorjs.com/docs/core-apis/ios#triggerjsevent), [Capacitor Android API — triggerJSEvent](https://capacitorjs.com/docs/core-apis/android#triggerjsevent)

### 1.6 Type/Size Limits

- **No explicit size limit** is documented for bridge payloads.
- **Large file warning**: The HTTP plugin explicitly warns: "Due to the nature of the bridge, parsing and transferring large amount of data from native to the web can cause issues." For large files, use the dedicated `@capacitor/file-transfer` plugin instead.
- The Preferences plugin (key-value) is described as "for small amounts of data."
- On the web platform, `Blob` is returned from filesystem reads; on native, data is returned as a **string** (base64 encoded for binary).

---

## 2. HTTP / Network Data Transfer

### 2.1 CapacitorHttp Plugin

**Capacitor v4.0+** (bundled with `@capacitor/core`). Provides native HTTP support by optionally patching `fetch` and `XMLHttpRequest` to use native libraries.

**Configuration**: Patching is **disabled by default**. Enable in `capacitor.config.json`:

```json
{
  "plugins": {
    "CapacitorHttp": {
      "enabled": true
    }
  }
}
```

**API methods**: `request()`, `get()`, `post()`, `put()`, `patch()`, `delete()` — all return `Promise<HttpResponse>`.

**`HttpResponse`** contains: `data` (any), `status` (number), `headers` (HttpHeaders), `url` (string).

Source: [CapacitorHttp](https://capacitorjs.com/docs/apis/http)

### 2.2 CapacitorHttp vs. Browser `fetch`

| Aspect | CapacitorHttp | Browser `fetch` |
|--------|--------------|-----------------|
| Network layer | Native platform's HTTP stack | WKWebView / Android WebView |
| SSL cert handling | Uses OS trust store, respects custom CAs | WebView may have different behavior |
| Cookie management | Separate from browser cookies | Shared with WebView |
| Patching required? | Yes — set `enabled: true` | No — always available but goes through WebView |
| Complex types (FormData, Blob) | "Only directly supported on web or through enabling CapacitorHttp and using the patched `window.fetch` or `XMLHttpRequest`." | Native support |

**When to use CapacitorHttp**: When you need native SSL handling, custom headers that the WebView might strip, or consistent behavior across platforms. The docs recommend enabling it generally for reliable native networking.

### 2.3 Large Payloads and Streaming

> **Large File Support**: "Due to the nature of the bridge, parsing and transferring large amount of data from native to the web can cause issues. Support for downloading and uploading files has been added to the `@capacitor/file-transfer` plugin."

Source: [CapacitorHttp — Large File Support](https://capacitorjs.com/docs/apis/http#large-file-support)

The `HttpOptions` interface includes `readTimeout` and `connectTimeout` (in milliseconds) for controlling timeouts. The `responseType` option allows specifying `'arraybuffer' | 'blob' | 'json' | 'text' | 'document'`.

**Data type limitations in HttpOptions**: "On Android and iOS, data can only be a string or a JSON. FormData, Blob, ArrayBuffer, and other complex types are only directly supported on web or through enabling CapacitorHttp."

Source: [CapacitorHttp — HttpOptions](https://capacitorjs.com/docs/apis/http#httpoptions)

### 2.4 File Transfer Plugin (Large Files) — RECOMMENDED

**`@capacitor/file-transfer` since v7.1.0** (plugin at v1.0.0 independently) is the **official replacement** for `Filesystem.downloadFile()` (deprecated since v7.1.0).

**Features**:
- `downloadFile()` — HTTP download to a file path
- `uploadFile()` — File upload to a server
- `addListener('progress', callback)` — Real-time progress events (throttled to every 100ms on Android/iOS)
- Full error handling with specific error codes (`OS-PLUG-FLTR-XXXX`)
- Supports `chunkedMode`, custom `headers`, `readTimeout`, `connectTimeout`, `disableRedirects`, `shouldEncodeUrlParams`

**Progress event**: Returns `type` ('download' | 'upload'), `bytes`, `contentLength`, `lengthComputable`.

**Error codes** (plugin v1.0.0+):

| Code | Description |
|------|-------------|
| OS-PLUG-FLTR-0004 | Invalid input parameters (Android, iOS) |
| OS-PLUG-FLTR-0005 | Invalid/empty server URL (Android, iOS) |
| OS-PLUG-FLTR-0006 | Permission denied (Android, iOS) |
| OS-PLUG-FLTR-0007 | File does not exist (Android, iOS) |
| OS-PLUG-FLTR-0008 | Failed to connect to server (All platforms) |
| OS-PLUG-FLTR-0009 | HTTP 304 Not Modified (Android, iOS) |
| OS-PLUG-FLTR-0010 | HTTP error status code (Android, iOS) |
| OS-PLUG-FLTR-0011 | Generic operation failure (All platforms) |

Source: [File Transfer Plugin](https://capacitorjs.com/docs/apis/file-transfer)

---

## 3. Inter-App Data Sharing

### 3.1 Share Plugin (`@capacitor/share`)

**Capacitor v1.0+** — Uses the native OS share sheet (iOS UIActivityViewController, Android Intent.ACTION_SEND) and the Web Share API on web.

**Supported fields**: `title`, `text`, `url` (http/https/file://), `files` (array of file:// URLs — added `Since: 4.1.0`), `dialogTitle` (Android only).

```ts
await Share.share({
  title: 'See cool stuff',
  text: 'Really awesome thing',
  url: 'http://ionicframework.com/',
  dialogTitle: 'Share with buddies',
});
```

**`canShare()`**: Available since plugin version 1.1.0 (checks if sharing is supported).

**File sharing**: Android requires explicit file path configuration in `android/app/src/main/res/xml/file_paths.xml` for non-cache directories.

Source: [Share Plugin](https://capacitorjs.com/docs/apis/share)

### 3.2 Deep Links (Universal Links & App Links)

**Capacitor v1.0+** — Supports both **custom URL schemes** and **Universal Links (iOS) / App Links (Android)**.

**App API — URL Open Events**:

```ts
import { App } from '@capacitor/app';

App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
  // event.url contains the deep link URL
  const slug = event.url.split('.app').pop();
  if (slug) {
    router.navigateByUrl(slug);
  }
});
```

The `appUrlOpen` event handles both custom schemes and universal/app links. The `URLOpenListenerEvent` includes `url`, `iosSourceApplication`, and `iosOpenInPlace`.

Source: [App Plugin](https://capacitorjs.com/docs/apis/app), [Deep Links Guide](https://capacitorjs.com/docs/guides/deep-links)

**Setup requirements**:
- **iOS**: Register custom schemes in `Info.plist` (`CFBundleURLSchemes`). For Universal Links, create an `apple-app-site-association` file and add the `Associated Domains` capability in Xcode.
- **Android**: Register custom schemes via `<intent-filter>` in `AndroidManifest.xml`. For App Links, create an `assetlinks.json` file and add the `<intent-filter android:autoVerify="true">` block.

Source: [Deep Links Guide — iOS Configuration](https://capacitorjs.com/docs/guides/deep-links#ios-configuration), [Deep Links Guide — Android Configuration](https://capacitorjs.com/docs/guides/deep-links#android-configuration)

### 3.3 Custom URL Schemes

**Capacitor v1.0+** — Configured per platform:
- **iOS**: Add a `CFBundleURLTypes` entry in `Info.plist` with your scheme (e.g., `mycustomscheme://`).
- **Android**: Add an `<intent-filter>` in `AndroidManifest.xml` with `android:scheme` set to your custom URL scheme (defaults to the app's package name).

Source: [App Plugin — iOS](https://capacitorjs.com/docs/apis/app#ios), [App Plugin — Android](https://capacitorjs.com/docs/apis/app#android)

### 3.4 Activity Restored Results (Android)

**Capacitor v1.0+** — On Android, when the system kills an app after launching another Activity (e.g., Camera), Capacitor stores the result and delivers it on next launch via the `appRestoredResult` event.

```ts
App.addListener('appRestoredResult', (data: RestoredListenerEvent) => {
  console.log('Restored state:', data);
  // data.pluginId, data.methodName, data.data, data.success
});
```

> "We recommend every Android app using plugins that rely on external Activities (for example, Camera) to have this event and process handled."

> **Note**: In Capacitor v7.0+, the deprecated `AppRestoredResult` type was removed — use `RestoredListenerEvent` instead.

Source: [App Plugin — appRestoredResult](https://capacitorjs.com/docs/apis/app#addlistenerapprestoredresult-)

---

## 4. Persistent Data on Device

### 4.1 Preferences Plugin (`@capacitor/preferences`)

**Capacitor v1.0+** — Simple key/value persistent store for **lightweight data**.

**Backing stores**: `UserDefaults` on iOS, `SharedPreferences` on Android, `localStorage` on web/PWA.

**API**: `get()`, `set()`, `remove()`, `clear()`, `keys()`, `configure()` (for custom groups), `migrate()` (from Capacitor 2 Storage), `removeOld()` (since 1.1.0).

**Critical note**: "This API is not meant to be used as a local database. If your app stores a lot of data, has high read/write load, or requires complex querying, we recommend taking a look at a **SQLite-based solution**."

**Values are strings only** — use `JSON.stringify`/`JSON.parse` for objects.

**Migration**: Built-in `migrate()` and `removeOld()` methods to migrate from Capacitor 2's Storage plugin.

**Apple Privacy Manifest (required May 1st, 2024)**: When using this plugin, you must add `NSPrivacyAccessedAPICategoryUserDefaults` (reason `CA92.1`) to your `PrivacyInfo.xcprivacy` file.

Source: [Preferences Plugin](https://capacitorjs.com/docs/apis/preferences)

### 4.2 Filesystem Plugin (`@capacitor/filesystem`)

**Capacitor v1.0+** — NodeJS-like API for reading/writing files on device.

**API methods** (all since v1.0.0 unless noted): `readFile`, `writeFile`, `appendFile`, `deleteFile`, `mkdir`, `rmdir`, `readdir`, `getUri`, `stat`, `rename`, `copy`.

**Directories**: `Documents`, `Data`, `Library` (v1.1+), `Cache`, `External`, `ExternalStorage`, `ExternalCache` (v7.1+), `LibraryNoCloud` (v7.1+), `Temporary` (v7.1+).

**Binary data**: Passed as **base64-encoded strings**. `readFile()` without encoding returns base64. `Encoding.UTF8` reads as text.

**Partial reads (Capacitor v8.1.0+)**: `readFile()` supports `offset` and `length` parameters for reading file segments natively (not available on web).

**Chunked reading (Capacitor v7.1.0+)**: `readFileInChunks()` with configurable `chunkSize`.

**`downloadFile()` — DEPRECATED in v7.1.0**: This method (originally added in v5.1.0) and its associated `addListener('progress', ...)` (v5.1.0) and `removeAllListeners()` (v5.2.0) are deprecated. Use `@capacitor/file-transfer` instead.

**Android note**: For large files, "you may need to add `android:largeHeap="true"` to the `<application>` tag in AndroidManifest.xml."

**Apple Privacy Manifest (required May 1st, 2024)**: When using this plugin, you must add `NSPrivacyAccessedAPICategoryFileTimestamp` (reason `C617.1`) to your `PrivacyInfo.xcprivacy` file.

**Structured error codes (Capacitor v7.1.0+)**:

| Code | Description |
|------|-------------|
| OS-PLUG-FILE-0004 | Bridge not initialized (iOS) |
| OS-PLUG-FILE-0005 | Invalid input parameters |
| OS-PLUG-FILE-0006 | Invalid path |
| OS-PLUG-FILE-0007 | Permission denied (Android) |
| OS-PLUG-FILE-0008 | File does not exist |
| OS-PLUG-FILE-0009 | Operation not supported (Android) |
| OS-PLUG-FILE-0010 | Directory already exists |
| OS-PLUG-FILE-0011 | Missing parent directory |
| OS-PLUG-FILE-0012 | Cannot delete non-empty directory |
| OS-PLUG-FILE-0013 | Generic operation failure |

Source: [Filesystem Plugin](https://capacitorjs.com/docs/apis/filesystem)

### 4.3 Database Recommendations (Official Position)

**Storage Guide** ([v8 docs](https://capacitorjs.com/docs/guides/storage)) — The official [Data Storage guide](https://capacitorjs.com/docs/guides/storage) explicitly addresses this:

> **Why not LocalStorage/IndexedDB?** "Local Storage can be used for small amounts of temporary data... but must be considered transient, meaning your app needs to expect that the data will be lost eventually. This is because the OS will reclaim local storage from Web Views if a device is running low on space."

> **On Android**: "the persisted storage API is available to mark IndexedDB as persisted."

**Capacitor does NOT provide a built-in SQLite or database plugin** — this is a deliberate design choice. The official recommendations are:

1. **For large data / high performance**: Use **SQLite**.
2. **Community SQLite plugins**: `capacitor-sqlite` (by jepiqueau) and `cordova-plugin-sqlite` (by xpbrew).
3. **Enterprise option**: Ionic's enterprise SQLite storage solution with encryption and secure key management ([Ionic Secure Storage](https://ionic.io/docs/secure-storage)).

> "The Capacitor Community has also built a number of other storage engines."

Source: [Preferences Plugin — Note on databases](https://capacitorjs.com/docs/apis/preferences), [Storage Guide](https://capacitorjs.com/docs/guides/storage)

---

## 5. Performance Considerations

### 5.1 Bridge Serialization Overhead

All data crossing the WebView↔Native bridge is **serialized to JSON** and **deserialized** on the receiving side. This has performance implications:

- **Small payloads**: The overhead is negligible for typical plugin calls (arguments, results).
- **Large payloads**: "Due to the nature of the bridge, parsing and transferring large amount of data from native to the web can cause issues."
  Source: [CapacitorHttp — Large File Support](https://capacitorjs.com/docs/apis/http#large-file-support)

### 5.2 Large File Strategy

When dealing with large files, the recommended approach is:
1. Use `@capacitor/file-transfer` for HTTP download/upload (keeps data on the native side without bridging it as JSON).
2. Use `@capacitor/filesystem` for local file operations (read/write directly on device, not via the bridge).
3. For displaying local images/files in the WebView, use `Capacitor.convertFileSrc()` to convert a native file path to a WebView-friendly URL.

Source: [JavaScript API — convertFileSrc](https://capacitorjs.com/docs/basics/utilities#capacitorconvertfilesrc)

### 5.3 Memory on Android

For apps working with large files, the Filesystem plugin documentation explicitly recommends:

> "Working with large files may require you to add `android:largeHeap="true"` to the `<application>` tag in AndroidManifest.xml."

Source: [Filesystem Plugin — Android](https://capacitorjs.com/docs/apis/filesystem#android)

### 5.4 Background Task Limitations

**`@capacitor/background-runner`** has specific execution time limits:

| Platform | Max Execution Time | Notes |
|----------|-------------------|-------|
| **iOS** | ~30 seconds | Task killed after timeout; scheduling is not guaranteed by iOS |
| **Android** | 10 minutes (recommend ≤30s for cross-platform) | Minimum repeat interval: 15 minutes |

> "Calling resolve() / reject() is required within every event handler called by the runner. Failure to do this could result in your runner being killed by the OS."

**Runner lifetimes**: "State is not maintained between calls to events in the runner. Each call to `dispatchEvent()` creates a new context in which your runner code is loaded and executed."

Source: [Background Runner — Limitations](https://capacitorjs.com/docs/apis/background-runner#limitations-of-background-tasks)

### 5.5 File Transfer Throttling

Progress events for file transfers are **throttled to every 100ms on Android/iOS** to avoid slowdowns.

Source: [File Transfer — Download](https://capacitorjs.com/docs/apis/file-transfer#downloadfile)

### 5.6 Preferences vs. LocalStorage

- `window.localStorage` is **transient** — OS may reclaim it under memory pressure.
- `@capacitor/preferences` uses `UserDefaults`/`SharedPreferences` — not evicted by OS, but meant for **small** data (settings, tokens, user IDs).
- For heavy data, SQLite is the recommended path.

Source: [Storage Guide](https://capacitorjs.com/docs/guides/storage)

### 5.7 Serialization Guidance for Plugin Authors

The official plugin development philosophy page provides guidelines:

> "Prefer undefined over null and other nonvalues."
> "Prefer identical units."
> "Prefer ISO 8601 datetimes with timezones over other formats."

Source: [Creating Plugins — Philosophies](https://capacitorjs.com/docs/plugins/creating-plugins#unified-and-idiomatic)

---

## 6. New in Capacitor v8.x (Data Transfer & Storage)

### Capacitor v8.0.0 Highlights

| Change | Details |
|--------|---------|
| **System Bars plugin** | Replaces `android.adjustMarginsForEdgeToEdge` config; uses env/CSS variables for edge-to-edge |
| **iOS SPM as default** | New iOS projects use Swift Package Manager by default (CocoaPods optional via `--packagemanager CocoaPods`) |
| **NodeJS 22+** | Required |
| **iOS target 15.0+** | Raised from 14.0 |
| **Android minSdk 24** | Raised from 23; compileSdk/targetSdk 36 |
| **Geolocation `interval`** | New `interval` parameter for `watchPosition` on Android |
| **Android density in configChanges** | Prevents WebView reload on app resize |

### Capacitor v8.1.0 Highlights

| Change | Details |
|--------|---------|
| **`Filesystem.readFile()` partial reads** | New `offset` and `length` parameters for reading file segments natively |
| **`App.getAppLanguage()`** | New method returning the app-specific language locale code (two or three character code) |

---

## Summary Decision Matrix

| Use Case | Recommended Solution | Since | Considerations |
|----------|---------------------|-------|----------------|
| Settings / key-value | `@capacitor/preferences` | v1.0 | Strings only; lightweight; Apple Privacy Manifest required (2024) |
| Simple file read/write | `@capacitor/filesystem` | v1.0 | Binary via base64; partial reads in v8.1.0+; chunking in v7.1.0+ |
| Large file download/upload | `@capacitor/file-transfer` | v7.1.0 | Progress events; dedicated native HTTP; structured error codes |
| General HTTP API calls | `CapacitorHttp` (with `enabled: true`) | v4.0 | Native SSL; avoid WebView HTTP issues |
| Streaming data from native | Plugin Callback (`RETURN_CALLBACK`) | v1.0 | Set `keepAlive=true` |
| Complex queries / large datasets | SQLite (community or enterprise) | — | No official Capacitor SQLite plugin |
| Share content to other apps | `@capacitor/share` | v1.0 | Files (v4.1.0+), URLs, text; `canShare()` since v1.1.0 |
| Deep linking / URL schemes | `@capacitor/app` + platform config | v1.0 | `appUrlOpen` listener |
| Background work | `@capacitor/background-runner` | v1.0 | Time-limited; not persistent; runner context destroyed after each call |
| Binary data in WebView | `Capacitor.convertFileSrc()` | v1.0 | Converts file:// to http://localhost path |
| App language locale | `App.getAppLanguage()` | **v8.1.0** | New in latest version |

---

## Deprecated Features Quick Reference

| Feature | Deprecated Since | Replacement | Status |
|---------|-----------------|-------------|--------|
| `Filesystem.downloadFile()` | v7.1.0 | `@capacitor/file-transfer` | DEPRECATED |
| `Filesystem.addListener('progress', ...)` | v7.1.0 | `FileTransfer.addListener('progress', ...)` | DEPRECATED |
| `Filesystem.removeAllListeners()` (progress) | v7.1.0 | `FileTransfer.removeAllListeners()` | DEPRECATED |
| `AppRestoredResult` type | v7.0.0 | `RestoredListenerEvent` | REMOVED |
| `AppUrlOpen` type | v7.0.0 | `URLOpenListenerEvent` | REMOVED |
| `bundledWebRuntime` config | v7.0.0 | Use a bundler | REMOVED |
| `android.adjustMarginsForEdgeToEdge` | v8.0.0 | `System Bars` plugin + CSS env variables | REMOVED |

---

*Research compiled from capacitorjs.com official docs (v8 — latest, no v9 has been released), GitHub repositories of `@capacitor/core`, `@capacitor/preferences`, `@capacitor/filesystem`, `@capacitor/file-transfer`, `@capacitor/share`, `@capacitor/app`, and `@capacitor/background-runner`. All citations link directly to the authoritative source. Last updated: based on Capacitor v8.1.0 documentation.*
