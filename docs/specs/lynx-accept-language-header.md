# 功能规格：lynx 标签翻译语言头（Accept-Language）

> 关联：[ADR-0200](../adr/ADR-0200-lynx-accept-language-header.md)（决策权威）、[术语表](../adr/glossary-lynx-accept-language.md)、伞型 #782。
> 状态：已实施（见文末 Tickets 回写）。

## 1. 问题与目标

**问题**：App API 无语言头 → `tags[].translated_name` 大面积 `null` → lynx 标签日文直出；ADR-0197 D10 被迫用原名检索。

**目标**：
- G1 lynx 全部 App API 请求携带 `Accept-Language`，内容语言跟随 UI 语言设置；
- G2 已登录用户在标签胶囊 / 详情页标签 / 搜索联想等处看到官方中文译名（Crowdin 已覆盖部分）；
- G3 OTA 版本偏斜下零破坏（桥契约不动）。

**非目标**：webview 端、OAuth 端点、标签 MT/词典兜底、语言设置 UI 变更。

## 2. 数据流

### 2.1 原生通道（真机）

```
TS execute()/executeRaw()（不变）
  → PictelioApi.request(method, path, body, callback)   [桥签名不变]
  → PictelioApiModule.request                            [变更①：worker 线程内解析语言头]
      ├─ PictelioPrefsModule.get(ctx, "settings_language")
      ├─ resolveAcceptLanguage(raw) → "zh-CN" | "en"     [纯函数，变更②]
      └─ PixivApiCore.executeRequest(..., acceptLanguage, ...)
           └─ acceptLanguage != null → builder.addHeader("Accept-Language", v)   [变更③：可空重载]
```

### 2.2 web 通道（dev web-core 预览）

```
TS execute()/executeRaw() web 分支                          [变更④]
  headers = { UA, Referer, "Accept-Language": locale.value, [Authorization] }
  → fetch(/pixiv-api/...) → Vite 代理 → Pixiv
```

## 3. 状态与映射

**语言头解析表（oracle = ADR-0200 D1）**：

| `settings_language` | 头值 |
|---|---|
| `"en"` | `en` |
| `"zh-CN"` | `zh-CN` |
| `""` / null / 其他任意 | `zh-CN` |

无持久状态新增、无 UI 状态新增。web 通道 `locale.value` 由 `settingsStore.setLanguage` / `followSystemLocale` 单向驱动（既有机制，不变）。

## 4. 边界条件

| # | 场景 | 行为 |
|---|------|------|
| E1 | prefs 读抛异常 / Context 不可用 | 头值 `zh-CN` + `Log.w`（禁静默降级）；请求照发 |
| E2 | locale 运行时切换（web 通道） | 新请求即带新值；在飞请求不变（headers 构造时快照） |
| E3 | 旧 APK + 新 JS / 新 APK + 旧 JS | 均正常（语言经 prefs 不经桥；JS 侧不读该头） |
| E4 | 429 退避 / 401 刷新重放（ADR-0199） | 正交不受影响——重试请求经同一 `execute`，语言头同样携带 |
| E5 | 非 Pixiv 域请求（`shouldAttachAuth`=false 路径） | 头照加（UA/Referer 同姿势，无域差别） |
| E6 | `PixivApiCore` 其他调用方（webview `PixivApiPlugin`、诊断探针 `NetDiagProbe`；OAuth 端点走 PictelioAuth 自有通道，不经本方法） | 走 5 参旧签名 → `null` → 不加头，行为零变化 |

## 5. 变更清单

| 文件 | 变更 |
|---|---|
| `packages/app/android/app/src/main/java/io/pictelio/app/PixivApiCore.java` | ③ 新增 6 参重载（`acceptLanguage` 可空）；旧 5 参委托 |
| `packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioApiModule.java` | ①② request 内解析语言 + 传参；`resolveAcceptLanguage` 纯静态函数 |
| `packages/app-lynx/src/api/client.ts` | ④ web 分支 headers 加 `Accept-Language: locale.value`（execute + executeRaw 两处） |
| `packages/app/android/app/src/test/java/io/pictelio/app/PictelioAcceptLanguageTest.java` | 新增：解析五分支 + 重载委托/MockWebServer 头断言 |
| `packages/app-lynx/src/api/client.test.ts` | 增：web 通道头断言 + locale 切换断言 |

## 6. 验收条件

- A1（单测）语言头解析表全分支绿（Java + TS 双侧）；
- A2（单测）web 通道 `apiClient.get` / `requestRaw` 的 fetch 调用参数含 `Accept-Language`，且随 `setLocale` 变化；
- A3（门禁）`pnpm check:app-lynx` / `test:app-lynx` / 根 `pnpm lint` / `fmt:check` / Java 单测全绿；
- A4（模拟器）debug 包装入模拟器 + 登录后，推荐 feed 标签胶囊可见中文译名（如 `#东方Project`、`#原创`），logcat 无新增异常。

## 7. Tickets（实施回写，2026-09-28 收口）

| 票 | 内容 | 状态 | 证据 |
|---|------|------|------|
| T1 #783 | Java 原生通道语言头（变更①②③ + Java 测试 10 用例） | ✅ | 77d3457b |
| T2 #784 | TS web 通道语言头（变更④ + client.test.ts 4 用例） | ✅ | 1e9606ae |
| T3 #785 | 门禁收口 + 模拟器验收 + review 闭环 + 本节回写 | ✅ | 25400480 / 6c7225c8（review round 1 修复） |

**验收结论（spec §6）**：
- A1 ✅ 解析五分支 Java 10/10 + TS 差分契约钉（`i18nLanguageKeyConsistency` 4 用例，含双变异验证）
- A2 ✅ `apiClient.get` / `requestRaw` 头断言 + `setLocale` 切换 + 快照语义 + 401 重放（E4）头一致
- A3 ✅ Java `testFullDebugUnitTest` BUILD SUCCESSFUL；TS 192 文件 / 2655 用例；`check:app-lynx` / 根 `lint` / `fmt:check` 全绿
- A4 ✅ 模拟器（full debug 变体）实测：基线截图 feed 标签 `#艦これ` `#バニーガール` 全日文（/tmp/lynx_before_feed.png）→ 装新包后 feed 胶囊 `#原创` `#女孩子`、详情页标签行同款中文（/tmp/lynx_after_feed.png、/tmp/lynx_after_detail2.png）；logcat 零 PictelioApiModule 异常

**code-review**：round 1 双轴 PASS（0 P0/P1），4 P2 全部处置（P2-1/P2-2 落测试防线并双变异验证、P2-3/P2-4 文档订正）、nit-2 采纳（常量上移）、nit-1/nit-3 留观察（既有语义非本次引入）。
