# ADR 0087: fluent-dialog 必须经 fluent-dialog-body 投影（slot 契约）

## 状态

已采纳（grill 阶段源码取证确认）

## 分类

技术决策 / Bug 修复 / 组件契约

## 日期

2026-08-05

## 背景

设置页"切换渲染引擎"确认弹窗（`SettingsDialogs.tsx` 的 `switchClient`）渲染异常：弹窗被拉成全宽横条、无遮罩、无圆角、标题/正文丢失、按钮不可见且无法交互（四类症状并发）。同一 `FluentDialog` 组件在 `SettingsImage`、`SettingsTranslate`、`NovelDetail`、`AgeGate`、`SettingsDialogs`（clear/deleteAccount/switchClient）等 6+ 处复用。

### 根因链

| 层 | 行为 | 证据 |
|---|---|---|
| `@fluentui/web-components@3.0.2` `<fluent-dialog>` template | shadow 内只有 `<dialog>` + **一个无名 `<slot>`**，**没有任何命名 slot** | `dist/esm/dialog/dialog.template.html` |
| `<fluent-dialog-body>` template | 才有命名 slot：`title` / `title-action` / `close` / **`action`（单数）**，正文走 dialog-body 的**无名默认 slot**（`.content`） | `dist/esm/dialog-body/dialog-body.template.html` |
| app 侧用法 | ① 不用 `<fluent-dialog-body>` 包裹；② 标题 `<h3 slot="title">` 直接挂 dialog（dialog 无 title slot → 不投影）；③ 按钮 `slot="actions"`（复数，**该 slot 不存在** → 按钮不投影）；④ `SettingsImage` 用 `slot="content"`（**该 slot 不存在** → 正文不投影） | `SettingsDialogs.tsx`、`SettingsImage.tsx`、`SettingsTranslate.tsx` |

> 即：app 当前用的是 fluent **v2 / 其他组件库**的 slot 契约（`content` + `actions` 复数 + 无需 body 包裹），与 v3.0.2 真实 template **完全对不上**。标题/正文/按钮的投影目标 slot 全部不存在，内容只能掉进 dialog 的默认 slot 成为裸子节点，拿不到 dialog-body 的定位/布局样式——这是"全宽横条 + 无遮罩 + 内容丢失 + 按钮缺失"四类症状的共同根因。

### 关于"动态创建不触发 showModal"

`StartupUpdateDialog.tsx` 注释记录"`<fluent-dialog>` 在动态创建时 open 属性不触发内部 showModal，且 slot 系统会导致按钮不可见"。核查 v3 源码后：**`show()`/`hide()` 实现健全**（modal 类型调 `this.dialog.showModal()`，`hide()` 调 `dialog.close()`，见 `dist/esm/dialog/dialog.js` L105-133），`FluentDialog.tsx` 的 ref + `createEffect` 调用路径正确。该注释所述症状更可能是当年 **slot 契约错乱 + 组件注册时机** 的复合表象，而非独立的动态 show bug。本决策采纳后需以真机验证复核此结论。

## 决策

### 1. fluent-dialog 内容必须包在 fluent-dialog-body 中

```tsx
<fluent-dialog>
  <fluent-dialog-body>
    <h3 slot="title">标题</h3>
    <p>正文（无 slot 属性 → 进 body 默认 slot = .content）</p>
    <fluent-button slot="action" appearance="secondary">取消</fluent-button>
    <fluent-button slot="action" appearance="primary">确认</fluent-button>
  </fluent-dialog-body>
</fluent-dialog>
```

### 2. slot 名契约为 `title` / 默认（正文）/ `action`（单数）

- 标题 → `slot="title"`
- 正文 → **不写 slot**（进 dialog-body 默认 slot，即 `.content`）
- 按钮 → `slot="action"`（**单数**）
- _Avoid_ 禁止 `slot="content"`（不存在）、`slot="actions"`（复数，不存在）、缺 `<fluent-dialog-body>` 包裹。

### 3. 统一在 FluentDialog 封装内保证结构

将 `<fluent-dialog-body>` 包裹收敛进 `FluentDialog.tsx` 封装（或提供 title/actions props），调用方只传标题/正文/按钮，不直接写 slot——避免每个调用点各自记忆契约、再次用错。

### 4. 保留 FluentDialog 的 open → show()/hide() 转换

`FluentDialog.tsx` 现有 ref + `createEffect` 把 `open` prop 转成 `show()/hide()` 调用的机制保留不变（该路径正确）。

## 验证

- 对照验证（grill 阶段采纳）：对比 `SettingsImage`（`slot="content"`）与 `switchClient`（裸 `<p>` + `slot="actions"`）——但源码 template 取证已先一步给出决定性结论：两种写法的 slot 均不存在，均不投影。
- 修复后需真机/浏览器复核：弹窗居中圆角、有遮罩、标题/正文/取消/确认四要素齐全、按钮可点击、确认后正常切换。

## 风险与反面

- **v3 动态 show 坑已定位并修复**：`StartupUpdateDialog` 注释所述"动态创建不触发 showModal"的真实根因是——自定义元素升级后其 shadow template 渲染仍异步，元素刚挂载时 `show()` 内 `this.dialog`（f-ref）未绑定，调用静默失败（与 slot 无关）。已在 `FluentDialog` 封装内修复：`showWhenReady` 用 rAF 轮询等内部 `<dialog>` 就绪再 show（120 帧上限 + `disposed` 卸载防护 + 超时 `console.warn`），并就绪帧再判 `props.open` 消除"open true→false 快速翻转被晚到就绪帧重新弹开"的竞态。真实浏览器（CDP headless Chrome）验证：恒 open=true、dialogType 变化、open 快速翻转三场景均正确。**注**：该时序在 happy-dom 下无法复现（happy-dom 的 `<dialog>`/rAF/signal 批处理为同步或 mock 实现，rafCount=0、inner 同步就绪），相关竞态用例在 happy-dom seam 上给出假阴性，故竞态验证以真实浏览器为准，未沉淀为单测。若未来发现新异常，备选退路仍是纯 CSS fixed 覆盖层（`StartupUpdateDialog` 模式）。
- **多调用点回归面**：`FluentDialog` 6+ 处复用，统一改封装后需逐一回归（clear / deleteAccount / switchClient / ugoira / R18 / R18G / NovelDetail / AgeGate / ImageHostSettings 的裸 `<fluent-dialog>`）。

## 相关

- 术语：`CONTEXT.md` → 对话框（Dialog）小节（fluent-dialog slot 契约）
- 备选退路：`StartupUpdateDialog.tsx` L25-106（纯 CSS fixed 覆盖层模式）
- `types/fluent.d.ts`（`fluent-dialog` / `fluent-dialog-body` 类型声明）
