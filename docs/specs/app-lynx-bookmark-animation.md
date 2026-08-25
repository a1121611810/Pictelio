# app-lynx 收藏/取消收藏动效 —— 功能规格

> 来源：grill-with-docs 会话 + UI 原型实拍选型（5 变体，`prototype/bookmark-anim` 分支留证）；决策记录：ADR-0112；术语：`packages/app-lynx/CONTEXT.md`
> 状态：ready-for-agent

## Problem Statement

`BookmarkButton` 切换收藏仅有颜色瞬切，且状态翻转等待 API 成功（悲观）——既无「操作被接收」的即时反馈，也不符合 app-lynx 的 Material Design 3 动效基线。收藏与取消收藏都需要符合 M3 的动效。

## Decisions（Grill 结论 → ADR-0112 映射）

| # | 决策 | 结论 |
|---|------|------|
| D1 | 动效形态 | 原型变体 E（M3 规范版）：**state-layer 环**（扩散/收拢）+ **主心 Expressive spring 弹心**。否决：A 粒子爆发 / B 纯弹跳 / C 纯波纹 / D 浮心（A/D 无 M3 规范锚点，B/C 情绪反馈不足或语义单一） |
| D2 | 双向语义 | 收藏 = 环 emphasized-decelerate 扩散（350ms）+ 主心 spring pop（0.75→1.18→0.97→1，300ms）填红；取消 = 环 emphasized-accelerate 收拢（250ms）+ 主心 standard 下沉回稳（1→0.88→1，200ms）褪灰 |
| D3 | 令牌合规 | 缓动/时长**必须**用 `tokens.css` 变量：`--motion-emphasized-decelerate` / `--motion-emphasized-accelerate` / `--motion-standard` / `--durationGentle`（300ms）/ `--durationNormal`（200ms）。原型中的字面量仅是 web-core 预览不解析 var() 的临时措施 |
| D4 | 触发时机 | **乐观**：tap 即播动效 + 翻转 bookmarked/count + 发 API；失败静息回滚（不播反向动画）+ `errorMsg` 提示。`busy` 锁保留（防连点并发提交）。对齐主 app `followListStore` optimistic toggle 先例 |
| D5 | change 事件 | 延迟到**动画播完后**（`BOOKMARK_ANIMATION_MS = 350`，取双向最长动画）上抛。语义 = 「动画完成态」；唯一消费方 Bookmarks.vue 零改动接线 |
| D6 | 收藏页移除 | Bookmarks.vue `onBookmarkChange` 收到取消后：`removedIllustIds.add()` + **同 tick `refreshEpoch++`** 整树重建（ADR-0107 决策 4 既有 workaround），消除单项移除的 patch 索引错位空位。**已确认接受滚动回顶代价**；不走网络刷新（页数坍缩 + 闪烁 + 每 toggle 一请求，已否决） |
| D7 | reduced-motion | 不做（Lynx 无 `prefers-reduced-motion` 媒体查询，沿用本 spec 系列先例） |

## 模块接口

**props 零变化**；`change` 事件形状不变、**时序语义变化**（乐观起点 → 动画完成点）：

```vue
<BookmarkButton
  :illust-id="item.id"
  :initial-bookmarked="item.is_bookmarked"
  :bookmark-count="item.total_bookmarks"
  @change="(bm) => onBookmarkChange(item, bm)"  <!-- 动画播完后才触发 -->
/>
```

## 实现要点

### BookmarkButton.vue（动画 + 乐观化改造）

- `toggle()`：tap → `busy` guard → 立即翻转 `bookmarked`/`count` + `animSeq++`（`:key` 重挂载重播主心 pop）+ 推入 ring 节点（`v-for` rings）→ 发 API → **350ms 后**清 ring 节点 + `emit('change')`；`catch` → 静息回滚 `bookmarked`/`count` + `errorMsg`（既有错误槽），`finally` 释放 `busy`
- 环节点清理与 change 延迟用**同一个** `setTimeout(350)`（无 animationend/transitionend，ADR-0111 平台事实；仅做节点清理与事件延迟，**不驱动动画帧**）
- 环：主心下层 absolute 居中 `view`，`rounded-full border-2`，收藏 `border-error` / 取消 `border-outline`
- transform 承载用 `view` 不用 `text`（ADR-0108 决策 2）

```css
/* 全局 <style>（scoped keyframes 未验证面，同 RefreshableList 约定）；类名全仓唯一 */
/* 主心 spring pop（M3 Expressive spring 近似） */
@keyframes bookmark-pop-add {
  0% { transform: scale(0.75); }
  55% { transform: scale(1.18); }
  80% { transform: scale(0.97); }
  100% { transform: scale(1); }
}
.bookmark-pop-add { animation: bookmark-pop-add var(--durationGentle) var(--motion-emphasized-decelerate) both; }

/* 主心下沉回稳（取消） */
@keyframes bookmark-pop-remove {
  0% { transform: scale(1); }
  50% { transform: scale(0.88); }
  100% { transform: scale(1); }
}
.bookmark-pop-remove { animation: bookmark-pop-remove var(--durationNormal) var(--motion-standard) both; }

/* state-layer 环扩散（收藏，350ms）/ 收拢（取消，250ms） */
@keyframes bookmark-ring-out {
  from { opacity: 0.4; transform: scale(0.6); }
  to { opacity: 0; transform: scale(2.1); }
}
.bookmark-ring-out { animation: bookmark-ring-out 350ms var(--motion-emphasized-decelerate) both; }

@keyframes bookmark-ring-in {
  from { opacity: 0.35; transform: scale(1.8); }
  to { opacity: 0; transform: scale(0.6); }
}
.bookmark-ring-in { animation: bookmark-ring-in 250ms var(--motion-emphasized-accelerate) both; }
```

### Bookmarks.vue（仅插画 tab，一行接线）

```ts
function onBookmarkChange(item: PixivIllust, bookmarked: boolean) {
  if (!bookmarked) {
    removedIllustIds.value = new Set(removedIllustIds.value).add(item.id)
    refreshEpoch.value++ // 同 tick 整树重建消除 patch 错位空位（ADR-0107 决策 4；已接受回顶）
  }
}
```

## 状态与边界

| 场景 | 行为 |
|------|------|
| tap 收藏 | 环扩散 + 主心 pop 填红 + count+1（即时）；350ms 后上抛 change |
| tap 取消 | 环收拢 + 主心下沉回稳褪灰 + count-1（即时）；350ms 后上抛 change |
| API 失败 | 静息回滚 bookmarked/count（**不播**反向动画）+ errorMsg（既有错误槽） |
| busy 中重复 tap | guard 忽略（防并发提交，既有） |
| 动画期间组件卸载 | 节点随 DOM 移除；setTimeout 回调内 emit/清数组对已卸载组件无害（vue 忽略），记录不防护 |
| Bookmarks 页取消收藏 | 动画播完 → 隐藏集过滤 + 同 tick epoch 重建 → 空位消除，列表回顶（已接受） |
| Bookmarks 页快速连消多项 | 各自 busy 锁互不妨碍；多个 change 各 bump 一次 epoch（重建幂等，Vue 同 flush 合并） |
| count 数字变化 | 瞬时 +1/-1，无数字滚动动画（排除项） |
| web-core 预览 / 原生 LynxView | keyframes 双端已实证（ADR-0108）；生产代码用 var() 令牌（原生解析已验证，区别于原型） |

## 测试计划

**单测**（oracle 溯源：期望值来自本 spec 决策表 D1–D6、ADR-0112、`tokens.css` 令牌定义——非从实现反推）：

1. **结构断言**：BookmarkButton 含 4 条 keyframes（`bookmark-pop-add` / `bookmark-pop-remove` / `bookmark-ring-out` / `bookmark-ring-in`）且 animation 引用 `--motion-*` / `--duration*` 变量（负向：无 bezier/ms 字面量）
2. **乐观语义**（行为，mock `../api/illust`）：tap 后**不待 API resolve** 即 `bookmarked` 翻转、count ±1
3. **失败回滚**：API reject → 状态回滚 + errorMsg 出现（IO 边界失败路径覆盖，硬约束 1）
4. **change 延迟**：fake timers —— tap 后 0ms 无 emit，350ms 后 emit 一次且参数正确
5. **busy 锁**：API pending 中第二次 tap 不重复发请求
6. **Bookmarks.vue**：`onBookmarkChange` 后 `refreshEpoch` 同 tick +1（行为断言）；正向收藏（`bm=true`）不 bump

**模拟器实测**（AVD `pictelio_ui`，lynx debug）：

| # | 项 | 通过判据 |
|---|----|---------|
| V1 | 收藏动画 | 推荐页点 ♥，截图连拍（≥3 张 ~100ms 间隔）：环逐帧扩散 + 主心 overshoot |
| V2 | 取消动画 | 再点 ♥：环收拢 + 主心下沉回稳褪灰 |
| V3 | 收藏页移除 | Bookmarks 页取消一项：动画播完后该项消失、**无空位**、logcat 无 `RemoveNode got wrong child index` |
| V4 | 失败回滚 | 断网点 ♥：动画照播 → errorMsg 出现 → 心形回滚 |
| V5 | web 构建 | `pnpm dev:app-lynx` 双 bundle 无新 warning |

## 排除项（Non-goals）

- 不做粒子爆发/浮心等规范外形态（原型 A/D 已否决）
- 不做 count 数字滚动/翻转动画（瞬变）
- 不做网络刷新列表（D6 已否决）
- 不做小说收藏按钮（app-lynx 无此功能面）
- 不做 prefers-reduced-motion（D7）
- 不改动其他 5 个 BookmarkButton 消费页面（Recommended/Following/IllustList/UserHome/IllustDetail 自动获得动画，无各自接线）

## 红线

1. 缓动/时长必须引用 `tokens.css` 变量，禁止 bezier/ms 字面量（D3；负向断言守护）
2. keyframes 放全局 `<style>`，类名全仓唯一（无碰撞）
3. `setTimeout` 仅用于节点清理 + change 延迟，禁止逐帧驱动动画（沿用 fab-spin 红线精神）
4. 失败回滚静息执行，禁止播反向动画掩盖失败
5. `removedIllustIds.add()` 与 `refreshEpoch++` 必须同一 reactive flush（ADR-0107 决策 4 时序教训）
6. 模拟器实测发现动画/重建异常 → 停下回报，不静默绕路

## Tickets

| # | 内容 | 前置依赖 | 验收 |
|---|------|---------|------|
| T0 | CONTEXT.md 术语（收藏动效 / bookmark animation）+ ADR-0112 + 本 spec + 原型捕获至 `prototype/bookmark-anim` 分支并清理 main 工作区原型文件 | — | docs 提交；分支留证 |
| T1 | BookmarkButton 动画 + 乐观化改造 + 单测 1–5 | T0 | `pnpm test:app-lynx` + `check:app-lynx` 绿 |
| T2 | Bookmarks.vue epoch 重建接线 + 单测 6 | T1 | 测试绿 |
| T3 | 模拟器验证 V1–V5 + 回写 ADR-0112 待验证项 | T2 | 5 项全过；截图留证；docs 提交 |
