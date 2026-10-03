# 非 Pixiv / 非插画向内容产品的顶层导航与信息架构模式（2026-10）

> 研究范围：明确**排除** Pixiv 类客户端横向对比（该对比已完成且被认为无信息量）。
> 本文档只回答一个问题：**非插画优先的内容产品，顶层导航有哪些模式，平台用什么硬规则约束它。**
>
> 采集日期：2026-10-03（所有 URL 均在该日实际抓取）
> 抓取方式：优先一手来源——厂商官方设计文档、官方帮助中心、官方产品页/帮助页。
> 未能取证的一律在正文标注「未证实」，并在第 9 节集中列出。

---

## 结论速览

以下 7 条均可回溯到下文编号结论。**每条后面标注支撑它的结论编号。**

1. **Material 3 对「底部导航条有几个目的地」给出的是硬数字：3–5 个。** 原文措辞是
   "Navigation bars can have three to five destinations"，并且 Android 实现层直接封顶：
   "`BottomNavigationView` does not support more than 5 `menu` items"。这是**可验证的上限**，
   不是建议值。〔§2-A，来源 1〕

2. **Apple HIG 当前版本对 iPhone 底部 tab 数量并没有写死数字**——它写的是定性规则
   "it's generally easier to navigate among fewer tabs"，外加一条**可操作的失败模式**：
   放不下时末位 tab 变成 "More" 溢出 tab，而 "The More tab makes it harder for people to
   reach and notice content on tabs that are hidden"。业界常引用的「Apple 说 3–5 个」
   在现行 HIG 文本中**找不到原文**，属未证实（见 §2-B、§9）。〔§2-B，来源 2〕

3. **两平台共同的一条实操铁律：tab bar 只能承载"导航"，不能承载"操作"。**
   HIG 原文 "Use a tab bar to support navigation, not to provide actions… If you need to
   provide controls that act on elements in the current view, use a toolbar instead."
   任何想做成 tab 的「发布」「上传」类入口，平台都在把你推回 toolbar / FAB。〔§2-C，来源 2〕

4. **"我的"在所有可取证样本里都不是独立顶栏目的，而是收进账号区或抽屉。**
   LINE Manga 官方站的顶层菜单是 毎日無料 / ストア / インディーズ / 本棚 / お気に入り /
   マイメニュー——「本棚（书架）」「お気に入り」是**个人收藏**，与「マイメニュー（我的菜单）」
   并列且**各自独立成项**，也就是说**收藏没有寄生在"我的"里面**。〔§3、§4，来源 5〕

5. **多媒介同框产品的主流做法是「一个首页 + 更深的媒介/题材切换器」，而不是顶层按媒介分栏。**
   eBookJapan 顶层是 ホーム / ジャンル / 新刊 / ランキング / 無料マンガ / セール，
   而「ライトノベル」「マンガ雑誌」「少女・女性」「少年・青年」「文芸・ビジネス・実用」
   全部**塞在「ジャンル」这一层之下**——小说与漫画在同一个 App 里，媒介差异下沉一级。
   〔§5-A，来源 6、7〕

6. **只有当两种媒介在供给链上是「不同产品」时，才出现顶层媒介分栏。**
   哔哩哔哩 Web 顶层是 首页 / 番剧 / 直播 / 游戏中心 / 会员购 / **漫画** / 赛事——
   动画（番剧）与漫画被提升到顶层一级；而 电影 / 电视剧 / 综艺 / 纪录片 / 动画 / 游戏
   这些**题材分区反而被压在首页的 partition 里**。〔§5-B，来源 10〕

7. **HIG 明确给「深层 IA」开了官方后门：层级太深时，把次级导航放进 tab 内部。**
   原文两处：visionOS 段 "consider using a sidebar within a tab in a tab bar… be sure to
   prevent selections in the sidebar from changing which tab is currently open"；
   iPadOS 段允许 tab bar 与 sidebar 互换。sidebars 页还给了容量规则：
   "In general, show no more than two levels of hierarchy in a sidebar."
   这意味着「媒介切换器塞进 Home 内部」不是妥协，是**平台背书的形态**。〔§5-C，来源 3〕

---

## 1. 顶层导航模式分类

下表每一行的「实际 tab 列表」都只填**我实际抓到的一手页面上的字面标签**；
抓不到的一律写「未证实」，不填行业传闻。

| 模式 | 代表产品 | 实际顶层列表（抓取到的字面标签） | 适合什么 | 代价 |
| --- | --- | --- | --- | --- |
| **内容型分栏**（content-type） | LINE Manga（Web 站） | 毎日無料 / ストア / インディーズ / 本棚 / お気に入り / マイメニュー（来源 5） | 各分栏供给逻辑互不重叠、用户心智清晰 | 分栏一多就撞 M3 的 5 个上限；且「本棚/お気に入り」本质是个人数据，与内容型分栏混排会让分栏语义不纯 |
| **内容型分栏（媒介型）** | 哔哩哔哩（Web 站） | 首页 / 番剧 / 直播 / 游戏中心 / 会员购 / 漫画 / 赛事 / 下载客户端（来源 10） | 动画、漫画、直播是**彼此独立的供给链** | 桌面端可以横排这么多；移动端搬不下 5 个，题材分区必须下沉（事实上就是下沉到了首页 partition） |
| **意图/动词型** | Dreame（Web 站） | Home / Ranking / Become a Writer / Writer Benefits / Download / search（来源 13） | 读写不对称、创作侧是核心价值的产品 | 创作者入口是"操作"不是"导航"，与 §2-C 冲突，需挪进账号区 |
| **社交图谱型** | TikTok | 官方帮助中心的 "Exploring videos" 一级分区为：For You / Friends Tab / Discover and search（来源 11） | 消费与关系链消费是两种截然不同的心智 | 关系链密度低时 Friends Tab 长期空置，冷启动观感差 |
| **库/收藏独立成栏** | GoodNovel（Web 站） | 顶部可见 Library、Search、Win the Prize、Contest（来源 14） | 收藏/书架是回访型用户的**主要动机** | 顶栏预算被占掉，挤掉一个内容型分栏 |
| **混合型（Home 兼个性化入口）** | LINE WEBTOON（Web 站） | CATEGORIES / ORIGINALS / CREATORS / Search / DASHBOARD（来源 7） | 平台侧（官方原创）与 UGC 侧需要分层曝光 | 命名（Originals / CATEGORIES）不遵循"单词"惯例，与 HIG 建议有张力（§2-D） |
| **社区/角色型** | Wattpad（Web 站） | Browse / Community / Write / Download app（来源 15） | 读者与作者是两种用户，双向流动 | 同样有"Write 属于操作而非导航"的平台冲突 |

### 1.1 关于"混合型"的补充观察

LINE WEBTOON 把 `ORIGINALS` 与 `CATEGORIES` 并列在顶栏，是本组样本里唯一明确把
"平台官方内容"与"全站题材"拆成两个顶栏目的的产品（来源 7）。
这与 §5 的结论方向相反——它把**供给方**而非**媒介**提升到了顶层。
对本项目的启示见 §7。

### 1.2 未能取证的家族（重要）

以下家族在本次采集中**没有拿到任何一手 tab 列表**，因此**不在上表内**：

- **Netflix**（Home / TV / Movies / New & Popular / My List）：`help.netflix.com/en/node/62526`
  抓取**超时失败**。→ 未证实。
- **YouTube**（Home / Shorts / Subscriptions / Library）：`support.google.com/youtube/answer/141805`
  抓到的是帮助中心**导航外壳**，文章正文由 JS 加载，导航标签未出现在 HTML 中。→ 未证实。
- **Instagram / 小红书** 的"搜索是否为独立 tab"：两站首页均为纯 JS 壳（小红书首页去标签后
  可提取文本行数为 0），无法取证。→ 未证实。
- **起点读书 / 抖音 / Bilibili App 底部 tab**：Web 站可取（来源 10），但 `qidian.com`
  返回 209 空壳、`douyin.com` 返回 2.4KB 跳转桩，**App 端 tab 布局未证实**。

> 这直接限制了 §6（搜索位置）的证据强度，详见 §9。

---

## 2. 平台硬约束

### 2-A Material 3：3–5 个目的地，且实现层硬封顶 5

来源 1（Google 官方 `material-components-android` 仓库文档，`docs/components/BottomNavigation.md`，
2026-10-03 抓取）逐字原文：

> "Navigation bars can have three to five destinations. The nav bar is positioned
> at the bottom of screens for convenient access. Each destination is represented
> by an icon and label text."

同一文件在代码示例段落给出更硬的约束：

> "**Note:** `BottomNavigationView` does not support more than 5 `menu` items."

同文件另有一条对**标签显隐**有直接设计后果的规则：

> "`LABEL_VISIBILITY_AUTO` (default): The label behaves as "labeled" when there are
> 3 items or less, or "selected" when there are 4 items or more"

**含义**：4 个目的地时 M3 的默认行为是**只给选中项显示文字标签**。
如果新方案落在 4 个 destination，且标签较长（中文 2–3 字尚可），需要显式设定
`LABEL_VISIBILITY_LABELED` 才能保住"每个 tab 都有文字"的可读性。这是纯粹由
destination 数量触发的行为跳变，属于平台硬约束的连锁反应。

**M3 正文页抓不到**：本仓库 `AGENTS.md` 已记录 `m3.material.io` 是 JS 渲染、抓不到正文。
2026-10-03 实测确认——`https://m3.material.io/components/navigation-bar/guidelines`
返回 200，但 body 内只有 Angular 挂载点 `<mio-root>` 与脚本，**无任何正文文本**。
因此 M3 的一切数字引用**只使用来源 1**（Google 官方 GitHub 仓库文档），
不使用 m3.material.io 作为引用源。

### 2-B Apple HIG：**没有** iPhone tab 数量的硬数字

来源 2（Apple 官方 HIG "Tab bars" 页的 DocC JSON，页面 `alert-date` 为 2026-06-08，
2026-10-03 抓取）逐字原文，与本节相关的四条：

> "**Use the appropriate number of tabs required to help people navigate your app.**
> As a representation of your app's hierarchy, it's important to weigh the complexity of
> additional tabs against the need for people to frequently access each section; keep in mind
> that it's generally easier to navigate among fewer tabs. Where available, consider a sidebar
> or a tab bar that adapts to a sidebar as an alternative for an app with a complex information
> structure."

> "**Avoid overflow tabs.** Depending on device size and orientation, the number of visible
> tabs can be smaller than the total number of tabs. If horizontal space limits the number of
> visible tabs, the trailing tab becomes a More tab in iOS and iPadOS, revealing the remaining
> items in a separate list. The More tab makes it harder for people to reach and notice content
> on tabs that are hidden, so limit scenarios in your app where this can happen."

> "**Include tab labels to help with navigation.** … Use single words whenever possible."

> "**Don't disable or hide tab bar buttons, even when their content is unavailable.** Having tab
> bar buttons available in some cases but not others makes your app's interface appear unstable
> and unpredictable. If a section is empty, explain why its content is unavailable."

**唯一出现数字的地方是 iPadOS 自定义 tab 的语境**，不是 iPhone 通用规则：

> "If you let people select their own tabs, aim for a default list of **five or fewer**
> to preserve continuity between compact and regular view sizes."

**结论（须明确）**：现行 HIG 对 iPhone 底部 tab **不设数量硬上限**，只给"越少越好"的定性指引
+ 一条"溢出即失败"的形态禁令。业界广泛流传的「Apple 规定 3–5 个 tab」在 2026-06-08 版
HIG 文本中**没有对应原文**。本次采集中在 DuckDuckGo 搜索结果里见到该说法，来源为
`uiuxdesigning.com/ios-tab-bar/`（二手站点，非 Apple），已归入 §9 弱证据，**不作为依据**。

> **方法论提示**：M3 说"3–5"是硬规则、HIG 说"少一点就好"是软规则。
> 把两者当成同一条约束来引用，是本领域最常见的一次误引。

### 2-C 平台共同铁律：tab bar 只做导航，不做操作

来源 2 原文：

> "**Use a tab bar to support navigation, not to provide actions.** A tab bar lets people
> navigate among different sections of an app, like the Alarm, Stopwatch, and Timer tabs in
> the Clock app. If you need to provide controls that act on elements in the current view,
> use a toolbar instead."

**对"发布/上传类主行动"的直接后果**：
本报告未找到任何一手平台文档正面讨论"FAB vs 顶层 tab"这一对比（→ §9 未证实）。
但上条规则给出了等价约束的**一半**：想要一个常驻的"做点什么"入口，平台指定的位置是
toolbar / 浮动控件，而不是 tab bar。样本中 Dreame 把 `Become a Writer` 放在顶栏（来源 13），
按此规则应视为**不符合 HIG 建议的实现**，而非可效仿的先例。

### 2-D 搜索位置：HIG 明确允许「尾部独立 search tab」

来源 2 的 iOS 段落原文：

> "A tab bar can include a **dedicated search tab at the trailing end**. For guidance,
> see Search fields."

这是本次采集中**唯一**一条平台层面正面规定搜索位置的原文。
注意两点限定：

1. 它说的是 **tab bar 内的尾部 search tab**，**不是** toolbar 里的搜索图标；
2. "trailing end"（末位）——与 §3 的"我的"位置约束同源，二者在尾部**互相排斥**。

另有一条可作为"搜索不该是顶层 tab"的反向支持（来源 2，visionOS 段）：

> "A tab's symbol is always visible in the tab bar. … Even though the tab bar expands, you
> need to keep tab labels short so people can read them at a glance."

以及 HIG 对 sidebar 深度的一处硬约束（来源 3）：

> "In general, **show no more than two levels of hierarchy** in a sidebar. When a data
> hierarchy is deeper than two levels, consider using a split view interface that includes
> a content list between the sidebar items and detail view."

### 2-F 复核补充：三条一手原文（由整合者独立抓取，2026-10-03）

本节由整合者用**独立会话**复核 §2-A/§2-B 时取得，不属于原作者抓取批次。
结论：**§2-A 与 §2-B 的判断均成立**（M3 是 3–5 硬规则；现行 HIG 无 iPhone 数量硬数字），
另补三条正文原文——它们比 §2-A/§2-B 更直接地约束「多媒介 + 隐藏导航」这一类形态。

**① Apple HIG 现行文本对"导航常驻"有明文要求（来源 2 同页，DocC JSON）**

> "Make sure the tab bar is visible when people navigate to different sections of your app.
> **If you hide the tab bar, people can forget which area of the app they're in.**
> The exception is when a modal view covers the tab bar, because a modal is temporary and
> self-contained."

⇒ **"藏起导航"被现行 HIG 直接点名为失败模式**，且唯一豁免是模态层。
本项目把 4 个顶层目的地放进需两步展开的悬浮 FAB，收起时不留任何目的地标签 ⇒ 落在这句话的射程内。

**② M3：底部导航各目的地应当"同等重要"（来源 1，m3.material.io "Navigation" 页正文）**

> "Bottom navigation destinations should be **of equal importance**."

⇒ 若一组目的地本质是"同一份内容的不同媒介过滤"，把它们并列为顶级导航目的地
**违反 M3 的这条原则**——这不是"tab 太多/太少"的数量问题，是**分组错误**。

**③ M3：Tabs 与 bottom navigation 是两种不同语义的东西（来源 1 同页对照表 + Caution 段）**

> 对照表行：`| Tabs | Any level of hierarchy | 2+ | Mobile, Tablet, Desktop |`
> Caution 段："**Tabs share a common subject, whereas bottom navigation destinations are
> top-level and disconnected from each other.**"

⇒ **"共享同一主题的并列数据集"在 M3 里叫 Tabs（页内二级），不叫顶级导航目的地。**
这条是本节对"换维度"最可操作的一句：**判断某个东西该不该占顶级位置，标准不是"它重不重要"，
而是"它和其他顶级目的地是不是同一主题下的两个视角"。**

**复核方法说明**：①③ 用同一批一手来源（Apple DocC JSON / m3.material.io 正文）独立抓取；
② 来自 m3.material.io "Navigation" 页 "Consistent" 段。
原作者 §2-E 提到的 `"One navigation destination is always active"` 仍标**未证实**（本次亦未在正文取到），
维持原判。

### 2-E 冷启动落在哪个 tab：HIG **没有**规则

来源 2 全文中**不存在**"app 启动时默认选中哪个 tab"的规定。
HIG 规定的是"选中态必须始终存在且可见"（来源 1 的 M3 侧：
"One navigation destination is always active"——该句出现在 m3.material.io 的搜索摘要中，
正文抓取不到，**未直接证实**，见 §9）。

本次采集中，**唯一**关于"冷启动落在哪个 tab"的产品侧一手陈述来自 LINE Manga 官方账号
（`note.com/lws/n/n830451b5c751`，经搜索结果摘要看到，原文称
「トップページとは、LINEマンガアプリを起動した際、一番最初に表示される**おすすめ**タブのページです」）。
**该页面本次未直接抓取成功**，因此本报告将其标为**未证实（弱）**，仅作为后续跟进线索。

> 结论：**"多数内容 App 冷启动落 Home 而非上次浏览的 tab"在本报告中没有任何一手证据支撑。**
> 这是一个看似有共识、实则未见官方背书的假设，不应被当作约束使用。

---

## 3. "我的" 归属

### 3.1 可取证的三个样本，结论一致

| 产品 | "我的"落在哪 | 证据 |
| --- | --- | --- |
| LINE Manga（Web） | 顶层菜单独立项 `マイメニュー`（My Menu），**排在末位**；无独立 `マイ` / `Profile` 名称 | 来源 5，菜单项字面为「マイメニュー」 |
| Dreame（Web） | 顶栏**没有**账户 tab，账户入口是右上角 `Log in` 文字链接 | 来源 13 |
| 哔哩哔哩（Web） | 顶层无账户 tab；账户入口在页面右上角（HTML 中未渲染为导航项，**具体形态未证实**） | 来源 10 |

### 3.2 模式归纳

**"我的"从不是一个内容型 tab，而是一个账号区入口。** 三个样本给出两种落法：

- **末位独立菜单项**（LINE Manga 的 `マイメニュー`）
- **顶栏右上角文字/头像链接**（Dreame 的 `Log in`）

**平台侧是否有把"我的"推向末位的规则？** 来源 2 只规定了 search tab 在 trailing end，
**没有**规定 profile/account 的位置。→ 「我的必须在末位」是**观察到的惯例，不是平台规则**。
（归入 §9）

### 3.3 命名观察

LINE Manga 用 `マイメニュー` 而非 `マイ`（来源 5），HIG 建议 "Use single words whenever
possible"（来源 2）。两字 vs 一字的差异在 M3 的 4-destination 场景下会触发
`LABEL_VISIBILITY_AUTO` 只显示选中项标签的行为（来源 1）——即末位 tab 在未选中时
**只剩一个无文字的图标**，语义负担全压在图标上。这是"末位 tab 命名过长"的实际代价。

---

## 4. 二级收 collections 归属

这是本次采集中**证据最扎实**的一节。

### 4.1 收藏与账号是**并列**的，不是嵌套的

LINE Manga 官方站顶层菜单的完整字面列表（来源 5，逐字）：

| 顺序 | 字面标签 | 语义分类 |
| --- | --- | --- |
| 1 | 毎日無料 | 内容/运营位 |
| 2 | ストア | 内容（购买入口） |
| 3 | インディーズ | 内容（平台活动） |
| 4 | **本棚** | **个人收藏（书架）** |
| 5 | **お気に入り** | **个人收藏（想看）** |
| 6 | **マイメニュー** | **账号区** |

三个关键事实：

1. `本棚`（书架）与 `お気に入り`（想看）**各自独立成项**，**没有**被收进 `マイメニュー`。
2. 两个收藏项**连续排列**在账号项之前——收藏是"高频回访区"，账号是"低频区"。
3. 抽屉（drawer）承载了 6 个顶层项，说明**在 Web 上同样的 IA 被平移到了侧边菜单**。

**这条证据直接反驳"二级收藏必然寄生在'我的'里"的说法**。

### 4.2 另一种落法：Library 作为独立顶层项

GoodNovel（Web）顶栏出现字面项 `Library` 与 `Search`（来源 14），与 `Win the Prize`、
`Contest` 并列。**收藏被提升为顶层**，而不是塞进账号区。

### 4.3 归纳

| 落法 | 样本 | 判据 |
| --- | --- | --- |
| 收藏独立成栏/独立菜单项，紧邻账号项 | LINE Manga（`本棚` + `お気に入り`）、GoodNovel（`Library`） | 收藏是回访主路径 |
| 收藏收进账号区 | **本次采集未找到实例** | — |
| 抽屉承载 | LINE Manga（整份 IA 平移到 `widget.Sidemenu`） | 桌面/宽屏 |

**"哪个模式在高留存 App 中占主导"** —— 本次采样的 4 个有收藏的产品
（LINE Manga、GoodNovel、eBookJapan、微信读书）中，**3 个把收藏放在账号区之外**
（LINE Manga 独立成项、GoodNovel 顶层 Library、eBookJapan 顶栏有 `本棚`），
**0 个找到"收藏收进我的"的实例**（→ §9 未证实：这是本次采样的上限，不是全市场结论）。

### 4.4 另一条相关证据：HIG 的"别把内容不可用的 tab 藏起来"

来源 2：

> "If a section is empty, explain why its content is unavailable."

对"下载/离线"这类**用户还没产生数据的 collection** 尤其相关：不能因为离线库为空
就把该入口藏起来，否则会造成 HIG 所说的"界面不稳定"。

---

## 5. 多媒介产品怎么切

> 这是本报告最核心的一节，也是委托方唯一明确点名"最决策相关"的问题。

### 5-A 主模式：**一个首页 + 更深的媒介/题材切换器**

#### eBookJapan（小说 + 漫画 + 杂志，同一 App）

顶层导航字面列表（来源 6，2026-10-03 抓取 `https://ebookjapan.yahoo.co.jp/`）：

> ホーム / ジャンル / 新刊 / ランキング / 無料マンガ / セール
> 以及 検索 / 本棚 / カゴ / クーポン

顶层**没有任何"小说"或"漫画"的媒介分栏**。
唯一的媒介相关顶层项是 `無料マンガ`（免费漫画）——但它是一个**运营位（免费区）**，
不是"漫画 vs 小说"的媒介轴。

媒介差异出现在 `ジャンル`（题材）这一层之下（来源 7，抓取
`https://ebookjapan.yahoo.co.jp/category/`，该页在顶层项完全相同的前提下
渲染出下列题材标签）：

> マンガ雑誌（漫画杂志） / ライトノベル（轻小说） / 少女・女性（少女・女性向）
> 少年・青年（少年・青年向） / 恋愛（恋爱） / 文芸・ビジネス・実用（文艺・商务・实用）
> バトル・アクション / ファンタジー / ハーレクイン / 令嬢ロマンス / アダルト

**判定：eBookJapan 把"漫画 vs 小说"下沉为题材维度，不是顶层轴。**
这是"同 App 多媒介 → 媒介下沉一级"的最强一手证据。

#### 微信读书（出版书 + 有声 + 漫画入口）

`https://weread.qq.com/` 首页（来源 8）去标签后可提取的首页栏目为：

> 最近热搜 / 大家都在看 / 榜单 / 大家都在读（"微信读书用户近期热读的出版书"）
> 最近 90 天出版的热门书籍 / 微信读书用户最喜爱的出版书 / 查看全部

**判定：单一信息流首页，媒介/题材全部混排，无媒介分栏。**
注意其分区标签**显式写着"出版书"**——即"书"是唯一被强调的媒介单位。

#### LINE Manga（纯漫画）

来源 5：内容规模自述"約112万点"，题材维度齐全但**全部是漫画题材**，
不存在"小说"这个轴。它的顶层菜单里 `インディーズ`（原创活动）是**供给方**维度。

#### LINE WEBTOON vs LINE Manga（委托方点名要看的一对）

**这是本次采集里最清楚的一个结论：两者不是"一个 App 里的两个 tab"，
而是 LINE Digital Frontier 旗下的两个独立产品。**

- LINE Manga：`https://manga.line.me/`，运营主体在页脚自述为
  **LINE Digital Frontier Corporation**（来源 5）。
- LINE WEBTOON：`https://www.webtoons.com/en/`（来源 7），独立域名、
  独立导航（`ORIGINALS` / `CATEGORIES` / `CREATORS` / `DASHBOARD` / `Search`）、
  独立分类表（Action / Romance / Fantasy / Comedy / Horror / Slice of Life… 全为漫画题材）。

**推论：即便是同一家公司、同一套内容资产，面对"漫画 vs 另一媒介"时，
它选择的解法也是「拆成两个产品」，而不是「在一个产品里加一个媒介 tab」。**
这条证据强于任何单个 App 的 tab 布局。

### 5-B 反例：**供给链独立**时，顶层分媒介

#### 哔哩哔哩（Web）

顶层导航字面列表（来源 10）：

> 首页 / 番剧 / 直播 / 游戏中心 / 会员购 / **漫画** / 赛事 / 下载客户端

同时，首页内部的 partition 分区为：

> 动态 / 热门 / 电影 / 国创 / 电视剧 / 综艺 / 纪录片 / 动画 / 游戏 / 鬼畜 / 音乐 /
> 舞蹈 / 影视 / 娱乐 / 知识 / 科技数码 / 资讯 / 美食 / 小剧场 / 汽车 / 时尚美妆 /
> 体育运动 / 动物 / vlog / 绘画 / 人工智能 / 家装房产 / 户外 / 健身 / 手工 / 旅游出行 / 三农

**结构非常清晰，且与 §5-A 恰好相反：**

- **媒介被提升到顶层**：`番剧`（动画）与 `漫画`（漫画）是顶层项。
- **题材被压到首页内部**：`电影 / 电视剧 / 综艺 / 纪录片 / 动画 / 游戏 / 鬼畜 / 音乐`… 全在首页 partition 里。

**判据提炼**：哔哩哔哩之所以敢在顶层分媒介，是因为**番剧、漫画、直播
是三条独立的版权采购 / 制作 / 结算链**，它们不是"同一种内容的不同题材"，
而是"不同的商品品类"。而电影/电视剧/综艺只是首页推荐流里的题材标签。

**注意**：这是 **Web 端**结构。`bilibili.com` App 的底部 tab 布局本次**未取证**（→ §9）。
把 Web 端 8 项顶栏直接类推到移动端是错误的。

#### Wattpad（读者 / 作者双身份）

顶层：Browse / Community / Write / Download app（来源 15）。
**这是按"用户角色"分栏，不是按媒介分栏**——Wattpad 内部同时有
romantasy、fanfiction、原创等所有题材，没有媒介轴。

### 5-C 平台的官方背书：**深层 IA 塞进 tab 内部是被认可的形态**

来源 3（Apple HIG "Sidebars" 页 DocC JSON，2026-06-08 版）两处原文：

> "**Consider using a tab bar first.** A tab bar provides more space to feature content,
> and offers enough flexibility to navigate between many apps' main areas. **If you need to
> expose more areas than fit in a tab bar, the tab bar's convertible sidebar-style
> appearance can provide access to content that people use less frequently.**"

> "**In general, show no more than two levels of hierarchy in a sidebar.** When a data
> hierarchy is deeper than two levels, consider using a split view interface that includes
> a content list between the sidebar items and detail view."

> "A sidebar requires a large amount of vertical and horizontal space. When space is limited
> or you want to devote more of the screen to other information or functionality, a more
> compact control such as a tab bar may provide a better navigation experience. **For many
> apps, you don't need to choose between a tab bar or sidebar for navigation; instead, you
> can adopt a style of tab bar that provides both.**"

来源 2（Tab bars 页，visionOS 段）：

> "**If it makes sense in your app, consider using a sidebar within a tab.** If your app's
> hierarchy is deep, you might want to use a sidebar to support secondary navigation within
> a tab. **If you do this, be sure to prevent selections in the sidebar from changing which
> tab is currently open.**"

**这组原文是本报告对重构方向最有价值的外部依据**：
它明确表示——当顶层 tab 装不下时，**正确做法是把次级维度放进 tab 内部**，
并且给出了一条具体的工程约束（tab 内的二级选择不得改变当前 tab）。
同时它给出了**深度上限：sidebar 最多两层**。

### 5-D 判定汇总

| 问题 | 判定 | 强度 |
| --- | --- | --- |
| 同 App 内"文本 + 插画/漫画"是否在顶层按媒介分栏？ | **否，主流是下沉一级**（eBookJapan 题材层、微信读书混排首页） | 强（2 个一手样本 + 平台背书 §5-C） |
| 什么情况下才顶层分媒介？ | **供给链彼此独立时**（哔哩哔哩：番剧/漫画 vs 电影/电视剧题材） | 中（1 个一手样本，仅 Web 端） |
| 同一家公司如何处理"同资产、不同媒介"？ | **拆成两个产品，不加 tab**（LINE Manga vs LINE WEBTOON） | 强（两个官方站点） |
| 平台是否允许"媒介切换器塞进 Home 内部"？ | **允许且推荐**（HIG sidebar-within-tab + two-levels 上限） | 强（Apple 官方文档） |

---

## 6. 搜索位置

### 6.1 平台侧唯一明文

来源 2："A tab bar can include a **dedicated search tab at the trailing end**."
（详见 §2-D）

### 6.2 样本侧

| 产品 | 搜索位置 | 证据 |
| --- | --- | --- |
| LINE Manga（Web） | 侧边菜单内独立项 `ヘルプ` 旁无搜索；顶栏无 search item；站内搜索在 `本棚` 区（`/member/bookshelf`）附近 | 来源 5（菜单字面无搜索项） |
| LINE WEBTOON（Web） | 顶栏 `Search`，占位文案 "Search series or c…" | 来源 7 |
| GoodNovel（Web） | 顶栏 `Search`（与 `Library` 并列） | 来源 14 |
| eBookJapan（Web） | 顶栏 `検索`（与 `本棚` / `カゴ` 并列） | 来源 6 |
| Dreame（Web） | 顶栏 `search`（与 Home / Ranking 并列） | 来源 13 |
| Wattpad（Web） | 顶栏无搜索项；有 `Download app` | 来源 15 |

**观察：6 个 Web 样本中 5 个把搜索放在顶栏（与内容型导航并列），0 个把搜索做成"独立内容 tab"。**
即在**桌面/宽屏**语境下，搜索是顶栏的**工具型条目**，与移动端"是否占一个 tab 位"是不同的问题。

### 6.3 移动端：证据缺口（重要）

委托方点名的移动端对照（Instagram / TikTok / 小红书 搜索独立成 tab vs
YouTube / X / Netflix 搜索放顶栏图标）**本次全部未取证**：

- `support.tiktok.com` 抓到了"Exploring videos"一级分区含 `Discover and search`（来源 11），
  **但文章正文是 JS 渲染，未能确认"搜索是否占一个底部 tab 位"**。
- Instagram 帮助中心、小红书、YouTube、Netflix：见 §1.2、§9。

**因此：哪个搜索模式与使用量相关，本报告没有任何证据。**
委托问题中的"which pattern correlates with usage"属于需要厂商内部数据或
可复现的公开实验才能回答的问题，公开一手文档不覆盖。

### 6.4 唯一能确定的一条：尾部位置有竞争

HIG 规定 dedicated search tab 在 **trailing end**（来源 2）。
若同时把"我的"放在末位（§3.2 观察到的主流惯例），**末位只能容纳一个**。
这是一个纯几何约束，不需要任何实测数据即成立。

---

## 7. 对 Pictelio 的直接启示（只写外部事实，不含本项目代码结论）

> 本节**不包含**任何对本项目源码、路由或现状的判断——那属于另一位工程师的职责。
> 这里只陈述外部证据所允许与所禁止的事。

### 7.1 强证据支持的说法

1. **4 个 destination 会触发 M3 标签行为跳变。** M3 的
   `LABEL_VISIBILITY_AUTO` 在 ≤3 项时全显示文字、≥4 项时只显示选中项文字（来源 1）。
   任何落在 4 个 tab 的方案都必须显式处理 `LABEL_VISIBILITY_LABELED`，否则"每个 tab 有文字"
   的现状不会自动保持。**这是平台文档级的确定后果，不是猜测。**

2. **5 个 destination 是 M3 的实现天花板，不是建议值。** `BottomNavigationView` 直接拒绝
   >5 个 menu item（来源 1）。这排除了"再多加一栏"这个方向。

3. **"在 Home 内部放一个媒介/题材切换器"是平台明确认可的形态，不是降级方案。**
   HIG 原文两处背书（来源 2、3），并附带可执行约束：
   - tab 内的次级导航**不得改变当前 tab**（来源 2）；
   - sidebar 最多**两层**层级（来源 3）；
   - 侧栏内**不要把关键信息或操作放在底部**（来源 3："Avoid putting critical information
     or actions at the bottom of a sidebar"）。

4. **收藏/书架不必然寄生在"我的"里。** LINE Manga 把 `本棚` 与 `お気に入り`
   与 `マイメニュー` **并列**（来源 5）；GoodNovel 把 `Library` 放顶栏（来源 14）。
   "高留存产品都把收藏塞进我的"这一常见假设，在本次样本中**没有出现**。

5. **"文本 + 插画"同框，主流是媒介下沉一级。** eBookJapan 是最清晰的样本：
   小说与漫画的差异出现在 `ジャンル` 之下（来源 6、7）；哔哩哔哩则是把
   **供给链独立**的番剧/漫画提上顶层，同时把题材压回首页（来源 10）。
   **判据不是"媒介多不多"，而是"两条供给链是不是同一个商品品类"。**

### 7.2 弱证据 / 不可作为依据的说法

以下在本报告的采集中**没有一手依据**，列出以防被误用：

1. **"Apple 规定 3–5 个 tab"** —— 现行 HIG（2026-06-08）**无此原文**（来源 2 全文已核）。
   唯一出现的数字是 iPadOS 自定义 tab 的 "five or fewer"（来源 2）。
   **可以引用的是 M3 的 3–5（来源 1），不是 Apple 的 3–5。**

2. **"多数内容 App 冷启动落 Home 而非上次浏览的 tab"** —— HIG 未规定（来源 2 全文已核），
   唯一产品侧陈述（LINE Manga 官方 note）本次未抓取成功。**未证实。**

3. **"我的必须在末位"** —— 是观察到的惯例（来源 5、13），**不是平台规则**。

4. **"Instagram / 小红书把搜索做成顶层 tab correlates with usage"** —— 零证据（§6.3）。

5. **"高留存产品主导把二级收藏放进 Me"** —— 本次 4 个样本中 0 个支持该说法，
   3 个反证。**本次采样的结论，不可外推为全市场结论。**

### 7.3 外部证据无法回答、需另行取证的问题

- 移动端 4–5 个 tab 的**具体文案长度**与 `LABEL_VISIBILITY` 组合在中文下的实际观感；
- 任何"改导航 → 留存/使用时长变化"的因果关系（需产品数据，公开文档不覆盖）；
- 哔哩哔哩 / 哔哩哔哩 App 端、抖音、起点读书、番茄小说的**移动端** tab 结构。

---

## 8. 证据清单

> 全部于 2026-10-03 实际抓取。抓取方式：`web_fetch`（一手读取）或 `curl` + HTML 文本抽取。
> 凡未出现在本清单中的 URL，均未被本报告用作依据。

| # | URL | 支持什么 | 抓取方式/状态 |
| --- | --- | --- | --- |
| 1 | `https://raw.githubusercontent.com/material-components/material-components-android/master/docs/components/BottomNavigation.md` | M3 "three to five destinations"；`BottomNavigationView` ≤5 menu item；`LABEL_VISIBILITY_AUTO` 在 3/4 项处的行为切换 | web_fetch，全文读取成功 |
| 2 | `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/tab-bars.json` | HIG tab bars 全文：定性 tab 数量规则、"Avoid overflow tabs" / More tab、"navigation not actions"、toolbar 替代、"Include tab labels… single words"、"Don't disable or hide tab bar buttons"、iOS "dedicated search tab at the trailing end"、iPadOS "five or fewer"、visionOS "sidebar within a tab" 与"prevent selections in the sidebar from changing which tab is currently open" | web_fetch，DocC JSON 全文读取成功（页面 `alert-date` = 2026-06-08） |
| 3 | `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/sidebars.json` | HIG sidebars 全文："Consider using a tab bar first"、"show no more than two levels of hierarchy in a sidebar"、"you don't need to choose between a tab bar or sidebar… adopt a style of tab bar that provides both"、"Avoid putting critical information or actions at the bottom of a sidebar" | web_fetch，DocC JSON 全文读取成功（`alert-date` = 2026-06-08） |
| 4 | `https://developer.android.com/develop/ui/compose/components/navigation-bar` | Jetpack Compose `NavigationBar` 组件页存在（抓到的仅为站点导航外壳，正文被截断，**未用于任何数字引用**） | web_fetch，部分成功 |
| 5 | `https://manga.line.me/` | LINE Manga 官方站侧边菜单完整字面列表：毎日無料 / ストア / インディーズ / 本棚 / お気に入り / マイメニュー / LINEマンガ編集部 / LINEコミックス / ログイン / お知らせ / ヘルプ；"約112万点"；页脚 "LINE Digital Frontier Corporation" | web_fetch，全文读取成功（正文返回地域限制提示，但侧边菜单为服务端渲染，已提取） |
| 6 | `https://ebookjapan.yahoo.co.jp/` | eBookJapan 顶栏字面：ホーム / ジャンル / 新刊 / ランキング / 無料マンガ / セール / 検索 / 本棚 / カゴ / クーポン；首页题材标签含 マンガ雑誌 / ライトノベル / 少女・女性 / 少年・青年 / 恋愛 / 文芸・ビジネス・実用 等 | curl + 文本抽取，成功 |
| 7 | `https://ebookjapan.yahoo.co.jp/category/` | 确认「ジャンル」层同时包含小说系（ライトノベル / 少女・女性 / 少年・青年 / 恋愛 / 文芸・ビジネス・実用）与漫画系（マンガ雑誌），即**媒介差异下沉一级** | curl + 文本抽取，成功 |
| 8 | `https://weread.qq.com/` | 微信读书首页栏目：最近热搜 / 大家都在看 / 榜单 / 大家都在读（"近期热读的出版书"）等；**单一信息流、无媒介分栏** | curl + 文本抽取，成功（页面为 Nuxt 应用，提取自服务端渲染内容） |
| 9 | `https://www.webtoons.com/en/` | LINE WEBTOON 独立站点：导航含 `ORIGINALS` / `CATEGORIES` / `CREATORS` / `DASHBOARD` / `Search`（占位 "Search series or c…"）；分类全为漫画题材（Action / Romance / Fantasy / Comedy / Horror…） | curl + 文本抽取，成功（部分导航项为 JS 渲染，已标注） |
| 10 | `https://www.bilibili.com/` | 哔哩哔哩 Web 顶层：首页 / 番剧 / 直播 / 游戏中心 / 会员购 / **漫画** / 赛事 / 下载客户端；首页 partition 含 电影 / 电视剧 / 综艺 / 纪录片 / 动画 / 游戏 / 鬼畜 / 音乐 等题材 | curl + 文本抽取，成功 |
| 11 | `https://support.tiktok.com/en/using-tiktok/exploring-videos` | TikTok 官方帮助中心 "Exploring videos" 一级分区：**For You / Friends Tab / Discover and search** | curl + 文本抽取，成功（**分区索引为服务端渲染，文章正文为 JS，未能确认 tab 布局**） |
| 12 | `https://www.comico.jp/` 与 `https://www.comico.jp/search` | comico 顶层入口字面：`作品を探す` / `ログイン・会員登録` / `お知らせ` / `ヘルプ` | curl + 文本抽取，成功 |
| 13 | `https://www.dreame.com/` | Dreame 顶栏字面：Home / Ranking / Become a Writer / Writer Benefits / Download / search / Log in | curl + 文本抽取，成功 |
| 14 | `https://www.goodnovel.com/` | GoodNovel 顶栏字面：Library / Search / Win the Prize / Contest / LOGIN | curl + 文本抽取，成功 |
| 15 | `https://www.wattpad.com/` | Wattpad 顶层字面：Browse / Community / Write / Download app / Log in / Sign Up | curl + 文本抽取，成功 |
| 16 | `https://m3.material.io/components/navigation-bar/guidelines` | **仅证明该页存在**；正文为 Angular JS 渲染，body 内无任何正文文本 → 本报告**未**据此引用任何 M3 数字 | web_fetch，200 但无正文 |
| 17 | `https://wnm.manga.line.me/linemanga/web/help?lang=ja` | LINE Manga 官方帮助中心入口；**正文为 JS 渲染**，去标签后仅得 2 行 → 未据此引用任何 tab 结构 | curl + 文本抽取，部分成功 |

**成功取得可引用内容的来源数：15**（来源 1–3、5–15）。
来源 4、16、17 抓取不完整，仅用于记录"已尝试且失败"，未支撑任何结论。

---

## 9. 弱证据与未证实项

> 本节按要求**不得为空**。以下全部是本次采集中**没有拿到一手证据**的项，
> 以及采集中遇到的**方法论障碍**，供复核者判断本报告的适用边界。

### 9.1 平台规则层面

1. **"Apple 规定 iPhone 底部 tab 为 3–5 个"——未证实。**
   现行 HIG（2026-06-08，`alert-date` 见来源 2）**不含**该表述。
   唯一在搜索结果摘要中看到该说法的是 `https://uiuxdesigning.com/ios-tab-bar/`
   ——第三方 UX 博客，**非 Apple 官方**，属二手来源，**不采纳**。
   若要坐实，需要 Apple 官方文档中确实出现过该措辞的版本（例如更早的 HIG 存档）。

2. **M3 的"3–5"是否来自 m3.material.io 本身——未证实。**
   本报告的数字全部来自 Google 官方 GitHub 仓库文档（来源 1）。
   m3.material.io 正文抓不到（来源 16），**无法核对两处措辞是否完全一致**。
   若需要引用 m3.material.io 的原始英文表述，须换用可执行 JS 的抓取方式。

3. **"冷启动应落在 Home 而非上次浏览的 tab"——未证实，且平台无此规则。**
   HIG tab bars 页全文（来源 2）无相关规定。
   唯一产品侧线索是 LINE Manga 官方 note
   `https://note.com/lws/n/n830451b5c751`，其摘要称
   「トップページとは、LINEマンガアプリを起動した際、一番最初に表示される"おすすめ"タブのページです」，
   **但该页面本次未直接抓取成功**，故标记未证实。**这是本次最值得补抓的一条。**

4. **FAB vs 顶层 tab 的官方对价——未证实。**
   未找到任何一手平台文档正面比较这两者。
   来源 2 只提供了等价约束的**一半**（操作类需求应放 toolbar）。
   HIG 有独立的 "buttons" / "fab" 页面，本次**未抓取**。

5. **"我的"必须在末位——未证实为平台规则。**
   观察到的惯例（来源 5、13）≠ 平台规则。
   HIG 只规定了 search tab 在 trailing end（来源 2）。

6. **"One navigation destination is always active"——未直接证实。**
   该句出现在 m3.material.io 页面在 DuckDuckGo 的搜索摘要中（来源 16 的页），
   但因该页正文不可抓取，本报告**未**将其作为 M3 断言的依据。

### 9.2 产品层面：本次完全没取到 tab 列表的对象

| 对象 | 尝试的 URL | 失败原因 |
| --- | --- | --- |
| **Netflix** | `https://help.netflix.com/en/node/62526` | **抓取超时**（web_fetch timeout） |
| **YouTube** | `https://support.google.com/youtube/answer/141805?hl=en` | 抓到帮助中心导航外壳，文章正文 JS 加载 |
| **Instagram** | `https://help.instagram.com/` | 首页 200，但正文为 JS，未提取到 tab 标签 |
| **小红书** | `https://www.xiaohongshu.com/` | 去标签后**可提取文本行为 0**（纯 JS 壳） |
| **抖音** | `https://www.douyin.com/` | 返回 2.4KB 跳转桩 |
| **起点读书** | `https://www.qidian.com/` | 返回 209 空壳（202） |
| **哔哩哔哩 App 端** | `https://www.bilibili.com/` | Web 端成功（来源 10），**App 底部 tab 未取证** |
| **Kindle / Amazon Books** | `https://www.amazon.com/gp/help/...` | **HTTP 403** |
| **Kobo** | `https://www.kobo.com/en/support` | **HTTP 403** |
| **Apple Books** | `https://support.apple.com/guide/books/welcome/ios` | **HTTP 404**（该 slug 已失效） |
| **Tapas** | `https://help.tapas.io/...`、`https://www.tapas.io/` | **HTTP 403 / 连接失败（000）** |
| **Wattpad 帮助中心** | `https://help.wattpad.com/hc/en-us` | **HTTP 403**（但 `www.wattpad.com` 主站成功，来源 15） |
| **Kakao Webtoon** | `https://www.kakaowebtoon.com/` | **连接失败（000）** |
| **Piccoma** | `https://www.piccoma.com/` | **连接失败（000）**，桌面与移动 UA 均失败 |
| **Radish** | `https://www.radishfiction.com/` | **连接失败（000）** |
| **Melon Books** | `https://www.melonbooks.co.kr/` | **连接失败（000）** |
| **DLsite** | `https://www.dlsite.com/` | 200 但**正文为 JS 渲染**，导航标签未提取到 |
| **番茄小说** | 未尝试（本次未列入抓取计划） | — |

**这意味着委托方点名的多媒介清单中，有 8 个对象本次零证据**
（Kindle / Apple Books / Kobo / Tapas / Kakao Webtoon / Piccoma / Melon Books / Radish）。
§5 的结论**不覆盖**这些产品。

### 9.3 方法论障碍（供复核者知道为什么会有上述缺口）

1. **`web_search` 工具在本会话不可用。** `mcp_invoke` 对 `web_search` 与 `tool_search`
   均返回 "Unknown tool_name"。替代方案是直接抓取 DuckDuckGo 的 HTML 端点，
   但**在本次会话进行到中段时该端点开始返回 bot 验证码页面**
   （`anomaly-modal`，"Unfortunately, bots use DuckDuckGo too"），
   后续的 `site:` 限定搜索因此失败。这直接导致 §9.2 中多数"官方帮助页"未能定位。

2. **大量目标站点的导航是 JS 渲染。** m3.material.io、developer.apple.com（HIG）、
   support.google.com、help.instagram.com、www.dlsite.com、
   wnm.manga.line.me、weread.qq.com 的部分区域均为客户端渲染。
   其中 Apple HIG 通过改抓 DocC JSON 端点
   （`https://developer.apple.com/tutorials/data/design/human-interface-guidelines/<slug>.json`）
   成功绕开，**这是本次唯一奏效的 JS 绕过手法**，
   其余站点未能用同样方式解决（推测其数据端点路径不同，本次未逐一探测）。

3. **反爬。** Amazon、Kobo、Tapas、Wattpad 帮助中心统一返回 403；
   多个日本/韩国站点（Piccoma、Kakao Webtoon、Melon Books、Radish）连接直接失败（000），
   推测与网络出口位置有关。**这些失败不代表这些产品的 tab 结构与本报告结论不符。**

4. **本次实际成功取证的来源数为 15，低于任务书设定的 30 条目标。**
   原因如上 1–3。**这是本次交付的已知不足，不是"证据已足够"。**

### 9.4 结论的适用边界

- §2（平台硬约束）**可直接依赖**：两条主来源（来源 1、2、3）均为官方文档全文。
- §4（二级收藏归属）**较强**：LINE Manga 单样本结构极清晰，但样本量 3–4，需扩样。
- §5（多媒介切法）**方向可信、覆盖面不足**：eBookJapan 与 LINE Manga/WEBTOON 两条证据强，
  哔哩哔哩的反例强，但仅覆盖 Web 端，未覆盖 9.2 表中 8 个未取证产品。
- §6（搜索位置）**仅移动端部分失败**，且"与使用量相关"这一问**零证据**。

---

*本文档只含外部证据，不含对 Pictelio 源码、路由或现状的任何判断。*
*所有 URL 于 2026-10-03 实际抓取；未抓取成功者已在第 9 节逐条列出。*
