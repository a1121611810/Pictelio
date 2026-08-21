# ADR-0105：受限小说卡等高——RestrictedNovelCard 组件 + 全站统一固定高度

真机（LynxView）上小说列表（NovelList / Bookmarks / UserHome 三处同款 markup）的受限条目卡高度靠内容 auto 撑，在 list-item 高度测量下塌陷，「受浏览限制，不予显示」文案被裁。全仓其他受限展示位（插画图区 `h-[48.4vw]`、详情页 overlay `w/h:100%`）均为显式高度，唯独小说卡依赖 auto-height（实测不可靠）。

## 决策

新增 `RestrictedNovelCard` 组件：接口仅 `{ item: PixivNovel }`（内部派生 level：`x_restrict === 2 ? 2 : 1`，调用方不再重复该三元表达式）；scrim 底 + R-18 / R-18G 徽章 + 文案 + **显式固定高度** + 内容居中 + `@tap.stop` 不跳详情。高度取**全站统一常量**（初始约 `40vw`，真机截图与普通卡比对后微调，收敛在组件内一处）。三处（NovelList / Bookmarks / UserHome）替换为 `<RestrictedNovelCard :item="item" />`。

## Considered Options

- **逐页对齐各自普通卡高度**（height prop）：三处普通卡高度不同（NovelList 带标签行最高 / Bookmarks 居中 / UserHome 最矮）且本身浮动（标题 1~2 行、标签 1~2 行），接口变宽且仍无法精确对齐——拒绝。
- **内容撑高 + min-height**：真机 auto-height 测量已证不可靠——拒绝。

## Consequences

- 受限卡在 UserHome（普通卡较矮）视觉偏高、在 NovelList（带标签行）略矮，属可接受的近似对齐——受限卡为深色占位，规格跨页统一优先于逐页精确对齐。
- 高度校准只改组件内一处（locality）；后续若引入统一小说卡外壳可再对齐。
- 与 ADR-0104（分页收敛）相互独立，可并行实施。
