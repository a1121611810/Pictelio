# Files

- [API Layer & Authentication](api-layer.md) - Pixiv API HTTP client — production native traffic routes through the PixivApiPlugin Java gateway (access_token hidden from JS), while dev mode uses fetch + Vite proxy. OAuth PKCE flow, 401 auto-refresh on Java side, GET request deduplication, and query key system.
- [Image Loading Pipeline](image-pipeline.md) - The complete path from Pixiv API response to screen rendering — three-layer image cache, multi-host selection, WebView proxy interception, Web Worker measurement, and periodic GC.
- [Architecture Overview](overview.md) - High-level architecture of Pictelio — a SolidJS SPA with Capacitor Android native runtime. Covers monorepo layout, boot sequence, routing, build tooling, CSS architecture, and design system.
