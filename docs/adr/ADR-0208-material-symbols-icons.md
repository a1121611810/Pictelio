# ADR-0208：图标接入 Material Symbols —— 用「子集字体 + 名称↔码点映射」取代 unicode 字形

## 状态

accepted（2026-09-30）

## 背景

[ADR-0205](./ADR-0205-md3-baseline-and-scope.md) 决策 5 立项。差距条目：
[差距分析 §2 #5](../../research/material-design-3-gap-analysis-2026-09.md)（🟠 高）。

### 现状：unicode 字形，且不可验证

项目没有任何图标字体，全仓用 unicode 字符「画」图标：

- 底部导航：`components/navTabs.ts:24-27` 的 `'⌂' '✦' '✎' '◎'`
- 关闭按钮：`BottomSheet.vue:121` 的 `'×'`
- `ActionButton.vue` 注释明写「unicode emoji 或文本符号」
- `GlobalFab.vue` 同样用文本符号承载图标

这不是「不够精致」的观感问题，是**三个实打实的缺陷**：

1. **跨设备不一致。** `'⌂' '✦' '◎'` 属于 Unicode 符号区，字体覆盖依赖系统 emoji/符号字体。
   Android 上不同厂商 ROM 的字形差异明显，同一版本 APK 在不同机器上图标可能长得不一样。
2. **不可访问。** 这些字符对读屏软件是「房屋符号」「四角星」，不是「首页」「收藏」——
   屏幕阅读软件念出来的是错的。项目已经在用 `:accessibility-label` 兜，
   但**兜底掩盖了问题**：修好图标后，label 仍需保留，二者不能互相替代。
3. **不可验证。** 这正是本仓反复在消灭的那类缺陷形态——**没有任何门禁能判红**。
   `hardcodeColorGate` 扫颜色、`mdTokenRefs` 扫 token、硬编码门扫中文文案，
   **没有一道门扫「图标是不是规范图标集」**。unicode 写法可以无限回流。

### 约束

- `packages/app-lynx` 当前**没有任何字体资产**：无 `src/assets`、无 `@font-face`、无 ttf/otf/woff
- `scripts/sync-android-assets.mjs` **只同步 Lynx bundle**（`main.lynx.bundle`），
  不搬运任意资源 ⇒ 新增字体资源需要新的同步路径
- Lynx 的 CSS 是子集，`@font-face` 与自定义字体的支持度**未经真机验证**

## 决策

### 决策 1：接入 Material Symbols Outlined，用**子集字体**而非完整字体

MD3 的官方图标集是 Material Symbols（原 Material Icons 的后继）。
选择 **Outlined** 变体（MD3 组件默认用 Outlined/Filled 两档之一，Outlined 视觉更轻，
与本项目当前 2px 描边手绘图标的密度接近，替换后视觉跳变最小）。

**必须用子集字体**：Material Symbols 完整可变字体是 MB 级，
而本项目实际用到的图标预计 **30–50 个**。全量内置会让 APK 无谓膨胀，
且字体会把全部 2000+ 字形塞进渲染管线。

**子集化在构建期外离线完成，产物（`.ttf` + 映射表）提交进仓库**，
理由与本仓既有实践一致：构建期联网取字体会让 `pnpm build` 依赖外部服务，
干净 clone 无法复现（与 [ADR-0203](./ADR-0203-webview-client-source-removal.md) 决策 8
「gradle 入口必须自带生成物前置」是同一条纪律）。

### 决策 2：名称↔码点映射表是**唯一事实源**，与字体子集一一对应

仓库内维护一份映射（`name → codepoint`）。它同时是三件事的源：

1. 字体子集的生成输入
2. 运行时 `<AppIcon name="...">` 查码点的依据
3. **门禁的 oracle**

三者一一对应这件事本身就是防线：映射里多一个名字而字体里没这个字形 ⇒ 渲染为空白；
字体里多一个字形而映射里没有 ⇒ 浪费体积。**两个方向都要判红。**

### 决策 3：统一 `<AppIcon>` 组件，不允许在模板里直接写字形

新增一个图标组件，输入 `name`，内部查映射表输出对应字符 + `rpx` 字号 +
`currentColor` 语义色。**所有图标位必须经它**。

理由不只是封装：直接写字形等于把「用哪个图标」的决定权散落到 75 个 `.vue`，
无法集中审计。组件是让门禁可判的前提——门禁要判的正是
「模板里的图标是否都走了映射表」。

### 决策 4：`accessibility-label` 继续保留，与图标并存

图标本身**不承载语义**。`<AppIcon>` 必须接受 `label` prop 并透传
（Lynx 侧走 `accessibility-label`），**或在调用点保留既有的 label 声明**。

理由：unicode 字形时代 label 是**唯一**语义来源，所以「有 label 就行」；
换成规范图标集后，若顺手删掉 label，会让「图标形状可读」退化成唯一线索——
这对读屏用户是净损失。**图标与 label 是互补关系，不是替代关系。**

### 决策 5：同批完成手绘描边图标的替换

`TextSelectionToolbar.vue:61-72` 的「复制」图标是用两个绝对定位的边框 `<view>`
手绘的（且这两个子 view 只有 10.5×12px，是**装饰性描边不是触控目标**）。
Material Symbols 有对应的 `content_copy` 字形 ⇒ 直接替换，删掉手绘代码。

## 后果

- APK 体积增加：子集字体预计 **30–60KB**（30–50 个 Outlined 字形），可接受
- **需要验证的引擎风险**：`@font-face` + 自定义字体在 Lynx 4.0.1 的支持度未知。
  若不支持，**回退方案**是：保留 unicode 字形但把映射表与门禁照样落地
  （映射表仍能让「图标名 ↔ 字形」可审计，消除缺陷 3），
  放弃缺陷 1、2 的改善。**回退方案必须保留门禁，不能连门禁一起放弃。**
- 图标位从此集中可审计；「图标写错名字」从静默失败变成构建期/门禁可判
- 若真机验证通过，这是本轮唯一同时消除「不一致 + 不可访问 + 不可验证」三条缺陷的改动

## 复核判据

1. **模板内无裸字形**：`.vue` 模板中不得出现 unicode 图标字符
   （白名单需逐条给理由；`×` 这类纯文本符号是否入白名单须显式决定，不得默认放过）
2. **映射表 ↔ 字体子集双向齐备**：映射中每个 name 都能在字体子集的 cmap 中找到；
   反向亦然。**两个方向都要断言**（只判一个方向会漏掉「映射有、字体无」这类静默空白）
3. **调用点完备**：所有图标位都经 `<AppIcon>`，且**每个都带 label**
4. **反事实自检**：删掉字体子集文件 ⇒ 门禁必须转红（证明它真在验字体，不只是在验映射表文本）

## 参考

- 决策来源：[`ADR-0205`](./ADR-0205-md3-baseline-and-scope.md) 决策 5
- 差距条目：[差距分析 §2 #5、§3.6](../../research/material-design-3-gap-analysis-2026-09.md)
- 术语文档：[`glossary-md3-alignment.md`](./glossary-md3-alignment.md)
- 资源同步现状：`scripts/sync-android-assets.mjs`（仅同步 bundle）
- MD3 图标集说明：[m3.material.io/styles/icons](https://m3.material.io/styles/icons/overview)
