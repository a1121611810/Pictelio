# 业界质量保障实践调研：代码逻辑正确、但真实运行时/交互行为破损的缺陷

- **调研日期**: 2026-09-16
- **调研背景**: Pictelio 是 1-2 人小团队的移动端 App，采用双渲染引擎（Android WebView + Lynx 原生渲染）。近期 4 个真实缺陷的共性是：单测全绿、code review 通过、但真机上用户跨状态交互时才暴露。
- **方法**: 按缺陷原型映射，检索一手来源（官方文档、规范、从业者工程博客、免费在线书籍原文），每条关键论断附来源 URL。
- **性质**: 本文件为人工调研报告，非 OpenWiki 生成物。

## 0. 缺陷原型与业界对应机制总览

| 原型 | 缺陷 | 为什么单测+review 抓不住 | 业界对应机制 |
| --- | --- | --- | --- |
| A | Lynx URL polyfill `.hostname` 返回 undefined，域名白名单 100% 误拒 | 单测跑在 happy-dom（标准浏览器语义）里，而缺陷在非标准运行时的 polyfill 差异 | 平台一致性测试（conformance testing，WPT 模式） |
| B | vue-lynx diff patch 静默丢弃中途插入的列表项 | mock 环境不跑真实渲染管线，数据层断言无法覆盖"数据在、渲染没有" | 真机灰盒 UI 自动化 + 状态遍历爬虫 |
| C | 收藏按钮组件 setup 时只读一次 props，轮播宿主复用实例导致状态冻结 | 单测只测组件自身，未测"宿主如何实例化/复用组件"的隐式契约 | 集成契约测试 + 组件身份（key/remount）纪律 |
| D | 4 个缺陷全部位于状态转换（返回/筛选/翻页/换卡） | 单帧存在性检查与状态级单测不覆盖"时序+序列" | 转换矩阵/模型驱动测试 + 探索式测试 + 发布侧遥测 |

---

## 来源清单汇总

### 一致性测试 / 平台规范
1. Web Platform Tests 官网 — https://web-platform-tests.org/
2. WPT 公共运行入口 wpt.live 与结果归档 wpt.fyi — https://wpt.live/ 、 https://wpt.fyi/
3. WPT 仓库（url/ 测试目录） — https://github.com/web-platform-tests/wpt （https://github.com/web-platform-tests/wpt/tree/master/url）
4. WHATWG URL Standard — https://url.spec.whatwg.org/
5. react-native-url-polyfill（WPT 派生测试的 RN polyfill 实践） — https://github.com/charpeni/react-native-url-polyfill
6. React Native Hermes 文档 — https://reactnative.dev/docs/hermes
7. Lynx 官方测试环境 @lynx-js/testing-environment — https://lynxjs.org/api/lynx-testing-environment/
8. ReactLynx Testing Library — https://lynxjs.org/react/reactlynx-testing-library
9. Lynx 仓库（含 Lynx Explorer 真机运行环境 App） — https://github.com/lynx-family/lynx
10. 微信小程序自动化（官方文档，含真机自动化） — https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/quick-start.html 、 https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/remote.html

### 真机 UI 自动化 / 爬虫 / 设备农场
11. Detox 官方仓库（"Gray box end-to-end testing"） — https://github.com/wix/detox
12. Detox 文档（灰盒理念） — https://wix.github.io/Detox/docs/introduction/getting-started/
13. Wix Engineering：Detox 测试稳定性 — https://medium.com/wix-engineering/detox-the-unobtainable-test-stability-or-is-it-5f8cd765df1c
14. Firebase Test Lab Robo test 官方文档 — https://firebase.google.com/docs/test-lab/android/robo-ux-test
15. Robo scripts — https://firebase.google.com/docs/test-lab/android/run-robo-scripts
16. Google Play 预启动报告（自动 Robo 爬虫） — https://support.google.com/googleplay/android-developer/answer/7002270
17. Espresso — https://developer.android.com/training/testing/espresso ；XCTest/XCUITest — https://developer.apple.com/documentation/xctest ；Appium — https://appium.io/ ；Maestro — https://maestro.mobile.dev ；AWS Device Farm — https://aws.amazon.com/device-farm/

### 集成契约测试 / 组件契约
18. Martin Fowler：Contract Test（原 Integration Contract Test） — https://martinfowler.com/bliki/IntegrationContractTest.html
19. Pact 官方文档 — https://docs.pact.io/ （消费者侧 — https://docs.pact.io/consumer ）
20. PactFlow：What is Consumer-Driven Contract Testing — https://pactflow.io/what-is-consumer-driven-contract-testing/
21. Microsoft 工程手册：CDC Testing — https://microsoft.github.io/code-with-engineering-playbook/automated-testing/cdc-testing/
22. Storybook Interaction tests — https://storybook.js.org/docs/writing-tests/interaction-testing ；Play function — https://storybook.js.org/docs/writing-stories/play-function ；Test runner — https://storybook.js.org/docs/writing-tests/integrations/test-runner
23. React 官方文档：Preserving and Resetting State — https://react.dev/learn/preserving-and-resetting-state
24. Vue 官方文档：Maintaining State with key — https://vuejs.org/guide/essentials/list.html#maintaining-state-with-key
25. eslint-plugin-react（jsx-key 等纪律 lint） — https://github.com/jsx-eslint/eslint-plugin-react

### 状态转换 / 模型驱动 / 探索式测试
26. Stately 测试文档 — https://stately.ai/docs/testing ；@xstate/test — https://stately.ai/docs/xstate-test
27. James & Jon Bach《Session-Based Test Management》（STQE 原文 PDF 镜像） — https://www.ida.liu.se/~TDDD04/labs/2020/exploratory_testing/stqe-sbtm.pdf
28. Satisfice：SBTM 论文下载（James Bach 官方站） — https://www.satisfice.com/download/session-based-test-management
29. Rapid Software Testing：SBTM Session Report Checklist — https://rapid-software-testing.com/session-based-test-management-report-checklist/
30. Wikipedia：Session-based testing — https://en.wikipedia.org/wiki/Session-based_testing
31. Manning《Bug Bash》（Lina Zubytė） — https://www.manning.com/books/bug-bash

### Shift-right / 发布侧
32. Google SRE 书《Release Engineering》（免费在线） — https://sre.google/sre-book/release-engineering/
33. SRE Workbook：Alerting on SLOs（错误率门禁思想） — https://sre.google/workbook/alerting-on-slos/
34. Google Play 分阶段发布（官方帮助，中文/英文） — https://support.google.com/googleplay/android-developer/answer/6346149
35. Play Console：Release with Confidence — https://play.google.com/console/about/guides/releasewithconfidence/
36. Android Vitals 官方文档 — https://developer.android.com/topic/performance/vitals ；恶劣行为阈值 — https://support.google.com/googleplay/android-developer/answer/7384416
37. Sentry Android Session Replay 官方文档 — https://docs.sentry.io/platforms/android/session-replay/
38. Embrace Mobile RUM — https://embrace.io/product/mobile-rum/ ；Datadog-Embrace 集成 — https://docs.datadoghq.com/integrations/embrace-mobile/
39. TestFlight 官方 — https://developer.apple.com/testflight/

### 测试策略文献
40. 《Software Engineering at Google》免费在线版（abseil.io） — https://abseil.io/resources/swe-book ；Ch11 Testing Overview — https://abseil.io/resources/swe-book/html/ch11.html ；Ch12 Test Sizes — https://abseil.io/resources/swe-book/html/ch12.html ；Ch14 Larger Testing — https://abseil.io/resources/swe-book/html/ch14.html
41. Kent C. Dodds：The Testing Trophy and Testing Classifications — https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications ；Write tests. Not too many. Mostly integration. — https://kentcdodds.com/blog/write-tests
42. EuroSTAR Huddle：Kristian Karl 谈 Spotify 测试自动化（测试蜂巢出处） — https://huddle.eurostarsoftwaretesting.com/resources/test-automation/experiences-of-test-automation-at-spotify-with-kristian-karl/ ；演讲视频 — https://www.youtube.com/watch?v=Vlw-4q8lnIw

---

## 1. 平台一致性测试（Conformance Testing）——对应缺陷 A

### 业界做法是什么
浏览器业界用**同一套共享测试套件**验证不同引擎对平台 API 的实现一致性。Web Platform Tests（WPT）自我定位是 "a cross-browser test suite for the Web-platform stack"，目标是让 web 在跨浏览器/跨设备时行为一致；测试公开运行（wpt.live），各大浏览器的运行结果被持续归档对比（wpt.fyi "an archive of test results collected from an array of web browsers on a regular basis"）。其关键思想：**平台 API 的语义由规范（如 WHATWG URL Standard）定义，测试样例从规范派生，然后跑在每一个"声称实现了该平台"的运行时上**。（来源 1-4）

嵌入式 JS 运行时（RN/小程序/Lynx 类）面临同样的问题，社区解法是把 WPT 的思想搬进运行时自己的测试管线。最有代表性的实例是 `react-native-url-polyfill`：其 README 明确指出 React Native 内置的 URL 是 "homemade"、"initially created to handle specific use cases"，曾出现 "URL cannot handle 'localhost' domain for base url" 等已知缺陷；该库 "Follows the URL Standard spec"，并 "**relies on unit tests generated from Web Platform Tests and Detox e2e tests**"，同时声明 "Supports Hermes"。（来源 5）——这正是"用规范派生测试验证运行时 polyfill 一致性"的完整范例，与缺陷 A（Lynx URL polyfill `.hostname` 返回 undefined）是同一缺陷家族。

容器类厂商的官方做法是提供"真运行时自动化"通道：微信小程序提供官方 miniprogram-automator（SDK 本身不带测试框架，搭配 Jest 等使用），并支持真机调试自动化（remote，扫码在真机上继续执行测试）。（来源 10）Lynx 生态则提供 `@lynx-js/testing-environment`（纯 JS 实现的 Lynx Spec：Element PAPI + 双线程模型，跑在 Node.js）和 Lynx Explorer（官方真机运行环境 App，覆盖 Android/iOS 等）。（来源 7-9）注意其分工：**JS 模拟环境只能当"逻辑 oracle"，平台 API 语义必须以真运行时为准**——模拟环境自己也是需要被一致性测试检验的对象。

### 谁在用
- 各大浏览器厂商（Chromium/WebKit/Gecko 等，wpt.fyi 上持续提交结果，来源 2）。
- RN 社区（react-native-url-polyfill 用 WPT 派生单测，来源 5）。
- 微信（官方 automator + 真机自动化，来源 10）；Lynx 官方（testing-environment + Explorer，来源 7-9）。

### 对应我们哪个缺陷
A。`new URL(url).hostname` 的白名单校验逻辑本身正确，错在**信任了"运行时已正确实现 WHATWG URL"这一未经检验的假设**。业界对策不是"换掉这个 API"这么具体，而是：把项目实际依赖的平台 API 面（URL、fetch、storage、编码等）沉淀为**规范派生的一致性断言**，并在 Lynx 真运行时上跑（Lynx Explorer / 真机调试），双引擎对照。happy-dom 单测从此只当"浏览器语义的参考实现"，不再是 Lynx 行为的 oracle。

### 采纳成本
**低-中（1-3 天）**。无需自研：从 WPT 的 url/ 目录摘取与白名单校验相关的用例（如 host/hostname/protocol 解析），改写成 Vitest 单测，一份在 happy-dom 跑，一份通过 Lynx 真机通道跑；先覆盖项目实际用到的 API 即可。配套一条编码纪律：平台 API 调用收口到统一工具函数（如 `safeParseURL`），便于集中防御和 lint。

---

## 2. 真机灰盒 UI 自动化与爬虫测试——对应缺陷 B

### 业界做法是什么
- **灰盒（gray box）理念**：Wix 的 Detox 自我定位就是 "Gray box end-to-end testing and automation framework"；官方文档解释其"adopts a gray box testing approach, by having access to the internals of the app under test"——测试框架能看到应用内部状态，从而与 app **同步**（等待动画/请求结束再断言），消除黑盒 E2E 的 flaky。Wix 工程博客将此总结为：移动 E2E 稳定性的唯一出路是从黑盒走向灰盒。（来源 11-13）
- **状态遍历爬虫**：Firebase Test Lab 的 Robo test "automatically explore your app's UI, following state transitions as a user would, to find crashes and issues without requiring you to write test code"——**无需写测试代码**，爬虫模拟用户点击/滑动自动遍历状态空间找崩溃；Robo scripts 可在爬虫基础上叠加脚本动作。（来源 14-15）Google Play 的预启动报告（pre-launch report）对每个上传的构建自动运行同样的爬虫并汇总问题。（来源 16）
- **工具谱系与设备农场**：平台原生栈 Espresso（Android）/XCTest（iOS），跨端 Appium、Maestro；云端设备农场如 Firebase Test Lab、AWS Device Farm 提供真机矩阵。（来源 17）

### 谁在用
Wix（Detox，RN 生态事实标准）；Google（Robo 爬虫内置进 Play 发布流程，所有开发者免费获得）；微信小程序团队（automator 真机自动化，来源 10）。本项目自己的 android-e2e（Appium + 模拟器）也属于这一谱系。

### 对应我们哪个缺陷
B。"数据在、渲染没有"的 diff patch 缺陷只存在于**真实渲染管线**中，任何 JS 层 mock 都复现不了。业界的对应机制有两层：(1) 灰盒 E2E——在真机/真渲染引擎上执行"中途插入列表项"这类操作后，**对渲染树（而非数据层）断言**；(2) 爬虫——按状态转换自动遍历，不依赖人事先想到"返回列表、切筛选、翻页"的组合。

### 采纳成本
**中（3-5 天起步）**。项目已有 Appium android-e2e 基建（`pnpm test:android:e2e`），边际成本低：把状态转换路径补成 spec，断言落到渲染树/截图；Firebase Test Lab 与 Play 预启动报告有免费额度，配置后自动获得爬虫覆盖。无需购买设备农场。

---

## 3. 集成契约测试（Integration/Contract Tests）——对应缺陷 C

### 业界做法是什么
- **Fowler 的契约测试**：用 test double 替换外部服务做测试时，核心风险是"**double 是否真实代表外部服务**"——外部服务改了契约而你不知道。对策是周期性运行契约测试，验证"对 double 的调用与对真实服务的调用返回一致"；失败不阻塞构建，而是触发修复任务与双方对话；更进一步是 **Consumer Driven Contracts**：消费方把契约测试交给提供方，在提供方自己的流水线里跑。（来源 18）
- **Pact**：契约测试的事实标准工具，自我描述为 "code-first consumer-driven contract testing tool"——消费方测试生成契约文件，提供方重放验证；PactFlow 与 Microsoft 工程手册都把 CDC 定位为"替代大规模慢速集成测试的兼容性保证"。（来源 19-21）
- **组件级契约：Storybook interaction tests**——"interaction tests are built as part of a story. You then use a play function to simulate user behavior like clicks, typing, and submitting a form"，渲染后执行用户行为脚本并断言，可经 test-runner 进 CI。（来源 22）这正是"同一组件在真实交互序列下的行为契约"。
- **组件身份纪律**：React 官方文档明确了状态与组件身份的绑定规则——"React will keep the state around for as long as you render the same component at the same position in the tree"，`key` 用于控制保留/重置；Vue 文档同样要求用 key 维护列表项状态。社区配套 lint（eslint-plugin-react 的 jsx-key 等）把这个纪律固化。（来源 23-25）缺陷 C（轮播宿主复用实例、setup 只读一次 props）正是"宿主改变实例复用方式 → 隐式契约断裂"的教科书案例：React/Vue 的组件身份模型文档等于把这类坑写成了规范。
- 《Software Engineering at Google》Ch14 在论证"为什么需要大型测试"时给出了两个直接相关的概念：**unfaithful doubles**（替身与真实依赖不一致且会随时间腐化）与消费驱动契约测试的工程实践——把"两边单独都对、合起来就坏"归因为**契约无测试守护**。（来源 40）

### 谁在用
微服务领域普遍采用 Pact（Microsoft 工程手册推荐，来源 21）；前端组件库普遍采用 Storybook 交互测试（来源 22）；React/Vue 官方文档 + eslint 生态守护组件身份纪律（来源 23-25）。

### 对应我们哪个缺陷
C。缺陷 C 的本质不是"组件写错了"，而是**组件与宿主之间有一条从未被写下来的契约**（"每卡片新实例" vs "跨卡片复用同一实例"）。业界对应做法：(1) 把隐式契约显式化——为每个可复用组件写"宿主矩阵"交互测试（至少覆盖列表宿主 + 复用/轮播宿主两种实例化方式），Storybook play function 是现成的形式模板；(2) 建立组件身份纪律（何时必须 key/remount），必要时上 lint。注意：**不需要上 Pact broker**——契约测试的思想（双方各自验证同一契约）在进程内组件之间同样适用，一套 Vitest 交互测试即可。

### 采纳成本
**低（1-2 天）**。纯单测层可写：对收藏按钮类组件补"第二种宿主"的测试（项目已有 `IllustDetail.gesture.test.tsx` 这类行为契约测试先例）；把"可复用组件必须在 ≥2 种宿主形态下验证状态机"写入 code review 检查项。

---

## 4. 状态转换/模型驱动测试 + 探索式测试——对应缺陷 D

### 业界做法是什么
- **SBTM（Session-Based Test Management）**：James & Jon Bach 把探索式测试工程化的经典方案，原文定义："In our practice of exploratory testing, **a session, not a test case or bug report, is the basic testing work unit**"——session 是不间断的时间盒（约 60-90 分钟），由**charter（任务书）**驱动，结束后产出结构化报告（时间分配、bug、风险、覆盖）并做 debrief。Wikipedia 概括其目标为 "combine accountability and exploratory testing to provide rapid defect discovery"。（来源 27-30）关键点：它承认"缺陷藏在没人写用例的地方"，用**有约束的漫游**代替穷举用例。
- **模型驱动测试（model-based testing）**：Stately 的 @xstate/test "contains utilities for facilitating model-based testing"，从状态机定义**自动生成测试路径**，"ensuring comprehensive coverage of all possible paths"。（来源 26）先把状态/转换显式建模，测试用例从模型派生——转换被遗漏的可能性从"人的遗漏"变成"模型的完备性检查"。
- **bug bash / dogfooding**：bug bash 是发布前全团队（不止 QA）的限时集体探索测试（有专书，来源 31）；《Software Engineering at Google》Ch14 将探索式测试（含 bug bash）与 dogfooding（吃自己的狗粮）列为大型测试体系的正式组成部分——Google 内部通过内部使用自己产品来暴露自动化测不到的问题。（来源 40）

### 谁在用
SBTM：测试行业通用方法论（Satisfice/Rapid Software Training 体系，来源 28-29）；模型驱动：XState/Stately 用户（来源 26），Spotify 历史上也用过 model-based testing（Kristian Karl 的分享，来源 42）；bug bash/dogfooding：Microsoft 传统实践、Google 正式纳入工程书（来源 31、40）。

### 对应我们哪个缺陷
D，且是 4 个缺陷的共性根源：**全部发生在状态转换（时序+序列）中**。业界共识：这类缺陷位于"按状态写单测"的盲区，因为单测天然 mock 掉了时间与事件序列。对策分三档：(1) 最轻——**手工转换矩阵**：枚举"页面 × 动作 × 引擎"的转换路径（返回列表/切换筛选/翻页/滑动换卡），作为每次发版前的真机手工清单，这实质上就是 30 分钟的微型 SBTM session；(2) 中——对核心流程画状态机，转换矩阵从模型派生（不必引入 XState 运行时，纸上建模即可，或用 @xstate/test 生成用例）；(3) 流程件——定期 bug bash + 团队自己日常使用 beta 版（dogfooding）。

### 采纳成本
**极低（流程件）到中（模型化）**。转换矩阵 + SBTM 式 session 是零基建的流程约定；状态机化某个核心流程约 1-2 天；不引入新框架也能获得 80% 收益。

---

## 5. Shift-right：发布侧兜底——所有缺陷的最后一网

### 业界做法是什么
- **分阶段发布/金丝雀**：Google SRE 书《Release Engineering》描述了以 canary 为核心的发布工程——变更先小范围验证、按风险调整发布节奏、出问题即回滚（push-on-green + 自动化发布管道）。（来源 32）Google Play 把这套机制产品化给所有开发者：staged rollout——"With a staged rollout, your update reaches only a percentage of your users, which you can increase over time"（可先向小比例用户发布，逐步提升比例，可暂停/回退）。（来源 34-35）
- **错误率/崩溃率门禁**：Android Vitals 由 Play 自动收集崩溃率、ANR 等指标，并定义"恶劣行为阈值"（bad behavior thresholds），超标会影响应用在商店的曝光。（来源 36）SRE Workbook 的 Alerting on SLOs 给出了"错误预算"化的通用门禁思想：错误率超阈值即停止/回滚发布。（来源 33）
- **移动端 RUM 与会话回放**：Sentry 官方提供 Android Session Replay（错误事件与用户会话回放关联）；Embrace 定位移动观测（Mobile RUM）："Complete user journey visualization with session replay, interaction tracking, and detailed event timelines for context-rich debugging"；Datadog 亦有 Embrace 集成。（来源 37-38）这类工具的独有价值：能抓**不崩溃的行为破损**（比如"搜索翻页全挂但进程没死"），这正是缺陷 A/B/C/D 在线上的表现形式——纯 crash 上报会漏掉它们。
- **Beta 通道**：TestFlight（官方 beta 分发）与 Play 测试轨道（内部/封闭/开放）是"扩大 dogfooding 半径"的标准载体。（来源 34、39）

### 业界共识
验证层（tests）永远有漏网——SWE at Google Ch14 论证大型测试必要性的起点就是单测覆盖不了"不可预期的输入与真实环境的交互"，而生产环境的问题"已经在影响最终用户"，因此发布侧必须有自己的观测与回滚机制（probers/canary analysis）。（来源 32、40）测试金字塔再完美也不能替代发布侧遥测；两者的分工是：测试网收窄已知风险，遥测网兜住未知风险。

### 对应我们哪个缺陷
A-D 全部适用。尤其注意：4 个缺陷中没有一个是"崩溃"型的（A 是功能误拒、B 是渲染缺失、C 是状态冻结），**crash-only 的监控对这类缺陷完全失明**，必须依赖错误/行为遥测与用户反馈通道。

### 采纳成本
**低起步，按需加码**。Play staged rollout + Vitals 是商店免费自带（零开发量，纯操作流程）；Sentry 有免费额度，接入 SDK 约半天-1 天；会话回放涉及隐私评审与流量成本，放后期。

---

## 6. 测试策略辩论：金字塔 vs 奖杯 vs 蜂巢——UI 重的 App 如何取舍

### 三种形状
- **金字塔**（传统）：大量单测为底、集成居中、E2E 在顶。《Software Engineering at Google》Ch11-12 系统化了这一模型并细化为"测试大小"（small/medium/large：small 限单进程、large 可跑任意真实环境），Google 的分布指导约为 80/15/5（小/中/大）；Ch14 则正面回答"为什么只有金字塔不够"：保真度（fidelity）不可替代，且单测 mock 掉的部分正是缺陷聚集地。（来源 40）
- **奖杯**（Kent C. Dodds，2018）：顶部是静态检查，主体是集成测试。其口号化的来源是 Guillermo Rauch 的推文 "**Write tests. Not too many. Mostly integration.**"，Dodds 论证集成测试在"信心/成本"权衡上最优。（来源 41）
- **蜂巢**（Spotify，Kristian Karl）：与金字塔相反，**集成测试是重心**，单测和 E2E 都少；手工测试精力聚焦特性测试而非回归。来源是其本人在 EuroSTAR 的访谈与演讲（"At Spotify, we want the manual testing effort to be focused as much as possible at feature testing, less on regression tests"）。（来源 42）

### 对 UI 重的移动双引擎 App 的含义
三种形状的辩论在本团队的语境下收敛为同一结论：**重心应从"状态级单测"移向"真运行时的集成/交互测试"**。理由：
1. 奖杯与蜂巢都把集成层当性价比最高的层——而本团队 4 个缺陷全部位于集成层（组件×宿主、数据×渲染、页面×转换）；
2. SWE book 的"测试大小"理论告诉我们 small test（happy-dom 单测）对保真度让步太大，需要 medium/large 层（真 WebView、真 Lynx 运行时）补位——这正对应缺陷 A/B；
3. 但三者都不否定单测：契约/一致性断言（第 1、3 节）本身仍以单测形式存在，只是**断言对象换成了真实运行时行为**。

---

## 7. 1-2 人小团队的最低可行采纳清单（按投入产出排序）

> 排序原则：先"零基建的流程/纪律件"（直接对症 4 个缺陷），再"1-3 天的轻基建"，最后"周级/持续成本的观测与农场"。每项标注对应的缺陷原型。

### 第一档：本周可做（零基建，流程与纪律）
1. **状态转换矩阵手工清单**（对应 D，成本：一次约 2h 建表 + 每次发版前约 30min）：枚举"页面 × 用户动作 × 引擎（WebView/Lynx）"，重点覆盖 4 个缺陷涉及的转换类（返回列表、切换筛选、翻页、滑动换卡）。发版前真机按清单过一遍 = 微型 SBTM session（来源 27-29）。
2. **平台 API 一致性冒烟**（对应 A，成本：约 1 天）：列出运行时实际依赖的平台 API（URL 解析、fetch、storage…），为每个写 3-5 条规范派生断言（WPT url/ 用例改写），在 Lynx 真机通道（Explorer/真机调试）跑，与 WebView 侧对照。同时收口编码纪律：禁止业务代码裸调 `new URL()`，统一走 `safeParseURL` 工具函数（借鉴 react-native-url-polyfill 的 WPT 派生测试模式，来源 3、5）。
3. **宿主矩阵测试**（对应 C，成本：约 1 天）：每个可复用组件至少在 2 种宿主形态（列表宿主 + 轮播/复用宿主）下断言"状态随 props/卡片切换正确更新"；把"组件身份与 key/remount 纪律"写入 code review 检查项（形式参照 Storybook play function 与 React/Vue 官方组件身份模型，来源 22-24）。
4. **Play staged rollout 默认化 + Vitals 周查**（对应 A-D，成本：纯操作，0 开发）：新版本一律先 20% 分阶段发布再放全量（来源 34、35）；每周查看 Vitals 崩溃率/ANR（来源 36）。
5. **dogfooding 制度化**（对应 D，成本：0）：团队自己日常使用 staged/beta 通道版本（来源 39、40）。

### 第二档：轻基建（每项 1-3 天）
6. **灰盒 E2E 补状态转换路径**（对应 B/D）：基于既有 Appium android-e2e 基建，把第一档的转换矩阵自动化成 spec；断言落到**渲染树/截图**而非数据层；关键路径每 PR 跑（灰盒理念见 Detox，来源 11-13；爬虫思想见 Robo，来源 14-16）。
7. **WPT 派生 conformance 单测子集例行化**（对应 A）：把第一档第 2 项扩成常驻测试文件，运行时/依赖升级时必须重跑（来源 1-5）。
8. **组件交互测试双环境跑**（对应 C/B）：同一组交互用例在 web 预览与 @lynx-js/testing-environment 各跑一遍——但牢记"模拟环境不是平台语义的 oracle"（unfaithful doubles 教训，来源 7、40），平台语义仍以第 6/7 项的真机断言为准。
9. **错误监控接入**（对应 A-D）：接 Sentry（或等价）SDK，先要错误聚合 + 面包屑（用户操作序列），暂不开会话回放（来源 37）。

### 第三档：按需/有富余再上（周级或持续成本）
10. **移动端会话回放 / RUM**（对应 A-D）：Sentry Session Replay 或 Embrace——对"不崩溃的行为破损"有独特定位价值；需隐私评审与流量预算（来源 37-38）。
11. **Robo 爬虫例行化**（对应 B/D）：Play 预启动报告每次上传自动跑（免费，来源 16）；需要更强遍历时用 Firebase Test Lab Robo + Robo scripts（来源 14-15）。
12. **核心流程状态机化 + 用例生成**（对应 D）：仅当某流程状态组合爆炸时才值得（@xstate/test，来源 26）。
13. **设备农场扩机型矩阵**（对应 A/B）：真机碎片化成为实际问题时再上 Firebase Test Lab / AWS Device Farm（来源 17）。

### 优先级依据
- 4 个缺陷中 3 个（A/B/D）的共同本质是"**从未在真实运行时上断言过交互行为**"——第一档第 1/2/5 项直接对症且近乎零成本；第 3 项（C）是纯单测层可写的，收益最直接。
- 业界没有银弹能在"单测 + review"层抓住全部运行时缺陷；共识是**三层网**：规范派生一致性测试（治 A）、真运行时交互/契约测试（治 B/C）、显式转换清单 + 探索式测试（治 D），外加默认开启的发布侧遥测（兜住全部漏网）。
- 小团队的相对优势恰恰在流程件：转换矩阵、SBTM session、dogfooding、staged rollout 都不依赖人数与基建，这是大厂反而难以全员执行的。
