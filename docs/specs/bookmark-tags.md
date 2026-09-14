# Spec: 插画收藏加标签（双端）

> 架构决策：ADR-0160（双轨收藏 + 收藏面板 + 覆盖式编辑）；统一术语：`docs/adr/glossary-bookmark-tags.md`（**收藏标签**/**作品标签**/**标签库**/**收藏面板**/**快速收藏**/**双轨收藏**/**覆盖式编辑**/**预填**/**可见性**均以术语表为准）。
> 调研：`docs/research/bookmark-tags-similar-clients.md`（API 契约六实现差分）、`docs/research/bookmark-tags-ux-patterns.md`（UX 模式）。

## Problem Statement

用户在 Pictelio 里收藏插画只有一个零决策动作（点心形），无法在收藏时打上自己的标签，也无法事后修改一条收藏的标签与公开/私密属性——收藏夹只能靠时间线堆叠，失去 Pixiv 收藏体系最核心的组织能力。官方 App 与主流三方客户端（Pixez、Pixeval）都具备该能力；lynx 端甚至还没有私密收藏。

## Solution

双轨收藏：单击心形保持现状的快速收藏（零决策、公开、爆发动效不变）；长按详情页心形唤出**收藏面板**（底部面板：可见性切换 + 收藏标签勾选/新建 + 保存）。已收藏作品打开面板时**预填**当前标签与可见性，保存即**覆盖式编辑**。双端（webview / lynx）同语义、各按自身设计系统呈现。

## User Stories

1. As a Pictelio 用户, I want 在详情页长按心形唤出收藏面板, so that 我可以有意识地决定这条收藏的标签与可见性
2. As a 用户, I want 单击心形仍然立即快速收藏（公开、无标签、爆发动效不变）, so that 高频收藏保持零摩擦
3. As a 用户, I want 面板里把我用过的**收藏标签**（标签库）展示为可勾选 chip, so that 我能复用已有的整理体系
4. As a 用户, I want 作品自带的**作品标签**作为建议来源一键选入, so that 我不必打字就能加上有意义的标签
5. As a 用户, I want 在面板内内联新建收藏标签, so that 我能开始新的分类
6. As a 用户, I want 可见性（公开/私密）与标签在同一个面板选择, so that 一次操作完成整条收藏的决策
7. As a 用户, I want 已收藏的作品打开面板时预填当前标签与可见性, so that 我在覆盖前看到服务端真值
8. As a 用户, I want 对已收藏作品保存面板 = 覆盖式编辑（一步改标签/可见性）, so that 不需要「取消收藏再重收」
9. As a 用户, I want 面板强制 10 个标签上限并有明确反馈, so that 不会触达服务端错误才知道超限
10. As a 用户, I want 同一标签不会重复入选, so that 标签集保持干净
11. As a 用户, I want 新建标签时输入空格即提交当前 token, so that 输入习惯与服务端空格分隔语义一致
12. As a 用户, I want 保存失败时面板回到预填态并显示错误, so that 我能重试而不丢上下文（禁止静默降级）
13. As a 用户, I want 面板打开期间系统返回键/返回手势先关面板, so that 返回行为可预测（不退出页面）
14. As a 用户, I want 已选标签以可读的多行 chip 区呈现, so that 保存前能复查全部 10 个选择
15. As a lynx 用户, I want 面板内提供私密可见性, so that 补齐与 webview 的私密收藏差距（lynx 现状恒公开）
16. As a 用户, I want 标签库请求失败不阻塞面板打开与保存, so that 标签只是增强、不是收藏的门槛（降级路径显式提示）
17. As a 用户, I want 小说收藏流程完全不变, so that 既有小说体验零回归
18. As a 开发者, I want tags 序列化（空格 join 单值、`tags[]` 字段名）有契约测试且 oracle 指向 pixivpy, so that 序列化回归在单测层被拦住
19. As a Android 用户, I want 双端面板在真机上可用（长按可触发、面板可操作、保存生效）, so that 功能是真实可用而非纸面绿

## Implementation Decisions

**D1 线上格式（ADR-0160 D1）**：`POST /v2/illust/bookmark/add`，form 字段 `illust_id`、`restrict`（`public`/`private`）、tags 为**收藏标签以空格 join 的单值、字段名 `tags[]`**；空标签集不发 tags 字段。走两端既有 `apiClient.post(Record<string,string>)` 通道，桥接零改动。

**D2 覆盖式编辑（ADR-0160 D2）**：保存面板时若目标已收藏，直接重发 add（完整标签集 + 可见性）覆盖；不先 delete。

**D3 双轨入口（ADR-0160 D3/D4）**：详情页心形——单击 = 快速收藏（现状行为与动效不变；webview 长按 500ms 从私密直存**升级**为收藏面板，属有意行为变更；lynx 新增长按 500ms 收藏面板，口径与 webview 一致）。列表卡片不加入口。

**D4 API 面**：两端 illust API 模块各新增/扩展三个函数——
- `addBookmark(illustId, restrict, tags?)`（webview 已有前两参，扩展第三参；lynx 补 restrict + tags）
- `loadBookmarkDetail(illustId)` → `GET /v2/illust/bookmark/detail`（响应 `bookmark_detail` 可空；非空含 `is_bookmarked`/`restrict`/`tags[]`）
- `loadUserBookmarkTags(restrict, offset?)` → `GET /v1/user/bookmark-tags/illust`（`user_id` 取当前用户；分页 `next_url` 兼容，本期首屏 + 追加可选）

**D5 面板状态模型**：标签选择是纯函数 reducer——toggle（勾/取消）、上限 10（拒绝第 11 个并反馈）、去重（勾选态幂等）、新建提交（空格提交 token、trim、非空校验、并入已选）。webview 与 lynx **同一语义**、各自实现（无双端共享包；reducer 纯函数便于 node 单测）。

**D6 预填链路**：面板打开 → 并行发 `loadBookmarkDetail`（预填已收藏态/可见性/已有标签）与 `loadUserBookmarkTags`（标签库候选，按当前可见性分库）；detail 失败 = 面板可打开但显示错误提示且保存禁用（无真值不覆盖）；标签库失败 = 候选区显示降级提示，保存不受阻。

**D7 webview 面板**：Fluent 2 token 化底部面板（沿用既有 sheet 组件形态：isOpen/onClose props、surface token、Fluent 缓动/时长）；注册进 overlay 栈（返回键先关面板）；心形按钮复用既有长按计时通道。可见性切换为 Fluent 开关行；标签区 = 已选区（chip 可移除）+ 标签库 chips + 作品标签建议区 + 内联新建输入。

**D8 lynx 面板**：M3 语义色底部面板，遵守 lynx 平台约束——全屏层必须 v-if 条件渲染（ADR-0123 全屏层规则）、absolute 定位用 (0,0) 锚点 + vw + translate（定位锚点规则）、list-item 无关（面板挂页面层）。长按以 touchstart/touchend 计时实现（500ms 口径）。注册进 modalStack（返回键先关面板，与 SearchSheet 同机制）。

**D9 lynx `useBookmarkMutation` 扩展**：保持该模块文档化的六条不变量（乐观触发/busy 锁/静息回滚/350ms 回调/errorMsg 清空/count clamp），增加带 restrict + tags 的收藏变体；快速收藏路径签名不变。legacy `createBookmarkToggle` 不动。

**D10 i18n**：双端 zh-CN（源语言）+ en 全量键（`bookmarkPanel.*` 前缀），键面与语义对齐。

**D11 已知行为**：含空格的收藏标签会被服务端切分（六实现共同的生态位限制，ADR-0160 后果节）；新建输入以「空格提交 token」承接，不另做服务端纠错。

## Testing Decisions

- **只测外部行为**：序列化结果（请求体/参数字面量）、reducer 输入输出、面板可观测行为（渲染文案/交互回调/错误提示），不测内部调用编排。
- **Wire 契约测试（oracle 溯源：pixivpy3 aapi.py `illust_bookmark_add`——空格 join、`tags[]` 字段名；六实现差分报告为第二来源）**：两端 API 模块 addBookmark 的 tags 序列化断言（0/1/多标签、含空格标签的透传语义）；既有先例 `tests/unit/api/illust.test.ts`（webview）与 lynx api 契约测试。
- **IO 边界（硬约束 #1）**：addBookmark / loadBookmarkDetail / loadUserBookmarkTags 三函数的成功与失败路径单测（HTTP 非 2xx、响应缺字段）。
- **Reducer 纯函数测试**：toggle/上限/去重/新建提交/空格 token，全部 node 单测。
- **组件测试**：webview 面板用 @solidjs/testing-library（先例：tests/unit/components/ 系）；lynx 用 composable 单测 + template 测试（先例：useBookmarkMutation.test.ts、*.template.test.ts）。
- **E2E**：agent-browser（webview）——mockFetch 构造 bookmark/detail 与标签库响应，走「详情页 → 长按心形 → 面板 → 勾标签 → 保存」并断言 add 请求载荷；Android 模拟器真机验收双端各一条端到端路径（登录取自契约种入/eval token 注入既有方法）。

## Out of Scope

- 小说收藏加标签（ADR-0160 D7，后续候选拆票）
- 列表卡片上的面板入口；快速收藏后的 Toast 补标签入口（P1 变体，后续增强）
- 收藏列表页按标签筛选/管理（重命名、删除标签库条目）
- 批量补标（UX 调研 P5）
- iOS / Web 发行形态差异

## Further Notes

- webview「长按 = 私密直存」为既有行为，本 spec 将其改写；依赖该语义的既有测试/E2E 必须随 D3 同步对齐，不允许双语义并存。
- lynx 长按为全新手势面，真机 hit-testing 风险（ADR-0123 家族）在验收票中以模拟器实测关闭。
- 标签库分页本期首屏即可验收；滚动追加为可选增强，不阻塞验收。

## 实施中发现的前置缺陷（已在本次一并修复，ADR-0161）

Android 真机验收暴露：**webview 原生构建下所有写操作（含本功能的收藏保存）失败**。根因是
`request()` 对 POST 把载荷放进插件 `params`（→ query string）且 body 为空，Pixiv 以 400/404
拒绝；web 分支与 app-lynx 原生分支本就是表单体，唯 webview 原生分支不一致（且此前无任何原生
写路径自动化覆盖，故长期未被发现）。已在 `packages/app/src/api/client.ts` 修正为
`application/x-www-form-urlencoded` 表单体，并补契约测试（oracle = host 侧直连实测 + 双端分支
一致性）。详见 **ADR-0161**。

对验收口径的影响：本 spec 的 T7（#536）必须以**服务端真值**为准（host 侧直连 Pixiv 读
`bookmark/detail`），不得只看 UI 绿；读路径全绿不能证明写路径可用。
