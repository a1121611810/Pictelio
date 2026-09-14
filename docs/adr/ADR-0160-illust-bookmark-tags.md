# ADR-0160: 插画收藏加标签——双轨收藏 + 收藏面板（覆盖式编辑）

- 状态：accepted
- 日期：2026-09
- 关联：统一术语 `docs/adr/glossary-bookmark-tags.md`、spec `docs/specs/bookmark-tags.md`、调研 `docs/research/bookmark-tags-similar-clients.md`（六实现差分）与 `docs/research/bookmark-tags-ux-patterns.md`（10 产品 UX 模式）、ADR-0112（lynx 收藏乐观状态机）、ADR-0114（lynx 收藏 UI）、ADR-0075（首页 C shell）、ADR-0123（lynx hit-testing 平台约束）

## 背景

用户诉求：为双端（`packages/app` webview + `packages/app-lynx`）增加「收藏加标签」能力，参考同类（Pixiv 三方客户端）与非同类 app 的做法，选择最适合本项目双端的方式。

现状缺口：两端 `addBookmark` 均只传 `illust_id`（webview `packages/app/src/api/illust.ts:336` 带 restrict；lynx `packages/app-lynx/src/api/illust.ts:75` **连 restrict 都未传**，恒公开）；收藏面板、标签库、书签详情三类端点零接入。webview 详情页心形已是双轨雏形（单击 = 公开快速收藏，长按 500ms = 私密直存）；lynx 只有单击。

调研结论（两份报告，证据见原文）：

- **API 契约（六实现差分一致）**：`POST /v2/illust/bookmark/add` 的 tags 为**多个标签空格 join 成单值、单字段 `tags[]`** 发送（pixivpy / Pixez / Pixeval+Mako / pixivgo 一致；pixivswift 用裸 `tags` 服务端等价），无一家用重复键数组；编辑已收藏 = **重发 add 覆盖**（无 edit 端点，不先 delete）；预填源 `GET /v2/illust/bookmark/detail`（`is_bookmarked`/`restrict`/`tags[].is_registered`）；标签库 `GET /v1/user/bookmark-tags/illust`（分页、公开/私密分库）；每作品上限 10 标签（官方双源）。
- **UX 形态（官方 App 与 Pixez 收敛 + 非同类模式佐证）**：单击心形保持快速收藏（零决策），**长按心形唤出收藏面板**（可见性 + 标签 + 新建 + 保存）——对应 UX 调研模式 P1（快存 + 延迟决策）与 P2（长按 = 慢速保存）的组合；Pinterest/Raindrop 式「保存即弹面板」（P3）对高频浏览型产品摩擦过高，被调研否决为主路径。

## 决策

**D1. 线上格式采用空格分隔序列化**：tags 以空格 join 成单值写入单个 `tags[]` 表单字段。这是六实现差分收敛的线上事实标准；双端既有 `post(path, Record<string,string>)` 通道（webview web fetch / webview native query-string / lynx web fetch / lynx native body）**零桥接改动**即可承载。否决重复键 `tags=a&tags=b`：需要动 4 条请求通道 + Java 桥，无任何同类实现使用。

**D2. 编辑已收藏采用覆盖式重发 add**：携带完整标签集 + 可见性直接 `bookmark/add` 覆盖，**不先 delete**。服务端无 edit 端点，先 delete 会让收藏状态在两次请求间闪断（乐观 UI 与服务端真值脱节），六实现均不这么做。

**D3. 交互采用双轨收藏**：单击心形 = 快速收藏（现状不变，动效资产保留）；长按心形 = 收藏面板。入口面收敛在**详情页**（双端一致）；列表卡片**不加入口**——卡片场景滚动密度优先，面板语义属于「已决定要收藏这件作品」的详情上下文。列表卡片上的既有手势（单击快速收藏、长按私密直存）**保持原状、本次不改**：本 ADR 只改详情页长按语义（D4），卡片侧变更留给后续独立的交互决策（其当前行为属既有产品决策，不在本 effort 范围内）。

**D4. webview 长按行为有意变更**：详情页长按从「私密直存」升级为「收藏面板」（私密性在面板内切换，且可预填恢复）。长按直达私密的旧语义被面板完全覆盖（面板内一个开关），与官方 App 形态一致；此为行为变更点，测试与文档显式固定。

**D5. 面板数据源三角**：预填（`bookmark/detail`）+ 标签库（历史标签候选）+ 作品标签（建议）；三者勾选后统一为收藏标签集合，另支持内联新建；上限 10 个，UI 强制。标签库按当前可见性分库展示。

**D6. lynx 端补齐 restrict**：`addBookmark` 增加 restrict 参数（现状硬编码公开），快速收藏仍恒公开，可见性选择仅在收藏面板内。

**D7. 范围裁剪：仅插画**。小说收藏加标签不在本期（小说收藏入口在列表卡片、无详情页心形上下文，且各端小说收藏 UI 独立演进）；作为后续候选拆票挂账，不在本 effort 验收内。

**D8. 每端用各自的底部面板形态**：webview 遵循 Fluent 2（token 化 bottom sheet）；lynx 遵循 M3 语义色 + lynx 平台约束（全屏层 v-if 规则、(0,0) 锚点 + vw 定位）。两端语义对齐（术语表为契约），视觉各从其设计系统——与 ADR-0158 D2 的双端不强行统一立场一致。

## 备选与否决理由

- **保存即弹面板（P3，Pinterest 式）**：把归类变成收藏必经步骤，对高频 feed 场景摩擦过高；官方 App 也不这么做。
- **快速收藏后 Toast 带「+标签」入口（P1 变体）**：可行，但 webview 列表卡无 toast 基建，且长按面板已覆盖「补标签」诉求；作为后续增强候选，不进本期验收。
- **delete + re-add 式编辑**：两次请求窗口内收藏状态闪断，且六实现差分全为直接覆盖。
- **重复键数组序列化 + 桥接扩展**：4 条请求通道 + Java `jsObjectToQuery` 改动，收益为零（服务端等价），风险面无谓扩大。
- **列表卡片长按也开面板**：卡片心形触发区小、长按与卡片自身手势/滚动冲突面大；详情页是天然的编辑场所。
- **两端统一同一套面板组件**：双端无共享渲染层（webview SolidJS / lynx vue-lynx），强行统一需引入抽象层，违背两端各自设计语言的既定立场。

## 后果

- **webview 长按语义变更**（私密直存 → 面板）需在 E2E 与既有测试中显式对齐；依赖「长按 = 私密」的既有行为断言将按新语义改写。
- **lynx 长按是全新手势面**：lynx 视图长按需以 touchstart/touchend 计时实现（与 webview 500ms 口径一致）；须在真机验证 hit-testing 约束下的可触发性（ADR-0123 家族风险）。
- **空格分隔序列化继承生态位限制**：含空格的标签会被服务端切分——所有同类客户端共同的平台行为；面板新建标签输入以「空格提交当前 token」承接（与官方输入习惯一致），并在规格中记为已知行为。
- **标签库分页**（`offset` 翻页）本期仅取首页 + 滚动加载可选；超大标签库用户的首屏候选可能不全，属可接受的展示层裁剪（编辑与新建不受影响）。
- **覆盖式编辑依赖乐观 UI 与服务端最终一致**：覆盖失败时回滚到预填态并暴露错误（测试硬约束 #3，禁止静默降级）。
