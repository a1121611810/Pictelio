# ADR-0183: Lynx 小说介绍页开关——介绍页先行可关、直达正文

- 状态: Accepted（2026-09-24）
- 日期: 2026-09-24
- 关联: 术语表 [glossary-lynx-novel-intro-toggle.md](./glossary-lynx-novel-intro-toggle.md)；spec [docs/specs/lynx-novel-intro-toggle.md](../specs/lynx-novel-intro-toggle.md)；前置 ADR-0167（三段式导航）、ADR-0139（Pinia 设置 store）、ADR-0179（`<M3Switch>` 组件）

## 背景

ADR-0167 给 Lynx 端全部六个小说入口（小说列表 / 收藏 / 用户主页 / 追更 / 推荐轮播 / 搜索弹层）加了三段式导航：点击小说先进介绍页 `/novel/:id/intro`，再经「开始阅读」进正文页 `/novel/:id`。介绍页作为预读决策面（封面/标签/简介/统计/收藏）价值成立，但用户反馈（2026-09-24）：**高频阅读场景下两跳是多余摩擦**，希望提供设置项——默认保持介绍页先行，关闭后点击小说直接进正文页。

现状事实（CodeGraph 取证）：

1. 六入口的介绍页导航串是**各自内联**的 `navigate(\`/novel/${id}/intro\`)`（追更为 `latest_content_id`、推荐为模板插值三元、搜索为实体类型三元），由源级守卫测试 `novelIntroEntryGuards.test.ts` 逐入口钉住，且**负向断言禁止任何直达正文的裸导航**——本次改道的正交前提：守卫测试必须随决策同步重写，否则新行为全红。
2. 设置基础设施齐备：`settingsStore`（Pinia setup store）已有设备级布尔开关范式（`related_injection` / `ranking_entry`，`prefs()` 持久化 + `[settingsStore]` 前缀 warn）；`Me.vue`「内容」组已有 M3Switch 开关行范式（行级 `@tap` + a11y 注册表）；`<M3Switch>` 组件（ADR-0179）是开关单点真理源。
3. 路由层约束（ADR-0167 钉死）：`/novel/:id` 与 `/novel/:id/intro` 共存、**禁止路由级 redirect**——benchNav 测试通道与未来深链依赖正文页直达可达。

## 决策

### D1：设备级布尔设置 `novel_intro_first`，默认开

- 键 `novel_intro_first`（设备级、不带 uid：导航偏好属设备/个人习惯，非账号内容授权），默认 `true` = 介绍页先行（保持 ADR-0167 现状为缺省行为，升级零感知）。
- 归属 `settingsStore`（Pinia），逐字沿用 `relatedInjection` / `rankingEntry` 范式：私有 ref + getter + `setNovelIntroFirst()`（持久化失败 `console.warn("[settingsStore] …")`，禁静默降级）。
- 纳入 `BACKUP_DEVICE_KEYS`（设备级设置跨引擎备份恢复域），与同组设备开关一致。

### D2：单点导航缝隙 `openNovel()`，六入口一体生效

新建 `src/utils/novelNavigation.ts` 导出 `openNovel(id: number | string): void`：读介绍页开关——开 → `navigate(\`/novel/${id}/intro\`)`；关 → `navigate(\`/novel/${id}\`)`。六入口的小说分支**全部**改走 `openNovel`，`/intro` 导航串从此只允许存在于该模块。

开关作用于**全部六入口**而非仅小说列表页：导航行为是单一人格化偏好，「有的入口两跳、有的入口一跳」的不一致对用户的惊扰大于任何单入口收益；且单点缝隙让行为天然一致、测试面集中（一处单测双态 + 一处守卫测试钉六入口接线）。

### D3：路由层零改动

不加重定向、不加路由元数据、不动 `router.ts`。介绍页在开关关闭后仍可直接到达（深链/未来入口），正文页直达可达性不变（ADR-0167 约束原样成立）。

### D4：设置 UI 落点 = `Me.vue`「内容」组新增一行

标题「小说先进介绍页」（i18n `me.content.novelIntroFirst`，zh-CN/en 双语），行级 `@tap` 翻转 + `<M3Switch :checked>`，逐字照 `relatedInjection` 行范式（含 a11y 注册表 key）。webview 端不出现此设置（无介绍页概念）。

### D5：webview 客户端不在范围

webview 从无介绍页（ADR-0167 明确 out of scope，保持两段式），本开关是 Lynx 端专属设置；键不与 webview 共享契约（无跨引擎同步语义）。

## 否决的替代方案

- **仅改小说列表入口**（用户字面口径的窄解释）：六个入口行为分裂——从收藏/搜索进的小说两跳、从列表进的一跳，偏好无法预期；否决，全入口一体生效（D2）。
- **路由级 redirect**（关=`/intro` → `/novel/:id`）：直接违反 ADR-0167「无路由级重定向」钉死约束，破坏介绍页深链可达与守卫测试既有「共存量」断言；否决。
- **六处内联三元**（各入口自读开关）：同一分支逻辑复制六份，漂移风险与守卫测试复杂度双升；单点缝隙是深模块的正解；否决。
- **账号级设置**（键带 uid）：内容授权类设置才需要账号隔离（R18/AI 先例），导航流畅度偏好跨账号无意义；否决。
- **介绍页内加「不再显示」快捷入口**：把导航偏好埋进被导航离开的页面，设置发现性差且与「默认开」的产品语义纠缠；保持设置页单点配置，否决。

## 后果

### 正面

- 高频读者一键回到一跳直达，摩擦消除；默认开保证存量用户行为零变化。
- 导航行为收敛为单点缝隙：双态行为一处单测，六入口接线一处守卫测试钉住（替换原「禁止直达」负断言为「缝隙调用 + `/intro` 串仅存在于缝隙」断言）。
- 设置基础设施零新增范式——键/持久化/UI/a11y/i18n 全部照既有设备级开关先例。

### 代价 / 风险

- 源级守卫测试 `novelIntroEntryGuards.test.ts` 需重写（原负向断言与直达正文行为互斥）——随本 ADR 同步改，测试断言的 oracle 从「ADR-0167 三段式」换为「ADR-0183 双态」。
- 直达正文后，介绍页承载的收藏入口对关闭用户不可达（正文页 header 已有收藏/评论入口，能力不缺失；仅封面/标签/简介预览面后置）。
- 新增 1 个设置键参与设备级备份域（`BACKUP_DEVICE_KEYS`），webdav 一致性测试如有键清单断言需同步。

### 排除面

- 正文页 header 信息架构调整（把介绍页元素带进正文页）：独立 effort，不在本开关范围。
- 追更章节的「继续阅读/进度恢复」语义：介绍页 CTA 固定从头读（票 #579 既有拍板），开关不改变。
- iOS / webview 端任何改动。
