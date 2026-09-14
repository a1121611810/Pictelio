# Spec: 相关作品注入行（双端：app webview + app-lynx）

- 状态：implemented（2026-09-12 当日实施于分支 `feat/related-injection`，7 commits 3f773575..d232e4c8；门禁 check:all / test:all（app 1673 + lynx 1154 + 其余包）/ lint:all 全绿；仓库级双轴 code-review 首轮 PASS-with-comments → 复审修复 commit d232e4c8 → 复审 PASS。遗留：模拟器/真机视觉批次（lynx 横滑降级行为、行高观感）挂账于 #490）
- 日期：2026-09-12
- 关联：评估结论 = 「返回列表原位插入相关作品」方案 B 形态（原位下方横滑条，非逐条散插）；官方接口 `/v2/illust/related`；小说无官方 related 端点（Phase 2 挂账）
- 工单：spec [#486](https://github.com/a1121611810/Pictelio/issues/486) / T1 [#487](https://github.com/a1121611810/Pictelio/issues/487) / T2 [#488](https://github.com/a1121611810/Pictelio/issues/488) / T3 [#489](https://github.com/a1121611810/Pictelio/issues/489) / T4 [#490](https://github.com/a1121611810/Pictelio/issues/490)（#487-#489 已关）

## 1. 背景与目标

第三方 Pixiv 客户端标配「相关作品」。本 spec 交付**比详情页底部相关区关联性更高的形态**：用户从列表进入详情后返回，在该作品（锚点）原位置**正下方注入一行「相关作品」横滑条**。数据来自官方 App API `/v2/illust/related`（响应为标准 `PixivIllustListResponse`）。

双端一致交付：webview（pictelio-app 首页插画面板）+ lynx（app-lynx 插画列表页）。设置开关控制，默认开启。

## 2. 非目标（Out of Scope）

- **小说注入**：无官方 related 端点，同标签搜索降级的语义稀释问题未拍板 → Phase 2 挂账（本 spec 不实现）。
- **逐条散插瀑布流**：评估已否决（滚动跳动 / 原列表边界不可追溯 / 虚拟化窗口改动大）。
- **详情页底部相关区**：不做（本方案覆盖其价值）。
- **其他列表页**（搜索结果、用户作品、收藏页 UserWorksFeed、lynx 其他 feed 页）：本期仅首页插画 Feed（webview recommended/follow/bookmarks 三 tab + lynx 推荐/关注两 tab）；扩展路径见 §7。
- **注入持久化**：注入行是会话内临时状态，冷启动/刷新不恢复。

## 3. 领域模型

### 3.1 术语

| 术语 | 定义 |
|---|---|
| **锚点（anchor）** | 用户从首页插画面板点击进入详情的那条作品 |
| **注入行（related row）** | 渲染在锚点卡片正下方的一行「相关作品」横滑条，带标题与收起按钮 |
| **注入会话** | 一次 feed 加载生命周期（首载/刷新/切 tab 重建）；刷新即清空该 tab 全部注入行 |
| **pendingAnchor** | 点击卡片时记录的 `{tab, illustId}`，返回面板时被消费；消费即清除 |

### 3.2 注入行数据形状

```ts
interface RelatedRow {
  /** 锚点作品 id（行渲染在 items 中该 id 卡片之后） */
  anchorId: number;
  /** 相关作品（已过滤，≤20 条）；渲染时再排除主列表已展示 id */
  items: PixivIllust[];
}
```

### 3.3 常量

| 常量 | 值 | 理由 |
|---|---|---|
| `MAX_ANCHORS` | 3 | 每个 tab 会话内最多 3 个锚点行，防列表膨胀不可追溯 |
| `ROW_SIZE` | 20 | related 接口首页即 30 条，过滤后截断 20 |
| related 缓存 | app: TanStack Query `["related", id]` staleTime 5min；lynx: 模块内 `Map<number, PixivIllust[]>` | 同一作品反复进出零重复请求 |

## 4. 交互语义

1. **记录锚点**：仅当点击发生在首页插画面板卡片上（`IllustFeedPanel` / lynx `IllustList` 的 `openDetail`）时记录 pendingAnchor；详情页内跳转、注入行内点击**不记录**（防循环注入）。
2. **消费锚点**：面板重新激活（webview 路由返回重挂载 / lynx KeepAlive `onActivated`）时消费 pendingAnchor → 清除 → 按下列判定：
   - 开关关闭 / 该 tab 已达 MAX_ANCHORS / 该锚点已有行 → 不注入；
   - 请求失败 → `console.warn` 不注入（静默降级禁止条款的例外：注入行是增强能力，失败只 warn 不影响主列表）；
   - 成功 → `filterFeedIllusts`（webview）/ settings 等价过滤（lynx：isRestricted + isAiRestricted）→ 排除主列表已展示 id 与锚点自身 → 截断 20 → 注入行插入 rows；过滤后为空不注入。
3. **行渲染**：锚点卡片正下方；行 = 标题「相关作品」+ 收起按钮（点按移除该行）+ 横向滚动缩略图（方形封面，点击 → 详情页）。
4. **清空时机**：下拉刷新 / 切 tab 重建 feed / 切 contentType → 清空对应 tab 的行。
5. **开关**：默认开启。关闭后：不再注入新行，**已注入行立即隐藏**（渲染层过滤，数据保留，重新开启即恢复）。

## 5. 双端实现设计

### 5.1 webview（pictelio-app）

- **API**：`api/illust.ts` 新增 `loadRelated(illustId, signal?)` → `GET /v2/illust/related`，参数 `{illust_id, filter: "for_ios"}`。
- **状态**：新 store `stores/relatedInjectionStore.ts`（createStore 顶层导出，项目范式）：`rowsByTab: Record<Tab, RelatedRow[]>` + `pendingAnchor` signal + `recordAnchor/consumeAnchor/addRow/removeRow/clearRows` actions；app 侧经 `queryClient.fetchQuery(["related", id], staleTime 5min)` 取数。
- **渲染**：`HomePage.tsx` `IllustFeedPanel` 把 `items()` 与 rows 交织成联合列表 `RenderItem = PixivIllust | { relatedRow: RelatedRow }` 传给 `FeedList`（泛型 T 已支持）；`renderItem` 分支渲染 `RelatedStripRow.tsx`（新组件，Fluent 令牌，横滑 `overflow-x-auto`）；`prefetchUrl` 对行返回 undefined（跳过预取）。
- **返回检测**：`IllustFeedPanel` 重挂载即消费（@solidjs/router 路由切换会卸载 HomePage；store 在模块层存活）。
- **设置**：`settingsStore.ts` 新增 `relatedInjection` boolean（key `related_injection`，default true）+ `setRelatedInjection`；`resetSettingsStore` 补一行；UI 放 `SettingsContent` 卡片内开关行。

### 5.2 lynx（app-lynx）

- **API**：`api/illust.ts` 新增 `loadRelated`（同参数）。
- **状态**：新 Pinia store `stores/relatedInjection.ts`：`rowsByTab: { recommend: RelatedRow[]; follow: RelatedRow[] }` + pendingAnchor + 模块级 Map 缓存 + 同语义 actions。
- **返回检测**：`IllustList.vue` 在 KeepAlive 白名单（ADR-0049）内 → `onActivated` 消费 pendingAnchor（Recommended.vue 已有 onActivated 先例）。
- **渲染**：页面维护 `displayItems = 交织(illusts, rows)`；`<list>` waterfall 中为行渲染 `full-span` list-item（横向 `<scroll-view scroll-orientation="horizontal"`？不行——list-item 内横向滚动在 lynx 原生 list waterfall 下受限，**实现时若横滑容器不可行，降级为固定两行网格条（2 行 × N 列，超出截断）**，spec 允许此实现自由度，但必须 full-span 且高度固定）；行内点击 `openDetail` 不记锚点。
- **设置**：`settingsStore.ts` 新增 `_relatedInjection` ref + `relatedInjection`/`setRelatedInjection`（storage key `related_injection`，沿用 idbSet 范式 + per-user key）；UI 放 `Me.vue` 内容开关区（R18 行同款 switch 行）。

## 6. 测试要求（IO 边界 + oracle）

- `loadRelated` 双端单测：成功路径（真实响应形状 `PixivIllustListResponse`）+ 失败路径（网络错误 / 畸形响应）。
- 注入状态机单测：上限、去重（同锚点/主列表重复 id 排除）、过滤链、清空时机、开关关闭隐藏、pendingAnchor 一次性消费。
- webview `RelatedStripRow` 组件测试 + lynx IllustList 模板测试补交织渲染断言。
- oracle 来源：接口响应形状取自 `api/types.ts` 既有类型与真实 endpoint 契约（与 recommended 同构），不手写自洽 mock。

## 7. 扩展路径（非本期）

- 小说注入（Phase 2）：主标签搜索降级 or 砍掉，另行拍板。
- 其他 feed（搜索/收藏页/用户作品）：webview 侧 `FeedList` 交织模式可平移；lynx 侧同理。
- 注入行内「查看全部」→ 搜索页带词跳转（related 词组合）。
