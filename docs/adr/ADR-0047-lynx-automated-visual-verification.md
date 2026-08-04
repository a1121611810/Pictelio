# ADR 0047: app-lynx 自动化视觉验证方案（web-core 渲染位置 + Vivaldi 持久 profile + CDP 登录）

## 状态

已采纳

## 分类

技术决策

## 日期

2026-08-01

## 背景

Tailwind 迁移（ADR-0046）后需要自动化视觉验证 6 页面。初期自动化探测（CDP `document.querySelectorAll('*')`）一直读到"空白"（~12 个主文档元素、0 个 lynx 内容），误判"渲染失败"；用户纠正：**实际渲染正常，每次打开浏览器都能看见**。真相是探测方法错误——lynx web-core 把渲染内容放在 `lynx-view` 元素内部的 srcdoc iframe / shadow root 中，`querySelectorAll('*')` 不穿透。

同时用户指出测试应使用**系统默认浏览器（Vivaldi）**而非每次新建 profile 的"无痕式"实例。

## 决策

1. **探测必须穿透渲染边界**：递归遍历 `document` + 每个元素的 `shadowRoot` + 每个 `IFRAME.contentDocument`，才能读到 lynx 渲染的 `x-view`/`x-text`/`x-input` 元素。Tailwind utility 出现在这些元素的 `className` 上（如 `w-full h-full bg-background-2`），可直接验证样式类生效。
2. **用系统默认浏览器（Vivaldi）+ 持久 profile**：`/Applications/Vivaldi.app/.../Vivaldi --remote-debugging-port=9223 --user-data-dir=~/.reasonix/vivaldi-auto`。已运行的浏览器不接受 `--remote-debugging-port`（Chromium 系设计），必须启动时带参；持久 profile 避免"每次像无痕"（登录态/缓存跨会话保留）。
3. **登录态注入用 CDP `Input.insertText`**：向聚焦的 `<input>` 键入 refresh_token——vue-lynx 的 `v-model` **不响应**原生 `input`/`change` 事件（JS 设 value + 派发事件无效），`Input.insertText` 走浏览器真实键入路径可触发。随后对 Submit 按钮（`x-view` 含 `bg-brand`）`dispatchEvent(new MouseEvent('click'))`。
4. **点击 lynx 元素用内联 CDP 表达式**：避免 Node 模板字符串拼接 `${...}` 的转义问题（此前多次失败）；文本匹配用 `startsWith` 而非精确 `===`（`textContent` 可能含隐藏字符）。
5. **验证矩阵**：6 页面在登录态真实数据下验证（Login/Recommended/NovelList/NovelDetail/IllustDetail/Me），校验关键 utility（`h-[11.733vw]`、`text-4xl font-bold`、`leading-[44rpx]`、`text-[18rpx]`、`m-1.5`、`w-[85%]` 等）。

## 核心动机

- 自动化视觉验证可行且与用户环境一致（默认浏览器）
- 登录态下用真实数据验证，覆盖数据渲染路径（非仅静态结构）
- 探测方法修正后，之前的"空白"误判不再重复（已存 memory 供后续复用）

## 风险与反面

- **登录态在内存**（Web 模式不持久化 token，安全权衡）：刷新页面即丢，需重新登录（~20s 流程）
- **token 管理**：`packages/app-lynx/.env` 含 `PIXIV_REFRESH_TOKEN`，已加入 `.gitignore`（防止误提交泄漏）
- **CDP 限制**：远程调试必须启动时开启；持久 profile 目录含登录态/缓存，属本机开发资产，勿提交/勿清理
- **Vivaldi 是 Chromium 系**：CDP 协议兼容；若默认浏览器更换为 Safari（非 Chromium），需改用 WebDriver 协议，本方案不适用
- **截图非验证必需**：像素级对比需人眼；自动化验证以 DOM 结构 + className 为准

### 正面

- 6 页面全量验证一次完成，无需人工逐页操作
- 方法可复用（memory 已记录：`lynx-login-verification-vivaldi`、`lynx-automated-render-probe`）
- 与用户日常浏览器一致，验证结果可信

### 反面

- 依赖 Vivaldi 特定路径与持久 profile（换机需重建）
- 登录流程约 20s，多页面验证需导航链式处理（文本匹配点击）

## 相关

- ADR-0046（Tailwind 迁移，本验证的对象）
- `glossary-web-core-pitfalls.md`（web-core 已知缺陷；本次新增"渲染位置"探测须知）
- memory：`lynx-automated-render-probe`、`lynx-login-verification-vivaldi`
