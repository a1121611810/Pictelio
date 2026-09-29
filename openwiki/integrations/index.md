# Files

- [Android Native & Build](android-native.md) - The Android native runtime layer for the single-engine Lynx client, now living under packages/android-host (Gradle project, Java native modules, release scripts). Covers Lynx Native Modules (PictelioApi, PictelioAuth, PictelioImageService, etc.), shared Java utilities (PixivImageLoader, SecureStorageCompat, NovelExporter, WebDavClient), Keystore token encryption, Gradle build pipeline, release signing, and version sync. The former Capacitor plugin layer and three-flavor architecture were removed with the WebView client (ADR-0203).
