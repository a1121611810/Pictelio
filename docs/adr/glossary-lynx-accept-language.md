# 术语表：lynx 标签翻译语言头（Accept-Language）

> 关联：[ADR-0200](./ADR-0200-lynx-accept-language-header.md)、spec `docs/specs/lynx-accept-language-header.md`、伞型 #782。
> 本文是本 effort 的统一术语源；代码注释、ADR、ticket、review 意见中的相关词以本文口径为准。

## 核心术语

| 术语 | 定义 | 备注 |
|------|------|------|
| **内容语言（Content Language）** | Pixiv API 响应中标签译名（`translated_name`）等本地化字段所用的语言。 | 由请求语言头决定；与 UI 语言（界面文案语言）是两个概念，本 effort 让二者对齐。 |
| **语言头（Accept-Language）** | HTTP 标准请求头。Pixiv App API（`app-api.pixiv.net`）以它决定响应的内容语言。 | 头名固定 `Accept-Language`；不用 `X-User-Lang`（官方新版 App 头，第三方生态实证以 Accept-Language 为主流，Pixez / Pixiv-Shaft / go-pixiv 均用之）。 |
| **标签译名（translated_name）** | Pixiv 标签对象上的官方译名字段，来自 pixiv Crowdin 众包翻译。 | 请求语言头缺失或对应语言无译文时为 `null`/缺失——lynx 现状即因此大面积回落日文原名。 |
| **语言头解析（Language Resolution）** | 把 lynx 语言设置值映射为 Accept-Language 头值的纯函数规则。 | 规则见 ADR-0200 D1：`en`→`en`；`zh-CN` / `""`（跟随系统）/ 非法值 → `zh-CN`。 |
| **语言设置（settings_language）** | lynx 语言设置持久化键（设备级共享键，ADR-0103），值域 `""` / `"zh-CN"` / `"en"`。 | `""` = 跟随系统。存储于 `CapacitorStorage` SharedPreferences（`PictelioPrefsModule.PREFS_FILE`）。 |
| **真机生效语言（Effective Device Locale）** | 真机上 UI 实际显示所用语言。 | 真机 LynxView 无 `navigator` → `detectSystemLocale()` 落 `zh-CN`，故真机跟随系统实际等于 `zh-CN`；语言头解析与此口径一致（见 ADR-0200 R1）。 |

## 通道术语

| 术语 | 定义 | 备注 |
|------|------|------|
| **原生通道（Native Channel）** | 真机链路：TS `execute()` → `PictelioApi.request`（桥）→ `PictelioApiModule.request`（Java）→ `PixivApiCore.executeRequest`（OkHttp）。 | 语言头在 **Java 侧**注入（ADR-0200 D2）。 |
| **web 通道（Web Channel）** | dev web-core 预览链路：TS `execute()` → `fetch` → Vite `/pixiv-api` 代理 → Pixiv。 | 语言头在 **TS 侧**注入（ADR-0200 D3），值取 i18n `locale.value`。 |
| **桥签名（Bridge Signature）** | `PictelioApi.request(method, path, body, callback)` 的 JS↔Java 方法契约。 | 本 effort **零变更**——语言经 prefs 跨层传递，不经桥参数（ADR-0200 D2 版本偏斜论证）。 |
| **OTA 版本偏斜（OTA Skew）** | OTA 分发的 JS bundle 版本与 APK 内 Java 代码版本不一致的组合态。 | 桥传参方案在新 JS + 旧 APK 下会桥参数失配 → 全部请求失败；Java 读 prefs 方案双向兼容。 |

## 竞品参照（调研快照，2026-09-28）

| 术语 | 定义 |
|------|------|
| **Pixez 模式** | 全局静态默认头 `Accept-Language: zh-CN`（`api_client.dart`），所有 App API 请求统一携带，不随 UI 语言。 |
| **Pixiv-Shaft 模式** | 用户「内容语言」设置项映射为请求头值（默认简中，可切 ja/en/繁中/ru/ko）。 |
| **Pixeval 模式** | API 译名之外提供扩展机器翻译兜底（DeepL/百度/DeepLX/Ollama），`TranslatableTextBlockBehavior` 悬停浮出。本 effort 不做（译名覆盖见顶后再议）。 |
