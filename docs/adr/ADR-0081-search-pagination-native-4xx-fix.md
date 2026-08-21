# ADR-0081：搜索分页修复——原生 next_url 归一化 + 同参数搜索防重入

## 状态

已接受（2026-08-13）

## 背景

搜索页（`/search`）在 Web 与 Android 端出现两个独立缺陷：

1. **Android 端翻页 4xx**：搜索出结果后滚动到底部触发第二页（`offset=30`），请求报 HTTP 4xx。
   根因：`PixivApiPlugin.request()`（Java）无条件把 `apiBase()` 拼到 `path` 前面。JS 侧把 Pixiv 响应里的**绝对 `next_url`** 原样传给插件，产生双域名 URL：
   `https://app-api.pixiv.net/https://app-api.pixiv.net/v1/search/illust?...&offset=30`
   → Pixiv 返回 **404**（"指定されたエンドポイントは存在しません"，已用 curl 直接验证）。
   该缺陷影响**所有分页**（搜索/推荐/收藏/用户作品/小说），不止搜索。

2. **Web 端首次搜索空结果**：搜索框提交后 `navigate` 改变 URL → `Search.tsx` 的 URL 同步 effect 二次调用 `executeSearch`。第二次 `abortPrevious()` 中止第一次的请求，两者都因 AbortError 静默失败 → 结果被清空，显示"没有找到相关作品"（浏览器可复现）。

## 决策

### 决策 1：原生 `next_url` 在 JS 层归一化为相对路径

在 `client.ts` 的 `rewriteUrl` 增加原生分支，并在 `nativeExecuteRequest` 原生路径应用：

- **绝对 Pixiv URL（`https://app-api.pixiv.net/...`）→ 剥离域名转为相对路径**（`/v1/...`），再交给 `PixivApi.request`。
- 插件契约保持"只收相对路径"（内部拼 `apiBase()`），不改 Java 侧。
- 相对路径请求（首屏 `apiClient.get("/v1/search/illust", params)`）原样透传，不做任何转换。

这与插画/小说列表 Feed 的分页路径（`nextPageOrLoad` → `apiClient.get(pageParam)`）共享同一个 `client.ts` 归一化，**一处修复覆盖全部分页**。

### 决策 2：`executeSearch` 同参数防重入

在 `searchStore.ts` 的 `executeSearch` 入口增加防重入守卫：

- 相同 `${keyword}_${scope}_${sort}` 搜索在飞行时，重复调用直接跳过（由第一个请求负责写入结果），**不 abort 前一个请求**。
- 参数不同（用户改词/改筛选）时仍走原 abort 逻辑（新搜索应取消旧请求）。

## Considered Options

### 原生 4xx 修复位置

| 方案 | 评估 |
|------|------|
| **JS 层归一化（采用）** | 插件契约保持"只收相对路径"（SSRF 安全面最小）；webview/lynx 共享 JS 层一次修复；可单测。 |
| Java 插件兼容绝对 URL | 需要额外主机白名单防 SSRF；webview/lynx 两个 Java 入口各改一次。 |
| 两侧都改（纵深防御） | 改动面最大，本期不引入。 |

## Consequences

### 正面

- Android 端搜索/推荐/收藏/用户作品/小说**所有分页**的 `next_url` 请求恢复可用（模拟器验证：搜索第二页加载 180 条，无 404；logcat 确认插件收到 `/v1/search/illust?...&offset=30` 相对路径）。
- Web 端首次搜索即出结果，不再出现竞态空结果。
- 插件不感知绝对 URL，无新增攻击面。

### 负面 / 注意

- `rewriteUrl` 原生分支对非 Pixiv 域绝对 URL 保持原样（防御性兜底，正常流程由 `assertPixivUrl` 先行拦截）。
- `loadMore` 不写搜索结果缓存：重进同词搜索恢复首页分页状态（既有行为，非本次引入）。
- `app-lynx`（Lynx MVP）的 `rewriteUrl` 原生分支同样把绝对 URL 原样透传，存在相同双域名隐患——**已于 ADR-0104 修复**（rewriteUrl 原生分支剥离域名 + execute/requestRaw 原生分支改传归一化路径，client.test.ts 覆盖）。

### 测试

- `tests/unit/api/client.test.ts`：+3 个原生分支 `rewriteUrl` 用例（绝对 next_url 剥离、非 Pixiv URL 原样、相对路径原样）。
- `tests/unit/stores/searchExecution.test.ts`：+1 个同参数防重入用例（第二次调用不发起新请求、不 abort 第一个）。
- 全量 911 测试通过；`tsc --noEmit`、oxlint 通过。
