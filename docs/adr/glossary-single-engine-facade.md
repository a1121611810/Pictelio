# 单引擎事实源与门面一致性 — 统一术语文档（glossary-single-engine-facade）

> 状态：已定稿。供 `README.md`、`packages/website/`、`AGENTS.md` 三处门面与后续 ADR 复用同一措辞。
> 背景：[#610](https://github.com/a1121611810/Pictelio/issues/610) 单引擎化已合入 main，v6.3.0 为首个单引擎发布版；
> 但三处门面仍叙述双引擎形态，措辞互不一致。本文档是它们**唯一的措辞来源**。
> 决策：[ADR-0201-single-engine-facade-consolidation.md](./ADR-0201-single-engine-facade-consolidation.md)。
> 已阅读基线：`CONTEXT-MAP.md`、`packages/app/CONTEXT.md`、`packages/app-lynx/CONTEXT.md`、
> `glossary-cross-engine.md`、`glossary-client-switch.md`、ADR-0062/0164/0177/0180、#805 / #819。
> 术语惯例沿用 `CONTEXT.md`：中文定义 + 英文标识符；`_Avoid_` 标注禁用词。

## 为什么要写这份文档

门面收口的失败模式不是「漏改一处」，而是**三处各改各的**：`README.md` 写「WebView 已下线」、
落地页写「双引擎随时切换」、`AGENTS.md` 写「自定义 Capacitor 插件在 `MainActivity.java` 经
`registerPlugin()` 注册」——三句互相矛盾，且第三句指向一个**不存在的类**。

根因是「webview 下线了」这句话本身有歧义：它可以指运行时、可以指源码、可以指依赖。
三处门面各自按不同理解落笔，于是必然分叉。本文档先把三态钉死，再给出可逐字复制的措辞锚点。

## 术语

### 单引擎事实（Single-engine facts）

**单引擎（single-engine）**：
Pictelio 当前只提供 Lynx 客户端一种渲染形态。WebView 客户端已随 #610 整体下线。
_Avoid_: 双引擎（dual-engine）、双客户端、双引擎形态 —— 描述**当前**状态时一律是历史错误；
仅在描述**历史决策**时可用（且须加时间限定）。

**运行时下线（runtime decommissioned）**：
WebView 客户端在**构建链与进程入口**层面的下线。实测判据（2026-09-29）：

| 判据 | 实测值 | 复核命令 |
|---|---|---|
| Gradle `productFlavors` | 无，单 variant | `grep productFlavors packages/app/android/app/build.gradle` |
| 进程入口 | `LynxActivity` / `PictelioAppLynx` | `find packages/app/android -name "MainActivity*.java"` → 0 |
| Android 源集 `com.getcapacitor` 导入 | **0** | `grep -r com.getcapacitor packages/app/android/app/src/` |
| Android 源集 `registerPlugin` 调用 | **0** | `grep -rn registerPlugin packages/app/android/app/src/ --include="*.java"` |
| `capacitor.config.ts` | 仓库内不存在 | `git ls-files \| grep capacitor.config` → 0 |

> ⚠️ **判据的作用域**：上表全部限定在 **Android 源集 / 仓库内**。
> `registerPlugin` 在**留存 WebView 源码**中仍有 22 处出现、分布 11 个文件
> （`packages/app/src/native/`；其中 11 处是 import、11 处是调用）
> —— 那属于「源码留存」，不是「运行时」。**不可把「Android 侧为 0」表述成「全仓为 0」**，
> 那正是本文档首版写错、且与下文「依赖留存」自相矛盾的地方。
> 同理，APK 内仍残留 `assets/public/*` 与 capacitor 配置残件（#819-4 实测：解压后约 1.4 MB，
> 压缩进包约 439 KB ≈ 全包 0.8%）。**两个数测的是不同东西**——解压体积与压缩后包内增量不可互换；
> 引用时注明口径。该目录被 `packages/app/android/.gitignore` 忽略，故体积只能在构建产物上量，
> 新 clone 无法复现，以 #819-4 的记录为准。

_Avoid_: 已删除（deleted）—— 见「源码留存」。

**源码留存（source retained）**：
`packages/app/src/**` 的 SolidJS 客户端源码（约 291 个源文件）与约 170 个单测文件**仍在库中**
（`packages/app/tests/unit/**/*.test.ts` 实测 169，随增删变动，引用时给命令不给定数），
但无任何 Activity 承载，**运行时永不被加载**。清理挂 [#819](https://github.com/a1121611810/Pictelio/issues/819) 第 4 项，
**不在门面收口范围内**。
_Avoid_: 已删除、已废弃（deprecated）—— 说「已删除」会误导后续读者去 `packages/app/src` 找可运行代码。

**依赖留存（dependency retained）**：
**5 个** Capacitor npm 依赖（`@capacitor/{android,app,core,preferences,cli}`）仍在
`packages/app/package.json` 中声明（全仓仅此一个 package 声明它们），
因为「源码留存」的代码仍在 import 它们。**依赖留存是源码留存的派生结果，不是独立决策。**

> ⚠️ **对 agent 的硬约束**：`packages/app/tests/unit/agentsMd.contract.test.ts` 以
> `packages/app/package.json` 为 oracle，断言 `AGENTS.md` 逐字包含 `Capacitor 8.5`。
> 因此**依赖留存期间不得从 `AGENTS.md` 删除 `Capacitor 8.5` 字样**，只能加限定语。
> 该依赖的清理属 #819-4；清理后本约束同步解除。

**三态并存（three coexisting states）**：
运行时下线 / 源码留存 / 依赖留存**同时成立**。任何只描述其中一态的表述都是不完整的。
_Avoid_: 用单一断言概括，如「Capacitor 已移除」（对依赖层为假）、「WebView 客户端已删除」（对源码层为假）。

### 门面（Facades）

**门面（facade）**：
向人类读者或 agent 叙述项目形态的对外表面。本项目共三处：

| 门面 | 读者 | 载体 | 更新触发 |
|---|---|---|---|
| 落地页 | 外部用户 | `packages/website/`（GitHub Pages 自动部署） | push main 且改动 `packages/website/**` |
| 说明文档 | 外部用户 / 贡献者 | `README.md` | 随代码 |
| 指令文档 | agent | `AGENTS.md` | 随代码，受体积门禁约束 |

_Avoid_: 首页、文档 —— 「门面」特指**叙述形态**的表面，不指承载业务的代码。

**措辞锚点（wording anchor）**：
三处门面描述引擎形态时**必须逐字复用**的句子，见下节。存在的唯一目的是防止再次分叉。
_Avoid_: 各门面自行改写同义句（2026-09-29 的分叉根因）。

**存档横幅（archive banner）**：
对**历史文档**（ADR、`docs/research/**`、`docs/specs/**`、双引擎期术语文档）加的一行状态声明，
声明「本文描述的是已下线形态，保留供决策史参考」。**只加横幅，正文一字不改。**
_Avoid_: 按当前事实改写历史文档（抹掉决策史）、直接删除（丢失 ADR 之外的实现记录）。

**事实源（source of truth）**：
某一事实的权威归属位置。归属见下表——**门面不得自行成为事实源**。

| 事实 | 事实源 |
|---|---|
| 版本号 | `packages/app/package.json` `version` |
| `versionCode` | `packages/app/android/app/build.gradle` |
| 构建变体 | `packages/app/scripts/lib/release-utils.mjs` `RELEASE_BUILD_TYPES` |
| npm 依赖 | `packages/app/package.json` |
| 架构叙述 | `openwiki/`（**生成物**，CI 定时重生成；禁止手改、禁止本地 `pnpm openwiki:update`） |
| 引擎形态措辞 | **本文档** |

## 措辞锚点（逐字复用）

三处门面描述引擎形态时使用以下两句，**不改写、不缩写、不补充**：

> Pictelio 自 v6.3.0 起为 **Lynx 单引擎**客户端，原 WebView 客户端已随 #610 整体下线。

> 该客户端为唯一运行时形态；`packages/app/src/` 中的 WebView 源码仍在库中但不参与构建与运行。

**各门面的实际承载与机器强制**（首轮 review 的 CF7 证明「逐字复用」若无断言即零防线）：

| 门面 | 承载 | 机器防线 |
|---|---|---|
| 落地页 | 句 1 | **无**（静态站点无测试接缝）——靠 code-review 守 |
| `README.md` | 句 1 + 句 2 | **无**——靠 code-review 守 |
| `AGENTS.md` | 压缩形式（见下） | **有**：`agentsMd.contract.test.ts` 的「措辞锚点逐字存活」断言 |

`AGENTS.md` 因体积门禁（28,672 B 硬上限）采用压缩形式，其**被断言强制**的两个子串是：

- `WebView 客户端已随 #610 下线`
- `唯一运行时形态`

改写这两处 → 契约测试转红。**落地页与 README 无等价防线**，改动它们时必须人工比对本文档。

**技术栈行内**的 Capacitor 表述（仅 `AGENTS.md` 需要，因为它逐字对齐 `package.json`）：

> Capacitor 8.5（源码引用，运行时已下线）

**硬约束表述**（`AGENTS.md` 专用，措辞已订正自双引擎期）：

> `SplashScreen.installSplashScreen()` 必须在 `super.onCreate()` 之前（AndroidX 要求，见
> `LynxActivity.java`）。

> ⚠️ 此句**只给正面表述**。首版附带的「旧机制已删除」半句点名了被删的宿主类与注册方法，
> 与 `agentsMd.contract.test.ts` 的清零断言直接冲突（照抄即 CI 红）。历史考据留在
> ADR-0201 与本表「运行时下线」节，**不进指令文件**。

## 与既有术语文档的关系

| 文档 | 处置 |
|---|---|
| `glossary-cross-engine.md` | 存档横幅——记录双实现差分测试词汇，当前仅 lynx 一个消费方 |
| `glossary-client-switch.md` | 存档横幅——引擎切换机制整体下线 |
| `packages/app/CONTEXT.md` 引擎路由两节 | 已有 #610 订正横幅，**保持不动** |
| `packages/app-lynx/CONTEXT.md` 首句「与 webview 客户端构成双引擎形态」 | **已订正**（本次改动） |

## ⚠️ 本文档的使用约束（读之前先看）

1. **本文档是措辞来源，不是可逐字粘贴的模板。** 摘用前先确认目标文件的机器防线允许。
   首版曾在此处给出「AGENTS.md 专用」的硬约束整句，其中点名了被删的宿主类与注册机制；
   而 `agentsMd.contract.test.ts` 同时断言这些 token 在 `AGENTS.md` 中**必须清零**
   ⇒ 照抄即让 CI 转红（首轮 review 的反事实 CF3 实测：3 条断言同时转红）。
   **术语文档的「提及某机制已下线」与指令文件的「不得出现该机制字样」是两种不同诉求，不可互相照搬。**
2. **判据表的作用域写在表内。** 判据一律限定在 Android 源集 / 仓库内；
   留存源码中的同名符号属「源码留存」，不得据此宣称「全仓为 0」。
3. **计数会漂移。** 源文件数、单测文件数、依赖数随增删变动；引用时给**复核命令**而非定数。
