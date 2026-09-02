# ADR-0136: 真机测试导航钩子（benchNav）——intent 深链替代注入 tap

- 状态：accepted
- 日期：2026-09-02
- 关联：ADR-0110（list 事件面勘误）、ADR-0135（滚动指示条——本钩子的首个产品使用方）、wayfinder #306（bench 搭建）
- 来源：grilling 决策（用户拍板「生产包不打包就拉回 main」）——钩子从 `bench/scroll-t0-306` 迁移至 main，经 `if (BuildConfig.DEBUG)` 包裹实现 debug/release 分离

## 背景

**平台约束**：原生 LynxView（4.0.1）真机对 adb 注入 tap 的 `@tap` 处理**部分失效**——放射 FAB 环项、子 tab、scroll-view touchmove 均实测「事件送达但不导航」（OPPO R11s，2026-08-30 实证，见「Lynx 滚动」会话记录）。因此**真机自动化导航不能依赖模拟点击**。

**历史**：wayfinder #306 搭建双端滚动 bench 时在 `bench/scroll-t0-306` 分支引入了 `benchNav` intent 深链钩子（`am start --es benchNav <scenario>` 直达目标页），绕过 tap 失效。此后**全部真机 ABBA 测量（#310/#311/#318/#313）都依赖它**。钩子在 4fda6c8f 从 main 剥离（用户指令「bench 工具链不进 main」——工具与产品隔离）。

**问题**：由于 main 无钩子，在 main 分支上做真机验证时（如滚动指示条 #319 验收）只能退回模拟点击——**撞上已知失效问题，导航卡死**（本次实际发生的错误链）。教训：**钩子必须在 main 的验证构建里可用，否则下次仍会踩坑**。

## 决策

1. **钩子代码进 main（生产不打包）**：`LynxActivity.onLoadSuccess` 的 benchNav 处理段用 `if (BuildConfig.DEBUG)` 包裹——debug 构建含钩子（真机验证直接可用，不再需要切分支）；release 构建（minifyEnabled true + R8）下 `BuildConfig.DEBUG` 恒 false → 死代码消除 → **生产 APK 不含任何钩子代码**。**已验证**：release APK dex 无 `benchNav` 字符串。
2. **JS 侧也加判断（双保险）**：router.ts / IllustList.vue / NovelList.vue 的监听器包在 `if (__DEV__)` 内（`__DEV__` 为项目既有编译期宏，lynx.config.ts `source.define` 注入，auth.ts 已有同范式）。**已核实 vue-lynx 插件覆盖语义**（plugin/dist/index.js:20798 `__DEV__: 'process.env.NODE_ENV !== "production"'`）：生产构建恒 false（监听器随死代码消除）；dev 构建恒 true（钩子可用）。与原生 `BuildConfig.DEBUG` 互补：**生产 = 原生(DEBUG false) + JS(__DEV__ false) 双重消除；dev = 双 true 可用**。
3. **钩子三层结构**（迁移后保留，全部进 main）：
   - **原生层**（LynxActivity.java，`onLoadSuccess`）：读 `getIntent().getStringExtra("benchNav")` → `switch` 编码场景→事件名数组 → 4 次广播（1.5/3/4.5/6s）——防「App 挂载/页面挂载」竞态；事件名编码路由（lynx 4.0.1 无 JavaOnlyString，故不用载荷）。
   - **路由层**（router.ts）：`registerBenchNavHandler()` 模块加载即注册，`pictelioBenchNavIllust`→`/illusts`、`Carousel`→`/recommended` 等；`replace` 幂等。
   - **页面层**（IllustList.vue / NovelList.vue）：`pictelioBenchNavIllustFollow` / `pictelioBenchNavNovelFollow` → 切「关注」子 tab（after 路由，页面挂载后）。
4. **约定变化**：原「钩子只在 bench/scroll-t0-306」「bench 工具链不进 main」的边界改为——**钩子是产品代码（debug 专用），bench 工具脚本（bench-scroll.mjs / lynx-bench-nav.sh）仍在 bench 分支**。真机验证流程简化：任意分支构建 debug APK 即可深链导航。

## 被考虑的方案

- **保持钩子只在 bench 分支**（原约定）：每次真机验证都要切分支——main 上验证时会退回 tap 而失效。否决（本次实际踩坑）。
- **JS 侧不判断（仅原生 DEBUG 包裹）**：曾认为「release 无广播源，监听器悬空零影响」。**被推翻**——项目已有 `__DEV__` 编译期宏（auth.ts 同范式），JS 侧判断零成本且生产消除更彻底；「零影响」论断不构成不做判断的理由。
- **import.meta.env.DEV**（JS 侧）：rspeedy 无已验证的 DEV 注入；项目已有更规范的 `__DEV__`（lynx.config define）。驳回。

## 后果

- 正面：**真机验证流程简化为「build debug 即测」**，不再有「main 无导航钩子」的坑；滚动指示条（#319）、后续所有真机验证复用。
- 代价（可接受）：debug 包体积略增（~80 行 + 4 次 postDelayed 的 1.5/3/4.5/6s 窗口）；JS 侧事件监听器在 release 悬空（无广播不触发，零行为影响）。
- 待验证项：无——debug 深链已验证（migrated APK 直达插画），release 无钩子已 dex 验证。
- **测试约定**：任何「翻车时怀疑导航」的新会话——先 `am start --es benchNav illust` 确认钩子可用，再怀疑代码。
