# Lynx 小说介绍页开关（intro-first toggle）— 术语表

> 范围：`pictelio-app-lynx`（Lynx 客户端）小说点击导航行为与设置开关。配套：[ADR-0183-lynx-novel-intro-toggle.md](./ADR-0183-lynx-novel-intro-toggle.md)、[spec lynx-novel-intro-toggle](../specs/lynx-novel-intro-toggle.md)、前置 [ADR-0167-lynx-novel-intro-three-segment.md](./ADR-0167-lynx-novel-intro-three-segment.md)。

## 核心术语

| 术语 | 定义 |
|------|------|
| **小说介绍页（Novel Intro Page）** | Lynx 端路由 `/novel/:id/intro`（`NovelIntro.vue`，路由名 `novel-intro`）。ADR-0167 引入的**预读决策面**：全屏封面 + 标题/作者/标签/简介/统计 + 「开始阅读」CTA + 收藏入口。数据复用 `/v2/novel/detail` 端点，零新增 API。 |
| **小说正文页（Novel Detail Page）** | Lynx 端路由 `/novel/:id`（`NovelDetail.vue`）。阅读器本体：虚拟化正文、选中菜单、翻译、导出、评论。**用户口头语「详情页」与本术语同指**；文档统一用「正文页」，代码符号保持 `NovelDetail` 不改名。 |
| **三段式导航（Three-segment navigation）** | 小说入口 → 介绍页 → 正文页的两跳流转（ADR-0167）。UI 约束而非路由约束：`/novel/:id` 始终直达可达（benchNav 测试通道与深链依赖）。 |
| **两段式导航（Two-segment navigation）** | 小说入口 → 正文页的一跳流转。webview 客户端现状；Lynx 端在介绍页开关**关闭**后达到同样行为。 |
| **介绍页先行（Intro-first）** | 介绍页开关**开启**（默认值）时 Lynx 的小说导航行为：点击小说先进介绍页。 |
| **直达正文（Direct-to-body）** | 介绍页开关**关闭**时 Lynx 的小说导航行为：点击小说跳过介绍页直接进正文页。介绍页路由保留、页面功能不删，仅入口改道。 |
| **小说介绍页开关（Intro-first toggle）** | 设置页（`Me.vue`「内容」组）的设备级布尔开关，键 `novel_intro_first`，**默认开**（= 介绍页先行）。控制的是导航行为，不是介绍页的存在性。 |
| **小说导航缝隙（Novel navigation seam，`openNovel`）** | 单点导航深模块（`src/utils/novelNavigation.ts`）：读介绍页开关 → 开=导航 `/novel/:id/intro`，关=导航 `/novel/:id`。六个小说入口的唯一小说跳转通道；`/intro` 导航串只允许出现在此模块内。 |
| **六入口（Six novel entry points）** | 票 #588 钉定的全部小说点击入口：小说列表（`NovelList.vue`）、收藏（`Bookmarks.vue`）、用户主页（`UserHome.vue`）、追更（`Watchlist.vue`）、推荐轮播（`Recommended.vue`）、全局搜索弹层（`SearchSheet.vue`）。开关对六入口**一体生效**。 |
| **设备级设置（Device-level setting）** | 与登录账号无关、随设备持久化的设置（SharedPreferences / web-core IndexedDB），键名不带 uid 后缀。对照：**账号级设置**（键含 `_${uid}`，如 `show_r18_${uid}`）。介绍页开关是设备级——导航偏好属于设备/个人习惯，非内容授权。 |

## 易混淆概念辨析

- **「开关关闭」≠「下线介绍页」**：关闭开关只改六入口的默认落点；`/novel/:id/intro` 路由、页面本身、「开始阅读」CTA 全部保留。未来深链/分享若指向介绍页仍可到达。
- **「介绍页」≠「正文页 header」**：正文页 header 只承载标题/作者/评论/导出入口（ADR-0167 已把封面/标签/简介/统计/收藏迁到介绍页）；关闭开关直达正文**不会**把这些信息带回正文页 header——那是另一个 effort 的范围。
- **「直达正文」≠「路由重定向」**：不在 `/novel/:id` 上做路由级 redirect 到 `/intro`（反向也不做）——ADR-0167 已钉死路由共存量、无重定向（benchNav 通道约束）；开关只在**调用点导航串**上分流。
- **「R-18/AI 遮罩」与开关正交**：直达正文后受限作品的遮罩/置灰行为完全由正文页既有逻辑承接（详情判定 → 不拉正文），开关不参与也不绕过任何内容分级闸门。
- **「设备级」≠「账号级」**：本开关不随 WebDAV 设置备份的账号级域走，但随设备级键清单（`BACKUP_DEVICE_KEYS`）参与跨引擎备份恢复——键不存在时按默认值（开）兜底，属显式默认而非静默降级。
