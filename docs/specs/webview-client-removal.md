# Spec：WebView 客户端源码删除与宿主迁移

> 决策：[ADR-0203](../../adr/ADR-0203-webview-client-source-removal.md)
> 术语：[glossary-webview-client-removal](../../adr/glossary-webview-client-removal.md)（本 spec 全文沿用其词）
> 规模口径：2026-09-29 `git ls-files` 实测
> 前序：[ADR-0201](../../adr/ADR-0201-single-engine-facade-consolidation.md)（门面收口）、
> [ADR-0202](../../adr/ADR-0202-ota-web-bundle-channel-retirement.md)（OTA 通道下线）
> Issue：[#819](https://github.com/a1121611810/Pictelio/issues/819) 第 4 项的执行

## Problem Statement

Pictelio 的 WebView 客户端**运行时**已随 #610 下线，OTA web bundle **发布通道**已随 ADR-0202 下线。
但开发者打开仓库看到的仍是双引擎形态：`packages/app` 里躺着 295 个文件的 SolidJS 客户端源码、
5 个 Capacitor npm 依赖、一整套 Vite/UnoCSS 构建配置，以及一个每次 `pnpm dev` 都会起、
但**永远不会被任何 Activity 加载**的 web 产物链。

更糟的是这个包的名字具有误导性——它同时是 Android 工程的宿主、发布链的宿主、原生 E2E 的宿主。
于是「WebView 到底下线了没有」这个最基础的问题，**读代码得不到答案**：
同一个目录里既有确定要删的死代码，又有承载当前产品的原生工程。

现状的具体症状：

- 一次 `pnpm install` 会装进 Capacitor、agent-browser、canvas、webdriverio 等一整套 WebView 时代依赖
- 根 `pnpm dev` 起的是一个没有用户的 Vite 服务
- 「去 Capacitor 化」与「Capacitor 依赖仍在」在同一行技术栈描述里并存
- APK 里仍打包着一份 1.4MB 的 web 产物（未被 git 追踪的旧构建残留），压缩后约占全包 0.8%
- 新人无法判断：改 `packages/app/src` 是在改产品，还是在改一堆死代码

## Solution

把「宿主」与「客户端」彻底分开，并把后者删除。

**第一步，宿主迁移**：把仍在承重的 Android Gradle 工程、发布脚本、原生 E2E 迁到新包
`packages/android-host`（npm 名 `@pictelio/android-host`），并把两处跨包 fail-closed 读取的
事实源（Pixiv OAuth 凭证、产品版本号）迁到 `packages/app-lynx`——那是唯一客户端，凭证与版本本就属于它。
迁移完成后，app-lynx 不再跨包读取，宿主包改为消费它们。

**第二步，客户端删除**：删除 `packages/app` 整包，连同 295 个源文件、5 个 Capacitor 依赖、
Vite/UnoCSS 构建配置、agent-browser E2E 套件，以及随源码失去意义的单测。

**第三步，收敛残留**：清理 `@pictelio/update-check` 的 web bundle API（ADR-0202 保留它的理由
是「消费层源码仍 import 它」，而该前提随源码删除自动解除）；把仍有价值的行为基准从差分测试
迁到 app-lynx 并**改写语义**。

**第四步，证明**：用**一个仓库不变量契约测试**回答「删干净了吗」——它是本次唯一的总闸。

## User Stories

### 作为仓库维护者

1. As a 仓库维护者, I want `packages/app` 整个目录消失, so that 任何人都不可能误改一段没有用户的代码
2. As a 仓库维护者, I want Android 原生工程与发布链在迁移后仍能产出可安装的 APK, so that 迁移被证明是保真的而非破坏性的
3. As a 仓库维护者, I want 迁移前后的 Java 行数、单测数、脚本数逐件对得上, so that「没丢东西」是可核对的而非凭感觉
4. As a 仓库维护者, I want 一个测试能直接回答「WebView 删干净了吗」, so that 我不必靠人工 grep 考古
5. As a 仓库维护者, I want 那条测试的每条断言都配阳性对照, so that 恒绿的假防线不会被我当成已完成
6. As a 仓库维护者, I want `pnpm dev` 起的是真正的 Lynx 客户端, so that 新人第一条命令就有用
7. As a 仓库维护者, I want 根命令不再委托给一个不存在的包, so that 命令表不会教人跑空
8. As a 仓库维护者, I want 删包后 `pnpm install` 不再装 Capacitor 与浏览器测试栈, so that 安装更快、攻击面更小
9. As a 仓库维护者, I want pre-push 门禁在删包后仍然工作, so that 我的提交不会因为一个悬空 import 被全量拦截
10. As a 仓库维护者, I want CI 的 Robolectric job 在新结构下仍然跑真实的原生单测, so that 原生防线不塌
11. As a 仓库维护者, I want 删掉那些只对 WebView 有效的脚本, so that 仓库里不再有跑不起来的 bench 工具
12. As a 仓库维护者, I want 知道删除会少掉哪些防线, so that 我能判断这个交换是否划算

### 作为读到技术栈描述的开发者

13. As a 开发者, I want 技术栈里不再出现 Capacitor 与 SolidJS, so that 我不会去找一个已删的运行时
14. As a 开发者, I want AGENTS.md 的入口指向真实的 Lynx 入口, so that 我按文档能走通
15. As a 开发者, I want 架构分层描述指向 packages/app-lynx, so that 我知道去哪找组件与 store
16. As a 开发者, I want 命令表里的每条命令都还真实存在, so that 我不会照着文档跑出一个 command not found
17. As a 开发者, I want 「宿主包」这个词有明确定义, so that 我理解 packages/android-host 不是客户端

### 作为已安装应用的用户

18. As a 已安装 v6.3.0 的用户, I want 升级后 refresh_token 仍能被读出来, so that 我不用重新登录
19. As a 已安装 v6.3.0 的用户, I want 我设置过的偏好全部保留, so that 这次重构对我是无感的
20. As a 已安装 v6.3.0 的用户, I want 升级包能正常覆盖安装, so that 构建链没被改坏

### 作为读到历史文档的人

21. As a 读者, I want 历史 ADR 与 spec 顶部有存档横幅, so that 我知道它描述的形态已下线但不误以为它是错的
22. As a 读者, I want 历史文档的正文一字不改, so that 实现记录与踩坑结论不丢失
23. As a 读者, I want 那些只在 WebView 侧记录过、但仍然有效的领域知识被保住, so that 下一位接手的人不用重新踩坑

### 作为 Lynx 客户端的维护者

24. As a Lynx 维护者, I want app-lynx 不再跨包 fail-closed 读取, so that 别的包消失不会让我的构建崩
25. As a Lynx 维护者, I want 我的版本号与凭证由我自己的包持有, so that 单一事实源名副其实
26. As a Lynx 维护者, I want 删包不会让 app-lynx 的 CI 转红, so that 我的门禁仍然可信
27. As a Lynx 维护者, I want 那些有价值的真值表基准活下来, so that Lynx 侧行为漂移仍能被发现
28. As a Lynx 维护者, I want APK 更新检查不受影响, so that 强制更新流程照常

## Implementation Decisions

### 决策一：两个动作，硬顺序

**宿主迁移**（承重资产换位置）与**客户端删除**（死代码消失）必须分开做，且迁移先做完。
理由：`packages/app-lynx` 的构建配置在配置期 fail-closed 读 `packages/app` 的凭证与版本；
仓库根的 pre-push 脚本反向 import `packages/app` 的一个 git 工具模块；
CI 的原生单测 job 以 `packages/app/android` 为工作目录。
先删包会同时打断 Lynx 构建、pre-push 门禁与 CI——三处同时红，且互相掩盖。

### 决策二：宿主包的新身份

`packages/android-host` 承重四类资产：Android Gradle 工程、构建/发布脚本、
`tests/android-e2e/**`、`tests/unit/scripts/**` 与 `tests/unit/android/**`。

**保真迁移**的含义是**逐件搬走、不改写**：Java 生产代码、JVM/Robolectric 单测、
android-e2e 文件、发布脚本及其单测，一件不少，且全部仍被既有门禁覆盖。
不借迁移之机做任何重构——那会让「迁完了没有」变得不可判定。

**选定新建包而非留包改名**：留包会让包名与内容长期错配，而改名要重写的工作量
（根脚本委托约定、命令表、CI 路径）一个都省不掉。既然都要付这笔钱，就一次付清。

### 决策三：两处事实源的归属变更

| 事实 | 原归属 | 新归属 | 理由 |
| --- | --- | --- | --- |
| Pixiv OAuth 凭证 | 宿主包 | `packages/app-lynx` | 唯一客户端持有自己的凭证 |
| 产品版本号 | 宿主包的 package.json | `packages/app-lynx` 的 version | APK 版本与客户端版本本是一回事 |

迁移后 app-lynx 读**自己包内**的文件，跨包 fail-closed 消失；
凭证/版本同步脚本改为消费 app-lynx。

### 决策四：OTA 残留的清理边界

清理 `@pictelio/update-check` 的 web bundle 相关 API（`minWebVersion` / `webBundle` /
`parseWebBundle` / `parseMinWebVersion` / `isBelowMin`），因为其唯一消费层随源码删除而消失。

**但保留 APK 更新检查**——app-lynx 的 `updateStore` 消费的是 `checkForUpdate`，
与 web bundle 无关。`@pictelio/update-check` **不是孤儿包**，必须留存。

### 决策五：真值表的迁移必须改写语义

`packages/app/tests/unit/differential/` 的 28 个文件随包删除。其中承载行为基准的部分
迁到 app-lynx 的差分测试目录，但**必须改写断言与命名**：

- 「A ↔ webview 一致」→ 若存在对侧（Java 实现或 spec），改为「A ↔ 对侧契约」；若不存在对侧，改为「A 单端行为基准」
- 双份的 shared fixture 删 webview 副本，Lynx 副本成为唯一事实源

**不允许**原样搬运后仍叫 differential。删除一侧之后，差分的**对侧已经不存在**，
继续用差分措辞描述单端断言是失实陈述。

### 决策六：根命令裸名的重新定义

既有 ADR-0059 确立「`<命令>` 裸名 = 委托给 WebView 客户端包」。删包后该约定失去目标。
由本 spec 重新定义：`dev` / `build` / `check` / `test` / `preview` 五条裸命令改指 Lynx 客户端；
Android 构建、发布、原生 E2E 一律走显式的 `pictelio-android-host` 形式，不占用裸名。

### 决策七：存量格式契约不可动

以下字面量必须原样保留，即使它们看起来是 WebView 时代的遗产：

- 安全存储层的前缀常量 `capacitor-storage_`
- 偏好存储的 SharedPreferences 名称 `CapacitorStorage`

依据 ADR-0050。它们是**存量用户数据格式**。改动会导致已安装用户读不到 refresh_token
与全部设置——这是数据事故，不是清理。

由此推出一条纪律：**不得**写「仓库内 `capacitor` 出现次数为 0」这种断言。
正确形态是「依赖声明为 0」与「存量格式契约 ≥ 1」**同时**成立。

### 决策八：接受的缺口（4 项，明确不再补做）

| 缺口 | 为何接受 |
| --- | --- |
| 浏览历史 | WebView 侧依赖 TanStack DB；是唯一有真实产品价值的缺口，另立票再议 |
| 图床设置写入口 | 读端原生实现在 Lynx 侧仍生效，但 WebView 侧写端随源码删除；接受退回默认图床 |
| 图片缓存三层设置 UI | 其 L3 走的是早已不存在的 Capacitor 插件，运行时本就不可用 |
| PKCE 授权码登录 | 其插件的 Java 对端已不存在，WebView 侧运行时已失效 |

**实施纪律**：这四项是**主动接受**的删除结果，不是「已知问题」。
实施期不得把任何一项悄悄扩大为「顺便补上」——那是范围蔓延。

### 决策九：需要删掉的「无被测对象」资产

以下资产在删除后没有任何被测对象，一并清除，不留骨架：

- agent-browser E2E 套件（12 个 spec，依赖 Vite 5173 dev server）
- E2E 锚点静态校验脚本（锚定已删的源码目录）
- WebView 专项 bench 脚本（CDP 通道、WebView 导航/图片就绪专项）
- 引用已删 flavor 拼法（如 `assembleFullDebug`）的回归脚本
- 发布步骤表里「构建 Web 产物」这一步（产物在 APK 中无落点）
- 本机未追踪的残留：Capacitor gradle 生成物三件套、APK 内的 web 产物目录、本地 iOS 壳

## Testing Decisions

### 什么算好测试

只断言**外部可观察的后果**，不断言实现细节。对本次工作而言，「实现细节」与「外部行为」
的分界线是：**仓库的最终形态**（有什么、没有什么、指向哪里）是外部行为；
**某个脚本内部怎么组织**是实现细节。

沿用本仓既有纪律：期望值必须溯源到独立来源（ADR / 实测 / 官方规范），
禁自洽反推；兜底路径必须显式暴露而非静默。

### 核心缝：单一仓库不变量契约测试

本次**只设一个总闸**，放在宿主包内。它一次性回答「WebView 删干净了吗」，
覆盖以下不变量（每条都配阳性对照——把违规塞回去必须转红）：

1. `packages/app` 目录不存在
2. 任何 package.json 都不再声明 Capacitor 依赖
3. 宿主资产齐全：Gradle 工程、Lynx 原生模块、发布脚本、android-e2e 目录、JVM 单测源集
4. 存量格式契约仍在（前缀常量与 SharedPreferences 名称均命中）
5. app-lynx 不再跨包引用被删目录
6. 根命令表里不再有委托给已删包的命令
7. 门面措辞收敛：技术栈不含 Capacitor / SolidJS，入口指向 Lynx

**阳性对照是强制项**，不是加分项。判据：本仓此前多条防线在「改动前就已绿」，
是恒真的假防线；唯一能识破的办法是每次写完立刻把违规塞回去看它转不转红。

**「不存在」类断言的检测式必须先证明能命中已知目标**。
特别是：`capacitor` 字样减少但**不归零**（决策七），
所以第 2 条只断言「依赖声明为 0」，不断言「全仓字样为 0」。

### 复用的既有缝（不新建）

| 缝 | 迁移动作 | 证明什么 |
| --- | --- | --- |
| 发布步骤表单测 | 迁到宿主包，删「构建 Web 产物」步的期望 | 迁移后发布链的步骤表仍自洽 |
| 退役参数门禁单测 | 原样迁 | 删除 CLI 参数后仍被显式拒绝 |
| AGENTS.md 契约测试 | 迁到宿主包，去掉 Capacitor 版本断言，保留体积门禁 | 文档未失控膨胀 |
| Gradle Robolectric（49 个） | 随 Gradle 工程迁移 | **原生代码逐件搬走、行为不变**（最强的保真证据） |
| android-e2e 契约单测（8 个） | 随 e2e 目录迁移 | 发版门工具链仍自洽 |
| app-lynx 自身单测（约 195 文件） | 不动，但修一处跨包读取 | 客户端未被打断 |
| R8 keep 规则契约测试 | 随宿主迁移 | 混淆规则与原生类名仍对齐 |

### 跨端差分测试的降级处理

那批「webview ↔ Lynx」差分测试迁移后不再有对侧。按决策五改写为
「Lynx ↔ Java / spec 契约」或「Lynx 单端基准」，并在文件名与 describe 措辞上体现——
不允许保留 differential 命名却只做单端断言。

### 先例

- 源扫描契约测试：`noControlChars.test.ts`（含阳性对照与 macOS bash 假阴性的坑位说明）
- oracle 溯源写法：`agentsMd.contract.test.ts`（每条断言标注 oracle 来源）
- 步骤表守卫：`release-build-steps.test.ts`（含改名复活导致字面量匹配漏过的先例，故改语义匹配）

## Out of Scope

- **不补做 4 项接受的缺口**（决策八），实施期不得扩范围
- **不重构**被迁移的 Java / 脚本内部实现，只搬不改
- **不删除历史 ADR 与 spec 正文**，只加存档横幅
- **不手改 `openwiki/`**，那是 CI 定时重生成的产物
- **不调整产品功能与 UI**，本次不碰任何面向用户的改动
- **不处理 #819 的其他子项**（发版门 R1 口径、versionCode 序列等），只做第 4 项
- **不动 versionCode / 版本序列决策**，那是独立的待定项
- **不清理 `packages/app-nuxt/` 幽灵目录**，与本次删除无因果关系，另行处理
- **不引入新的 lint / fmt 覆盖面**（ADR-0185 挂账的 app-lynx 风格债清偿是独立工作），
  但需在结论中记录覆盖面变化的事实

## Further Notes

**执行顺序的红线**

1. 宿主迁移必须整体完成并验证，才允许进入删除阶段
2. 改 `AGENTS.md` 之前，先把以被删包为 oracle 的契约测试迁走——
   否则会出现一段「文档已改、oracle 已失效」的 CI 红窗口
3. app-lynx 里那个读 WebView 源码的 i18n 契约测试必须与删除**同批**改写，
   否则它会在 app-lynx 自己的 CI 里转红——这是唯一会「从对面炸回来」的陷阱

**必须一并处理的连带项**

- pre-push 门禁里对已删包的反向 import 与域规则
- CI 两个工作流里的字面路径
- 根 lint/fmt 配置里指向已删包的忽略规则
- 命令教学文档（README、AGENTS.md、发布清单）里会让人跑空的操作命令

**知识保全**

被删源码里有若干 Lynx 侧**没有**、但仍然有效的领域结论（其中最关键的是一组
关于搜索关键词的实测硬约束，以及图床缓存键契约）。它们只存在于被删的领域上下文文档中，
删除前需迁到 app-lynx 的领域文档或 spec。这是本轮**唯一有信息损失风险**的环节，
必须在删除前完成，不能「删完再补」。

**验收口径**

完成 = 核心缝的全部断言转绿 + 既有缝全部保持绿 + APK 可构建安装 + 全新 clone 上
`pnpm install && pnpm test:all && pnpm check:all` 全绿。
其中「APK 可构建安装」与「全新 clone 可复现」必须实测，不能以「理论上可行」代替。
