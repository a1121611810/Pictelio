# ADR-0168: lynx 系统栏策略——基底边到边 + 全屏模式设置开关

- 状态: Accepted（2026-09-19，T4 验收通过：[docs/research/lynx-systembars-t4-acceptance.md](../research/lynx-systembars-t4-acceptance.md)——Android 9/14/16 三级别全矩阵绿；API 36 经断言式 CI 验收 workflow 补测，ALL PASS）。**部分修订（2026-09-21）**：spec §2 D4「状态栏图标深浅固定」已由 [ADR-0180](ADR-0180-lynx-dark-mode.md) D6 修订为随 `resolvedDark` 动态（lynx 暗色模式落地）。
- 日期: 2026-09-19
- **修订（2026-10-02）**：insets 管线的**单位边界**——原生 `WindowInsetsCompat.getInsets()` 返回物理像素，而 Lynx `px` 是逻辑像素（= dp），原实现漏换算导致**全部安全区补偿被放大 density 倍**（见「后果 · 已修缺陷」）。
- 关联: wayfinder 地图 [#591](https://github.com/a1121611810/Pictelio/issues/591)（决策 [#595](https://github.com/a1121611810/Pictelio/issues/595)）；spec [docs/specs/lynx-systembars.md](../specs/lynx-systembars.md)；研究 [#592](https://github.com/a1121611810/Pictelio/issues/592)（平台事实）/ [#593](https://github.com/a1121611810/Pictelio/issues/593)（Lynx 能力）；基线 [#594](https://github.com/a1121611810/Pictelio/issues/594)；修订 ADR-0131（内容区契约，语义保持）；D4 被 [ADR-0180](ADR-0180-lynx-dark-mode.md) 修订

## 背景

targetSdk 36 下，Android 15+ 设备对 targetSdk ≥35 的应用**强制边到边**（无 opt-out 途径；`setStatusBarColor` 静默透明），而 LynxActivity/app-lynx 零 insets 补偿——15+ 真机上顶栏/底部元素存在被系统栏压住的潜伏缺陷；Android ≤14 则是「独立黑/灰系统栏 × 浅色 UI」的视觉割裂（#594 基线实证）。同一 APK 呈现两种窗口形态。用户诉求：状态栏视觉统一（着色），并可在设置中开启全屏模式。

## 决策

D1-D7 全集见 spec §2（此处记结论与权衡要点）：

1. **基底 = 边到边**（`EdgeToEdge.enable` 于 LynxActivity，全版本主动开启）。Android ≤14 与 15+ 形态一致，消灭双形态分裂；状态栏区域由 Root 染 App surface 色——即「着色」诉求的平台正确实现。**⚠️ 2026-10-02 修订**（原文保留）：原写作「由 Root **padding** 染」，而顶部那一半 padding 已随 [ADR-0214](ADR-0214-top-inset-per-page-ownership.md) 删除；**染色本身仍成立**（来自 .Root 的 background-color），变的只是机制名。
2. **全屏 = 设置开关 opt-in**（默认关）：`WindowInsetsControllerCompat` hide/show，运行时即时生效、设置键持久化、Activity 重建重设。仅追加隐藏系统栏，不改布局基底。
3. **insets 管线**：原生 `onApplyWindowInsetsListener` → JS 订阅 `pictelioInsets` 事件 + 订阅后 `getSafeAreaInsets` 拉初值（**拉取而非预注入**：insets 首帧分发在 attach 期早于 JS 订阅，纯推必丢首帧——T1 实现期修订）。
4. **`getViewportSize` 语义保持「可视内容区」**（ADR-0131 契约）：原生侧 contentSize = LynxView 边界 − 可见系统栏 insets，随 insets 变化更新——消费方（GlobalFab/viewportGeometry/弹层几何）零改动。

## 否决的替代方案

- **状态栏着色（`setStatusBarColor`）**：targetSdk ≥35 在 Android 15+ 静默透明且不可改（F2.1/F2.2）——选它实际交付「≤14 着色 + 15+ 裸奔」的永久双形态，随设备升级持续恶化。
- **「边到边 on/off」设置开关**：15+ 设备上系统强制、无关闭途径——开关必然静默失效，属欺骗性 UI。
- **全局全屏（immersive 作默认）**：官方定位为游戏/媒体局部场景；隐藏系统栏不豁免 insets 布局工作（F3.9，成本与 e2e 相同），另牺牲系统可达性 + 与图片查看器边缘手势冲突（exclusion rects 仅部分缓解且限 200dp/边）。
- **逐页全 bleed 沉浸（替代 Root 全局 padding）**：保底正确性优先——首批全局 padding 使所有页面零遮挡，个别沉浸页（图片查看器）留待后续按页 opt-out。**⚠️ 2026-10-02 由 [ADR-0214](ADR-0214-top-inset-per-page-ownership.md) 修订**（原文保留）：该否决**已撤销** —— 当时的根容器 padding 使「后续按页 opt-out」在契约上不可实现，现改为顶部让位逐页归属。

## 后果

- 正面：全版本（API 28→35+）单一代码路径与形态；系统栏区域染 surface 色；全屏模式诚实可用（全版本可切可逆）；JS 布局侧改动收敛为 Root padding + 弹层 spacer，几何消费方零改动。**⚠️ 2026-10-02 修订**（原文保留）：「Root padding」中的**顶部一半已失效**（见 ADR-0214），现在收敛为「根容器 padding-bottom + 各页顶部 spacer」；「几何消费方零改动」只对底部成立。
- 代价 / 风险：insets 管线是新增永久契约面（事件名/载荷/方法名由契约测试双向钉住）；`getSafeAreaInsets` 初值依赖「订阅后拉取」时序（JS 侧 initSafeArea 必须先订阅后拉，契约测试注释已锚）；Android ≤14 三键导航 nav bar 80% scrim 为 compat 缺省（D6，可一行关闭）；API 36 模拟器实证因镜像下载网络阻塞挂账（文档锚定已足，#594 报告 §三 有补做指引）。
- 排除面：图片查看器 / IllustDetail 全 bleed 沉浸不入首批（spec D7）。**⚠️ 2026-10-02 由 [ADR-0214](ADR-0214-top-inset-per-page-ownership.md) 修订**（原文保留）：首个 bleed 页**实际落地为首页（推荐页）**而非图片查看器，范围分歧与理由见 ADR-0214「与 ADR-0168 的一处范围分歧」一节；IllustDetail 是否 bleed 留待另票；webview 客户端系统栏策略另立 effort（其 Capacitor WebView 栈机制不同，且 Android 16 预测性返回默认开对其返回链路另有影响——见 #592 风险旗标，需独立验证）。

### 已修缺陷：insets 单位边界（2026-10-02）

**现象**：状态栏 72 物理 px，但所有页面 header 上方凭空多出 144px 空白（density 3.0 设备）；6 个底部弹层底部各多 144px 死白。web-core 预览正常。

**根因**：`WindowInsetsCompat.getInsets()` 返回**物理像素**，而 Lynx 的 `px` 是**逻辑像素**（= Android dp，见 [glossary-lynx-units](glossary-lynx-units.md)）——两者差一个 `SystemInfo.pixelRatio`。ADR-0168 落地时两侧直接对接，**漏掉了这道换算**，补偿被放大 density 倍。mdpi（density 1.0）设备恰好正确，故跨设备表现不一致。

**为什么 T4 验收没抓到**：验收矩阵只做定性核对（「状态栏区域染 surface 色」）——放大 3 倍后**仍然是染了 surface 色**，定性判据照样绿灯。**没有任何一处量过幅值**。

**修法**：`safeArea.ts` 作为**唯一换算点**，对外一律暴露逻辑像素（`physical / pixelRatio`）；下游（Root padding + 6 个弹层 spacer）一行不改。**⚠️ 2026-10-02 由 [ADR-0214](ADR-0214-top-inset-per-page-ownership.md) 修订**（原文保留）：「Root padding 一行不改」**已失效** —— 顶部那一半已删除并下沉到各页（6 个弹层 spacer 未动）。换算点本身仍是 `safeArea.ts` 唯一，这部分不变。**不改 Java**：`sInsetTop` 同时被 `updateContentArea()` 消费，而后者需要物理 px。

**真机复验**（emulator-5554 / 1080×2160 / density 3.0 / 插画页）：header surface 带 400 → **256px**（= 72 + 184.3 TopAppBar）；页面根底边 1944 → **2088**（= 2160 − 72）；对照判据 `border-b-[1px]` 仍为 3 物理像素行（vw/px 语义未回归）。
