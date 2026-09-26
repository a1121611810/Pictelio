# ADR-0191：app-lynx 稍后看（WatchLater——本地暂存作品列表）

- 状态：Accepted（已采纳）
- 日期：2026-09-27
- 关联：`docs/adr/glossary-lynx-four-features.md`（术语表——WatchLater/Watchlist/Bookmark 术语红线）、`docs/specs/lynx-watch-later.md`（规格，随 /to-spec 产出）、ADR-0103（账号级跨引擎键契约与 PrefsStorage seam）、ADR-0172（PrimJS Web API 面约束——无 IndexedDB）、ADR-0175（原生文件系统通道——量级参照）、ADR-0160（收藏双轨——语义边界）、ADR-0189（NovelIntro 底部动作行——入口落点）、ADR-0194（公共组件层——列表页组件复用）

## 背景

Pictelio 缺一个"这里有点意思，回头再看"的轻量暂存能力。现状三条路都不通：

1. **服务端无对应物**：Pixiv 官方帮助中心没有"稍后观看/后で見る"服务端功能，App API 无对应端点族；第三方客户端同样缺失——Pixez 未实现该能力；存在先例 tomacheese/my-pixiv 用**本地快照**实现同类需求（本地存作品元数据，无服务端），证明本地快照是该约束下的成熟形态。
2. **既有三条收藏路径语义均不符**：收藏（Bookmark，ADR-0160 双轨 public/private）是服务端资产、带收藏标签体系，拿它当稍后看会污染收藏语义；追更（Watchlist）是小说系列的服务端订阅；下载队列是文件获取任务。三者都不是"看一眼随时清"的暂存。
3. **lynx 端基础设施就绪**：Me 页功能入口卡区已有 bookmarks / watchlist / downloads / networkCheck / 通知（ADR-0188）五行先例；`settingsStore` 的 PrefsStorage seam（ADR-0103 决策 3：native = `PictelioPrefs` → SharedPreferences "CapacitorStorage"，web-core dev = idbKV）可直接承载账号级键；`parseMuteTagsRaw`（ADR-0187）已确立"JSON 解析失败 → console.warn + 空值"的宽容解析先例。

## 调研结论

1. 端点不存在是硬约束 → 唯一路径是本地实现；本地快照有第三方先例（my-pixiv），无自建同步服务的必要性（稍后看无跨设备实时价值，备份可走既有 WebDAV 域评估）。
2. 存储介质三选一：PictelioPrefs（原生）/ idbKV（仅 web-core）/ Java 文件系统通道（ADR-0175，为翻译缓存 10MB 级设计）。稍后看是低频小体积键值（≤500 条 JSON），PrefsStorage seam 是量级与契约双适配的唯一解。
3. 列表数据模型必须是**快照**而非 id 引用列表：id-only 需要每次进列表批量拉详情（网络依赖 + 慢 + 被删作品直接消失，丢"稍后看"的暂存语义）；全量详情快照又过大。**最小快照字段集**（标题/封面/作者/时间）即可支撑列表决策，详情交给实时页。
4. 入口挂点：插画侧 `IllustDetail` 动作区、小说侧 `NovelIntro` 动作区（ADR-0189 Row 1 四次级动作行）是两条作品类型的天然决策点；列表页与 Me 入口对齐 Watchlist/通知的既有信息架构。

## 决策

**D1 本地快照条目模型——加入不拉详情，列表用快照，详情走实时页。**
存储单元 = 快照条目 `{ kind, id, title, coverUrl, userId, userName, addedAt }`（字段见术语表）。加入时从**当前页面已有数据**直接构造（列表卡片/详情页都持有这些字段），**不重复发起详情请求**。列表页（`WatchLater.vue`）渲染快照（封面 + 标题 + 作者 + 加入时间 + 删除）；点击进入**实时详情页**（`/illusts/:id` / `/novel/:id`）。**取舍（已接受）**：快照可能陈旧（作品改名/换封面/被删）——列表只承担"唤起回忆 + 决策是否点开"，陈旧可接受；被删作品点击后由详情页既有错误态承接，列表不做预校验（省 N 次探活请求）。

**D2 去重与排序——`(WorkKind, id)` 去重，新条目前插。**
去重键 = `(WorkKind, id)`：同 id 插画与小说是两条（现实中同 id 跨类型不冲突，键仍带 kind 保证稳健）。重复添加 → 轻提示「已在稍后看」（不报错、不刷新位置）。新条目**前插**（最新在前），`addedAt` 记录加入时刻。

**D3 容量上限 500——超出丢最旧 + 模块前缀 console.warn（禁静默降级）。**
上限常量 500；插入后超限则从尾部（最旧）弹出直至满足，并 `console.warn('[watchLater] 容量已满，丢弃最旧条目 …')`。对齐测试硬约束 #3：降级必须可见，不做静默截断。500 的量级依据：以"日加 10 条、月清一次"的高频使用画像，500 条 ≈ 一个半月缓冲，远超正常使用，又把 JSON 体积压在几十 KB 级。

**D4 持久化——账号级键 `watch_later_${uid}`，复用 PrefsStorage seam，值为 JSON 字符串数组。**
键名 `watch_later_${uid}`（ADR-0103 账号级模式：双端逐字同键的契约预留，值语义 = 快照条目 JSON 数组字符串）。读写经 `settingsStore` 的 PrefsStorage seam：原生 `PictelioPrefs` → SharedPreferences "CapacitorStorage"；web-core dev → idbKV（`prefs()` 按 `isNativeMode()` 分流，零新通道）。解析失败（损坏/非法 JSON）→ 模块前缀 `console.warn` + 空列表兜底（`parseMuteTagsRaw` 先例，禁静默降级）。
否决 **idbKV-only**：原生 PrimJS 无 IndexedDB（ADR-0172），原生侧会直接失效；否决 **Java 文件系统通道**（ADR-0175 形态）：那是为翻译缓存 10MB 级、需淘汰/并发/失效六边界的设计，本场景量级过重且引入跨进程时序复杂度；否决 **"私人书签当稍后看"**：收藏是服务端可见性资产（ADR-0160 双轨 public/private）+ 带标签体系，把"临时"语义塞进"收藏"污染两端语义，且稍后看的插画+小说双类型与插画收藏端点族不重合。

**D5 入口与列表页——双动作区 toggle + `/later` 列表页 + Me 计数入口。**
入口（两处，均 toggle、已加入态高亮，沿用收藏按钮激活态范式）：插画详情页动作区一个「稍后看」toggle；小说介绍页动作区（ADR-0189 Row 1）一个「稍后看」toggle。列表页：路由 `/later`（`meta.requiresAuth: true`，先例 `/watchlist`），组件 `WatchLater.vue`，复用公共组件（ADR-0194：PageTopBar 返回变体 + EmptyState 空态；列表全量本地渲染、无分页，无列表尾）；列表项可删除（单条删除，不做批量——500 条内的清理场景单删足够，批量挂账）。Me 页功能入口卡区新增「稍后看」行（带条目计数，数据源同 store）。**快照卡不渲染 RestrictOverlay**：快照无 tags/页数等完整作品数据、无法可靠判定 R-18/AI 受限态，且用户主动加入即已知情；点开详情后的受限处置交由详情页既有链路。

**D6 术语红线——全链路强制 WatchLater 命名，与 Watchlist 物理隔离。**
route `/later`、组件 `WatchLater.vue`、i18n key 前缀 `later.*`、store/工具命名 `watchLater*`、持久化键 `watch_later_${uid}`。任何 WatchLater 相关代码**不得**出现 `watchlist` 词根，反之亦然（追更链路零改动）。UI 文案统一「稍后看」，规避别称见术语表。

## 备选与否决理由（汇总）

| 备选 | 否决理由 |
| --- | --- |
| 对接服务端"稍后观看" | 端点不存在（官方帮助中心 + App API 双确认）；自建同步服务超出客户端范围 |
| idbKV-only 存储 | 原生 PrimJS 无 IndexedDB（ADR-0172），原生侧失效 |
| Java 文件系统通道 | ADR-0175 形态为 10MB 级缓存设计，量级过重、复杂度不成比例 |
| 私人书签当稍后看 | 污染收藏语义（服务端可见性资产 vs 本地临时暂存）；类型覆盖面也不符 |
| id-only 列表 + 批量拉详情 | 列表打开强依赖网络且慢；被删作品从列表消失违背暂存预期 |
| 全量详情快照 | 体积失控；列表决策只需最小字段集 |
| 超限整体拒绝写入 | 用户在不知情时添加无效；丢最旧 + warn 保留列表可用性且降级可见 |
| 快照卡渲染 RestrictOverlay | 无完整数据不可靠判定；用户主动加入即知情 |
| 批量删除 | 500 条内单删足够；范围收敛，挂账后续 |

## 后果

- 正面：lynx 补齐"轻量暂存"能力空白且 Java 零改动；快照模型让列表零网络依赖、秒开（对齐「先渲染后加载」硬约束）；`watch_later_${uid}` 沿 ADR-0103 契约预留跨引擎键位；术语红线以命名隔离固化，杜绝 Watchlist/WatchLater 混淆回潮。
- 取舍（已接受）：快照陈旧不校验（被删作品由详情页错误态承接）；本机存储不跨设备实时同步（WebDAV 备份域是否纳入挂账 spec）；超限丢最旧不可恢复（有 warn 可见）；稍后看不参与任何服务端互动（无已读/无同步标记）；小说介绍页 Row 1 由四动作增至五动作（ADR-0189 已挂账的极窄屏 `< 320px` 降级矩阵需在 spec 同步扩容）。
- 中性：Me 页入口卡区增至七行（bookmarks / watchlist / 稍后看 / downloads / networkCheck / 通知 / 好P友——ADR-0193），信息架构密度可接受。
- 后续候选（不在本期）：批量删除/清空、稍后看内搜索过滤、WebDAV 备份域纳入评估、快照字段扩展（页数/标签预览）、webview 端对等实现（双端差异化是现状常态，独立立项）。
