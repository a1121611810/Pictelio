# `<dialog>` 元素迁移可行性报告（pictelio-app 弹窗体系）

> 日期：2026-08-07
> 分析对象：HTML `<dialog>` 元素 + `HTMLDialogElement` API（MDN 官方文档 + BCD 兼容性数据）
> 目标平台：`packages/app`（SolidJS 1.9 SPA，双环境：Android Capacitor WebView + Web 浏览器）
> 现有实现：10 处手写 overlay（`fixed inset-0 z-50` 模式），无一使用 `<dialog>`

---

## 1. 结论

**核心 `<dialog>` + `showModal()` 可行，推荐迁移 7 处弹窗；3 处全屏媒体组件不适合迁移。**

两个必须绕开的坑：

1. **`closedby="any"`（点击外部自动关闭）不可用** — Android WebView 134（2025-03）才支持，项目门槛 WebView ≥ 85 覆盖不了 85~133 区间，「点击外部关闭」仍需手动实现（复杂度与现状持平）。
2. **退场动画的 `overlay` 属性方案 Firefox/Safari 至今不支持** — MDN 推荐的优雅退场方案在 Web 端需降级（退场无动画或接受直接消失）。

---

## 2. `<dialog>` 核心机制（MDN 文档摘要）

来源：[MDN `<dialog>` 元素文档](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog)

### 2.1 打开与关闭

- `showModal()`：打开 modal dialog。浏览器自动提供：
  - **Top Layer 提升**：脱离文档层叠上下文，不参与 z-index 竞争
  - **背景 inert**：页面其余部分自动不可交互、不可聚焦
  - **隐式 `aria-modal="true"` + `role="dialog"`**
  - **Esc 键关闭**：触发 `cancel` 事件（可 `preventDefault()` 拦截）
  - **Android 返回键**：自动映射为 `cancel` 事件（平台相关用户行为）
- `show()`：打开 non-modal dialog，不阻塞页面交互
- `close()` / `<form method="dialog">`：关闭并可选设置 `returnValue`

### 2.2 样式钩子

| 钩子 | 用途 |
|------|------|
| `::backdrop` 伪元素 | modal 模式的背景遮罩（替代手写 scrim div） |
| `:modal` 伪类 | 匹配以 `showModal()` 打开的 dialog |
| `:open` 伪类 | 匹配打开状态（不支持时可用 `dialog[open]` 属性选择器降级） |

### 2.3 动画（MDN 推荐方案）

`<dialog>` 隐藏时是 `display: none` + 移出 top layer，要做过渡动画必须：

- **入场**：`@starting-style` 定义打开前的起始样式 + `transition-behavior: allow-discrete` 作用于 `display` 和 `overlay`
- **退场**：`overlay` 属性加入 transition 列表，使 top layer 移除延迟到过渡结束后

```css
dialog {
  opacity: 0;
  transition:
    opacity var(--durationGentle) var(--curveDecelerateMid),
    overlay var(--durationGentle) allow-discrete,
    display var(--durationGentle) allow-discrete;
}
dialog:open { opacity: 1; }
@starting-style {
  dialog:open { opacity: 0; }
}
dialog::backdrop {
  background-color: transparent;
  transition: background-color var(--durationGentle),
    display var(--durationGentle) allow-discrete,
    overlay var(--durationGentle) allow-discrete;
}
dialog:open::backdrop {
  background-color: var(--colorScrim);
}
```

或使用 CSS keyframe 动画（无需 `@starting-style`，但 backdrop 退场无法做动画——关闭时立即从 DOM 移除）。

### 2.4 新特性（本项目不可用）

| 特性 | 说明 | 最低版本 |
|------|------|---------|
| `closedby="any"` | light dismiss（点击外部/点按外部自动关闭） | Chrome/WebView **134**（2025-03），Safari 仅 preview |
| `requestClose()` | 触发可拦截的关闭请求（先 `cancel` 后 `close`） | Chrome/WebView 134，Safari 18.4 |
| Invoker Commands（`commandfor` + `command="show-modal"`） | 声明式无 JS 开关 | 更晚，不可用 |

---

## 3. 兼容性矩阵（MDN BCD 数据）

项目环境：Android `minSdkVersion = 30`，`MainActivity` 强制检测 **WebView ≥ 85**；Web 端为开发/预览路径。

| 特性 | Android WebView | 项目门槛 ≥85 | Firefox | Safari | 判定 |
|------|----------------|--------------|---------|--------|------|
| `<dialog>` / `showModal()` / `close()` / `cancel` / `close` 事件 / `returnValue` | Chrome **37**（2014-09） | ✅ 远超 | 98 | 15.4 | **安全使用** |
| `::backdrop` | 随 `<dialog>` 同期 | ✅ | 98 | 15.4 | **安全使用** |
| `@starting-style` | Chrome **117**（2023-09） | ⚠️ 85~116 缺失 | 129 | 17.5 | 渐进增强 |
| `transition-behavior: allow-discrete` | Chrome 117 | ⚠️ 同上 | 129 | 17.5 | 渐进增强 |
| `overlay` 属性（退场动画必需） | Chrome 117 | ⚠️ | ❌ **不支持** | ❌ **不支持** | **Web 端需降级** |
| `closedby` / `requestClose()` | Chrome **134**（2025-03） | ❌ 85~133 缺失 | 141 / 139 | preview / 18.4 | **不可用** |

关键事实：

- **Android 主路径核心功能 100% 覆盖**：WebView 37（2014）即支持 `<dialog>` 全部核心 API，项目门槛 85 是 2020 年水平。
- **入场动画**在 WebView 117+（2023-09 后的设备）可用 `@starting-style` 实现；85~116 降级为无动画直接出现（可接受）。
- **退场动画**在 Android WebView 117+ 可用 `overlay` 方案，但 Firefox/Safari（Web 端）不支持 `overlay`，退场动画只能放弃或用 hack（延迟 `close()` 调用）。

---

## 4. 现有弹窗盘点与问题

源码实证（CodeGraph 提取）：项目共 **10 处** `fixed inset-0 z-*` 手写 overlay，全部自绘 scrim + 手动关闭逻辑。

| 组件 | 结构 | z-index | 点击外部关闭 | 建议 |
|------|------|---------|-------------|------|
| `CommentOverlay.tsx:47` | 底部 80vh sheet + scrim | z-50 | ✅（`e.target === e.currentTarget`） | **迁移** |
| `ReportSheet.tsx:50` | 底部 sheet + scrim | z-50 | ✅（scrim onClick） | **迁移** |
| `SeriesSheet.tsx:222` | 底部 sheet + scrim | z-50 | ✅ | **迁移** |
| `BlocklistSheet.tsx:19` | 底部 sheet + scrim | z-50 | ✅ | **迁移** |
| `ReaderSettingsSheet.tsx:59` | 底部 sheet + scrim | z-50 | ✅ | **迁移** |
| `TranslateSheet.tsx:52` | sheet | z-40 | ✅ | **迁移** |
| `StartupUpdateDialog.tsx:70` | 居中 dialog + scrim | z-50 | ❌ | **迁移**（最适合作为首个试点） |
| `ImageViewer.tsx:164` | 全屏图片查看器（双指缩放/滑动翻页/双击） | z-50 | — | **不迁移** |
| `UgoiraViewer.tsx:129` | 全屏动图播放器 | z-50 | — | **不迁移** |
| `OAuthWebView.tsx:67` | 全屏 OAuth 登录 WebView | z-9999 | — | **不迁移**（关键路径，风险大于收益） |

### 手写模式的共性问题

1. **z-index 战争**：z-50 与 z-9999 硬编码混用（OAuthWebView 用 9999 压过一切），多弹窗堆叠全靠人肉排序。
2. **零可访问性**：10 处全部无 `role="dialog"`、无 `aria-modal`、无焦点圈禁、无 inert——弹窗打开时 Tab 焦点可逃逸到背景页面。
3. **无 Esc 关闭**：桌面 Web 端键盘用户无法 Esc 关闭任何弹窗。
4. **scrim 重复代码**：每个组件手写一层 scrim div + 背景色 + onClick 判断，10 处近似但不完全一致的实现（两种点击外部判断模式并存）。
5. **Android 返回键**：依赖 `backGestureService.ts` 集中手动管理弹窗关闭分支。

---

## 5. 四维度评估

### 5.1 性能：持平或微幅提升

**收益：**

- **Top Layer 脱离层叠上下文**：浏览器原生管理弹窗堆叠顺序，消除 z-index 竞争；top layer 有专门渲染优化。
- **`::backdrop` 合成器渲染**：背景遮罩是浏览器合成的独立层，比手写 scrim div 少一层 DOM 合成。
- **动画时序更可靠**：`@starting-style` 让浏览器精确控制首帧样式，避免 `<Show>` 条件渲染插入 DOM 同帧动画已开始导致的闪烁风险。

**成本：**

- modal dialog 始终在独立复合层，含大量内容的 sheet（如 CommentOverlay 80vh 评论列表）首次打开有一次层提升开销，实测影响极小。

### 5.2 内存占用：基本不变

- 每个弹窗少一个 scrim div，10 处共省 10 个节点（且 `<dialog>` 关闭时 `display: none` 无渲染开销，节点可常驻不必随 `<Show>` 增删）。
- SolidJS 响应式开销不变：开关从 `<Show when={isOpen}>` 改为 `ref.showModal()` / `close()`，signal 数量持平。
- 与项目核心内存约束「图片二进制零进 JS 堆」（ADR-0037）无关，图片流水线不受影响。

### 5.3 可维护性：显著提升（最大收益点）

- **10 处重复模式收敛为 1 个 primitive + 1 套 CSS**：`useDialog` 封装 `showModal()`/`close()`/`cancel` 事件 ↔ SolidJS signal 双向同步 + 手动点击外部关闭。
- **可访问性免费获得**：`aria-modal`、焦点圈禁、背景 inert、Esc 关闭、隐式 `role="dialog"` 全部由浏览器提供。
- **Android 返回键免费**：`showModal()` 打开的 dialog 自动响应返回键（触发 `cancel`），可逐步移除 `backGestureService` 的弹窗分支。
- **新增成本**：一次性基建（primitive + Fluent token 化的动画 CSS）；「点击外部关闭」需手动实现（监听 dialog 本体 click，判断落点是否在内容区外）——与现有手写逻辑复杂度相当，非新增负担。

### 5.4 兼容性：Android 无障碍，Web 端两处降级

- **Android（主路径）**：核心 API 全覆盖；入场动画 117+ 生效，85~116 降级无动画（可接受）。
- **Web（开发/预览）**：退场动画在 Firefox/Safari 不可用（`overlay` 属性缺失），最简方案是退场不做动画或延迟 `close()`。

---

## 6. 实施建议

1. **先建 `primitives/useDialog.ts`**：封装 dialog ref 管理、`showModal()`/`close()`/`cancel` 事件与 SolidJS signal 的双向同步、手动「点击外部关闭」（替代不可用的 `closedby="any"`）。
2. **首个试点选 `StartupUpdateDialog`**：居中布局、无复杂交互、无点击外部关闭需求，风险最低。
3. **动画策略**：
   - 入场：`@starting-style`（WebView 117+ 生效，旧版本静默降级为直接出现）+ Fluent token（`--durationGentle` / `--curveDecelerateMid`）
   - 退场：Android 可用 `overlay` 方案；统一简化为**入场有动画、退场直接消失**也可接受（现有实现本就无退场动画——`<Show>` 卸载即消失）
4. **Android 返回键**：迁移后在 `cancel` 事件中调用 `onClose()`，逐步从 `backGestureService` 移除对应弹窗的手动分支。
5. **保持 `<Show>` 包裹**：dialog 内容较重时（如评论列表），仍可用 `<Show>` 控制内容渲染，仅将外层容器换成 `<dialog>`，兼顾「关闭时不渲染内容」的现有内存语义。

---

## 7. 参考来源

- [MDN `<dialog>` 元素文档](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog)（2026-08-07 查询）
- [MDN BCD `api.HTMLDialogElement`](https://bcd.developer.mozilla.org/bcd/api/v0/current/api/HTMLDialogElement.json)（`showModal` / `closedBy` / `requestClose` 版本数据）
- [MDN BCD `css.at-rules.starting-style`](https://bcd.developer.mozilla.org/bcd/api/v0/current/css.at-rules.starting-style.json)
- [MDN BCD `css.properties.overlay`](https://bcd.developer.mozilla.org/bcd/api/v0/current/css.properties.overlay.json)
- 源码：CodeGraph 提取的 `CommentOverlay.tsx` / `ReportSheet.tsx` / `BlocklistSheet.tsx` / `ImageViewer.tsx` + `grep "fixed inset-0 z-"` 全量盘点（10 处）
