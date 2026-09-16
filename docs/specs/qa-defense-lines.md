# Spec: QA 防线三网（转换矩阵 / 宿主矩阵 / 平台一致性自检）

- 状态：approved for implementation（2026-09-16，ADR-0163 拍板）
- 关联：ADR-0162/0112/0107（lynx list 结构变更三态）；`docs/research/industry-qa-practices-runtime-interaction-defects.md`；#374（存在性判定口径，本 spec 修订为内容断言）
- 分发事实：**不经 Play**（GitHub Releases APK + webview OTA）；android-e2e 不进每-PR CI（#539），本 spec 全部 e2e 产物定位为**发版前必跑 + 大 PR 手动触发**

## 0. 术语

| 术语 | 定义 |
|------|------|
| **转换矩阵（transition matrix）** | 「列表面 × 用户动作 × 引擎 × 内容断言」参数化矩阵；android-e2e spec 形态；发版前必跑 |
| **内容断言（content assertion）** | 对渲染内容的对比判定（首行类型/元素存在+数值对比/段存在性），**存在性判定的升级版**（#374 口径修订） |
| **宿主矩阵（host matrix）** | 可复用组件在 ≥2 种宿主形态（列表宿主 / 复用·轮播宿主）下的行为测试 |
| **init-only props** | 只在组件 setup 时被读一次、此后变更不生效的 props（如 `initialBookmarked`/`initialCount`/`initialCount` 类） |
| **平台一致性自检页（platform conformance self-check page）** | Lynx 端 debug 自检路由：对项目依赖的平台 API 面跑规范派生断言，渲染 PASS/FAIL 矩阵 |
| **`safeParseURL`** | 平台 API 收口函数：hostname 字符串解析（禁 URL 全局），全仓唯一 URL 域名解析入口 |

## 1. 目标

让 2026-09-15/16 的四类缺陷（A 平台运行时不兼容 / B list patch 丢弃 / C props 冻结 / D 状态转换）在「合并前或发版前」被机器拦住，而非用户真机发现。

## 2. 非目标

- 不引入 Pact / Storybook / Play 生态任何工具
- 不改变 android-e2e「不进每-PR CI」的既有裁决（#539）
- 不做 Sentry/错误监控接入（需账号 + lynx 捕获行为探针，单独立项）
- 不做 webview OTA 之外的 lynx bundle OTA

## 3. 方案

### T1 清单件（纯文档，P0）

1. **`.agents/skills/code-review/SKILL.md`**：在既有双审计后追加**审计三（平台与宿主契约）**：
   - (a) 原生 `<list>` 结构变更（插入/删除/替换）→ 必须有 epoch 防御或结构规避 + 设备 spike 记录（ADR-0162）；
   - (b) Lynx 平台全局 API 新用法（`new URL`、新全局对象、新 bridge）→ 必须有设备探针记录 + 源级守卫；
   - (c) init-only props 组件接入新宿主形态 → 必须有宿主矩阵测试或显式 remount 契约注释。
2. **`docs/agents/qa-transition-checklist.md`**（新文件）：发版前双引擎转换清单（手工版转换矩阵），按 §4 矩阵表逐行给出「操作步骤 + 内容断言 + 预期结果」；头部注明「每行源自真实缺陷或防线 spec，发版前必过」。
3. **`docs/release-checklist.md`**：追加「发版前 QA 防线」节：引用 qa-transition-checklist 全过；GitHub Releases 先发 **pre-release**（beta 通道）挂 ≥3 天转 stable；发现缺陷先在矩阵登记再修。

### T2 转换矩阵 spec（android-e2e，P1）

新文件 `packages/app/tests/android-e2e/specs/transition-matrix.spec.ts`，**发版前手动门**（describe 标注 `@release-gate`）。矩阵首版 4 行（每行 = 一个已收口缺陷的回归）：

| 行 | 表面 | 动作序列 | 内容断言（禁存在性） |
|----|------|----------|---------------------|
| R1 | lynx `/illusts` 推荐 | 点中部卡片→详情→返回 | 返回后锚点卡内存在「相关作品」段（`relatedRowFor` 渲染物）；滚动位置不回顶（对比返回前后截图/首屏元素一致） |
| R2 | lynx SearchSheet | 搜多结果词→滚到底→等第二页 | 断言翻页后行数增加且无「加载更多失败」横幅；再切「小说」scope→列表无插画行 |
| R3 | lynx 推荐轮播 | 滑动 ≥2 张 | 每张卡收藏数两两不同（对比帧文本）；卡内容随 index 变化 |
| R4 | webview 搜索 | 同 R2 序列 | 同 R2 断言（webview 侧基线对照） |

实现约束：复用既有 helpers（`driver.ts`/`appium.ts`/登录种入/代理方法学，先读 `switch-client-roundtrip.spec.ts` 与 `lynx-boot-renders.spec.ts` 摸清惯例）；导航一律用 benchNav 深链（真机 @tap 不可靠）；R1 的注入段断言用页面文本「相关作品」+锚点卡定位。

### T3 宿主矩阵测试（app-lynx 单测，P1）

1. **审计**：grep `initial[A-Z]` + setup 读 props 模式，列出全部 init-only 组件清单写入测试文件头注释（已知：`BookmarkButton`；`CarouselSwiper` 为嫌疑宿主侧）。
2. **测试**：`BookmarkButton.host-matrix.test.ts`——同一挂载序列下：(a) 列表宿主形态（v-for 每卡独立实例）props 正确；(b) **复用宿主形态**（同一实例依次喂两组 illustId/count）断言状态随 props 刷新的**契约行为**（当前实现 = 须 remount；测试锁定「宿主不 remount 时状态冻结」这一契约边界，即断言组件按 init-only 语义工作，防止未来有人静默改语义）。
3. **契约显式化**：`BookmarkButton.vue` 头注释补一行契约：「init-only props：宿主必须按作品 remount（:key），否则状态冻结在首卡（ADR-0163）」。

### T4 平台一致性自检页（app-lynx，P2-a）

1. **收口**：新增 `src/utils/safeParseUrl.ts`——`extractHostname(url): string | null`（http(s) authority 正则，去 userinfo/端口；与 `api/search.ts` 现行实现同构并迁移过去复用）；`search.ts` 改为从该工具导入。
2. **自检页**：新增 `src/pages/PlatformCheck.vue`（路由 `/platform-check`，**不进任何导航入口**，仅 benchNav 钩子可达——对齐 DebugImage 先例）。矩阵项（每项 PASS/FAIL + 实际值）：
   - URL：`new URL('https://app-api.pixiv.net/x').hostname` 是否等于 `'app-api.pixiv.net'`（预期 FAIL——记录平台事实）
   - URL：`safeParseUrl` 同输入解析结果（预期 PASS——收口函数对照）
   - `URLSearchParams` 基本序列化/反序列化往返
   - `JSON.parse(JSON.stringify())` 往返（Unicode 键）
   - bridge 回调引号契约：`PictelioPrefs.prefsGet` 已知返回带引号字符串（unquote 前后值展示）
3. **接线**：`router.ts` 注册路由（`meta` 无 requiresAuth，避免登录耦合）；`__BENCH_NAV__` 钩子 `pictelioBenchNavPlatformCheck` → navigate（对齐既有 benchNav 三层模式）。
4. **守卫**：`PlatformCheck.template.test.ts`（或源级测试）锁定矩阵项存在；`.template.test.ts` 守卫 `search.ts`/`safeParseUrl.ts` 无裸 `new URL(`。

## 4. 验收

| Ticket | 验收 |
|--------|------|
| T1 | 三个文档存在且内容覆盖 §3.T1 全部条目；code-review SKILL 新审计轴与既有双审计并列 |
| T2 | spec 存在、遵循既有 helpers 惯例、`@release-gate` 标注；在本地模拟器（Appium 栈可用时）至少跑通 R1 一行并留运行证据；不可运行时在文件头注明待发版门首跑 |
| T3 | 审计清单落注释；宿主矩阵测试双形态覆盖；门禁 test:app-lynx 全绿 |
| T4 | 自检页可经 benchNav 到达并渲染矩阵（模拟器截图取证）；`search.ts` 无裸 `new URL(`；全部门禁绿 |

## 5. 测试要求

- T3/T4 的单测遵循仓库惯例（oracle 溯源头注释；源级守卫剥注释后断言）。
- T2 的断言严禁降级为存在性检查（本 spec 明文修订 #374 口径）。
- 所有新增测试命名/位置遵循 `tests/unit` vs `src/**/*.test.ts` 既有布局。

## 6. 扩展路径（非本期）

- 矩阵行扩展：收藏页、关注列表、排行榜、多图详情
- 错误监控接入（Sentry + lynx 捕获探针）
- lynx bundle OTA 化（对齐 webview 快慢双通道）
- 转换矩阵脚本化触发器（`pnpm qa:matrix` 一键）
