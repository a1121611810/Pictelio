# ADR-0163: QA 防线三网——转换矩阵、宿主矩阵、平台一致性自检

- 状态：accepted（2026-09-16）
- 关联：spec `docs/specs/qa-defense-lines.md`；ADR-0107 D4 / ADR-0112 D5 / ADR-0162（lynx list 结构变更三态行为）；调研报告 `docs/research/industry-qa-practices-runtime-interaction-defects.md`（42 个一手来源）；issue-tracker 工作流 `docs/agents/issue-tracker.md`

## 背景

四个真实缺陷（2026-09-15/16 取证收口）暴露了同一种缺口：**单测全绿、code review 通过、但真机上用户跨状态交互时才暴露**。逐个归因：

| 缺陷 | 根因层 | 为什么既有防线全漏 |
|------|--------|-------------------|
| 搜索翻页必败（URL polyfill `.hostname`=undefined） | Lynx 运行时与浏览器语义不一致 | 单测跑 happy-dom（标准语义）——测试环境替它撒谎；该平台事实事前不存在任何记录 |
| 搜索 scope 切换失效（整表替换 patch 错位） | vue-lynx list 结构变更 | ADR-0107 D4 在案 8 天后 SearchSheet 建仓裸用 `<list>`——知识停在 ADR 散文，无机制强制继承 |
| 关联行不渲染（中途插入被丢弃） | 同上家族新形态 | 交织逻辑源码正确；失败只在真实渲染管线；且验收为单帧存在性检查 |
| 收藏数冻结（props init-only） | 组件与宿主的生命周期契约从未被写下 | 单测每次全新挂载；缺陷只在「一个实例服务多作品」的用法出现 |

共性：**4 个缺陷全部位于状态转换中（返回/切筛选/翻页/换卡）**，且全部位于「代码正确性」之外的两层——平台运行时语义层、跨组件契约层。code review 与状态级单测在这两层结构性失明；人工验收是单帧存在性检查（#374 口径），同样失明。

业界调研结论（见调研报告）：无单点银弹，共识是三层网——规范派生一致性测试、真运行时灰盒交互/契约测试、发布侧遥测；测试策略辩论（金字塔/奖杯/蜂巢）对 UI 重的双引擎 App 收敛为「重心移向真运行时集成测试」。

## 决策

建立三道防线 + 一条审查纪律，全部复用既有基建：

### 防线一：转换矩阵（transition matrix）——治状态转换缺陷（B/D 类）

「列表面 × 用户动作 × 引擎 × 内容断言」参数化矩阵，物化为 android-e2e spec（复用既有 Appium 基建与登录种入/代理方法学），首版覆盖四缺陷对应行（进详情返回注入段断言、scope 切换内容对比、轮播换卡数值对比、搜索翻页断言）。**断言粒度必须内容对比，禁止单帧存在性**（#374 存在性口径的修订）。

跑法：**发版前必跑 + 大 PR 手动触发，不进每-PR CI**（维持 #539 决策——AVD/Appium/token 环境重，每 PR 数十分钟不可接受）。

### 防线二：宿主矩阵契约测试——治跨组件契约缺陷（C 类）

凡 init-only props 的可复用组件，必须存在「第二种宿主形态」的行为测试（同实例喂第二组 props / 复用宿主下断言状态随卡片切换），并在接口注释显式写下生命周期契约。**不引入 Pact/Storybook**——单仓库进程内契约用 Vitest 即可，broker 是多团队微服务场景的产物。

### 防线三：平台一致性自检页——治平台运行时缺陷（A 类）

新增 Lynx 端自检路由页（debug 可达，benchNav 钩子导航）：对项目实际依赖的平台 API 面（URL 解析、bridge 回调引号契约等）渲染规范派生的 PASS/FAIL 矩阵，**在真 Lynx 运行时上执行**。配套纪律：平台 API 调用收口到统一工具函数（`safeParseURL`），源级守卫禁止裸用回流。happy-dom 单测自此定位为「浏览器语义参考实现」，**不再作为 Lynx 运行时行为的 oracle**。

### 审查纪律：code-review 第三审计轴

`.agents/skills/code-review/SKILL.md` 追加审计项：(a) 原生 list 结构变更 → epoch 防御或结构规避 + spike 记录；(b) Lynx 平台全局 API 新用法 → 设备探针记录 + 源级守卫；(c) init-only 组件新宿主 → 宿主矩阵测试。三条若在事发前存在，②④在建仓时即被拦截。

### 发布侧适配

本项目不经 Play 分发（GitHub Releases APK + webview OTA），调研报告的 staged rollout/Vitals 不直接适用。替代：GitHub Releases **pre-release 标记即分阶段发布**（挂 ≥3 天转 stable，写入 release-checklist）；错误监控（Sentry 类，含不崩溃行为缺陷的面包屑）单独立项——lynx 端错误捕获行为本身是未验证平台事实，接入前需探针。

## 否决的备选

- **更多 review 轮数**：四缺陷无一处于 review 可见层，轮数不解决层级缺失。
- **Pact broker / Storybook**：多团队微服务与组件库场景的产物，本仓库单进程内契约 Vitest 足够。
- **Play staged rollout / Vitals / Test Lab Robo**：无 Play 分发通道，生态不匹配。
- **每-PR 跑设备矩阵**：环境重量不可接受（#539 既有裁决），防线价值靠「发版前必跑」纪律保证。

## 后果

- 发版流程新增「转换矩阵必跑」一步（手工/脚本触发，约 10-20 分钟）；release-checklist 与 code-review skill 相应更新。
- 新增「平台事实必须有探针记录 + 源级守卫」的全仓纪律；happy-dom 单测的 oracle 地位被显式降级为浏览器语义参考。
- 已知遗留：Sentry 类错误监控需账号与 lynx 捕获行为探针，单独立项；真机（OPPO）批次验收仍为按需人工。
- 正面代价：三防线首版约 5-6 人日；此后每新列表面/新可复用组件的边际成本为一条矩阵行/一个宿主用例。
