# ADR-0168: lynx 系统栏策略——基底边到边 + 全屏模式设置开关

- 状态: Accepted（2026-09-19，T4 验收通过：[docs/research/lynx-systembars-t4-acceptance.md](../research/lynx-systembars-t4-acceptance.md)；API 35+ 设备实证挂账，文档锚定见 #592）
- 日期: 2026-09-19
- 关联: wayfinder 地图 [#591](https://github.com/a1121611810/Pictelio/issues/591)（决策 [#595](https://github.com/a1121611810/Pictelio/issues/595)）；spec [docs/specs/lynx-systembars.md](../specs/lynx-systembars.md)；研究 [#592](https://github.com/a1121611810/Pictelio/issues/592)（平台事实）/ [#593](https://github.com/a1121611810/Pictelio/issues/593)（Lynx 能力）；基线 [#594](https://github.com/a1121611810/Pictelio/issues/594)；修订 ADR-0131（内容区契约，语义保持）

## 背景

targetSdk 36 下，Android 15+ 设备对 targetSdk ≥35 的应用**强制边到边**（无 opt-out 途径；`setStatusBarColor` 静默透明），而 LynxActivity/app-lynx 零 insets 补偿——15+ 真机上顶栏/底部元素存在被系统栏压住的潜伏缺陷；Android ≤14 则是「独立黑/灰系统栏 × 浅色 UI」的视觉割裂（#594 基线实证）。同一 APK 呈现两种窗口形态。用户诉求：状态栏视觉统一（着色），并可在设置中开启全屏模式。

## 决策

D1-D7 全集见 spec §2（此处记结论与权衡要点）：

1. **基底 = 边到边**（`EdgeToEdge.enable` 于 LynxActivity，全版本主动开启）。Android ≤14 与 15+ 形态一致，消灭双形态分裂；状态栏区域由 Root padding 染 App surface 色——即「着色」诉求的平台正确实现。
2. **全屏 = 设置开关 opt-in**（默认关）：`WindowInsetsControllerCompat` hide/show，运行时即时生效、设置键持久化、Activity 重建重设。仅追加隐藏系统栏，不改布局基底。
3. **insets 管线**：原生 `onApplyWindowInsetsListener` → JS 订阅 `pictelioInsets` 事件 + 订阅后 `getSafeAreaInsets` 拉初值（**拉取而非预注入**：insets 首帧分发在 attach 期早于 JS 订阅，纯推必丢首帧——T1 实现期修订）。
4. **`getViewportSize` 语义保持「可视内容区」**（ADR-0131 契约）：原生侧 contentSize = LynxView 边界 − 可见系统栏 insets，随 insets 变化更新——消费方（GlobalFab/viewportGeometry/弹层几何）零改动。

## 否决的替代方案

- **状态栏着色（`setStatusBarColor`）**：targetSdk ≥35 在 Android 15+ 静默透明且不可改（F2.1/F2.2）——选它实际交付「≤14 着色 + 15+ 裸奔」的永久双形态，随设备升级持续恶化。
- **「边到边 on/off」设置开关**：15+ 设备上系统强制、无关闭途径——开关必然静默失效，属欺骗性 UI。
- **全局全屏（immersive 作默认）**：官方定位为游戏/媒体局部场景；隐藏系统栏不豁免 insets 布局工作（F3.9，成本与 e2e 相同），另牺牲系统可达性 + 与图片查看器边缘手势冲突（exclusion rects 仅部分缓解且限 200dp/边）。
- **逐页全 bleed 沉浸（替代 Root 全局 padding）**：保底正确性优先——首批全局 padding 使所有页面零遮挡，个别沉浸页（图片查看器）留待后续按页 opt-out。

## 后果

- 正面：全版本（API 28→35+）单一代码路径与形态；系统栏区域染 surface 色；全屏模式诚实可用（全版本可切可逆）；JS 布局侧改动收敛为 Root padding + 弹层 spacer，几何消费方零改动。
- 代价 / 风险：insets 管线是新增永久契约面（事件名/载荷/方法名由契约测试双向钉住）；`getSafeAreaInsets` 初值依赖「订阅后拉取」时序（JS 侧 initSafeArea 必须先订阅后拉，契约测试注释已锚）；Android ≤14 三键导航 nav bar 80% scrim 为 compat 缺省（D6，可一行关闭）；API 36 模拟器实证因镜像下载网络阻塞挂账（文档锚定已足，#594 报告 §三 有补做指引）。
- 排除面：图片查看器 / IllustDetail 全 bleed 沉浸不入首批（spec D7）；webview 客户端系统栏策略另立 effort（其 Capacitor WebView 栈机制不同，且 Android 16 预测性返回默认开对其返回链路另有影响——见 #592 风险旗标，需独立验证）。
