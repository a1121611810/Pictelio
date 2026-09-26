# Spec: lynx 稍后看（WatchLater）

> 架构决策：ADR-0191（app-lynx 稍后看——本地暂存作品列表）；统一术语：`docs/adr/glossary-lynx-four-features.md`（**稍后看（WatchLater）**/**追更（Watchlist）**/**收藏（Bookmark）**/**快照条目**/**作品类型（WorkKind）**/**容量上限** 均以术语表为准）。红线：WatchLater 与 Watchlist/Bookmark 三链相互独立，任何命名与文案不得交叉。

## Problem Statement

用户刷 Feed 时经常遇到"有点意思，但现在没空看"的作品，想要一个"随手暂存、回头再看"的去处。现状三条路都不通：收藏（Bookmark）是服务端可见性资产、带收藏标签体系，拿它当暂存会污染收藏语义；追更（Watchlist）是小说系列的服务端订阅，覆盖不了"单部作品看一眼"的场景；下载队列是文件获取任务。于是用户只能"先收藏回头整理"（收藏夹被临时性条目堆爆）或"记住标题回头搜"（靠记忆，必丢）。Pixiv 服务端不存在"稍后观看"端点，lynx 端也没有任何轻量暂存能力——这个缺口只能由客户端本地补齐。

## Solution

稍后看（WatchLater）：在插画详情页动作区或小说介绍页动作行一键加入，作品以快照条目（标题/封面/作者/加入时间）存入本机账号级存储，容量上限 500 条。Me 页「稍后看」入口（带计数徽标）进入列表页：零网络依赖秒开，插画与小说双类型并列，可单条删除；点击任意条目进入实时详情页看当前真实状态。纯本地能力，不写服务端、不动收藏与追更。

## User Stories

1. As a Pictelio 用户, I want 在插画详情页动作区点「稍后看」把当前插画加入稍后看, so that 有点意思的作品能随手暂存、回头再看
2. As a 用户, I want 已加入的插画再点一次同一按钮即移除（toggle，已加入态高亮）, so that 加入与移除是同一个零学习成本的动作
3. As a 用户, I want 在小说介绍页动作行点「稍后看」把当前小说加入稍后看, so that 插画与小说都能暂存
4. As a 用户, I want 已加入的小说再点一次即移除, so that 两类作品的暂存交互完全一致
5. As a 用户, I want 列表页里插画与小说并列浏览，每条带封面、标题、作者与作品类型（WorkKind）徽标, so that 我能分清哪条是插画、哪条是小说
6. As a 用户, I want 点击列表条目进入实时详情页（小说遵循 novel_intro_first 设置）, so that 看到的是作品当前的真实状态而非加入时刻的快照
7. As a 用户, I want 同一作品重复加入不产生重复条目（按 (WorkKind, id) 去重）并得到「已在稍后看」轻提示, so that 列表保持干净、既有条目位置不被重复操作打乱
8. As a 用户, I want 稍后看有 500 条容量上限，超限自动淘汰最旧条目且降级可见, so that 列表不会无限膨胀，也不会在无感知中静默丢数据
9. As a 用户, I want Me 页「稍后看」入口行带条目计数徽标, so that 不进列表就知道攒了多少
10. As a 用户, I want 在列表行上点删除按钮单条移除, so that 看完一条清一条
11. As a 用户, I want 列表为空时看到明确的空态提示, so that 知道功能存在、也知道去哪里加入第一条
12. As a 用户, I want 无网（飞行模式/弱网）时列表仍可完整浏览与删除, so that 通勤途中也能翻暂存、决定回头看什么
13. As a 用户, I want 稍后看列表零网络依赖、打开即渲染快照, so that 不用等加载、不因网络慢而白屏
14. As a 用户, I want 切换登录账号后看到的是当前账号自己的稍后看, so that 多账号之间的暂存互不污染
15. As a 用户, I want 清楚稍后看只存在本机——卸载应用或清除应用数据后列表不再保留（收藏与追更仍在服务端）, so that 对不同列表的数据存续有正确预期
16. As a 用户, I want 列表页按系统返回键回到上一页, so that 返回行为与既有二级页一致、可预测
17. As a 用户, I want 被删除/改名作品的快照条目仍留在列表中，点击后由详情页既有错误态承接, so that 暂存的"回忆"不被服务端状态清空（列表不做逐条探活）

## Implementation Decisions

**D1 store 模型（ADR-0191 D1/D2）**：新增 Pinia setup store `useWatchLaterStore`：state 为 `items` 有序数组（新条目前插，最新在前）；actions = `has(kind, id)`（判定已加入态）/ `add(snapshot)` / `remove(kind, id)` / `toggle(snapshot)`。去重键 = `(WorkKind, id)`：同 id 的插画与小说是两条；重复 `add` 幂等（不重复插入、不刷新既有条目位置）；`toggle` = 已在则 `remove`、不在则 `add`。

**D2 快照条目（ADR-0191 D1）**：存储单元 = 快照条目 `{ kind, id, title, coverUrl, userId, userName, addedAt }`，从详情页已有数据直接构造（illust/novel 对象现成字段），不新增网络请求。列表展示用快照，点击进实时详情页（取舍已接受：快照可能陈旧，列表不预校验）。

**D3 持久化（ADR-0191 D4，沿 ADR-0103 账号级键契约）**：读写经既有 PrefsStorage seam；账号级键 `watch_later_${uid}`，值为快照条目 JSON 字符串数组。底层通道沿既有分流零新增（原生 → PictelioPrefs/SharedPreferences，web-core dev → idbKV）。

**D4 容量上限（ADR-0191 D3）**：容量上限 = 500 条（模块常量）；`add` 后超限从尾部弹出最旧条目直至满足，并输出模块前缀 `console.warn`（禁静默降级，对齐测试硬约束 #3）。

**D5 加载时机与账号切换**：认证就绪后一次性 hydrate（跟随现有 settings 加载点）；登录/登出切换 uid 时重载对应账号键的数据。解析失败（损坏/非法 JSON）→ 模块前缀 `console.warn` + 空列表兜底（`parseMuteTagsRaw` 先例）；**所有失败路径显式 warn，禁静默降级**。

**D6 入口（ADR-0191 D5）**：两处入口，均 toggle、已加入态高亮（沿用收藏按钮激活态范式）：① 插画详情页动作区「稍后看」toggle；② 小说介绍页动作行由四动作增至第五动作「稍后看」toggle（衔接 ADR-0167/0189 的动作行降级矩阵；极窄屏溢出风险记入 Further Notes）。重复加入给「已在稍后看」轻提示（不报错、不刷新列表位置）。

**D7 列表页（ADR-0191 D5 / ADR-0194）**：路由 `/later`（`meta.requiresAuth: true`；requiresAuth 先例 = 追更（Watchlist）列表页，仅引用先例，命名红线见 D10）；页面组件 `WatchLater.vue`；本地全量渲染（无分页、无 FeedListFooter）；复用 PageTopBar（返回变体）+ EmptyState（空态）；每行 = 快照卡（封面 + 标题 + 作者 + WorkKind 徽标）+ 删除按钮；点击进实时详情，复用既有 openIllust/openNovel 导航 seam，小说遵循 novel_intro_first 设置。快照卡不渲染 RestrictOverlay（快照无完整作品数据、无法可靠判定受限态，用户主动加入即知情）。

**D8 Me 页入口（ADR-0191 D5）**：Me 页功能入口卡区新增「稍后看」入口行（带条目计数徽标），跟随既有 Watchlist 入口行模式；计数数据源同 store。

**D9 i18n**：键前缀 `later.*`，zh-CN（源语言）与 en 双字典全量键；过 noDeadKeys 与 hardcode-gate 门禁；UI 文案统一「稍后看」。

**D10 术语红线（ADR-0191 D6）**：全链路 WatchLater / later 命名——store 与工具 `watchLater*`、路由 `/later`、组件 `WatchLater.vue`、i18n 前缀 `later.*`、持久化键 `watch_later_${uid}`；WatchLater 相关代码禁与既有 Watchlist（追更）/`watchlist` 键混用，反之亦然；追更链路零改动。

## Testing Decisions

- **seam 说明**：三类既有 seam——store 行为层（Pinia `setActivePinia` + fake-indexeddb，先例 = 既有 searchHistoryStore 测试）、页面/入口 template 快照测试（先例 = `*.template.test.ts` 族）、路由注册守卫测试。**只断言外部行为**（store 输入输出、渲染文案/状态、导航目标），不测内部调用编排；mock 数据形状取自真实 API 类型字段（illust/novel 现成字段），禁手写自洽字段（测试硬约束 #2）。

- **用例矩阵**：

| 模块 | 用例 |
| --- | --- |
| store 行为 | `add` 新条目前插；重复 `add` 幂等（不重复插入、不移位）；`remove(kind, id)` 精确移除；`toggle` 未在→加入 / 已在→移除；去重键含 kind——同 id 插画与小说互不干扰 |
| store 容量上限 | 插入至 501 条 → 尾部淘汰最旧、总数回到 500，且模块前缀 `console.warn` 被调用（降级可见） |
| store 持久化（IO 边界，硬约束 #1） | 写入键 `watch_later_${uid}`、值为 JSON 字符串数组（成功路径）；读取回放与写入一致；JSON 损坏/非法 → 空列表兜底 + `console.warn`（禁静默降级）；uid 切换 → 重载对应账号数据且旧账号数据不串 |
| 路由守卫 | `/later` 注册存在，`meta.requiresAuth` 生效（未认证不可入） |
| 模板——插画入口 | toggle 已加入态高亮 / 未加入态还原；点击触发加入/移除 |
| 模板——小说入口 | 动作行第五动作存在且 toggle 生效 |
| 模板——列表页 | 空态渲染 EmptyState；条目行渲染封面/标题/作者/WorkKind 徽标；删除按钮移除对应行；点击条目导航至实时详情（小说按 novel_intro_first） |
| 模板——Me 入口 | 入口行存在，计数徽标数值与 store 条数一致 |

## Out of Scope

- 服务端同步（端点不存在，纯客户端能力，ADR-0191 背景）
- WebDAV 备份纳入（是否纳入备份域挂账后续评估）
- 批量操作（批量删除/清空——500 条内单删足够，挂账）
- 排序切换（固定新在前）
- webview 客户端实现（双端差异化是现状常态，独立立项）
- 稍后看内搜索/过滤
- 快照自动刷新（陈旧快照不预校验，被删作品由详情页既有错误态承接）

## Further Notes

- **seam 决策声明**：本 spec 产出会话为无人值守，seam 选择沿用仓库最高可用 seam 惯例——store 行为 / 纯函数（去重、淘汰）/ template 快照 / 路由守卫四类既有 seam，零新增 seam 类型，供用户事后审阅。
- **极窄屏动作行溢出风险**：小说介绍页动作行由四动作增至第五动作，ADR-0189 已挂账的极窄屏（< 320px）降级矩阵需在实现票同步扩容；溢出时按该降级矩阵既有预案收纳，实现须带极窄屏验证。
- **快照陈旧取舍（已接受）**：列表只承担"唤起回忆 + 决策是否点开"，不做逐条探活（省 N 次请求）；被删/改名作品点击后由详情页既有错误态承接。
- **双锚**：架构决策 = ADR-0191（D1–D6 与上文 Implementation Decisions 逐条对应）；领域语言 = Lynx 四功能统一术语表（稍后看（WatchLater）/追更（Watchlist）/收藏（Bookmark）/快照条目/作品类型（WorkKind）/容量上限，全链路拼写以术语表为准）。
