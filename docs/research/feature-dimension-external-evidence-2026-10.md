# 功能维度的外部证据与项目综合推断

- 日期：2026-10-03
- 顺序：**先联网取证（§1–§3）→ 再结合项目实测（§4）→ 综合推断（§5）**
- 与前两份的关系：
  - [`nav-dimension-and-stickiness-2026-10.md`](./nav-dimension-and-stickiness-2026-10.md)：导航维度的外部证据 + 方案（结论仍成立）
  - [`feature-coupling-decoupling-map-2026-10.md`](./feature-coupling-decoupling-map-2026-10.md)：**纯项目实测，无外部证据**。
    本份**取代**它的推断部分（§5.3 列出了被修正的三处），但**保留**它的实测数据。
- 证据分级同前：**【一手】**=厂商官方/研究机构原文；**【二手】**=转述；**【代码事实】**=本仓实测。

---

## 1. 外部证据 A：功能可发现性（NN/g，一手）

来源：Nielsen Norman Group 官方文章《People Don't Notice That AI Feature…》
（`nngroup.com/articles/discoverability-ai-amazon/`）。NN/g 是可用性研究的**一手来源本身**。

### 1.1 两个必须分开的概念

> "When a feature has good **findability**, users can easily find it **if they look for it**.
> When a feature has good **discoverability**, users notice, recognize, and understand it
> **even when they were not previously aware of its existence**."

| 概念 | 失败表现 |
|---|---|
| **Findability**（找得到） | 用户明确去找，但找不到 |
| **Discoverability**（看得见） | 用户压根不知道这东西存在 |

### 1.2 一条与本项目处境几乎逐字吻合的结论

> "In our qualitative usability testing, we found that the majority of AI features we tested
> **lacked both discoverability and findability**."
>
> 受测者的三类行为：不预期/没想到去找；**路过了也没注意到**；被研究者**指引去找时仍找不到**。
>
> "This was unfortunate because, **in several cases, participants found the features useful
> once researchers led them to these features.**"
> —— 某位受测者原话："Honestly I just didn't even notice [the feature]. I'm wondering why it
> was here. It was definitely really helpful, but I totally missed it."

**⇒ 这段描述的是本项目的现状**：功能有用、有实现，只是用户不知道。

### 1.3 可发现性失败的解剖（Amazon Rufus 案例，同文）

该功能**在全局导航里**、被研究者指向后用户评价有用，但无人自发使用。NN/g 归纳出四个原因：

| 原因 | 原文要点 |
|---|---|
| 位置不合常规 | 在 logo 左上角，而用户预期聊天入口在右下角（"external consistency" 破坏） |
| 名称陌生 | 连高频用户都没注意过那个名字，因为它不表意 |
| 图标是新的 | 用了一个从未被建立含义的图标（星芒） |
| 视觉噪声 | 页面本身塞满竞争信息，功能被淹没 |

**⇒ 四因里有三因是"呈现"问题，不是"有没有做"问题。**

---

## 2. 外部证据 B：功能该放几层、怎么分组（NN/g，一手）

来源：NN/g《Progressive Disclosure》（`nngroup.com/articles/progressive-disclosure/`）。

### 2.1 核心定义

> "Progressive disclosure **defers advanced or rarely used features to a secondary screen**."

### 2.2 两条对本项目直接生效的硬规则

**① 层数上限：2 层。**

> "In practice, designs that go beyond **2 disclosure levels** typically have low usability
> because users often get lost when moving between the levels. **If you have so many features
> that you need 3 or more levels, consider simplifying your design.**"

> ⚠️ 这条与 Apple HIG「show **no more than two levels** of hierarchy in a sidebar」**互相印证**
> ——两条来自不同机构、不同领域的规则给出同一个数字，不是巧合。

**② 分组靠 card sorting，不靠直觉。**

> "If you can't scale back the complexity, at least **chunk your advanced features into groups
> that make sense**, so that users need check only one place and can ignore any areas that they
> don't need. Use traditional techniques like **card sorting** to get the grouping right."

### 2.3 ⚠️ 一条**反证**我上一份建议的规则

> "Because progressive disclosure's goal is to expedite use of the initial display, it's
> **rarely a good idea to offer multiple ways to progress to secondary options**."

**⇒ 这一条直接质疑本项目现有的"补位补丁"做法**：`Recommended.vue:298` 在首页顶栏
给通知补了一个入口，等于给同一功能开了第二条进入路径。按 NN/g，这属于要重新审视的做法。
（详见 §4.3。）

### 2.4 关于"先度量再改"的原文支持

> "you must **supplement such analytics with observational usability testing to discern whether
> a page gets many hits because users want it or because they simply enter the page by mistake**."
>
> "For an application, you can get even more detailed usage data by **instrumenting the code to
> record how often people use various features**."

**⇒ 度量该怎么做、该怎么解读，NN/g 给了明确警告：不能只看点击量。**

---

## 3. 外部证据 C：非同类产品实际怎么做

| 来源 | 事实 | 级别 |
|---|---|---|
| **LINE WEBTOON 官方帮助中心**（`help2.line.me/LINE_WEBTOON/android`） | 「我的漫畫」一个面同时装下 **所有最近看過的漫畫 + 我的最愛 + 下載 + 活動記錄**；暂存下载也收在同一路径 `[我的漫畫>暫存]` | 【一手】 |
| 同上 | 加入最愛后「**您就會在新集數上架時在App中收到推播訊息**」；推播可按类开关；美国区部分推播**默认关闭** | 【一手】 |
| 同上 | 「同步閱讀紀錄」跨设备保存**阅读过的集数记录** | 【一手】 |
| **eBookJapan** | 顶层 `ホーム / ジャンル / 新刊 / ランキング / 無料マンガ / セール`；小说与漫画题材**全在「ジャンル」之下** | 【一手】 |
| **Kindle / Whispersync** | 同步 `last reading location`，"**pick up right where you left off**" | 【一手（经手册镜像）】 |
| **Apple Books** | 顶层 `Reading Now / Library / Book Store / Audiobooks / Search`；Reading Now 内含"正在读 / Want to Read / Complete the Series / You Might Like"——**按用户状态分，不按媒介分** | ⚠️ **【二手】**（百度百科/搜狐转载，**未取到 Apple 官方页**，见 §6） |

### 3.1 从这组证据里能读出的三条

1. **「我的东西」被聚合成一个面**（LINE WEBTOON 一手）。
2. **「追更」与「收到更新通知」是同一个动作的两半**（LINE WEBTOON 一手）。
3. **顶层按「用户与内容的关系/状态」组织，而非按内容类型组织**
   （Apple Books 二手 + eBookJapan 一手：媒介下沉一级）。

---

## 4. 把外部证据对到本项目实测数据上

> 本节左侧为 §1–§3 的外部规则，右侧为 [`feature-coupling-decoupling-map`](./feature-coupling-decoupling-map-2026-10.md) 的【代码事实】。

### 4.1 规则：功能应当分组，让用户只查一处（NN/g 2.2②）

| 项目实测 | 数字 |
|---|---|
| 24 个业务页面，4 个顶层目的地 | 20 个次级 |
| 入口数 = 1 且全部来自 `Me.vue` 的功能 | **6 个**（收藏/追更/稍后看/好P友/静音标签/网络自检） |
| 入口数 = 0 的功能 | **1 个**（`/following` 关注流） |
| 组件侧零 `import` 孤儿 | 1 个（`NavigationBar.vue`） |
| 供给侧零消费者 API | 16 个 |

**⇒ 命中的是 NN/g 说的"没有 chunk"**：这 7 个功能没有归组，
用户想找"我存的东西"时，得知道它们分别在哪、且其中一件根本找不到。

### 4.2 规则：可发现性失败常源于呈现，而非缺失（NN/g 1.3）

| 外部四因 | 本项目对应 |
|---|---|
| 位置不合常规 | `Me.vue` 是唯一容器；「我的」同时是 7 个留存资产 + 4 个调试项的混合页 |
| 名称陌生 | 「我的」不表意——它不只含"我的东西"，还含网络退避调参、引擎降级 |
| 图标/呈现新 | 外环 4 个图标承载 4 个语义，其中"我的"= person |
| 视觉噪声 | 业务行与调试行平级混排（`Me.vue:637/647/693/703` vs `:741/824`） |

**⇒ 关键推论：把 `/following` 从"零入口"变成"有入口"是必要的，但**不充分**——
按 NN/g 案例，光放进导航栏不够，还要位置常规 + 名称表意 + 不被噪声淹没。**

### 4.3 ⚠️ 规则：不要给同一功能开多条进入路径（NN/g 2.3）——项目现状正踩在这条上

| 现状 | 是否违反 |
|---|---|
| `/notifications` 有 **2 个入口**（`Me.vue` + `Recommended.vue:298` 顶栏补位） | ⚠️ 正是 NN/g 警示的模式 |
| 通知的注释自陈「**目前只能从「我的」进入，顶栏补一个直达位**」 | 补位而非改分组 |

**⇒ 对上一份建议的修正**：我在导航报告里写"给 `/following` 增加入口"，
方向没错；但**不能沿用"再补一个入口"的做法**。
正确处置是**先把功能归组、把「我的」拆干净**，让每个功能有且只有一个正规入口。
若某功能确实需要第二入口，须说明为何它是"独立动作"而非"同一个功能的第二条路"。

### 4.4 规则：「我的东西」应聚合成面（LINE WEBTOON 一手）

| 本项目 | 归属 |
|---|---|
| 收藏 / 稍后看 / 追更 / 下载 | 四个**互不跳转**的独立页（实测四页出路径仅指向作品详情） |
| 继续读 | 🔴 **不存在**（旧 WebView 客户端曾有，随 ADR-0203 丢失） |

**⇒ 我们的"我的漫画"等价物目前是 4 个孤立页 + 1 个缺失项，不是 1 个聚合面。**

### 4.5 规则：追更需有回执（LINE WEBTOON 一手）

| 本项目 | 状态 |
|---|---|
| 追更状态 | ✅ 有（`watchlistStore`） |
| 送达通道 | 🔴 **零**：全仓 Java 无 `NotificationManager`；manifest 无 `POST_NOTIFICATIONS` |

**⇒ 命中的是"同一个动作的两半只做了一半"。**

### 4.6 规则：位置持久化是独立能力（Kindle 一手）

| 本项目 | 状态 |
|---|---|
| 阅读位置持久化 | 🔴 无（`novelTranslateStore` 的 `progress` 是 AI 翻译进度，不是阅读位置） |
| 浏览历史 | 🔴 无（仅 `searchHistoryStore`，存的是搜索词，上限 10） |

**⇒ "接着读"在成熟产品里 = 位置持久化 + 聚合入口两件事，我们两件都没有。**

### 4.7 规则：层数 ≤ 2（NN/g 2.2① + HIG 互证）

| 拟议形态 | 层数 | 判定 |
|---|---|---|
| 发现（二级：全部/插画/小说）→ 作品详情 | 2 | ✅ 合规 |
| 发现 → 作品详情 → 标签近邻 | 3 | ⚠️ **超限**，需确认标签近邻是否算独立一层 |

---

## 5. 综合推断

### 5.1 一句话结论

> 外部证据与项目实测指向同一处：**本项目的问题不是"功能少"或"维度选错"，
> 而是"已实现的功能没有被分组、没有正规入口、没有回执"**。
> 换顶层维度是这套结构失衡的**症状**，不是病因。

### 5.2 三个阶段的因果链（外部规则 → 项目事实 → 结论）

```
NN/g: 有用但没人找的功能 = discoverability 失败
        ↓
实测: 7 个功能无正规入口（6 个单入口全在 Me.vue，1 个零入口）
        ↓
NN/g: 失败可源于分组缺失，而非功能缺失
        ↓
结论: 先归组 + 给唯一正规入口，比换 tab 维度收益更直接、风险更低
```

### 5.3 本份**修正**了前一份推断的三处

| # | 前一份的说法 | 修正后 | 依据 |
|---|---|---|---|
| 1 | 「给 `/following` 增加入口」 | 方向对，但**不能靠补第二个入口**；须先归组，保证每功能**唯一**正规入口 | NN/g 2.3 |
| 2 | 「书架应聚合 收藏+稍后看+追更+下载」 | 应聚合 **收藏+稍后看+继续读**；**下载的队列控制面留在设置**（它是任务控制，不是内容） | LINE WEBTOON「我的漫畫」的构成 + 4.4 |
| 3 | 「功能天然成 4 簇」 | 仍是推论，**但 NN/g 要求用 card sorting 验证**——**4 簇这个分组本身尚未被验证** | NN/g 2.2② |

⚠️ **第 3 条是本报告最重要的自我限制**：我提出的「四簇」分组是**我从代码结构推出来的**，
不是从用户研究得来的。NN/g 对同样的判断给出了明确方法——
**用 card sorting 让用户自己归类**。若不验证，这 4 簇只是"看起来整齐"。

### 5.4 建议的动作序列（按"是否需要外部依据"排序）

| 优先 | 动作 | 外部依据 | 是否需新能力 |
|---|---|---|---|
| **1** | 卡片分类测试（card sorting）验证分组假设 | NN/g 2.2② **要求先做** | ❌ 低成本 |
| **2** | 把 7 个无正规入口的功能归组，给每组一个唯一入口；拆开「我的」里的调试项 | NN/g 2.2② + 1.3 | ❌ 不需要新后端 |
| **3** | 消除"同一功能两条路"（通知的顶栏补位） | NN/g 2.3 | ❌ |
| **4** | 补「继续读」（位置持久化 + 聚合面） | Kindle 一手 + LINE WEBTOON 一手 | ⚠️ 需新建 |
| **5** | 补送达通道 | LINE WEBTOON 一手 | ⚠️ 权限 + 原生模块 |
| **6** | 顶层换维度 | 上一份导航报告 | ⚠️ 依赖 1–2 的结果 |

> **顺序理由**：1 是 NN/g 明确要求的前置方法，且能证伪 5.3 的第 3 条；
> 2–3 修的是 NN/g 点名的两类失败，**不需要任何新后端能力**；
> 6 放最后——**在分组假设未验证前重组顶层，等于把一个未验证的判断固化进导航。**

---

## 6. 本报告的证据缺口（必须交代）

| 缺口 | 状态 |
|---|---|
| **Apple Books 官方页** | ⚠️ 抓取失败（404），§3 的 Reading Now 结构来自**二手转载**，不作为承重依据 |
| **NN/g 空态设计文章** | ⚠️ 搜索只返回机构背景页，**未取到**。§6 表格里"关注页冷启动空态"缺外部依据 |
| **「一个功能该有几个入口」的量化证据** | 未取到。§4.3 的判断来自定性规则，**非量化** |
| **中文产品（微信读书/起点/番茄）的官方功能文档** | 本次未取（聚焦英文一手来源），§3 的中文样本仅 LINE WEBTOON |
| **card sorting 的实施细节** | 未查（本报告不执行，只建议） |

**⇒ 本报告的强度分布**：§1、§2 为**强**（研究机构原文，两家互证）；
§3 **中**（4 个一手 + 1 个二手）；§4 **强**（项目实测可复核）；§5 **中**（推论，第 3 条自我否定）。
