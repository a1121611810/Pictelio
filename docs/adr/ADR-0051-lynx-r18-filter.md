# ADR 0051: app-lynx R18/R18G 内容过滤（IndexedDB 设置存储 + Me 页开关）

## 状态

已被取代（Superseded）——过滤策略（§4 `filterByRestrict`）由 issue #91 遮罩方案取代：全量渲染 + 受限条目盖玻璃遮罩（`isRestricted` + `RestrictOverlay`），`filterByRestrict` 已删除。IndexedDB KV 层（§1）与 Me 页开关（§3）仍有效。

## 分类

技术决策 / 内容安全

## 日期

2026-08-01

## 背景

app-lynx 的推荐插画/小说 feed **无任何 R18 过滤**，直接展示 `x_restrict` 为 1（R-18）/ 2（R-18G）的内容。主项目 app 有 `showR18` / `showR18G` 两个开关（`settingsStore.ts`，**默认 false**，在设置页），feed 加载后经 `r18Filter.ts` 客户端过滤。

app-lynx 无设置页，需选择开关的存放位置与持久化介质。

## 决策

### 1. 通用 IndexedDB KV 层（`utils/idbKV.ts`）

app-lynx 的 JS 运行在 Web Worker（`lynx-bg`），**无 localStorage**（ADR-0050 已确认）；IndexedDB 是唯一持久化手段。将 ADR-0050 的 token 存储**泛化为通用 KV 层**（`idbSet`/`idbGet`/`idbRemove`），`tokenStorage` 改为薄封装——单一存储入口（高可维护）。

DB schema：`pictelio_lynx` **version 2**（version 1 已有旧 store `tokens`，version 保持 1 则 `onupgradeneeded` 不触发、`kv` store 不会创建 → 读写失败；升级到 2 强制创建 `kv`。旧 `tokens` 数据不迁移，一次性重新登录）。

### 2. 设置 store（`stores/settingsStore.ts`）

- `showR18` / `showR18G` 两个响应式开关，**默认 false**（对齐主项目，默认隐藏 R18/R18G）
- 启动时 `loadSettings()` 从 IndexedDB 恢复（`initRouter` 中调用）；变更时 `setShowR18`/`setShowR18G` 写入
- `filterByRestrict<T extends { x_restrict: number }>(items)`：对齐主项目 `r18Filter.isRestricted` 逻辑（`!showR18 && x_restrict===1` / `!showR18G && x_restrict===2` → 过滤）

### 3. 开关 UI：Me 页两个 switch

app-lynx 无设置页，Me 页（"我的"）为唯一合适入口。新增"内容设置"区块（两个 Fluent 风格滑动 switch："显示 R-18 内容" / "显示 R-18G 内容"），样式复用现有 client 切换的圆点语义。

### 4. Feed 客户端过滤

`Recommended.vue` / `NovelList.vue` 的**首屏与分页**均在 fetch 后应用 `filterByRestrict`（对齐主项目 `filterFeedIllusts`/`filterNovels` 的位置——主项目在 store 写入前过滤）。

详情页不拦截（feed 已过滤，进入详情的仅可见内容；R18 遮罩方案后续）。

> **已被取代（issue #91）**：实测推荐/关注小说 feed 的 `x_restrict` 全部为 1/2，过滤后白屏；且空页防护基于过滤后长度误杀分页。现改为全量渲染 + `isRestricted` 判定 + `RestrictOverlay` 遮罩（含详情页正文遮罩），分页空页防护回归服务端原始判空。

## 权衡

| 方案 | 结论 |
|------|------|
| 固定默认隐藏（无开关） | 被否——主项目是**两个开关**（默认关），需对齐提供开关能力 |
| 开关放设置页 | app-lynx 无设置页，Me 页为 MVP 合适入口；后续建设置页时迁移 |
| 设置存内存（重启回默认） | 被否——与主项目"开关持久化"体验不一致；IndexedDB KV 低成本（O(1) 读写、非敏感设置） |
| 单独建存储 vs 泛化 tokenStorage | **泛化**——单一存储入口，避免双份 IndexedDB 逻辑漂移 |

## 风险

- **IndexedDB version 升级**：version 2 强制触发 `onupgradeneeded` 创建 `kv`；旧 `tokens` store 数据不迁移（一次性重登）。后续 schema 变更必须递增 version。
- **开关与过滤时序**：`loadSettings` 与 `fetchFirstPage` 并发——若设置未加载完 feed 已到，可能用默认值（隐藏）过滤；开关变更后已加载 feed 不实时刷新（下次进入生效）。MVP 可接受。
- **详情页无遮罩**：R18 内容进入详情页无模糊/警告遮罩（主项目有）；feed 已过滤所以日常路径不可达，直接 URL 进入的场景待后续。
- **原生（#41）**：IndexedDB 仅 web-core；原生 LynxView 的设置存储待 #41 与登录持久化一并对齐。

### 正面

- 对齐主项目开关语义（两开关 + 默认关）
- 存储复用单一 IndexedDB KV 层（可维护）
- feed 过滤与分页全覆盖

### 反面

- 无设置页，开关入口在 Me 页（后续迁移）
- 开关变更不实时刷新已加载 feed

## 相关

- ADR-0050（IndexedDB KV 层来源、Worker 环境调查）
- 主项目 `settingsStore.ts` / `utils/r18Filter.ts`（对齐来源）
- 实施提交：`cf74212`
