# TypeScript strict 三道隐形暗门 —— 对 Pictelio 的收益分析

> **来源**：李帕吉 / 前端小石匠 公众号 2026-09-21《开了 strict 照样翻车：TypeScript 没告诉你的三道隐形暗门》
> **范围**：仅做分析（按用户要求 "只做分析"）。不动代码、不写实现。
> **方法**：通读全文 → grep 项目源码定位应用面 → 风险评级 → 实施优先级。

---

## TL;DR

文章三个手法对 Pictelio 项目有**真实收益**，且已经命中具体风险点：

| 手法 | Pictelio 收益 | 风险等级 | 已有动作 |
|---|---|---|---|
| **Branded Types**（名义类型 / 幽灵类型） | **强** —— API 层 `illustId / novelId / userId / seriesId / chapterId` 全是裸 `number`，跨类型误传编译期零拦截 | **高** | 无 |
| **`never` 穷尽检查** | **强** —— `downloadsViewModel.statusLabel` 是教科书级别反例，新增枚举项会静默 `undefined` | **高** | 无 |
| **`satisfies` 运算符** | **弱** —— 项目已经在 i18n 英文域全量使用，新增配置对象场景不多 | 低 | **已覆盖**（en/ locale files） |

---

## 第一道门：Branded Types —— **真实高价值**

### 文章论点（要点）

- TypeScript 结构化类型只认"形状"不认"语义"；
- `type OrderId = string` 实质只是给编译器看的注释，无任何隔离；
- 解决：`unique symbol` + 交叉类型 `string & { readonly [Brand]: typeof Brand }`，零运行时代价；
- 在系统边界（HTTP / DB / 反序列化）通过工厂函数 `toUserId(raw): UserId` 打标。

### 项目现状（grep 结果）

API 层所有 ID 都是裸 `number`：

```
src/api/illust.ts:49   loadDetail(illustId: number, ...)
src/api/illust.ts:62   loadRelated(illustId: number, ...)
src/api/illust.ts:77   loadBookmarks(userId: number, ...)
src/api/illust.ts:89   loadUgoiraMetadata(illustId: number, ...)
src/api/illust.ts:224  buildUgoiraFrames(illustId: number, ...)
src/api/illust.ts:300  downloadIllustUgoira(illustId: number, ...)
src/api/illust.ts:350  bookmarkIllust(illustId: number, ...)
src/api/illust.ts:364  deleteBookmark(illustId: number, ...)
src/api/novel.ts:31    fetchNovelData(novelId: number)
src/api/novel.ts:46    loadBookmarks(userId: number, ...)
src/api/novel.ts:62    loadDetail(novelId: number)
src/api/novel.ts:71    loadTextRaw(novelId: number)
src/api/novel.ts:108   loadText(novelId: number)
src/api/auth.ts:38,82  result.userId: number
```

接口响应也全是裸 ID：

```
src/api/types.ts:11    PixivUser.id: number
src/api/types.ts:42    PixivIllust.id: number
src/api/types.ts:65    PixivNovel.id: number
src/api/types.ts:98    NovelNavItem.id: number
src/api/types.ts:120   PixivUgoiraFrame: ...
```

### 真实风险面

**`fetchNovelData(novelId: number)` 接受任何 `number`。** 调用方拿 `illustId` 传进去不会报错，最终发的是 `/v2/novel/detail?novel_id=<illustId>`，服务端要么返回别的作品、要么空响应——纯静默错误。这正是文章里 `refund(orderId, customerId)` 翻车故事的等价形态。

具体可能触发的代码路径（需要进一步 grep 验证调用现场，但 API 签名已经允许）：
- 在某个收藏/历史 store 里拿到一个作品 ID，需要再拉小说详情时，把 illust ID 错传进 novel 函数；
- 用户/章节/系列 ID 之间也存在同样问题。

### 收益评估

| 维度 | 评估 |
|---|---|
| **零运行时代价** | ✅ 与文章一致，编译期擦除 |
| **改造范围** | 中等：API 层 + response 类型 + 调用现场 + 工厂函数 |
| **误报风险** | 低：仅在边界（HTTP/DB）打标，内部流通仍是 number，类型转换代码可控 |
| **配套需要** | `unique symbol` 全局声明；工厂函数放在 `src/api/id.ts` 或类似集中 seam |
| **回归测试** | 现有单测应能在不改语义情况下全绿；增加 "误传 ID 编译报错" 的 tsc-only 烟测 |

### 落点选择（按文章 "工程落地里的克制与边界"）

文章明确指出：**"打标类型最适合的落脚点始终是系统的核心领域实体"**。Pictelio 应该只对以下 ID 打标：
- `IllustId`、`NovelId`、`UserId`、`SeriesId`、`ChapterId`、`BookmarkId`、`CommentId`、`TagId`、`UgoiraFrame.file` 里的 ID 部分（URL path 内的 illust ID）

不应打标的：
- 临时计数器、数组下标、UI 内部 key（`index`）、分页 `offset/limit`（虽为 number，但语义不同且无混淆风险）

---

## 第二道门：`never` 穷尽检查 —— **真实高价值**

### 文章论点（要点）

- 给可辨识联合（discriminated union）新增成员时，依赖 `switch` 的代码会**静默穿透**，返回 `undefined`；
- 解决方法：默认分支调用 `assertNever(value: never): never`，编译器把 `value` 视为 `never`；新增成员时类型不再是 `never` 而是新成员 → `assertNever` 报错拦截。

### 项目现状：教科书级反例已经存在

**反例 1（最严重）：`utils/downloadsViewModel.ts:91`**

```typescript
export function statusLabel(status: DownloadStatus): string {
  switch (status) {
    case "queued":       return t("core.util.downloadsViewModel.statusQueued");
    case "downloading":  return t("core.util.downloadsViewModel.statusDownloading");
    case "paused":       return t("core.util.downloadsViewModel.statusPaused");
    case "stopped":      return t("core.util.downloadsViewModel.statusStopped");
    case "completed":    return t("core.util.downloadsViewModel.statusCompleted");
    case "failed":       return t("core.util.downloadsViewModel.statusFailed");
    // ← 无 default，无 assertNever
  }
}
```

联合定义 `src/utils/downloadQueueCore.ts:6`：

```typescript
export type DownloadStatus =
  | "queued" | "downloading" | "paused"
  | "stopped" | "completed" | "failed";
```

**真实事故形态**：将来新增 `"rate_limited"` 或 `"awaiting_network"` 状态（如后台下载 + 网络感知），`statusLabel` 会静默返回 `undefined`，`t()` 拿到 undefined → 视图层显示空白 / 整组件白屏。这正是文章 `getRefundStatusLabel` 例子描绘的事故。

**反例 2（次严重）：`utils/aiFilter.ts:41`**

```typescript
export function isAiHiddenByType(aiType: number, mode: AiFilterMode): boolean {
  if (mode === "show") return false;
  const ai = aiType >= 1;
  return mode === "mask" ? ai : !ai;
}
```

联合定义 `src/utils/aiFilter.ts:9`：

```typescript
export type AiFilterMode = "show" | "mask" | "only";
```

这是 if-else 链（不是 switch），但语义等价：未来加 `"highlight"`（高亮但不隐藏）模式，这里会静默走 `mask` 分支，行为错误。改造手法：把 if-else 链改成 switch + assertNever。

**其他候选（按 grep 结果，需进一步人工确认）**：

| 联合类型 | 定义位置 | 适用收益 |
|---|---|---|
| `RestrictType = "public" \| "private"` | `api/types.ts:217` | 低（语义稳定，几乎不会扩） |
| `ContentType = "illust" \| "manga" \| "novel"` | `api/types.ts:216` | 中（如未来加 `"video"`，多文件需同步） |
| `LayoutMode = "waterfall" \| "single" \| "grid"` | `stores/settingsStore.ts:21` | 中（设计 token 已 3 个，加新会改 spec） |
| `NovelLayoutMode = "list" \| "coverWall" \| "textList"` | `stores/settingsStore.ts:22` | 中 |
| `Theme = "light" \| "dark" \| "system"` | `stores/themeStore.ts:5` | 低（稳定） |
| `Tab = "recommended" \| "follow" \| "bookmarks" \| "me" \| "history"` | `stores/uiStore.ts:4` | 中 |
| `ImageQuality = "medium" \| "large" \| "original"` | `stores/settingsStore.ts:20` | 低（CDN 限制稳定） |
| `TranslateErrorCode = "unauthorized" \| "insufficient_balance" \| "rate_limit" \| "server" \| "network" \| "content_filter" \| "unknown"` | `api/translate.ts:52` | **中-高**（错误码会随上游演化） |
| `DownloadStatus` 6 项 | `utils/downloadQueueCore.ts:6` | **高**（移动端下载场景状态机最常扩） |

**`app-lynx` 同源**：app-lynx 有同名 `utils/downloadsViewModel.ts:90`，按 "与 app 端差分对齐" 的双端契约（spec `docs/specs/download-manager.md §7`），两个端都要同步改。

### 收益评估

| 维度 | 评估 |
|---|---|
| **零运行时代价** | ✅ 零运行时（assertNever 调用只在未覆盖分支被触发） |
| **改造范围** | 小：只在 switch/if-else 链的 default/末支加 `assertNever(x)`；联合定义不动 |
| **误报风险** | 极低：编译器只在确实未覆盖时报错 |
| **配套需要** | 1 个共享的 `assertNever<T>(x: T): never`（放在 `src/utils/assertNever.ts`） |
| **回归测试** | tsc 编译即可验证；可加 1 个 "所有联合的 assertNever 自检" 测试 |

### 落点选择

文章明确：**"穷尽性检查，最适合那些生命周期相对稳定、由系统内部状态机驱动的离散集合"**。Pictelio 高价值候选（按优先级）：

1. `DownloadStatus`（最高，状态机扩展最频繁）
2. `TranslateErrorCode`（错误码随上游演化）
3. `AiFilterMode`（已发生风险）
4. `ContentType` / `LayoutMode` / `NovelLayoutMode` / `Tab`（中等）

不要在以下场景使用：
- 第三方插件的开放枚举（文章原话："强行使用 never 穷尽反而会把扩展弹性锁死"）
- 单纯映射到 i18n 文案的 switch（i18n 缺 key 已有 satisfies + console.warn 双层防御）

---

## 第三道门：`satisfies` 运算符 —— **项目已大部分采用，剩余场景不多**

### 文章论点（要点）

- `: Type` 注解：保留约束但丢失字面量推断（IDE 自动补全差、字符串方法不可用）；
- `as const`：保留字面量但丢失约束；
- `satisfies Type`：**同时**校验结构 + 保留字面量，TS 4.9+ 推荐方案。

### 项目现状：i18n 英文域已经全量使用

```
src/i18n/locales/en/time.ts:12          } as const satisfies Record<TimeKey, string>;
src/i18n/locales/en/error.ts:26         } as const satisfies Record<ErrorKey, string>;
src/i18n/locales/en/components1.ts:85   } as const satisfies Record<ZhComponents1Key, string>;
src/i18n/locales/en/core.ts:90          } as const satisfies Record<ZhCoreKey, string>;
src/i18n/locales/en/components2.ts:359  } as const satisfies Record<ZhComponents2Key, string>;
src/i18n/locales/en/routes.ts:392       } as const satisfies Record<ZhRoutesKey, string>;
src/i18n/locales/en/index.ts            } as const satisfies Dict;
```

每个 en 域文件都满足"新增键必须先在 zh-CN 出现"这条规则。这是 **Trap 3 的标准落地**。

### 不对称点（轻微）

`zh-CN/<domain>.ts` 仅用 `as const`，无 satisfies。原因：zh-CN 是 **source of truth**，没有外部契约可满足。但这种设计隐含一个**反向缺陷**：

> **如果有人从 zh-CN 误删一个 key，所有 en 文件的 `satisfies Record<TimeKey, string>` 不会报错**（因为 satisfies 语义允许"多余键"）。

换言之：
- en 加 key、zh 没加 → ✅ 编译报错（正确防御）
- zh 删 key、en 还有 → ❌ 不报错（运行时英文走 fallback 路径，行为正确但缺类型信号）
- zh 删 key、en 也删 → ✅ 无声 OK（符合预期）

### 其他候选场景（grep 出来后判断）

| 位置 | 现状 | 是否值得改 satisfies |
|---|---|---|
| `services/backupWiring.ts:34` `BACKUP_SET_KEYS = ["blocked_user_ids", "reported_ids"] as const` | 简单字符串元组 | 否（无约束场景） |
| `services/backupWiring.ts:43` `BACKUP_RUNTIME_KEYS = [...] as const` | 同上 | 否 |
| `api/feedQueryPersist.ts:68` `TRUNCATE_LADDER = [...] as const` | 数值元组 + 算法使用 | 否 |
| `api/translate.ts:20` `TRANSLATE_MODELS = [...] as const` | 字符串元组 | 否 |
| `routes/ImageHostSettings.tsx:238-254` 散落的 `"race" as const` / `"weighted" as const` 等 | 单值类型断言 | 否（无结构校验对象） |

### 收益评估

| 维度 | 评估 |
|---|---|
| **零运行时代价** | ✅ 零运行时 |
| **改造范围** | 极小（核心场景已覆盖） |
| **误报风险** | 低 |
| **剩余收益点** | 几乎为零；只有 "新建一个外部契约的 config 对象" 时再考虑 |

### 落点选择

- ✅ 维持现状（en/ 域继续使用 satisfies）
- ⚠️ 警惕 zh-CN 误删 key：建议加运行时自检（启动时遍历 `Object.keys(zhCN)` vs `Object.keys(en)`），或单测覆盖；**不**改类型层（无干净方案）
- ❌ 不主动改造其他 `as const` 场景（无外部契约）

---

## 综合优先级建议

如果未来要把这三套手法引入项目，建议顺序：

### Tier 1（高 ROI，立竿见影）

1. **`utils/downloadsViewModel.ts:91` `statusLabel`** 加 `assertNever`（30 行内改动，双端同步）
2. **`utils/aiFilter.ts:41` `isAiHiddenByType`** 改为 switch + assertNever（双端同步）
3. **共享 `src/utils/assertNever.ts`** 提供 `assertNever<T>(x: T): never`，加单测

### Tier 2（中 ROI，分阶段推）

4. **Branded Types for API IDs**：先在 `src/api/id.ts` 引入 `IllustId / NovelId / UserId` 类型 + 工厂函数；
   然后逐步在 `api/illust.ts` / `api/novel.ts` 签名替换；
   调用现场改造（最大量，约 50+ 文件涉及 `illustId` / `novelId` / `userId`）；
   配套 tsc-only 烟测："误传编译失败"
5. **`TranslateErrorCode` 的 switch 也加 assertNever**

### Tier 3（低 ROI，可选）

6. 其他稳定联合（`Theme` / `ImageQuality` / `RestrictType`）：纯防御性，ROI 低
7. zh-CN 误删 key 防御：建议用 runtime / 测试覆盖，类型层无干净方案

---

## 边界提醒（按文章 "工程落地里的克制与边界"）

文章最后强调的三条边界，对 Pictelio 同样适用：

1. **不要 "逢 ID 必打标、逢 switch 必穷尽"**：内部临时变量、稳定的二元枚举不需要
2. **不要为了 "类型完备" 把代码搞复杂**：收益 < 心智成本时直接放弃
3. **类型系统是防护缆绳不是体操**：在编译期拦截真实事故、运行时零成本 —— 同时满足才是划算投入

---

## 引用

- 文章链接：<https://mp.weixin.qq.com/s/1sYdhpyW1SHxgGFPd9PIAA>
- 项目对应位置：
  - `packages/app/src/api/illust.ts` / `api/novel.ts` / `api/types.ts`
  - `packages/app/src/utils/downloadsViewModel.ts` / `utils/aiFilter.ts`
  - `packages/app/src/utils/downloadQueueCore.ts`
  - `packages/app/src/i18n/locales/en/*.ts` / `i18n/locales/zh-CN/*.ts`
  - `packages/app-lynx/src/utils/downloadsViewModel.ts`（同源双端）
- 项目硬约束：`tsconfig.json` 已开 `strict + noUnusedLocals + noUnusedParameters + noFallthroughCasesInSwitch`
