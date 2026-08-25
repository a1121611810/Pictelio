# ADR-0112: app-lynx 收藏/取消收藏动效（M3 state-layer 环 + spring 弹心）

- 状态：accepted
- 日期：2026-08-25
- 关联：ADR-0108（Lynx 原生 keyframes/transform 引擎平台事实，本 ADR 直接复用）、ADR-0111（无 animationend/transitionend）、ADR-0107（决策 4：同 tick epoch 重建 workaround）、ADR-0110（重建 = 回顶）、`packages/app-lynx/CONTEXT.md`（收藏动效 / bookmark animation）、`docs/specs/app-lynx-bookmark-animation.md`
- 来源：grill-with-docs 会话 + UI 原型实拍选型（5 变体，`prototype/bookmark-anim` 分支留证，用户选定变体 E）

## 背景

`BookmarkButton` 切换收藏仅颜色瞬切且等待 API 成功（悲观），无即时反馈，不符合 app-lynx 的 M3 动效基线。需求：**收藏与取消收藏都要有动效，且必须符合 Material Design 3**。

**平台事实（既有 ADR 实证，本决策零新平台风险）：**

1. CSS keyframes + transform 双端已实证（ADR-0108：Lynx 原生 SDK 字节码含 LynxKeyframeAnimator + TransformProps；web-core 浏览器原生）。
2. 无 animationend/transitionend 事件（ADR-0111）——特效节点清理与事件延迟只能靠 `setTimeout`。
3. 裸 `<list>` 数据变更触发 vue-lynx patch `RemoveNode got wrong child index`（ADR-0107 决策 4）——workaround = 同 tick epoch 整树重建，且重建 = 滚动回顶（ADR-0110 正是利用此机制实现回顶）。
4. Lynx 无 `prefers-reduced-motion` 媒体查询支持。
5. scoped `<style>` keyframes 为未验证面——动画样式放全局 `<style>`，类名全仓唯一（RefreshableList 约定）。
6. text 元素 transform 支持性弱——transform 承载用包裹 view（ADR-0108 决策 2）。

## 决策

1. **动效形态 = 原型变体 E（M3 规范版）**：state-layer 环 + 主心 Expressive spring 弹心。收藏 = 环 emphasized-decelerate 扩散（350ms）+ 主心 pop（scale 0.75→1.18→0.97→1，300ms）填红；取消 = 环 emphasized-accelerate 收拢（250ms）+ 主心 standard 下沉回稳（scale 1→0.88→1，200ms）褪灰。环是 M3 icon button state-layer ripple 语义的规范内延伸；overshoot 弹心属 M3 Expressive spring 体系（用户拍板口径 2）。
2. **令牌合规**：缓动/时长一律引用 `tokens.css` 变量（`--motion-emphasized-decelerate` / `--motion-emphasized-accelerate` / `--motion-standard` / `--durationGentle` / `--durationNormal`），禁止 bezier/ms 字面量（原型字面量仅是 web-core 预览不解析 var() 的临时措施；生产 var() 原生解析已验证）。
3. **乐观触发**：tap 即播动效 + 翻转 `bookmarked`/`count` + 发 API；失败静息回滚（**不播**反向动画）+ `errorMsg`（既有错误槽）。`busy` 锁保留防连点并发。对齐主 app `followListStore` optimistic toggle 先例。否决悲观（等 API 再播）：网络延迟 300ms~2s 会废掉即时反馈这一 delight 动效的核心价值。
4. **change 事件延迟到动画播完后上抛**（350ms，取双向最长动画）：语义 = 动画完成态。唯一消费方 Bookmarks.vue 零改动接线；取消动画不被「立即移除」截断。
5. **收藏页移除 = 动画后隐藏集过滤 + 同 tick `refreshEpoch++` 整树重建**（决策 4 时序 + 决策 3 平台事实的既有 workaround 复用），消除单项移除的 patch 错位空位。**用户已确认接受滚动回顶代价**；否决网络 refresh（已加载页数坍缩 + 清空闪烁 + 每 toggle 一次请求）；否决「会话内不移除」（用户要求该项真正消失）。
6. **不做 reduced-motion 适配**（平台事实 4，沿用 fab-spin spec 先例）。
7. **验收 = 单测（结构 + 行为断言，oracle = 本 ADR/spec 决策表 + tokens.css 令牌）+ 模拟器实测**（动画连拍 / 空位消除 / 失败回滚 / logcat 无 RemoveNode）。

## 被考虑的方案

原型 5 变体实拍对比（`prototype/bookmark-anim` 分支）：

- **A 粒子爆发**（对齐主 app HeartBurstEffect）：M3 组件规范无粒子模式，属品牌表达层；Lynx 需 12 条固定方向 keyframes（keyframes 内 var() 未验证），维护成本最高。否决。
- **B 纯弹跳**：规范内但取消侧语义弱（无「收回」表达），情绪反馈单一。否决。
- **C 纯波纹环**：M3 最原生但收藏高情绪点反馈偏弱。否决（其环语义被 E 吸收）。
- **D 浮心飘出**：同 A，规范无锚点。否决。
- **网络刷新列表**（用户提出后经评估否决）：`createMixFeed.loadFirstPage()` 同步清空渲染流 → 页数坍缩 + 加载闪烁 + 每 toggle 一请求；保留其「动画后真正消失」内核，用本地 epoch 重建低成本达成（决策 5）。

## 后果

- 正面：双向即时反馈且全链路 M3 令牌合规；零新依赖/新原生面/新 bridge；平台风险全部由既有 ADR 实证覆盖；6 处 BookmarkButton 消费点（Recommended/Bookmarks/Following/IllustList/UserHome/IllustDetail）自动获得动画，仅 Bookmarks 页 +1 行接线。
- 负面：Bookmarks 页取消收藏后列表回顶（用户已接受）；乐观化引入失败回滚路径（由单测覆盖）；`setTimeout(350)` 承担节点清理 + change 延迟双重职责（仅清理/延迟，不驱动帧，沿用 fab-spin 红线精神）。
- 待验证项（T3 模拟器闭环）：
  - 环扩散/收拢 + spring pop 在原生 LynxView 实际帧动画（机制同 ADR-0108 已验证面，行为待确认）；
  - 取消收藏后 epoch 重建空位消除、logcat 无 RemoveNode；
  - 若动画异常 → 停下回报，不静默绕路（spec 红线 6）。
