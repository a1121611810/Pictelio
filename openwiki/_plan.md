---
type: Plan
title: Wiki Update Plan — PixivApiPlugin Gateway (ADR-0037)
description: Docs impact plan for commits 4fb04fd..dd8a728 — PixivApiPlugin replaces PictelioHttpPlugin, Rolldown/Oxc minifier, AuthPlugin saveCall fix, OAuthUtils extraction.
tags: [plan, temporary]
---

## Source Changes (89cffb5 → dd8a728)

- **PixivApiPlugin gateway** (147152b, dba7412): PictelioHttpPlugin.java deleted, PixivApiPlugin.java added. client.ts simplified — 120 lines removed (CapacitorHttp, PictelioHttp, accessToken/refreshAuth). auth.ts: access_token only in DEV mode. MainActivity registers PixivApiPlugin instead of PictelioHttpPlugin. New: OAuthUtils.java. Docs: ADR-0037, capacitor-data-transfer.md, capacitor-image-best-practices.md.
- **AuthPlugin saveCall/releaseCall** (a148b55, 828eab6): Fix PluginCall lifecycle safety.
- **Build comment update** (4fb04fd): terser → Oxc minifier (Rolldown built-in).
- **Version bump** (eb00568): v3.18.0 incrementals.

## Docs Impact Plan

### 1. /openwiki/architecture/api-layer.md — SIGNIFICANT UPDATE
- Transport section: No longer "dual-mode" in production. Native mode uses PixivApiPlugin (not CapacitorHttp/PictelioHttp). Web mode uses fetch + Vite proxy (dev only).
- Auth flow: 401 refresh moved from JS Promise queue to Java side (PixivApiPlugin internal synchronized). Promise queue is DEV-only now.
- Credentials: access_token is Java-only, never enters JS heap in production.
- Diagram: Replace the 401 retry flow — Java handles refresh internally.
- Remove references to PictelioHttp.ts.
- Source file references: update file list to include PixivApi.ts instead of PictelioHttp.ts.

### 2. /openwiki/integrations/android-native.md — SIGNIFICANT UPDATE
- Plugin list: Replace PictelioHttpPlugin with PixivApiPlugin (4 plugins remain, composition changes).
- Mermaid diagram: Update to show PixivApi instead of PictelioHttp.
- MainActivity section: Update registered plugins.
- Add OAuthUtils mention (shared utility class).
- Update metadata description.

### 3. /openwiki/architecture/overview.md — MINOR UPDATE
- "Mobile targets" / Android section: Update Custom Capacitor plugins list (remove PictelioHttp, add PixivApi).
- Build tooling: May need bundler update (rolldown-runtime confirms Rolldown bundler in v3.18.0).

### 4. /openwiki/quickstart.md — MINOR UPDATE
- ADR table: Add ADR-0037 (PixivApiPlugin gateway), mark ADR-0002, ADR-0004 as superseded.
- Repo evolution: Add v3.18.0 gateway theme.

## Relationships

- PixivApiPlugin → replaces → PictelioHttpPlugin (deleted)
- PixivApiPlugin → is registered in → MainActivity.java
- PixivApiPlugin → implements → ADR-0037 architecture
- ADR-0037 → supersedes → ADR-0002 (SSRF whitelist) and ADR-0004 (401 Promise queue)
- PixivApiPlugin → uses → OAuthUtils (extracted shared utils)
- PixivApiPlugin → secures → access_token (Java-only, never JS heap)
- client.ts → delegates to → PixivApiPlugin (native mode) or fetch (DEV mode)
- Rolldown/Oxc → replaces → Vite/Terser (production bundling)
