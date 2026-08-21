# ADR-0104：app-lynx 分页收敛——rewriteUrl 原生归一化 + 全列表页迁移到 createMixFeed

真机上（LynxView）插画推荐/关注滚动到底触发分页时返回 HTTP 404。根因：原生模式把 Pixiv 响应的**绝对 next_url 原样**传给 `PictelioApiModule.request`，Java 侧无条件拼 `apiBase()` 产生双域名 URL（`apiBase + 绝对URL`）→ Pixiv 404。这是 ADR-0081 已修复 app 端、并明确标注「app-lynx 待其分页功能落地时一并处理」的遗留缺口。同时，5 个列表页（IllustList / NovelList / Following / UserHome / Bookmarks）各自手写 loadMore（双防抖、竞态代、空页防护、错误处理），与已存在的深模块 `createMixFeed`（Recommended 页在用）重复；分页失败通过 `errorMsg` 显示在**列表顶部**（ADR-0082「分页失败保留内容 + 底部内联」教训未吸收）。

## 决策

1. **rewriteUrl 原生归一化（client.ts）**：`rewriteUrl` 原生分支改为——绝对 Pixiv URL（`PIXIV_API_BASE` 精确前缀）剥离域名成相对路径（含 query）；相对路径原样透传；非 Pixiv 绝对 URL 原样（防御性兜底）。`execute` / `requestRaw` 的原生分支改传 `rewriteUrl(path)`，不再裸传原始 path。一处修复覆盖全部分页端点（插画/小说/关注/收藏/用户作品/关注列表/评论）。
2. **分页收敛到 createMixFeed**：5 个手写列表页迁移到 `createMixFeed`（单源或多源）；mode/tab 切换（推荐↔关注、插画↔小说）通过**重建 feed 实例**实现（generation 机制丢弃在途旧响应，不新增接口）。页面退化为 ref 快照 + `sync()` 桥接（Recommended 已验证模式）。
3. **错误槽分流 + 到底态**：`createMixFeed` 内部拆 `firstError` / `pageError` 两槽，接口新增 `pageError()`（`error()` 保持首屏语义）；翻页成功只清 `pageError`。列表页 footer 三态：加载中… / 没有更多了（`nextUrl` null 且列表非空）/ 分页失败（底部内联，保留内容，滚动自动重试——不加重试按钮，现有冷却已防死循环）。

## Considered Options

- **就地手写错误分流**（每页 5~10 行）：快，但把 createMixFeed 已吸收的逻辑再手写 5 遍，重复继续扩散，本次改动写 5 遍——拒绝。
- **新建 usePagination composable**：抽象面需覆盖 6 页差异（pending 队列、混合 feed），接口变浅——拒绝。

## Consequences

- `FollowList`（关注/粉丝列表）与评论分页本次**不迁移、不接入** pageError（根因已修，无 404；错误呈现后续按同一模式补）。
- `Recommended` 页（已用 createMixFeed）同步接入 pageError / footer 到底态。
- 迁移是重构：各页骨架、空态、切 tab、KeepAlive 行为保持不变，由 `createMixFeed.test.ts` 扩展用例 + 页面类型检查 + 真机回归兜底。
- 受限卡等高（ADR-0105）与本决策相互独立，可并行实施。
