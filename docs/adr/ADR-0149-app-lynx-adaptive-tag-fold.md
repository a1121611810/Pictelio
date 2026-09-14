# ADR-0149: app-lynx 列表标签采用「测量驱动自适应折叠」（adaptive tag fold）

- 状态：accepted
- 日期：2026-09-10
- 关联：ADR-0118（标签胶囊行首版，固定 3+N）、ADR-0133（标签点击 → 全局搜索，推翻「纯展示不可点」前提）、ADR-0107（SelectorQuery 漏 XElement 教训）、ADR-0123 / ADR-0147（list-item 内 absolute 与 hit-testing 平台约束）、packages/app/src/components/home/AdaptiveTags.tsx（webview 对照实现）
- 来源：用户要求把 app-lynx 列表标签对齐 webview AdaptiveTags 效果；先做 throwaway spike 双端验证可行性，结论为「可行」，本 ADR 固化该决策。
- 术语：见 packages/app-lynx/CONTEXT.md「标签胶囊行」「标签自适应折叠」（本文档只记录决策）。

## 背景

webview 首页卡片（AdaptiveTags.tsx + adaptiveTagFit.ts）的标签效果是：**单行**、按容器宽实测后装多少算多少、剩余宽再塞一个**省略号截断 chip**、其余折叠为「+N」。app-lynx 现状是硬 slice(0, 3)（NovelList.vue）或固定 3+N（TagChipRow.vue），**没有任何一处按宽度自适应**。

难点在于 Lynx 没有 offsetWidth / ResizeObserver / canvas.measureText，且 **list-item 内禁止 absolute**（真机高度测量会把 absolute 子元素算进内容高度，见 ADR-0123/0147），webview 的「隐藏测量层」结构无法照搬。

## spike 结论（原始证据）

throwaway spike（src/prototype/AdaptiveTagSpike.vue）在 **web-core**（__web_preview）与**真机**（emulator-5556，LynxActivity，lynx 4.0.1）双端验证：

| 问题 | 结论 |
|------|------|
| createSelectorQuery().select('#id') + invoke({method:'boundingClientRect'}) | **双端可用**，返回真实逐元素宽度（真机 #R-18 w=46.33、#性别转换 w=67.67、#异世界转生 w=79） |
| 正确调用形态 | **必须链式 .select(id).invoke(...).exec()**。web-core 的 SelectorQuery.commitTask 会 _taskQueue.slice() 出新对象并把 task 推到新对象，先存 const q 再 q.exec() 执行的是**空队列**（静默无回调） |
| selectAll(...).invoke(...) 批量测量 | **双端均不支持**，回调 {code:5, data:"selectAll not supported for invoke method"} |
| 自适应折叠结果 | 真机 container=330 → fit={"visible":5,"remaining":5}（5 chip + 「+5」）；container=350 → visible:5, remaining:4, partialWidth:31.33 |
| 省略号截断 | **真机渲染**（#…）。web-core 会剥离 max-line（Unsupported property "max-line" was removed during template encode）→ 省略号**只能在真机验证** |
| 截断 chip 的 CSS | **仅 max-line:1 不够**：真机实测截断 chip 会竖排换行（文字逐字堆叠）。必须同时 white-space:nowrap + text-overflow:ellipsis（正式实现已采纳） |
| 容器宽实测口径 | 正式组件行 `w-full` 在真机测到 287.33px（卡片内容宽），逐 chip 宽度为自然宽（46.3 / 67.7 / 45 …）——测量不发生挤压 |
| 测量时序 | 首帧 onMounted + nextTick 可能读到 container=0（布局未完成），需重试到 width > 0 |

## 决策

1. **采用测量驱动的自适应折叠**：对齐 webview AdaptiveTags 的**行为**（装多少算多少 + 省略号 + 「+N」），视觉沿用 M3 令牌（不复刻 Fluent 配色，遵守 app-lynx 设计系统约束）。
2. **测量用逐元素 select + 链式 exec()**：一次 exec() 提交 N 个 select().invoke()（N = 标签数，量级 ≤ 10）。**禁止** selectAll().invoke()。
3. **不引入隐藏测量层**：在行内渲染全部 chip（overflow-hidden 先裁），量完再按结果重渲染为「可见 chip +（可选）截断 chip +（可选）+N」；避免 list-item 内 absolute。
4. **降级显式可见**：createSelectorQuery 缺失 / 回调超时 / 重试若干帧后容器宽仍为 0 → 回落**固定上限**（3 个完整 chip，无省略号）+ console.warn；禁止静默降级。
5. **交互语义**：chip 点击 → 全局搜索弹层（原始 tag.name，ADR-0133），@tap.stop 防冒泡；「+N」与截断 chip → 进作品详情（对齐 webview onOverflowClick）。
6. **纯算法修正一处**：贪心条件用 used + gap + w + gap + plusWidth <= width（webview 版漏算「最后一个 chip 与 +N 之间的 gap」，会多放一个导致溢出）。
7. **同步修订术语**：packages/app-lynx/CONTEXT.md 删除「纯展示不可点」与 _Avoid_ 省略号截断（理由随 ADR-0133 失效），新增「标签自适应折叠」词条。

## 被考虑的方案

- **纯 CSS 近似（固定可见数 k + 末位收缩 + 「+N」）**：无需测量、双端确定，但做不到「装多少算多少」。不采纳为主方案；保留为降级候选。
- **selectAll 批量测量**：双端不支持（code 5）。否决。
- **隐藏 absolute 测量层（照搬 webview）**：list-item 内 absolute 被真机高度测量算入内容高度。否决。
- **JS 估算文本宽度（字符宽度表）**：跨平台字体度量不稳，易错位/溢出。否决。

## 后果

**正面**：列表标签对齐 webview 观感；「装多少算多少 + 省略号 + +N」在 app-lynx 落地。

**负面 / 风险**：
- 测量是**跨线程异步**的，需 ready 门控 + 重试；首帧可能有极短占位。
- **既有 bug（已闭环）**：GlassCard.vue 的 SelectorQuery 写法（先存 q 再 q.exec()）在 web-core 下静默失效，导致 /me 账户卡「液态弹性」触摸反馈不触发；已由后续 commit be1865c4 修正为链式 exec（并修正 rspeedy-env.d.ts 的 invoke 返回类型 + 补源级守卫）。原「记录为待办」已了结。
- 省略号依赖 max-line，web-core 预览不可验证，回归须在真机。

## 验收

- [x] spike 双端验证测量可用（web-core + emulator-5556 真机）
- [x] 真机自适应折叠 + 「+N」渲染（fit={"visible":5,"remaining":5}）
- [x] 真机省略号截断渲染（partialWidth=31.33 → #…）
- [x] 正式实现接入 NovelList：真机渲染「4 个完整 chip + 截断 chip（#…）+ 「+5」」（容器实测 287.33px，fit visible=4 / remaining=5 / partialWidth=30.67）
- [x] 真机点击：chip → tag-tap（R-18）；「+N」→ overflow-tap（均经 @tap.stop）
- [x] 单测 916 全绿 + tsc 通过

## 相关文档

- ~~packages/app-lynx/src/prototype/~~（throwaway spike，双端验证完成后已删除；证据见本文 spike 结论表与真机截图）
- packages/app/src/components/home/AdaptiveTags.tsx、packages/app/src/components/home/adaptiveTagFit.ts（webview 对照）
- docs/specs/app-lynx-adaptive-list-tags.md（后续 spec）
