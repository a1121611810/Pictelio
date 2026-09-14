# app-lynx 列表标签自适应折叠（AdaptiveTags parity）

- 状态：ready-for-agent
- 关联：ADR-0149、ADR-0133、ADR-0118
- 来源：/grill-with-docs + /prototype 双端 spike（见 ADR-0149）

## Problem Statement

app-lynx 小说列表卡片的标签是硬截断：永远只显示前 3 个（NovelList.vue 中 tags.slice(0, 3)），第 4 个起无声消失。用户既不知道「还有多少标签」，也无法点标签去搜索。webview 客户端的首页卡片（AdaptiveTags）能做到「按容器宽度装多少算多少 + 省略号 + +N + 可点搜索」，两端信息量与观感差距明显。

## Solution

把 app-lynx 列表卡片的标签行改为测量驱动的自适应折叠：单行内按实测容器宽度尽可能多放完整标签；放不下时右侧固定预留「+N」计数；若还有剩余宽度，再放一个省略号截断的标签；标签可点直达全局搜索，「+N」与截断标签点进作品详情。视觉沿用 M3 令牌。

## User Stories

1. As a 小说读者, I want 列表卡片上尽可能多看到标签, so that 我能快速判断这本小说是否合我口味。
2. As a 小说读者, I want 标签超出容量时看到「+N」而不是无声消失, so that 我知道还有更多标签。
3. As a 小说读者, I want 过长标签用省略号收尾而不是撑爆卡片, so that 卡片布局始终整齐。
4. As a 小说读者, I want 点击标签直接搜这个标签, so that 我能发现同类作品。
5. As a 小说读者, I want 点击「+N」或截断标签进入详情看全部标签, so that 我不会卡在列表页。
6. As a 小说读者, I want 窄屏下标签不换行、不横向溢出, so that 卡片看起来干净。
7. As a 小说读者, I want 列表项重新挂载后标签按当前宽度重新排布, so that 滚动复用/重进页面后仍正确。
8. As a 小说读者, I want 测量失败时仍能看到部分标签（而非空白或错乱）, so that 功能降级但不崩。
9. As a 小说读者, I want 只有 1 个短标签时不显示无意义的「+N」, so that 界面不啰嗦。
10. As a 开发者, I want 折叠算法是纯函数且有单测, so that 边界可回归。
11. As a 开发者, I want 测量逻辑收敛在一个原语里, so that 其它列表页可复用。
12. As a 开发者, I want 测量不可用时显式 warn 而非静默降级, so that 契约破坏可见。
13. As a 无网络/首次渲染用户, I want 首帧不出现明显跳动, so that 加载体验稳定。
14. As a 开发者, I want 标签点击不冒泡到卡片进详情, so that 点标签只搜标签。

## Implementation Decisions

- 不改 webview（packages/app）。
- **纯算法模块**（标签折叠算法）：与 packages/app/src/components/home/adaptiveTagFit.ts 同语义；修正一处 gap 漏算（贪心条件需计入「最后一个 chip 与 +N 之间的 gap」）。输入 chipWidths[] / plusWidth / containerWidth（+ gap / minPartial），输出 { visible, remaining, partialWidth }。
- **测量原语**：包装 lynx.createSelectorQuery()，**逐元素 select('#id').invoke({ method: 'boundingClientRect' }) 后链式 exec()**（一次 exec 提交全部）。**禁止** selectAll().invoke()（双端 code 5）。测量入口可注入假 query 以便单测 IO 边界（参照 utils/viewportSizeBridge.ts 的注入模式）。
- **测量原语的错误策略**：仅对「无 createSelectorQuery / 回调超时 / 矩形缺失」降级并 console.warn；query 工厂自身抛错视为编程错误，直接向上 reject，不吞掉（失败路径显式可见，锚测试硬约束 #3）。
- **列表标签组件**：单行；先渲染全部 chip（overflow-hidden 裁切）→ 测量 → 按结果渲染「可见 chip +（可选）截断 chip +（可选）+N」。**禁止** list-item 内 absolute 隐藏测量层。
- **门控与重试**：mounted + nextTick 后测量；容器宽为 0 时重试若干帧；超时/不可用 → 回落固定上限（3 个完整 chip，无省略号）+ console.warn。
- **交互**：chip → 全局搜索弹层（原始 tag.name，ADR-0133），@tap.stop；「+N」/截断 chip → 进作品详情。
- **视觉**：M3 令牌；chip 形态与 TagChipRow 统一（bg-secondary-container / text-label-medium / md-shape-small）；「+N」用 primary 底区分计数。
- **范围**：先接 NovelList.vue（小说推荐 / 关注列表）。TagChipRow（轮播）、IllustDetail 标签行不动。Bookmarks / UserHome 小说卡本次不加标签。
- **文档**：CONTEXT.md「标签自适应折叠」+ ADR-0149 已落地。

## Testing Decisions

- 好的测试只测外部行为：纯函数输入 (widths, plus, container) → 输出 (visible, remaining, partialWidth)；原语输入假 query 的响应 → 输出宽度表 / 降级标记。
- **纯折叠函数单测**覆盖：全装得下（无 +N）/ 恰好溢出 / 预留 +N 后贪心 / 剩余宽不足而放弃截断 chip / 单个标签超宽 / 容器 0 / 空数组 / gap 计入。
- **测量原语 IO 边界单测**（AGENTS.md 测试硬约束 #1）：正常回调 / 无 createSelectorQuery / 回调超时 / 宽度 0 / query 抛错 —— 全部走注入的假 query，成功与降级路径都断言（并断言 warn 被调用，锚「禁止静默降级」）。
- **组件模板结构断言**（已落地 src/components/AdaptiveTagRow.template.test.ts，源级守卫，锚 ADR-0097 防线）：测量元素 id 前缀、maxWidth 写入、+N 门控、降级常量 + warn、单行 overflow-hidden、可点元素为 <view> 且 @tap.stop、负向断言禁 selectAll / 禁 absolute / 禁 flex-wrap、重试递归不得重置预算。
- **真机回归**：benchNav novel 直达 /novels，截图确认「N 个 chip + +N（+ 省略号）」。
- oracle 溯源：期望值来自 ADR-0149 的 spike 实测与 webview 对照实现，不从被测实现反推。

## Out of Scope

- 不改 webview。
- 不改轮播 TagChipRow 的固定 3+N。
- 不改 IllustDetail 标签行（已可点、可换行全量）。
- 不给 Bookmarks / UserHome 小说卡新增标签。
- 不修 GlassCard.vue 的 SelectorQuery 既有 bug（建议另开 issue）。
- 不做「点击标签展开全部」的内联展开（+N 走详情）。
- **不做旋转/横竖屏重排**：LynxActivity 声明了 configChanges（orientation|screenSize…）→ 旋转不重建 Activity；app-lynx 无 viewport-resize 推送通道（PictelioApp.getViewportSize 为一次性查询，ADR-0131），且 vue-lynx 不回收 list cell。故旋转后容器变宽不会触发重算——列为后续平台能力任务（US7 已收窄为「重新挂载即重算」）。
- **不修 webview 的 adaptiveTagFit 末位 gap 漏算**：本次只改 app-lynx；两端在该边界**有意分叉**（ADR-0149 决策 6），不做差分等价测试。

## Further Notes

- 省略号依赖 max-line，web-core 预览会剥离该属性 → 省略号只能在真机验证（ADR-0149）。
- throwaway spike 与 web 预览入口在实现落地后删除：src/prototype/、lynx.config.ts 的 adaptive-tag-{a,b,r} 入口。
- 既有 bug：GlassCard.vue:50-73 的 SelectorQuery 写法在 web-core 静默失效（ADR-0149 后果节）。
