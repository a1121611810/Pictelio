# 移动端全局搜索模式调研(Global Search Patterns)

> 调研日期:2026-09-01 | 方式:纯网络调研(未读本地代码)
> 目标:为 Pictelio app-lynx(Lynx 移动端客户端)新增"搜索插画 + 小说"功能,评估"更灵活、可全局调用"的搜索方案(类似 command palette / Spotlight 的全局入口)。
> 引用约定:正文以 `[S#]` 标注来源编号,详见文末「来源汇总」。少数结论(已标注"摘要核实")来自搜索引擎结果摘要、未取得原文 URL,可信度低于官方文档。

---

## 摘要(一屏读完)

1. **官方规范高度一致**:Material Design 3 定义了"搜索栏 + 全屏覆盖式搜索结果"的完整形态([S1][S2]);Apple HIG 明确要求"全 App 只保留一个明显的搜索位置",并建议**搜索是核心功能时给独立 Tab**、搜索建议随输入实时更新且点击即执行([S4])。Android 官方同样推荐 SearchView 悬停在 App Bar 上、从图标展开([S6][S7])。
2. **"入口放在哪"是唯一真正有分歧的决策点**,而呈现形态(全屏搜索页)几乎是行业事实标准。2024–2026 年的明显趋势是**搜索入口向底部导航迁移**(pixiv 官方 App 2024 年新增底部"検索"Tab 与"みつける"Tab [S10][S11]、Spotify 2016 年起 Search 即核心底部 Tab [S20]、YouTube Music 2025–26 把搜索从右上角图标整体迁入底部栏 [S26 摘要核实]、Instagram 2025 年甚至把搜索栏从顶部移到底部导航 [S22]),核心理由是**大屏单手可达性(Fitts 定律)与可发现性**。
3. **"全局可调用"的极致形态是命令面板/Spotlight 式覆盖层**(Notion Quick Find、macOS Spotlight [S18][S19]),其移动端适配通常是把**全屏覆盖层**作为形态、把**底部 Tab 或顶部图标**作为入口——即"入口显式化 + 形态覆盖化"的组合,而不是靠隐藏手势。
4. **对本项目的建议**:以 **P1(底部"搜索"Tab 常驻入口)+ 全屏搜索页(覆盖层形态、M3 full-screen layout)** 为主方案;搜索页内部走"**搜索前四件套(历史/热搜/联想/推荐词)→ 提交 → 结果 Tab(插画/小说/用户,带计数)→ 排序过滤**"的成熟链路。P3(命令面板)的思想通过「搜索页可从任意页面直接打开(路由级深链)」落地。不推荐纯手势唤起(P5,与 Lynx 滑动手势冲突、可发现性差)。
5. **体验细节共识**:联想/即时搜索用 **150–300ms debounce + AbortController 防竞态**(debounce 只减请求量、不解决乱序问题);**搜索历史只在"确认提交"时保存**(否则历史全是半截输入),去重、限 8–10 条、chips 展示、可单删/全清,存本地;结果 Tab 带计数、计数为 0 时隐藏;无结果态要给出路(换词/放宽/切换类型),错误态保留关键词可重试。

---

## 1. 官方设计规范要义

### 1.1 Material Design(M3 Search + M1 Search patterns)

**M3 Search 组件**([S1][S2]):
- 用途定义:"Search lets people enter a keyword or phrase to get relevant information"(让用户输入关键词获取相关信息)。
- 推荐样式:**Contained**(填充容器,分隔搜索栏与建议/结果列表);基线样式 Divided。与 M3 Expressive(2025)配合有更强的动效与灵活性。
- 布局:**Full-screen(全屏)**与 **Docked(停靠面板)**两种——搜索建议/结果占据整屏或停靠面板,即"从搜索栏展开为覆盖屏"是官方主推交互。
- 规格:搜索栏最小 360dp、最大 720dp、高 56dp;聚焦时填充区从 24dp 边距扩展为 12dp(Expressive),标签左对齐;颜色/状态由设计令牌驱动,分为"未聚焦的搜索栏"与"搜索视图全状态"两套 token。
- M3 App Bar 组件新增 **Search app bar** 变体(2025 M3 Expressive 更新):搜索栏可置于 App Bar 内(图标在栏内/栏外、居中文本),选中后打开搜索视图([S3])——即"顶部 App Bar 内搜索栏 → 全屏搜索视图"的官方背书。

**M1(经典 Material)Search patterns**([S5]):
- **Persistent search(常驻搜索)**:当搜索是 App 核心功能时,在内容区顶部放一个内嵌搜索框,保持可聚焦;聚焦后展示**历史建议**,选择建议即提交;结果以卡片呈现;搜索框在结果页保持可见但失焦、键盘收起;上下箭头(↑)收回焦点与建议,X 清空文字,支持语音搜索。
- **Expandable search(可展开搜索)**:当搜索不是主要焦点时,工具栏放放大镜图标,点击后工具栏原位变换为搜索框(自动聚焦、弹出键盘、下方显示历史建议),↑ 关闭并还原工具栏;结果在工具栏下方以卡片呈现。
- 两种模式都在用户输入时从"历史建议"切换到"自动完成建议",选择建议或回车即提交;X 清空;结果加载后搜索框保持在页面上但失焦。

### 1.2 Apple Human Interface Guidelines(HIG)

**Searching 章节**([S4]):
- **单入口原则**:`Provide a single, obvious place for users to search within your app`——避免多页面重复放搜索框;不同类别用搜索范围(scope)而非多个物理入口区分。
- **位置决策**:`Give search its own tab when it's a primary feature. Otherwise, put a search field in a navigation bar.`(搜索是主要功能 → 独立 Tab;否则放导航栏/内容顶部)。
- **占位符**:简短具体(如 "Search contacts"),不用 "Type here to search…" 类指令语句;占位符不是默认值。
- **范围指示器(scope)**:仅在确有需要时使用(分段控件),切换范围应即时刷新结果;不要平白增加界面层级。
- **建议(suggestions)**:强烈推荐随输入实时显示补全/联想(历史、热门、实体名,可用 iOS 16+ `UISearchSuggestion`);**建议应可点击并直接执行搜索**,而非仅填充文本框;不被键盘/手势关闭后遮挡关键内容。
- **搜索历史隐私**:用户应能随时清除历史("Clear");历史属敏感数据,不应默认跨设备同步;同步需明确告知并可关闭;善用隐私设置开关。
- **Spotlight 集成**:App 内容应可通过系统级搜索被发现(Core Spotlight / `NSUserActivity`),索引保持最新、返回深链;不要索引临时或私密数据([S8] 展示 iOS 18+ Core Spotlight 语义搜索:按语义而非精确匹配索引,索引本地私有)。

**Search fields 章节**([S4][S9 摘要核实]):iOS/iPadOS 底部工具栏优先,顶部工具栏/内联为备选(单手可达性);iPadOS/macOS 在工具栏尾部或独立侧栏/标签页项。

**Spotlight 唤起方式**([S14]):主屏中央**向下滑动**(或点击主屏底部搜索按钮,Face ID 机型)打开 Spotlight;结果随输入实时更新;支持 "Search in App" 直接进入 App 内搜索。

### 1.3 Android 官方

- "Create a search interface"文档([S6][S7]):推荐用 **SearchView 作为 App Bar 的活动视图**(`collapseActionView|ifRoom`,图标初始收起、点击展开为搜索框),而非系统搜索对话框;须配置 `hint` 提示可搜索内容;搜索 Activity 设 `singleTop` 并在 `onCreate`/`onNewIntent` 双路径处理 query;在线搜索显示进度条;本地 SQLite 用 FTS 全文本检索。
- 系统级搜索(主屏长按/上滑、设备搜索)于 App 内为"可被搜索的源",与本文讨论的 App 内搜索入口是互补而非替代。

---

## 2. 知名应用搜索交互实证

| 应用 | 入口位置 | 呈现形态 | 关键特征 | 来源 |
|---|---|---|---|---|
| **pixiv 官方 App** | 底部导航"検索(みつける)"Tab(Android 2024-06 起);同时有"ホーム"与"ディスカバー"Tab | 全屏搜索页 | 底部 nav 上线后,搜索从右上角图标升级为常驻 Tab;搜索页支持详细搜索选项(解像度/縦横比/制作ツール/小说长度/ジャンル等,2026-04 版本);搜索历史 + 人気タグ;顶部可切"イラスト・マンガ/小説/ユーザー" | [S10][S11][S12 摘要核实] |
| **Twitter / X** | 底部导航 Explore(放大镜)Tab,兼作搜索按钮;2026 重制的底部 dock 含 Home / Explore(Grok 搜索)/ 通知 / 聊天 | 全屏搜索页 | "Explore" 将趋势内容与搜索融合为发现入口;2026 新搜索系统上线 Top/Latest 双 Tab,因语义化召回被吐槽「关键词被忽略」——时序/精确召回与语义召回的经典张力 | [S13][S27 摘要核实] |
| **Instagram** | 顶部搜索栏 → **2025-09 实测 A/B 迁移到底部导航**(大量用户抱怨"肌肉记忆被打碎") | 全屏覆盖式搜索结果页 | 顶部搜索(Explore)曾用 `UISearchController` + 分段控件(Top/People 等);底部化后争议集中于习惯迁移;作者评价"大屏更自然",建议像 Chrome 一样允许用户选择位置 | [S22][S21 摘要核实] |
| **抖音 / TikTok** | 底部导航"搜索/发现"Tab(历史上在"搜索"与"Discover"间摇摆) | 全屏搜索页 + 结果可滚动信息流 | 搜索入口即发现页,热词/发现内容前置;结果区按"视频/用户/声音/话题"筛选;行业讨论中搜索正演变为"第二个 For You 页"(意图驱动信息流) | [S15][S16][S17] |
| **哔哩哔哩** | 首页顶部搜索框,点击后蒙层变暗、原地展开全屏搜索输入 | 全屏搜索页(建议层)→ 结果页 | 结构:Ctrl 层"搜索建议/历史/热搜/推荐词"→ 结果层**多 Tab(综合/视频/番剧/影视/用户/直播/专栏),每 Tab 显示 `{分类名} {计数}`(计数 -1 时隐藏)**;支持防抖联想、Tab 二次点击回顶刷新;类型独立结果面板 | [S18][S19][S20][S21] |
| **微信** | 导航栏下方全局搜索(仅"微信""通讯录"两个 Tab 有;初始状态隐藏或随内容下滑隐藏、回顶部才出现);另一主入口是"发现→搜一搜" | 全屏搜索页;搜索范围**前置**到搜索框菜单(搜一搜/朋友圈/公众号/小程序等),而非结果页 Tab | 场景化显隐:"我不需要你时你从不打扰,我需要你时你恰好出现";原因是微信核心是聊天、搜索是辅助;范围和结果混合形态换来"入口低权重但全局可达" | [S28 摘要核实][S30 摘要核实] |
| **Telegram** | 首页顶部常驻全局搜索栏(新版本追加底部工具栏入口,且**保留了原顶部入口作为视觉弱化的过渡**,先同存、后迁移) | 全屏搜索结果,跨全部会话 | 全局跨会话检索 + 本地索引(毫秒级);过滤语法 `from:@user`、引号精确、文件/图片/链接类型过滤;历史只在"已同步到设备"的消息内可搜 | [S29 摘要核实][S31 摘要核实] |
| **Notion** | 侧栏 Search + **Cmd/Ctrl+P / K** 全局唤起 | **命令面板式覆盖层(Quick Find)** | 覆盖层内顶部输入、下方"最近浏览"快捷跳转;支持引号精确、排序(最佳匹配/最近编辑/创建)、过滤(仅标题/创建人/团队空间/日期);Notion AI 可"全源搜索";桌面端还有"全局命令搜索"(外部唤起)。最近改版给结果加页面预览 | [S23][S24][S25] |
| **Spotify** | 底部导航核心三 Tab:Home / Search / Your Library(2016 年弃汉堡菜单改底部 5 Tab:Home/Browse/Search/Radio/Your Library) | Tab 即搜索页(非覆盖层) | 迁移后整体点击 +9%、菜单项点击 +30%;搜索页顶部是 Top genres + 最近搜索;著名痛点:**Tab 在底部、但搜索框在页面顶部,大屏单手难达**(The Verge 2016 当场吐槽),用户持续要求"点 Tab 自动弹键盘" | [S20][S32][S33] |
| **YouTube / YouTube Music** | YouTube 主 App:右上角放大镜图标 → 搜索页;YouTube Music:**2025-08 起测试、2026 年中全量,搜索图标从右上角整体迁入底部 Tab**(Home/Samples/Search/Library) | 全屏搜索页;搜索页整合发现内容(New releases/Charts/Moods & genres)与近期查询 | 官方迁移理由写明:**单手可达性(大屏手机)**;与流媒体同类 App 对齐;语音/哼唱识别快捷键保留在搜索页顶部 | [S26 摘要核实] |

---

## 3. 模式分类:入口触发 × 呈现形态 × 交互流程

三个维度提炼:
- **入口触发**:底部 Tab / 顶部常驻框 / 顶栏图标展开 / 底部弹层入口 / 手势 / 快捷键。
- **呈现形态**:全屏页面 / 全屏覆盖层(overlay)/ 半屏 sheet / 就地展开(transform)。
- **交互流程**:输入 → 联想建议 → 提交 → 结果页(是否带类型 Tab、排序、过滤)。

按这三个维度归纳出 **5 种截然不同的模式**:

### P1 专属搜索 Tab(底部导航常驻入口 + 全屏搜索页)

| 维度 | 描述 |
|---|---|
| 入口 | 底部导航常驻 Tab(放大镜图标) |
| 形态 | 全屏搜索页(可与发现内容融合) |
| 流程 | 点 Tab →(可选自动弹键盘)→ 历史/热词 → 联想 → 提交 → 结果页(类型 Tab) |

- **代表应用**:pixiv 官方 App(検索 Tab [S10])、Spotify(Search Tab [S32])、YouTube Music(2025–26 迁入 [S26 摘要核实])、X(Explore Tab [S13])、TikTok(发现/搜索 Tab [S16])、Instagram 2025(搜索栏移至底部 [S22])。
- **优点**:可发现性最高(常驻、永不迷路);thumb 区单手可达,物理设计满足大屏时代;官方规范直接背书(HIG:搜索为主要功能时给独立 Tab [S4]);迁移测试证明可显著提升功能使用率(Spotify +30% 菜单点击 [S32])。
- **缺点**:消耗一个底部 Tab 名额(3–5 个上限内,右侧不足时需取舍,如与"客户端切换"Tab 竞争);当搜索非核心功能时权重过高(微信的反例 [S30 摘要核实]);Tab 页面与"当前内容页里的搜索"(如小说页内搜)割裂。
- **适配场景**:内容消费型/发现型 App——搜索是高频主动行为。**与本项目(pixiv 第三方面向插画+小说发现)高度匹配。**

### P2 顶部搜索框 / 顶栏图标(常驻框、图标展开、隐显式)

| 维度 | 描述 |
|---|---|
| 入口 | 内容区顶部常驻框 / App Bar 放大镜图标点击展开 / 下滑隐藏、回顶出现 |
| 形态 | 就地展开(M3 expandable [S5])→ 全屏搜索页(M3 Search App Bar [S3]) |
| 流程 | 点框/图标 → 自动聚焦弹键盘 → 历史/热搜/联想 → 提交 → 结果页 |

- **代表应用**:B 站(顶部框,蒙层展开 [S20][S21])、Telegram(顶部常驻 [S29 摘要核实])、微信(导航栏下方,场景化隐显 [S30 摘要核实])、小红书/抖音(右上角放大镜 [S31 摘要核实])、Pinterest(桌面大框/移动图标 [S34 摘要核实])、YouTube 主 App(右上角图标)。
- **优点**:不占底部 Tab,内容优先;符合 M1/M3 官方 "expandable/App Bar 内搜索栏" 规范;可做场景化显隐(微信式"需要时恰好出现")。
- **缺点**:单手难达(顶部犄角旮旯,Verge 对 Spotify 高位置搜索框的吐槽是经典证据 [S33]);隐显逻辑增加状态复杂度;图标形态可发现性弱于文字 Tab;只在首页有入口时,"全局可调用性"受损。
- **适配场景**:搜索是辅助功能的工具型 App(IM、效率工具);或作为 P1 的**补强**(首页顶部再放一个入口,与底部 Tab 同源同页面)。

### P3 全局命令面板 / Spotlight 式覆盖层

| 维度 | 描述 |
|---|---|
| 入口 | 快捷唤起(Cmd/Ctrl+K/P)、任何页面的统一徽标按钮、系统级趋势(Spotlight 下滑 [S14]) |
| 形态 | 全屏覆盖层(输入置顶、下方建议/结果列表,分组带图标) |
| 流程 | 唤起(输入框自动聚焦)→ 即时过滤/搜索 → 点击结果直接执行(打开页面/执行动作) |

- **代表应用**:Notion Quick Find([S23][S24])、macOS/iOS Spotlight([S14])、各类桌面工具(Figma、编辑器);移动端适配为"底部弹层或全屏 sheet 化命令框"(社区实践 [S35 摘要核实])。
- **优点**:**全局可调用性第一**——任何页面一触即达,可与底层导航/跳转动作合并(搜"设置/关于"直达);期望一致性最强,是产品负责人 "command palette / spotlight" 诉求的直接答案;单一入口符合 HIG 单入口原则。
- **缺点**:移动端无 Cmd+K 文化,可发现性差,**必须有配合的显式入口**;覆盖层与当前页面上下文割裂,返回/键盘管理复杂;结果承载类型多(对象+动作)时排序与分组复杂度↑;对 Lynx 需自绘覆盖层与遮罩,实现与性能成本较高。
- **适配场景**:作为**形态**而非唯一入口——把"全屏覆盖搜索层"作为 P1/P2 入口点开后呈现的界面,再在详情页等提供全局直达入口。桌面/键盘场景(如有 Web 版)可做 Cmd+K 等价物。

### P4 底部弹层 / 半屏 Sheet

| 维度 | 描述 |
|---|---|
| 入口 | 底部按钮/手势上拉 |
| 形态 | 半屏 sheet(可拖拽、snap 吸附、滑动关闭) |
| 流程 | 唤起 → 输入 → (联想/历史在 sheet 内)→ 提交后跳转全屏结果页或 sheet 内展示精简结果 |

- **代表应用**:移动端命令面板的 sheet 化适配(社区组件 CommandSheet,支持半屏/全屏 snap 点 [S35 摘要核实]);"边看边搜"类上下文内搜索(如小说阅读页内查找)。
- **优点**:保留上下文(可边看边搜);拇指友好;轻量、易关闭;适合"快速导航/跳转"型搜索。
- **缺点**:半屏空间小,不适合展示"插画缩略图+小说摘要"的结果密集列表(需要二次跳转,多一次点击);与页面滚动手势、返回手势易冲突(Lynx 上需验证手势拦截)。
- **适配场景**:局部搜索(阅读器内找字、评论区筛选);全局搜索的**结果落地页**建议仍用全屏。

### P5 手势唤起(系统级形态)

| 维度 | 描述 |
|---|---|
| 入口 | 主屏下拉(iOS Spotlight [S14])、长按/上滑(Android 设备搜索)、App 内"下拉显示搜索框"(微信订阅号场景 [S30 摘要核实]) |
| 形态 | 系统级覆盖搜索或 App 内隐式展开 |
| 流程 | 手势 → 自动聚焦 → 输入 → 结果 |

- **代表应用**:iOS Spotlight(系统级标杆)、Google 搜索/Android 设备搜索、微信订阅号列表下拉搜索。
- **优点**:零 UI 占用、系统心智成熟、全局可达(主屏任何位置)。
- **缺点**:可发现性最差(用户必须"知道"手势);App 内实现与下拉刷新、返回手势、滚动回弹冲突;Android 设备级搜索在非 Google 生态(国产 ROM)上一致性差;Lynx 引擎手势支持需单独验证。
- **适配场景**:基本不适合作为 App 内主入口;可作为"系统搜索能搜到 App 内容"的溢出通道(对应 HIG Spotlight 集成 [S4])——本项目无系统级索引需求,可放弃。

---

## 4. 搜索体验细节最佳实践

### 4.1 搜索历史(本地存储)
- **只在"确认提交"时写入历史**(回车/点击建议/点击搜索按钮),不要每次击键都存——否则历史会变成"半截输入垃圾场";去重、上限约 8–10 条,chips 或列表展示;支持单条删除与全部清除;历史在"输入框聚焦且为空"时展示([S5][S36] 摘要核实)。
- 历史**本地存储**,隐私优先:同步前需告知用户并给开关(HIG [S4])。内容社区注意:搜索历史可能包含 R18 关键词,是否记录/展示需与现有 R18 开关策略一致(产品层决策点)。

### 4.2 联想词 / 热词
- 建议随输入**实时更新**(HIG 明确要求 [S4]);来源分层:历史词 → 输入联想(服务端 suggest)→ 热门/趋势词(与个性无关,全员相同)。
- **点击即执行搜索**(而非只填框,HIG [S4]);M1 的"输入前历史建议、输入后自动完成切换"同样适用([S5])。
- 搜前推词(placeholder 底纹词/猜你想搜/热榜)是内容社区激活搜索的关键手段——小红书、抖音的推词点击率可达 50%+([S31 摘要核实]),值得首版就做"热词 + 历史"组合。

### 4.3 异步即时搜索(debounce + 防竞态)
- **debounce 只减请求量,不解决乱序竞态**:必须"debounce(150–300ms,300ms 为常用甜点)+ AbortController 取消在途请求"双管齐下;不支持的平台用请求序号(sequence id)实现 last-write-wins([S36][S37])。
- 监听 `input` 事件(而非 keyup,防粘贴/IME 丢失),debounce 回调内读取**当前**输入值;吞掉 `AbortError/ERR_CANCELED` 不报错;最小字符数阈值 2–3;会话级查询缓存 Map(防重复请求,注意容量上限)。
- 空查询清空结果**不 debounce**(立即复位)。
- 取舍:联想层即时(debounced),正式结果页建议"提交式"(回车/点击进入),符合 pixiv 官方 App 与 B 站的成熟做法([S10][S18]),避免每次击键都打全量搜索接口。

### 4.4 结果 Tab 组织(插画/小说/用户)
- 类型 Tab 是内容社区标配:pixiv 官方 App 顶部"イラスト・マンガ / 小説 / ユーザー"([S10])、B 站"综合/视频/番剧/影视/用户/直播/专栏"且**每个 Tab 显示计数、计数为 -1/0 时隐藏**([S18][S19])。
- 推荐:综合(混合推荐)置顶 + 插画 + 小说 + 用户;Tab 常驻计数避免把"0 结果类型"还给用户。
- **范围前置 vs 结果 Tab**:微信将搜索范围(搜一搜/朋友圈/公众号)前置到搜索框旁菜单,原因是其内容格式高度不统一、难统一排序([S30 摘要核实]);本项目内容类型边界清晰(插画/小说/用户),**结果 Tab 后置(先搜后筛)更符合主流与官方建议**(HIG scope 指示器仅在确有价值时使用 [S4])。
- 排序/过滤作为次级控件收在结果页顶部筛选栏(B 站模式 [S20]),不要主 Tab 平铺。

### 4.5 状态机与空状态
- 把搜索界面建模为 **5 态:待输入(空)→ 联想中 → 结果 → 无结果 → 错误**,不要合并"未搜索"与"无结果"([S36] 摘要核实)。
- **待输入态**:展示历史 + 热搜 + 推荐词/分区入口(小红书/B 站模式),杜绝空白页。
- **加载态**:保留旧结果 + 骨架/轻量指示,防闪烁。
- **无结果态**:给出路——"减少关键词/换更短词""查看其他类型 Tab""清除筛选";避免 dead-end([S36] 摘要核实)。
- **错误态**:保留关键词与输入,提供重试;不要静默清空([S36] 摘要核实)。

### 4.6 焦点、键盘与手势
- 入口点开即**自动聚焦**并弹键盘(M3/SearchView `autoShowKeyboard` [S7]);用户对"点搜索 Tab 不弹键盘"持续抱怨(Spotify [S33 摘要核实])。
- 输入框右侧 X 一键清空;返回键先收起建议/键盘、再退出搜索(HIG:建议列表不应挡住关键内容且可被键盘/手势关闭 [S4])。
- 覆盖层开启时锁定底层滚动,但保留返回手势路径(Android 返回优先关闭覆盖层)。

---

## 5. 对本项目(Pictelio / app-lynx)的适用性评估

项目背景(依公开背景信息):app-lynx 为 Lynx(类 React Native 引擎)移动端客户端,搜索对象为 **Pixiv 插画 + 小说**(可扩展用户),已有底部导航承载登录/推荐/小说/个人中心/引擎切换等模块;客户端遵循 Material Design 3 风格。

### 5.1 模式打分(1–5 分,越高越好;实现成本 5=成本最低)

| 模式 | 简洁 | 可发现性 | 全局可调用性 | 实现成本(5=最低) | 总分(25) |
|---|---|---|---|---|---|
| **P1 底部搜索 Tab + 全屏搜索页** | 3 | 5 | 5 | 3 | **16** |
| **P2 顶部搜索框/图标** | 4 | 3 | 2 | 4 | 13 |
| **P3 命令面板/覆盖层(作形态)** | 3 | 3 | 5 | 2 | 13 |
| **P4 底部弹层/半屏 Sheet** | 4 | 2 | 3 | 3 | 12 |
| **P5 手势唤起** | 3 | 1 | 4 | 2 | 10 |

评分说明:
- **P1** 可发现性/全局可调用性双满分:底部 Tab 常驻,任何页面可见可点;成本中等(需一个 Tab 位 + 全屏搜索页;Lynx 需自绘搜索视图,建议复用现有 Feed 虚拟化组件思路)。
- **P2** 简洁但"全局可调用性"低:顶部入口一般只在首页;若做"每个顶部页都放"又违反 HIG 单入口原则([S4])。
- **P3** 作为**形态**与 P1 结合后总分实质提升:全屏覆盖层即"从任意页面(详情页/阅读页)直接打开搜索页",这是"全局可调用"的真正落点;单独做纯命令面板(动作+对象混合)则成本高、收益边际。
- **P4** 空间不足,不适合结果密集的搜索;**P5** 与 Lynx 手势冲突,明确排除,但"系统搜索入口"类溢出通道本阶段无价值。

### 5.2 推荐方案

**主方案:P1(底部"搜索"Tab)+ 全屏搜索页(覆盖层形态)**
- 底部导航新增"搜索"Tab(放大镜,位于首页与小说之间的核心区);进入即全屏搜索页(覆盖层,M3 full-screen layout [S2]):自动聚焦 → 历史 chips + 热搜词 + 推荐词(参考小红书/B 站 [S18][S31 摘要核实])→ 联动联想(150–300ms debounce + AbortController [S36][S37])→ 提交 → 结果页。
- 结果页:**综合 / 插画 / 小说 / 用户** 四个 Tab 带计数(计数 0 隐藏,参考 B 站 [S18])+ 顶部排序/过滤次级栏;视图复用现有卡片/虚拟滚动体系。
- **全局可调用补充(P3 思想)**:搜索页注册为路由级全局页面,详情页/小说阅读页提供顶部放大镜/悬浮按钮直达;阅读器内"正文查找"用局部搜索(P4 形态的 sheet 化简化版),两套入口指向同一界面链路。

**对齐官方与竞品的要点清单**
- 单入口原则:除全局 Tab 外,别在多个页面重复放搜索框(HIG [S4]);详情页的全局入口建议统一为"返回搜索层"而非新搜索框。
- 历史仅提交时保存、可清除、本地存储,HIG 隐私要求 [S4]。
- R18 历史词与过滤策略保持产品一致性(与现有审核开关联动,不静默保留敏感词)。
- 结果页与入口的一致性:点 Tab 直接展示历史/热词,不再要求二次点击才聚焦(Spotify 教训 [S33 摘要核实])。

**风险与权衡**
- **Tab 名额**:底部已有导航项,新增后需控制总数 ≤5,权衡"客户端切换"等低频入口的去留。
- **肌肉记忆**:Instagram 2025 迁移搜索入口引发口碑反弹([S22]);本项目从无到有新增入口,不存在迁移问题,反而可选"顶部图标 + 底部 Tab"双入口同源以最大化可发现性。
- **双端一致性**:Web(SolidJS 版)与 Lynx 版搜索语义(结果 Tab、R18 过滤)应共享契约,避免双端行为分叉。

---

## 6. 来源汇总

### Primary / 官方(优先)
- [S1] Material Design 3 — Search overview:https://m3.material.io/components/search/overview
- [S2] Material Design 3 — Search specs(contained/divided、full-screen/docked、360–720dp、56dp):https://m3.material.io/components/search/specs
- [S3] Material Design 3 — Top app bars(含 2025 Search app bar 变体):https://m3.material.io/components/app-bars/overview
- [S4] Apple HIG — Searching(单入口、主要功能给 Tab、占位符、scope、建议、历史隐私、Spotlight):https://developer.apple.com/design/human-interface-guidelines/searching
- [S5] Material Design 1 — Search patterns(persistent / expandable):https://m1.material.io/patterns/search.html
- [S6] Android Developers — Create a search interface:https://developer.android.com/develop/ui/views/search/search-dialog
- [S7] Android Developers — Set up the search interface:https://developer.android.com/develop/ui/views/search/training/setup
- [S8] Apple WWDC24(10131)— Support semantic search with Core Spotlight(iOS 18):https://developer.apple.com/videos/play/wwdc2024/10131/
- [S14] Apple Support — Use Spotlight Search(主屏下滑唤起、实时结果):https://support.apple.com/118232
- [S10] pixiv 官方 — Android 版底部导航菜单追加(2024-06-11,新增"ホーム/検索(みつける)/新着"):https://www.pixiv.net/info.php?id=11015
- [S11] pixiv 官方 — スマホ向けトップページ更新(ホーム/ディスカバー Tab,2024-06):https://www.pixiv.co.jp/2024/06/18/110000
- [S23] Notion 官方文档 — Keyboard shortcuts(Cmd/Ctrl+P / K 打开 Quick Find):https://www.notion.com/help/keyboard-shortcuts
- [S24] Notion 官方文档 — Using Quick Find to search:https://www.notion.com/help/search

### 可靠技术媒体 / 工程博客
- [S15] TechCrunch — TikTok 测试 Discover 页取代搜索 Tab(2019-07):https://techcrunch.com/2019/07/19/tiktok-tests-an-instagram-style-grid-and-other-changes/
- [S16] Page Flows — TikTok Android 搜索流程逐屏记录:https://pageflows.com/post/android/searching/tiktok/
- [S17] Software Informer — Why TikTok Search Is Becoming the New For You Page:https://software.informer.com/Stories/en/why-tiktok-search-is-becoming-the-new-for-you-page.html
- [S18] DeepWiki(PiliPlus 开源项目)— Bilibili Search System(建议层/结果 Tab/计数隐藏/防抖):https://deepwiki.com/bggRGjQaUbCoE/PiliPlus/4.6-search-system
- [S19] DeepWiki(bilibili-api-collect)— Search & Discovery(综合/分类搜索接口):https://deepwiki.com/afiuh/bilibili-api-collect/10-search-and-discovery
- [S20] CSDN — 三大平台设计模式分析之 Android:BiliBili(顶部点击图标蒙层展开):https://blog.csdn.net/weixin_39993989/article/details/117678383
- [S21] 博客园 — 评价 bilibili 移动端的搜索框(占位"热搜/推荐词"):https://www.cnblogs.com/laohei114514/p/17416555.html
- [S22] PiunikaWeb — Instagram quietly relocates search bar to bottom(2025-09-26,底部化 A/B 与用户反应):https://piunikaweb.com/2025/09/26/instagram-search-bar-bottom-placement/
- [S13] TweetDelete — Twitter symbols(Explore 放大镜即移动端搜索按钮):https://tweetdelete.net/resources/twitter-symbols/
- [S32] The Verge — Spotify 底部导航替代汉堡菜单(2016-05,9%/30% 点击增长):https://www.theverge.com/2016/5/3/11580182/spotify-design-change-says-so-much-about-the-hamburger-button
- [S33] The Verge — Spotify 新设计让搜索"伸手难及"(顶部搜索框位置吐槽):https://www.theverge.com/2016/5/3/11584046/spotify-terrible-bad-awful-too-high-search-bar
- [S25] 21notion — Notion CMD+K 升级(结果预览、最近使用加权):https://21notion.com/(原文路径未取得,摘要核实)
- [S36] 137foundry — Search Autocomplete That Feels Instant(150–300ms debounce、AbortController 防竞态、缓存与空态):https://137foundry.com/articles/search-autocomplete-instant-without-hammering-api
- [S37] TechInterview.org — Build a Search-as-You-Type Input(200–300ms debounce、三种竞态方案):https://www.techinterview.org/post/3233475061/build-search-as-you-type-input-frontend

### 需注意可信度的条目(搜索引擎摘要核实,未取得原文 URL)
- [S9] Apple HIG — Search fields(底部工具栏优先):https://developer.apple.com/design/human-interface-guidelines/search-fields(页面存在,细分为检索摘要)
- [S12] pixiv 官方 2026-04 作品搜索选项追加(イラスト/マンガ/小説 详细筛选):pixiv.net 官方お知らせ,摘要核实
- [S26] YouTube Music 搜索迁移底部 Tab(2025-08 测试/2026 全量,单手可达理由):Google 官方说明,摘要核实
- [S27] X 2026 新搜索系统(语义化召回争议、Top/Latest 双 Tab):日媒与技术媒体综述,摘要核实
- [S28] 微信官方 2019「微信搜一搜」升级与 2022 公开课(全局搜入口、7 亿 MAU):站长之家/鞭牛士报道,摘要核实
- [S29] Telegram 底部工具栏迁移与"弱化保留顶部入口"过渡:设计评论(Ilya Birman)与媒体,摘要核实
- [S30] 微信搜索入口层级分析(导航栏下方、场景化显隐、"范围前置"):人人都是产品经理/搜狐专栏《产品认为简单但开发难的技术》等,摘要核实
- [S31] 小红书/抖音"右上角放大镜 + 搜前推词(底纹词/猜你想搜/热榜)":优设网/UICN/人人都是产品经理等设计分析,摘要核实
- [S34] Pinterest 搜索 UX(桌面大框/移动图标、Guided Search chips、全屏搜索覆盖层):Designlab/Prototypr/TechCrunch 综述,摘要核实
- [S35] 移动端命令面板 bottom-sheet 化(CommandSheet,半屏/全屏 snap):dioxus-nox-cmdk 社区组件文档与 GitHub 实践,摘要核实
