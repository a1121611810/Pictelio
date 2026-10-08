# ADR 索引

> 本文件由 scripts/generate-adr-index.mjs 确定性生成，**勿手改**；ADR 增删、改名后重跑该脚本。

| 类别 | 数量 |
| --- | --- |
| 编号 ADR（ADR-NNNN） | 201 |
| 术语表（glossary-*.md） | 47 |
| 遗留编号（0001-0021，无 ADR- 前缀） | 21 |
| 其他（迁移计划 / spikes 等） | 2 |
| **合计** | **271** |

## 编号 ADR（按编号排序）

- [ADR-0022-complete-store-migration-to-tq-factory.md](ADR-0022-complete-store-migration-to-tq-factory.md) — ADR 0022: 完成 Store 到 createTQFeedStore 工厂的迁移
- [ADR-0023-unify-scroll-primitives.md](ADR-0023-unify-scroll-primitives.md) — ADR 0023: 统一滚动原语
- [ADR-0024-extract-use-user-profile-hook.md](ADR-0024-extract-use-user-profile-hook.md) — ADR 0024: 提取 useUserProfile Hook
- [ADR-0025-cleanup-comment-system.md](ADR-0025-cleanup-comment-system.md) — ADR 0025: 评论系统清理与拆分
- [ADR-0026-fix-loginurl-empty.md](ADR-0026-fix-loginurl-empty.md) — ADR 0026: 修复 Login.tsx loginUrl 为空字符串的 Bug
- [ADR-0027-userworksfeed-conditional-render.md](ADR-0027-userworksfeed-conditional-render.md) — ADR 0027: UserWorksFeed 条件渲染替代双 Virtualizer 实例
- [ADR-0028-oauth-transport-dedup.md](ADR-0028-oauth-transport-dedup.md) — ADR 0028: 消除 auth.ts / pkceAuth.ts 中的 OAuth 传输层重复
- [ADR-0029-eliminate-store-circular-ref.md](ADR-0029-eliminate-store-circular-ref.md) — ADR 0029: 消除 uiStore 与 themeStore 间的循环引用
- [ADR-0030-image-cache-periodic-gc.md](ADR-0030-image-cache-periodic-gc.md) — ADR 0030: imageLoader L1 缓存添加定时 GC 与低内存感知
- [ADR-0031-unify-virtual-feed.md](ADR-0031-unify-virtual-feed.md) — ADR 0031: 统一 VirtualFeed 与 NovelVirtualFeed 为泛型 VirtualFeedShell
- [ADR-0032-author-click-navigation.md](ADR-0032-author-click-navigation.md) — ADR 0032: 全量覆盖第三方用户名点击跳转个人中心
- [ADR-0033-update-dialog-multiple-fixes.md](ADR-0033-update-dialog-multiple-fixes.md) — ADR 0033: 启动更新弹窗不可见的多次修复
- [ADR-0034-migrate-playwright-e2e-to-agent-browser.md](ADR-0034-migrate-playwright-e2e-to-agent-browser.md) — ADR 0034: Playwright E2E 测试逐步迁移至 Agent-Browser
- [ADR-0035-migrate-component-tests-to-e2e-and-unit.md](ADR-0035-migrate-component-tests-to-e2e-and-unit.md) — ADR 0035: 组件测试逐步迁移至 Agent-Browser E2E + 单元测试
- [ADR-0036-error-tuple-pattern.md](ADR-0036-error-tuple-pattern.md) — ADR-0036: 错误元组模式统一替换 try-catch
- [ADR-0037-pixiv-api-plugin-gateway.md](ADR-0037-pixiv-api-plugin-gateway.md) — ADR 0037: PixivApiPlugin 网关架构
- [ADR-0038-immediate-navigation.md](ADR-0038-immediate-navigation.md) — ADR 0038: 即时导航 — 先渲染、后加载数据
- [ADR-0039-detail-image-cache-ready.md](ADR-0039-detail-image-cache-ready.md) — ADR 0039: 详情页多图缓存就绪后渲染
- [ADR-0040-splash-exit-animation.md](ADR-0040-splash-exit-animation.md) — ADR-0040: Splash Screen 退出动画
- [ADR-0041-token-barrier.md](ADR-0041-token-barrier.md) — ADR 0041: Token Barrier — 认证就绪前阻塞 API 请求
- [ADR-0042-demand-query.md](ADR-0042-demand-query.md) — ADR 0042: 按需查询 — 禁用自动 fetch，由组件生命周期驱动
- [ADR-0043-skeleton-setTimeout.md](ADR-0043-skeleton-setTimeout.md) — ADR 0043: 骨架屏渲染保障 — setTimeout(0) 替换 requestAnimationFrame
- [ADR-0044-glass-tab-visual-language.md](ADR-0044-glass-tab-visual-language.md) — 玻璃 Tab 视觉语言（Glass Tab Visual Language）
- [ADR-0045-lynx-scrolltolower-infinite-loading.md](ADR-0045-lynx-scrolltolower-infinite-loading.md) — ADR 0045: app-lynx 推荐页 scrolltolower 无限加载修复
- [ADR-0046-app-lynx-tailwind.md](ADR-0046-app-lynx-tailwind.md) — ADR 0046: app-lynx 引入 Tailwind CSS（spacing=vw / fontSize=rpx / Fluent 语义色板）
- [ADR-0047-lynx-automated-visual-verification.md](ADR-0047-lynx-automated-visual-verification.md) — ADR 0047: app-lynx 自动化视觉验证方案（web-core 渲染位置 + Vivaldi 持久 profile + CDP 登录）
- [ADR-0048-lynx-recommended-card-layout.md](ADR-0048-lynx-recommended-card-layout.md) — ADR 0048: app-lynx 推荐列表卡片布局修复（w-full 百分比基准 + 间距）
- [ADR-0049-lynx-keepalive-page-cache.md](ADR-0049-lynx-keepalive-page-cache.md) — ADR 0049: app-lynx 详情返回列表不重载（KeepAlive 页面实例缓存 + 极简历史栈）
- [ADR-0050-lynx-login-persistence.md](ADR-0050-lynx-login-persistence.md) — ADR 0050: app-lynx 登录态持久化（web-core IndexedDB + 原生适配主项目 Keystore 存储）
- [ADR-0051-lynx-r18-filter.md](ADR-0051-lynx-r18-filter.md) — ADR 0051: app-lynx R18/R18G 内容过滤（IndexedDB 设置存储 + Me 页开关）
- [ADR-0052-lynx-illust-bookmark.md](ADR-0052-lynx-illust-bookmark.md) — ADR 0052: app-lynx 插画收藏（详情页 + 列表卡片 ♥）
- [ADR-0053-lynx-nativemodule-contract.md](ADR-0053-lynx-nativemodule-contract.md) — ADR 0053: Lynx NativeModule 契约与原生双模式适配（access_token 隔离）
- [ADR-0054-image-pipeline-unified-core.md](ADR-0054-image-pipeline-unified-core.md) — ADR 0054: 图片流水线统一核心（PixivImageLoader 双 client 共用）
- [ADR-0055-lynx-native-render-compat.md](ADR-0055-lynx-native-render-compat.md) — ADR 0055: vue-lynx 原生渲染兼容策略（真机实测问题系统化）
- [ADR-0056-lynx-list-number-prop-binding.md](ADR-0056-lynx-list-number-prop-binding.md) — ADR 0056: lynx list number 类型属性必须 v-bind 数字绑定（列数契约）
- [ADR-0057-emulator-verification-on-macos26.md](ADR-0057-emulator-verification-on-macos26.md) — ADR 0057: macOS 26.5.2 上 Android 模拟器验证环境选型
- [ADR-0058-check-gate-includes-standalone-tsc.md](ADR-0058-check-gate-includes-standalone-tsc.md) — ADR-0058：`pnpm check` 质量门禁包含独立 tsc 类型检查
- [ADR-0059-root-script-convention.md](ADR-0059-root-script-convention.md) — ADR-0059：根目录脚本命令约定（`命令:包名` 与 `命令:all`）
- [ADR-0060-lynx-feed-image-lazy-loading.md](ADR-0060-lynx-feed-image-lazy-loading.md) — ADR 0060: 推荐页图片按需加载——lazy-load 属性 + 数据分批渲染（web-core 图片加载风暴防护）
- [ADR-0061-android-emulator-e2e-gate.md](ADR-0061-android-emulator-e2e-gate.md) — ADR 0061: Android 模拟器 E2E 测试纳入门禁——「切换渲染引擎」链路真机验证
- [ADR-0062-single-engine-client-switch-hiding.md](ADR-0062-single-engine-client-switch-hiding.md) — ADR-0062：独立包引擎切换 UI 隐藏与 Native 能力暴露
- [ADR-0063-github-actions-ci-gate.md](ADR-0063-github-actions-ci-gate.md) — ADR 0063: GitHub Actions CI 作为 PR 合并门禁——轻量双 job（check+lint / test）
- [ADR-0064-engine-switch-experience-fix.md](ADR-0064-engine-switch-experience-fix.md) — ADR-0064：引擎切换体验修复（说明页确认 + 即时反馈 + R8 白屏根治）
- [ADR-0065-per-asset-release-upload.md](ADR-0065-per-asset-release-upload.md) — ADR-0065：Release 资产逐包上传（每包独立 gh 进程 + 上传面板 + 失败隔离）
- [ADR-0066-lynx-system-back-bridge.md](ADR-0066-lynx-system-back-bridge.md) — ADR-0066：app-lynx 系统返回 native→JS 事件桥（返回决策权在 JS）
- [ADR-0067-node-release-uploader.md](ADR-0067-node-release-uploader.md) — ADR-0067：Release 上传改用 Node 原生上传器（默认直连）+ 代理路径提示
- [ADR-0068-update-dialog-sizing.md](ADR-0068-update-dialog-sizing.md) — ADR 0068: 更新弹窗尺寸规范——85vh 上限 + 更新内容区自适应滚动 + 清单 changelog 完整保留
- [ADR-0069-cardized-settings-and-personal-center.md](ADR-0069-cardized-settings-and-personal-center.md) — 设置页与个人中心卡片化视觉统一（Cardized Settings & Personal Center）
- [ADR-0070-home-cardized-a2.md](ADR-0070-home-cardized-a2.md) — 首页全页 A2 化（Home Cardized — A2 Visual Language）
- [ADR-0071-illust-detail-cardized-a2.md](ADR-0071-illust-detail-cardized-a2.md) — 作品详情页 A2 化（Illust Detail Cardized — A2 Visual Language）
- [ADR-0072-novel-detail-cardized-a2.md](ADR-0072-novel-detail-cardized-a2.md) — 小说详情页 A2 化（Novel Detail Cardized — A2 Visual Language）
- [ADR-0073-home-content-a2-unification.md](ADR-0073-home-content-a2-unification.md) — ADR-0073: 首页内容域 A2 视觉统一（Home Content A2 Unification）
- [ADR-0074-a2-win11-correction.md](ADR-0074-a2-win11-correction.md) — ADR-0074: A2 视觉语言按 Win11 / Fluent 2 官方规范修正（A2 Win11 Correction）
- [ADR-0075-home-c-shell-fixed-layout.md](ADR-0075-home-c-shell-fixed-layout.md) — ADR-0075: 首页 C 框架 + L5 固定布局（Home C Shell & Fixed Layout L5）
- [ADR-0076-home-pull-to-refresh.md](ADR-0076-home-pull-to-refresh.md) — ADR-0076: 首页下拉刷新（Home Pull-to-Refresh）
- [ADR-0077-novel-fast-scroller.md](ADR-0077-novel-fast-scroller.md) — ADR-0077: 小说详情 FastScroller（可拖拽滚动条 + 章节预览）
- [ADR-0078-feed-list-unification.md](ADR-0078-feed-list-unification.md) — ADR-0078: 列表交互统一（FeedList 容器 + 加载语义分离）
- [ADR-0079-tool-trigger-protocol.md](ADR-0079-tool-trigger-protocol.md) — ADR-0079：工具触发协议（CodeGraph / OpenWiki / 文档查询主动路由）
- [ADR-0080-dependency-upgrade-analysis.md](ADR-0080-dependency-upgrade-analysis.md) — ADR-0080：依赖升级评估（2026-08 全库盘点）
- [ADR-0081-search-pagination-native-4xx-fix.md](ADR-0081-search-pagination-native-4xx-fix.md) — ADR-0081：搜索分页修复——原生 next_url 归一化 + 同参数搜索防重入
- [ADR-0082-feed-pagination-inline-retry.md](ADR-0082-feed-pagination-inline-retry.md) — ADR-0082：分页失败内联重试
- [ADR-0083-dead-code-cleanup.md](ADR-0083-dead-code-cleanup.md) — ADR-0083：死代码清理（Dead Code Cleanup）
- [ADR-0084-e2e-testing-localization.md](ADR-0084-e2e-testing-localization.md) — ADR-0084: agent-browser E2E 测试本地化与 CI 精简
- [ADR-0085-ai-assertion-reposition.md](ADR-0085-ai-assertion-reposition.md) — ADR-0085: agent-browser AI 断言归位（确定性为主，LLM 保留语义判断）
- [ADR-0086-lynx-responsive-units.md](ADR-0086-lynx-responsive-units.md) — ADR 0086: app-lynx 响应式单位选型——字号 rpx + 宽高间距 vw
- [ADR-0087-fluent-dialog-body-slot-contract.md](ADR-0087-fluent-dialog-body-slot-contract.md) — ADR 0087: fluent-dialog 必须经 fluent-dialog-body 投影（slot 契约）
- [ADR-0088-app-lynx-feed-tabs-gateway.md](ADR-0088-app-lynx-feed-tabs-gateway.md) — ADR 0088: app-lynx 三问题修复——requestRaw 原生网关 / 流内遮罩卡 / 全局 tab 重构
- [ADR-0089-update-check-architecture.md](ADR-0089-update-check-architecture.md) — ADR 0089: 检查更新双端共用——共享检查层 + 客户端各自更新策略
- [ADR-0090-image-cache-three-layer.md](ADR-0090-image-cache-three-layer.md) — ADR-0090: 图片缓存三层分离架构
- [ADR-0091-extract-hearticon-component.md](ADR-0091-extract-hearticon-component.md) — ADR 0091: 提取 HeartIcon 共享组件
- [ADR-0092-create-persisted-set-factory.md](ADR-0092-create-persisted-set-factory.md) — ADR 0092: 提取 createPersistedSet 工厂消除 store 重复
- [ADR-0093-tanstack-query-adoption.md](ADR-0093-tanstack-query-adoption.md) — ADR-0093: 采用 TanStack Query 管理服务端状态
- [ADR-0094-tanstack-db-browsing-history.md](ADR-0094-tanstack-db-browsing-history.md) — ADR-0094: 采用 TanStack DB 实现本地浏览历史
- [ADR-0095-split-illust-detail.md](ADR-0095-split-illust-detail.md) — ADR 0095: 拆分 IllustDetail.tsx
- [ADR-0096-virtual-scroll-migration.md](ADR-0096-virtual-scroll-migration.md) — ADR 0096：自建虚拟滚动迁移到 TanStack Virtual
- [ADR-0097-agent-skill-repo-localization.md](ADR-0097-agent-skill-repo-localization.md) — ADR 0097：code-review skill 仓库化 + 测试期望值溯源（oracle check）
- [ADR-0098-cross-engine-consistency.md](ADR-0098-cross-engine-consistency.md) — ADR 0098：跨引擎一致性保障——差分测试 + 属性测试 + OAuth 400 识别修复
- [ADR-0099-local-openwiki-disable.md](ADR-0099-local-openwiki-disable.md) — ADR 0099：禁用本地 openwiki:update，文档同步完全移交 CI 定时任务
- [ADR-0100-app-url-boundary-token-guard.md](ADR-0100-app-url-boundary-token-guard.md) — ADR 0100：URL 重写受信边界修复——伪后缀域误判与 access_token 附加守卫（对齐 lynx #165）
- [ADR-0101-stryker-mutation-trial.md](ADR-0101-stryker-mutation-trial.md) — ADR 0101：StrykerJS mutation testing 试点（纯函数包本地灵敏度门禁）
- [ADR-0102-lynx-task-restore.md](ADR-0102-lynx-task-restore.md) — ADR 0102：app-lynx 缩小恢复——full 包路由壳破坏 task 恢复契约，isTaskRoot 守卫修复
- [ADR-0103-account-scoped-content-settings.md](ADR-0103-account-scoped-content-settings.md) — ADR 0103：账号级内容设置（R18/R18G）跨 client 同步 + 移除年龄门
- [ADR-0104-app-lynx-feed-pagination-convergence.md](ADR-0104-app-lynx-feed-pagination-convergence.md) — ADR-0104：app-lynx 分页收敛——rewriteUrl 原生归一化 + 全列表页迁移到 createMixFeed
- [ADR-0105-restricted-novel-card-equal-height.md](ADR-0105-restricted-novel-card-equal-height.md) — ADR-0105：受限小说卡等高——RestrictedNovelCard 组件 + 全站统一固定高度
- [ADR-0106-lynx-pull-to-refresh.md](ADR-0106-lynx-pull-to-refresh.md) — ADR-0106: app-lynx 列表下拉刷新（Lynx Pull-to-Refresh）
- [ADR-0107-lynx-fab-refresh.md](ADR-0107-lynx-fab-refresh.md) — ADR-0107: app-lynx 列表刷新入口改 FAB（废弃原生下拉刷新）
- [ADR-0108-lynx-fab-refresh-spin.md](ADR-0108-lynx-fab-refresh-spin.md) — ADR-0108: app-lynx 刷新 FAB 旋转动画（CSS keyframes）
- [ADR-0109-lynx-back-to-top.md](ADR-0109-lynx-back-to-top.md) — ADR-0109: app-lynx 回顶按钮（scroll-to-index 通道 + scoped slot 接口）
- [ADR-0110-lynx-back-to-top-persistent.md](ADR-0110-lynx-back-to-top-persistent.md) — ADR-0110: app-lynx 回顶按钮（常驻版）
- [ADR-0111-lynx-fab-menu.md](ADR-0111-lynx-fab-menu.md) — ADR-0111: app-lynx 采用 M3 FAB menu 整合刷新与回顶入口
- [ADR-0112-lynx-bookmark-animation.md](ADR-0112-lynx-bookmark-animation.md) — ADR-0112: app-lynx 收藏/取消收藏动效（M3 state-layer 环 + spring 弹心）
- [ADR-0113-work-type-badges.md](ADR-0113-work-type-badges.md) — ADR-0113: 作品类型标识（动图/多图）跨端统一 —— App 图标化角标 + Lynx 流内徽章行
- [ADR-0114-app-lynx-pagination-buttons.md](ADR-0114-app-lynx-pagination-buttons.md) — ADR-0114: app-lynx 推荐页按钮分页（替换式翻书，绕开 list 增量渲染 bug）
- [ADR-0115-app-lynx-recommended-carousel.md](ADR-0115-app-lynx-recommended-carousel.md) — ADR-0115: app-lynx 推荐页改单卡轮播（自研 swipe）+ 移除 T0-DIAG
- [ADR-0116-app-lynx-script-setup-no-export.md](ADR-0116-app-lynx-script-setup-no-export.md) — ADR-0116: app-lynx `<script setup>` SFC 禁止 ES module `export`（build-fix）
- [ADR-0117-app-lynx-cover-image-deep-module.md](ADR-0117-app-lynx-cover-image-deep-module.md) — ADR-0117: app-lynx 深模块 CoverImage 统一「图片三态」（RecommendedCover / SkeletonImage 收敛）
- [ADR-0118-app-lynx-recommended-carousel-polish-r2.md](ADR-0118-app-lynx-recommended-carousel-polish-r2.md) — ADR-0118: app-lynx 推荐轮播打磨 R2（封面比例显示 / 轮播吸附阈值+fling / 冷启动沉浸骨架 / 标签胶囊行）
- [ADR-0119-app-lynx-carousel-scrim-flow-layout.md](ADR-0119-app-lynx-carousel-scrim-flow-layout.md) — ADR-0119: app-lynx 推荐轮播 scrim 改页面级遮罩（真机非首 slide 文案不渲染修复）
- [ADR-0120-app-lynx-radial-nav-fab.md](ADR-0120-app-lynx-radial-nav-fab.md) — ADR-0120: app-lynx 全局导航改为「放射双层环悬浮 FAB」（合并刷新/回顶/翻页）
- [ADR-0121-app-lynx-radial-fab-m3-size.md](ADR-0121-app-lynx-radial-fab-m3-size.md) — ADR-0121: app-lynx 放射导航 FAB 展开项按 M3 尺寸重定（B 方案 56dp 圆）+ 层叠与扫角修复
- [ADR-0122-ota-self-built-switching.md](ADR-0122-ota-self-built-switching.md) — ADR-0122: OTA web bundle 切换机制自研而非引入 @capgo/capacitor-updater
- [ADR-0123-app-lynx-fab-hit-testing-fix.md](ADR-0123-app-lynx-fab-hit-testing-fix.md) — ADR-0123: 修复放射 FAB 全屏容器在原生 LynxView 吞掉页面触摸（hit-testing 平台约束固化）
- [ADR-0124-r8-keep-room-generated-constructor.md](ADR-0124-r8-keep-room-generated-constructor.md) — ADR-0124: v4.22.0 Release 启动闪退修复 —— R8 keep 规则显式保住 Room 反射实例化面
- [ADR-0125-lynx-ugoira-unpacked-pipeline.md](ADR-0125-lynx-ugoira-unpacked-pipeline.md) — ADR-0125: lynx 原生模式 ugoira 播放管线采用 Java 解压写盘（file:// 帧 URL）
- [ADR-0126-ugoira-flicker-and-range-fallback.md](ADR-0126-ugoira-flicker-and-range-fallback.md) — ADR-0126: lynx 播放闪烁用 defer-src-invalidation 修复；app range 模式失败走降级（拦截器 206 被实测否决）
- [ADR-0127-ugoira-streaming-playback.md](ADR-0127-ugoira-streaming-playback.md) — ADR-0127: app 侧 ugoira fflate 模式改为流式渐进播放（不依赖 Range）
- [ADR-0128-ugoira-native-streaming-playback.md](ADR-0128-ugoira-native-streaming-playback.md) — ADR-0128: lynx 原生模式 ugoira 首次播放改为流式渐进（Java 边下边解压写盘 + 拉模式分批交付）
- [ADR-0129-app-lynx-detail-multi-image-list.md](ADR-0129-app-lynx-detail-multi-image-list.md) — ADR-0129: app-lynx 多图详情改列表（通栏连续大图 + 逐页比例修正，扩展 CoverImage）
- [ADR-0130-settings-8-card-regroup.md](ADR-0130-settings-8-card-regroup.md) — ADR-0130: 设置页按功能域重组 8 卡分类
- [ADR-0131-app-lynx-viewport-size-contract.md](ADR-0131-app-lynx-viewport-size-contract.md) — ADR-0131: app-lynx 内容区尺寸契约——以内容区尺寸计算底部几何
- [ADR-0132-app-lynx-global-search.md](ADR-0132-app-lynx-global-search.md) — ADR-0132: app-lynx 全局搜索（底部弹层 + FAB 双形态入口）（底部弹层命令面板 + FAB 双形态入口）
- [ADR-0133-app-lynx-tag-tap-search.md](ADR-0133-app-lynx-tag-tap-search.md) — ADR-0133: app-lynx 点击标签触发全局搜索（预填关键词）
- [ADR-0134-app-lynx-novel-list-virtualization.md](ADR-0134-app-lynx-novel-list-virtualization.md) — ADR-0134：小说正文列表虚拟化（`<list single>`）与主线程滚动信号（app-lynx）
- [ADR-0135-app-lynx-scroll-indicator.md](ADR-0135-app-lynx-scroll-indicator.md) — ADR-0135: 列表滚动指示条（滚动信号面复用，wayfinder #304 / #318）
- [ADR-0136-app-lynx-bench-nav-hook.md](ADR-0136-app-lynx-bench-nav-hook.md) — ADR-0136: 真机测试导航钩子（benchNav）——intent 深链替代注入 tap
- [ADR-0137-app-lynx-scroll-ui-test-method.md](ADR-0137-app-lynx-scroll-ui-test-method.md) — ADR-0137: 滚动态 UI 真机测试方法——滚动中采样（并发截图）替代「滚动后截图」
- [ADR-0138-app-lynx-vue-router.md](ADR-0138-app-lynx-vue-router.md) — ADR-0138: app-lynx 路由迁移到官方 vue-router（createMemoryHistory）
- [ADR-0139-app-lynx-pinia-migration.md](ADR-0139-app-lynx-pinia-migration.md) — ADR-0139: app-lynx 状态管理迁移到 Pinia（setup store，authStore 试点 + 全量路线）
- [ADR-0140-globalfab-pinia-migration.md](ADR-0140-globalfab-pinia-migration.md) — ADR-0140: globalFab 后置迁移到 Pinia（setup store，spike 验证通过后的全量迁移）
- [ADR-0141-app-lynx-vue-query-migration.md](ADR-0141-app-lynx-vue-query-migration.md) — ADR-0141: app-lynx 数据层迁移到 TanStack Vue Query v5（spike 验证后的方向决策）
- [ADR-0142-pre-push-fetch-fallback-and-release-preflight.md](ADR-0142-pre-push-fetch-fallback-and-release-preflight.md) — ADR-0142: pre-push 钩子加固与 release 分叉预检的 fail 语义分层
- [ADR-0143-imagehost-download-source-java-sink.md](ADR-0143-imagehost-download-source-java-sink.md) — ADR-0143: 图床下载源决策下沉 Java 下载层与「缓存键恒官方 URL」契约
- [ADR-0144-app-lynx-vue-tsc.md](ADR-0144-app-lynx-vue-tsc.md) — ADR-0144: app-lynx check 工具从 tsc 切到 vue-tsc
- [ADR-0144-solidjs-2-migration.md](ADR-0144-solidjs-2-migration.md) — ADR-0144: SolidJS 1.9 → 2.0（RC）主客户端升级与周边生态同步迁移
- [ADR-0145-image-save-download.md](ADR-0145-image-save-download.md) — ADR-0145: 作品图片保存（单图保存 / 多图选页 / 批量下载）
- [ADR-0146-download-queue-export.md](ADR-0146-download-queue-export.md) — ADR-0146: 下载队列与 ugoira 多格式导出
- [ADR-0147-lynx-scrollview-overlay-hit-testing.md](ADR-0147-lynx-scrollview-overlay-hit-testing.md) — ADR-0147: 下载管理页底部动作栏在原生 LynxView 点击失效修复（absolute 覆层覆盖 `<scroll-view>` 的平台约束）
- [ADR-0148-remove-page-style-setting.md](ADR-0148-remove-page-style-setting.md) — ADR-0148: 移除「页面风格」设置并固定为 Fluent（Remove Page Style Setting）
- [ADR-0149-app-lynx-adaptive-tag-fold.md](ADR-0149-app-lynx-adaptive-tag-fold.md) — ADR-0149: app-lynx 列表标签采用「测量驱动自适应折叠」（adaptive tag fold）
- [ADR-0150-app-lynx-page-level-first-load-skeleton.md](ADR-0150-app-lynx-page-level-first-load-skeleton.md) — ADR-0150: app-lynx 页级首载骨架（空态文案仅在首载成功落定后出现）
- [ADR-0151-app-lynx-auth-ready-gate.md](ADR-0151-app-lynx-auth-ready-gate.md) — ADR-0151: app-lynx 认证就绪门（首帧数据请求等待 token 恢复）
- [ADR-0152-app-lynx-theme-color.md](ADR-0152-app-lynx-theme-color.md) — ADR-0152: app-lynx 选择主题色（静态 M3 色板 + 根类切换）
- [ADR-0153-engine-availability-fallback.md](ADR-0153-engine-availability-fallback.md) — ADR-0153: 引擎可用性判定与降级（WebView 不可用时优先 Lynx）
- [ADR-0154-novel-export.md](ADR-0154-novel-export.md) — ADR-0154: 小说多格式导出（共享纯逻辑包 + 原生编码器 + 复用下载队列）
- [ADR-0155-ai-artwork-three-state-filter.md](ADR-0155-ai-artwork-three-state-filter.md) — ADR-0155: AI 作品三态过滤（显示 / 遮罩 / 仅看）
- [ADR-0156-webdav-backup-architecture.md](ADR-0156-webdav-backup-architecture.md) — ADR-0156: WebDAV 备份架构（三层同构：Java 单一核心 + 双薄桥 + TS 共享纯函数层）
- [ADR-0157-i18n-selection-and-loading.md](ADR-0157-i18n-selection-and-loading.md) — ADR-0157: 双端 i18n 选型与加载策略（简中源 + 英文，@solid-primitives/i18n + 副端手写模块）
- [ADR-0158-ranking-information-architecture.md](ADR-0158-ranking-information-architecture.md) — ADR-0158: 排行榜不新增导航分类——feed 内融合入口 + 独立榜单页（两端形态不同）
- [ADR-0159-bridge-thread-unblocking.md](ADR-0159-bridge-thread-unblocking.md) — ADR-0159: 插件桥线程卸载与引擎切换线 E2E 契约修复
- [ADR-0160-illust-bookmark-tags.md](ADR-0160-illust-bookmark-tags.md) — ADR-0160: 插画收藏加标签——双轨收藏 + 收藏面板（覆盖式编辑）
- [ADR-0161-native-post-form-body.md](ADR-0161-native-post-form-body.md) — ADR-0161: webview 原生 POST 载荷改走表单体（修复所有原生写操作）
- [ADR-0162-lynx-related-inline-section.md](ADR-0162-lynx-related-inline-section.md) — ADR-0162: lynx 相关作品注入行改为锚点卡内展开段（瀑布流 list-item 中途插入被 patch 丢弃）
- [ADR-0163-qa-defense-lines.md](ADR-0163-qa-defense-lines.md) — ADR-0163: QA 防线三网——转换矩阵、宿主矩阵、平台一致性自检
- [ADR-0164-default-engine-lynx-bidirectional-fallback.md](ADR-0164-default-engine-lynx-bidirectional-fallback.md) — ADR-0164: 默认引擎翻转为 Lynx 与双向引擎降级
- [ADR-0165-lynx-text-selection-and-toolbar.md](ADR-0165-lynx-text-selection-and-toolbar.md) — ADR-0165: lynx 正文选中与自绘操作菜单的契约
- [ADR-0166-release-notes-model-summary.md](ADR-0166-release-notes-model-summary.md) — ADR-0166: 发布文案的「模型总结」步骤与通用 OpenAI 兼容通道
- [ADR-0167-lynx-novel-intro-three-segment.md](ADR-0167-lynx-novel-intro-three-segment.md) — ADR-0167: lynx 小说导航三段式（列表 → 介绍页 → 正文）
- [ADR-0168-lynx-systembars-e2e-base-and-fullscreen-toggle.md](ADR-0168-lynx-systembars-e2e-base-and-fullscreen-toggle.md) — ADR-0168: lynx 系统栏策略——基底边到边 + 全屏模式设置开关
- [ADR-0169-translation-provider-interface.md](ADR-0169-translation-provider-interface.md) — ADR-0169: app-lynx 端 TranslationProvider 无关接口 + chunked pipeline
- [ADR-0170-lynx-translate-nativemodule-bridge.md](ADR-0170-lynx-translate-nativemodule-bridge.md) — ADR-0170: app-lynx Native bridge 与 PictelioTranslate Java 模块
- [ADR-0171-translation-cache-strategy.md](ADR-0171-translation-cache-strategy.md) — ADR-0171: app-lynx 翻译缓存策略
- [ADR-0172-app-lynx-runtime-web-api-constraints.md](ADR-0172-app-lynx-runtime-web-api-constraints.md) — ADR-0172: app-lynx 运行时 Web API 面约束（PrimJS 缺项与收口）
- [ADR-0173-llm-endpoint-probe-and-verification.md](ADR-0173-llm-endpoint-probe-and-verification.md) — ADR-0173: LLM endpoint 探测与凭据验证（两层状态）
- [ADR-0174-java-translate-terminal-test-contract.md](ADR-0174-java-translate-terminal-test-contract.md) — ADR-0174: PictelioTranslate Java 终态交付契约的单测防线（机制采纳）
- [ADR-0175-app-lynx-native-translation-cache-channel.md](ADR-0175-app-lynx-native-translation-cache-channel.md) — ADR-0175: app-lynx 原生翻译缓存通道（真机文件系统路径）
- [ADR-0176-app-lynx-translation-per-stream-keying.md](ADR-0176-app-lynx-translation-per-stream-keying.md) — ADR-0176: app-lynx 翻译 Java 端解析状态按 streamId 分桶（per-stream keying）
- [ADR-0177-android-gradle-test-variant-gate.md](ADR-0177-android-gradle-test-variant-gate.md) — ADR-0177: Android Gradle 单测变体门禁（`./gradlew test|build|check` 恒红陷阱收口）
- [ADR-0178-app-lynx-translation-retry-and-partial-ui.md](ADR-0178-app-lynx-translation-retry-and-partial-ui.md) — ADR-0178: app-lynx 翻译失败重试与 partial 段落标记的形态参数
- [ADR-0179-app-lynx-m3-switch-component.md](ADR-0179-app-lynx-m3-switch-component.md) — ADR-0179: app-lynx `<M3Switch>` 组件抽取——10+2 处 inline markup 收口
- [ADR-0180-lynx-dark-mode.md](ADR-0180-lynx-dark-mode.md) — ADR-0180: lynx 夜间模式——三态明暗外观 + 自建暗色检测通道 + 双轨 splash
- [ADR-0181-assertnever-exhaustive-checking.md](ADR-0181-assertnever-exhaustive-checking.md) — ADR-0181: 编译期穷尽性检查——`assertNever` 工具 + 跨端复制策略
- [ADR-0182-branded-types-for-api-ids.md](ADR-0182-branded-types-for-api-ids.md) — ADR-0182: Branded Types for API IDs —— 编译期身份隔离
- [ADR-0183-lynx-novel-intro-toggle.md](ADR-0183-lynx-novel-intro-toggle.md) — ADR-0183: Lynx 小说介绍页开关——介绍页先行可关、直达正文
- [ADR-0184-dependency-upgrade-execution-2026-09.md](ADR-0184-dependency-upgrade-execution-2026-09.md) — ADR-0184: 全 workspace 依赖升级执行批次（2026-09）
- [ADR-0185-vite-plus-1rc-toolchain.md](ADR-0185-vite-plus-1rc-toolchain.md) — ADR-0185: vite-plus 1.0.0-rc 采纳与 lint/fmt 仓库根收敛
- [ADR-0186-vite-plus-1rc-regression-campaign.md](ADR-0186-vite-plus-1rc-regression-campaign.md) — ADR-0186: vite-plus 1.0-rc 升级全面回归战役（2026-09-25）
- [ADR-0187-tag-mute.md](ADR-0187-tag-mute.md) — ADR-0187：标签级静音（本地标签词表过滤）
- [ADR-0188-notification-center.md](ADR-0188-notification-center.md) — ADR-0188：通知中心（拉取式应用内通知）
- [ADR-0189-lynx-novel-intro-action-row.md](ADR-0189-lynx-novel-intro-action-row.md) — ADR-0189: app-lynx 小说介绍页底部动作行（收藏·追更·下载·系列目录）
- [ADR-0190-app-lynx-m3-segmented-button-component.md](ADR-0190-app-lynx-m3-segmented-button-component.md) — ADR-0190: app-lynx `<M3SegmentedButton>` 组件抽取——5 处 inline 分段控件收口
- [ADR-0191-lynx-watch-later.md](ADR-0191-lynx-watch-later.md) — ADR-0191：app-lynx 稍后看（WatchLater——本地暂存作品列表）
- [ADR-0192-lynx-download-naming-template.md](ADR-0192-lynx-download-naming-template.md) — ADR-0192：app-lynx 下载命名模板与按作者建目录（Download File Template / Author Directory）
- [ADR-0193-lynx-mypixiv-list.md](ADR-0193-lynx-mypixiv-list.md) — ADR-0193：app-lynx 好P友列表（MyPixiv）
- [ADR-0194-lynx-common-components.md](ADR-0194-lynx-common-components.md) — ADR-0194：app-lynx 公共组件层抽取（Common Layer——六组件收口）
- [ADR-0195-pre-push-fmt-gate.md](ADR-0195-pre-push-fmt-gate.md) — ADR-0195：pre-push 增加 fmt 门禁（范围=被推文件）
- [ADR-0196-app-lynx-source-tracing.md](ADR-0196-app-lynx-source-tracing.md) — ADR-0196：app-lynx 溯源（Source tracing）——外部反向搜图服务
- [ADR-0197-app-lynx-tag-neighbors.md](ADR-0197-app-lynx-tag-neighbors.md) — ADR-0197：app-lynx 标签近邻（Tag neighbors）——标签组合降维检索
- [ADR-0198-app-lynx-bili-theme.md](ADR-0198-app-lynx-bili-theme.md) — ADR-0198：app-lynx bili 主题——bilibili 品牌色手工映射为第 7 支主题色
- [ADR-0199-app-lynx-rate-limit-backoff.md](ADR-0199-app-lynx-rate-limit-backoff.md) — ADR-0199：app-lynx Pixiv API 限流退避——429 指数退避 + 全抖动，参数设置可调
- [ADR-0200-lynx-accept-language-header.md](ADR-0200-lynx-accept-language-header.md) — ADR-0200：app-lynx 标签翻译语言头——Accept-Language 跟随 UI 语言，原生通道 Java 侧解析
- [ADR-0201-single-engine-facade-consolidation.md](ADR-0201-single-engine-facade-consolidation.md) — ADR-0201：webview 下线后的三门面收口（只改文档，不动产品代码）
- [ADR-0202-ota-web-bundle-channel-retirement.md](ADR-0202-ota-web-bundle-channel-retirement.md) — ADR-0202：OTA web bundle 发布通道下线（消费层留存）
- [ADR-0203-webview-client-source-removal.md](ADR-0203-webview-client-source-removal.md) — ADR-0203：WebView 客户端源码删除与宿主迁移
- [ADR-0204-root-command-naming.md](ADR-0204-root-command-naming.md) — ADR-0204：根命令裸名重新定义（取代 ADR-0059 的委托指向）
- [ADR-0205-md3-baseline-and-scope.md](ADR-0205-md3-baseline-and-scope.md) — ADR-0205：app-lynx 设计基线锚定 MD3，整改范围与「有意偏离」清单
- [ADR-0206-typography-type-scale.md](ADR-0206-typography-type-scale.md) — ADR-0206：排版系统落地 —— MD3 type scale 的四元组进 Tailwind 档位
- [ADR-0207-shape-and-state-layer-guardrails.md](ADR-0207-shape-and-state-layer-guardrails.md) — ADR-0207：形状与状态层的护栏化 —— 把「碰巧正确」变成「写错即失败」
- [ADR-0208-material-symbols-icons.md](ADR-0208-material-symbols-icons.md) — ADR-0208：图标接入 Material Symbols —— 用「子集字体 + 名称↔码点映射」取代 unicode 字形
- [ADR-0209-md3-filled-text-field-alignment.md](ADR-0209-md3-filled-text-field-alignment.md) — ADR-0209：表单输入框对齐 MD3 filled text field（含官方规格回源纠正）
- [ADR-0210-lynx-style-stack-capability-boundary.md](ADR-0210-lynx-style-stack-capability-boundary.md) — ADR-0210：Lynx 样式栈能力边界 —— 动效落地的可行路径与死类名台账
- [ADR-0211-ui-continuity-motion-contract.md](ADR-0211-ui-continuity-motion-contract.md) — ADR-0211：界面连续性契约 —— 让每一次可见状态变化都在时间维度上被表达
- [ADR-0212-tonal-elevation-surface-over-shadow.md](ADR-0212-tonal-elevation-surface-over-shadow.md) — ADR-0212：层级表达以表面色调为主 —— 把 elevation 从「唯一手段」降为「辅助手段」
- [ADR-0213-immersive-media-view.md](ADR-0213-immersive-media-view.md) — ADR-0213：沉浸式媒体查看 —— 详情页全屏看图 + 点图隐藏全部界面元素
- [ADR-0214-top-inset-per-page-ownership.md](ADR-0214-top-inset-per-page-ownership.md) — ADR-0214：顶部安全区让位改为「逐页归属」—— 修订 ADR-0168 的全局 Root padding 决策
- [ADR-0215-fail-safe-aux-mechanisms.md](ADR-0215-fail-safe-aux-mechanisms.md) — ADR-0215：辅助机制必须 fail-safe，且每条声称都要有可复现的机器证据
- [ADR-0216-four-root-pages-header-removal-and-fab-allowance-removal.md](ADR-0216-four-root-pages-header-removal-and-fab-allowance-removal.md) — ADR-0216：四个根页去顶栏 + 撤销根容器 FAB 占位带
- [ADR-0217-bottom-occlusion-allowance-scoped-to-scroll-content.md](ADR-0217-bottom-occlusion-allowance-scoped-to-scroll-content.md) — ADR-0217：底部遮挡让位下沉到滚动内容末尾，取代全局 FAB 占位带
- [ADR-0218-app-lynx-top-nav-user-question-dimension.md](ADR-0218-app-lynx-top-nav-user-question-dimension.md) — ADR-0218：顶层导航由「媒介维度」改为「用户问题维度」（发现/更新/书架/我的）
- [ADR-0219-lynx-continue-reading.md](ADR-0219-lynx-continue-reading.md) — ADR-0219：继续读（本地话级阅读位置 + 书架第三段兑现）
- [ADR-0220-notification-delivery-channel-probe.md](ADR-0220-notification-delivery-channel-probe.md) — ADR-0220：送达通道的形态选择（触达探测，而非通知功能）
- [ADR-0221-row-action-leaves-trailing-band.md](ADR-0221-row-action-leaves-trailing-band.md) — ADR-0221：行内动作离开行尾——遮挡带是行尾的「固定占用者」

## 术语表（glossary）

- [glossary-android-emulator-e2e.md](glossary-android-emulator-e2e.md) — Android 模拟器 E2E 门禁 — 术语表
- [glossary-android-lifecycle-restore.md](glossary-android-lifecycle-restore.md) — 前后台与任务恢复统一术语文档（glossary-android-lifecycle-restore）
- [glossary-app-lynx-feed-tabs-gateway.md](glossary-app-lynx-feed-tabs-gateway.md) — app-lynx Feed / Tab / 网关 — 术语表
- [glossary-app-lynx-global-search.md](glossary-app-lynx-global-search.md) — app-lynx 全局搜索 — 术语表
- [glossary-app-lynx-hit-testing.md](glossary-app-lynx-hit-testing.md) — app-lynx 命中测试与覆盖层统一术语表
- [glossary-app-lynx-native.md](glossary-app-lynx-native.md) — app-lynx 原生集成统一术语表
- [glossary-app-lynx-pinia.md](glossary-app-lynx-pinia.md) — app-lynx 状态管理 Pinia 迁移统一术语表
- [glossary-app-lynx-radial-nav-fab.md](glossary-app-lynx-radial-nav-fab.md) — app-lynx 放射导航统一术语表
- [glossary-app-lynx-rate-limit-backoff.md](glossary-app-lynx-rate-limit-backoff.md) — app-lynx 限流退避 — 术语表
- [glossary-auth-retry.md](glossary-auth-retry.md) — 认证重试与 Token 生命周期 — 术语表
- [glossary-bookmark-tags.md](glossary-bookmark-tags.md) — 收藏加标签统一术语表（illust bookmark with tags）
- [glossary-bottom-occlusion-allowance.md](glossary-bottom-occlusion-allowance.md) — 底部让位族术语表（安全区 vs 遮挡让位）
- [glossary-branded-types.md](glossary-branded-types.md) — Branded Types（名义类型 / 幽灵类型）—— 术语表
- [glossary-client-switch.md](glossary-client-switch.md) — 客户端切换（引擎切换）— 术语表
- [glossary-cross-engine.md](glossary-cross-engine.md) — 跨引擎统一术语文档（glossary-cross-engine）
- [glossary-dead-code-cleanup.md](glossary-dead-code-cleanup.md) — 死代码治理 — 术语表
- [glossary-dependency-upgrade.md](glossary-dependency-upgrade.md) — 依赖升级评估 — 术语表
- [glossary-detail-image-loading.md](glossary-detail-image-loading.md) — 详情页多图加载术语表
- [glossary-emulator-verification.md](glossary-emulator-verification.md) — 模拟器验证环境 — 术语表
- [glossary-exhaustiveness-checking.md](glossary-exhaustiveness-checking.md) — 编译期穷尽性检查（Exhaustiveness Checking）—— 术语表
- [glossary-feed-image-loading.md](glossary-feed-image-loading.md) — Feed 图片按需加载术语表
- [glossary-fluent-design-chapter-archive.md](glossary-fluent-design-chapter-archive.md) — Fluent Design 规范章 — 存档归档（逐条适用性判定）
- [glossary-image-save.md](glossary-image-save.md) — 作品图片保存（单图保存 / 多图选页 / 批量下载）— 术语表
- [glossary-lynx-accept-language.md](glossary-lynx-accept-language.md) — 术语表：lynx 标签翻译语言头（Accept-Language）
- [glossary-lynx-bili-theme.md](glossary-lynx-bili-theme.md) — app-lynx bili 主题 — 术语表
- [glossary-lynx-continue-reading.md](glossary-lynx-continue-reading.md) — Lynx 继续读术语表（继续读 · 阅读位置 · 会话末位置）
- [glossary-lynx-four-features.md](glossary-lynx-four-features.md) — Lynx 四功能统一术语表（稍后看 · 下载命名 · 好P友 · 公共组件层）
- [glossary-lynx-novel-intro-toggle.md](glossary-lynx-novel-intro-toggle.md) — Lynx 小说介绍页开关（intro-first toggle）— 术语表
- [glossary-lynx-units.md](glossary-lynx-units.md) — Lynx 单位与 web-core 换算机制 — 术语表
- [glossary-md3-alignment.md](glossary-md3-alignment.md) — Material Design 3 对标术语表
- [glossary-notification-center.md](glossary-notification-center.md) — 术语表：通知中心（Notification Center）
- [glossary-novel-export.md](glossary-novel-export.md) — 小说导出（TXT/HTML/MD/DOCX/PDF/EPUB + RTF/JSON/FB2）— 术语表
- [glossary-r8-reflection-shrink-crash.md](glossary-r8-reflection-shrink-crash.md) — R8 反射收缩启动崩溃 — 术语表
- [glossary-search-pagination.md](glossary-search-pagination.md) — 搜索与分页 — 术语表
- [glossary-series-sheet.md](glossary-series-sheet.md) — 系列弹出面板术语表
- [glossary-single-engine-facade.md](glossary-single-engine-facade.md) — 单引擎事实源与门面一致性 — 统一术语文档（glossary-single-engine-facade）
- [glossary-solidjs2-migration.md](glossary-solidjs2-migration.md) — Glossary: SolidJS 2.0 迁移统一术语
- [glossary-tag-mute.md](glossary-tag-mute.md) — 术语表：标签静音（Tag Mute）
- [glossary-toolchain-regression.md](glossary-toolchain-regression.md) — 术语表：工具链回归战役（ADR-0185 / ADR-0186）
- [glossary-top-inset-and-verification.md](glossary-top-inset-and-verification.md) — 顶部让位与验收判据术语表
- [glossary-ui-cards.md](glossary-ui-cards.md) — 卡片化设置页与个人中心术语表（Cardized UI Glossary）
- [glossary-update-check.md](glossary-update-check.md) — 检查更新（版本检查）— 术语表
- [glossary-virtual-scroll.md](glossary-virtual-scroll.md) — 虚拟滚动迁移术语表
- [glossary-vue-router-migration.md](glossary-vue-router-migration.md) — app-lynx 路由迁移统一术语表（vue-router memory history）
- [glossary-vue-tsc.md](glossary-vue-tsc.md) — app-lynx 集成 vue-tsc 统一术语表
- [glossary-web-core-pitfalls.md](glossary-web-core-pitfalls.md) — Web-core 预览已知缺陷与防护 — 术语表
- [glossary-webview-client-removal.md](glossary-webview-client-removal.md) — WebView 客户端源码删除 — 统一术语文档（glossary-webview-client-removal）

## 遗留编号（0001-0021）

- [0001-proguard-keep-strategy.md](0001-proguard-keep-strategy.md) — ADR-0001: ProGuard Keep Strategy — 精确注解 keep
- [0002-ssrf-url-whitelist-strategy.md](0002-ssrf-url-whitelist-strategy.md) — ADR-0002: SSRF 防护 — Java 层 Host 白名单 + CI 验证一致性
- [0003-backup-security-three-layer-defense.md](0003-backup-security-three-layer-defense.md) — ADR-0003: 备份安全 — 三层防护策略
- [0004-401-concurrent-retry-promise-queue.md](0004-401-concurrent-retry-promise-queue.md) — ADR-0004: 401 并发重试 — Promise 队列代替 boolean 标志
- [0005-remove-predictive-back.md](0005-remove-predictive-back.md) — ADR-0005: 移除 Android 预测性返回手势
- [0006-keep-virtualfeed-separate.md](0006-keep-virtualfeed-separate.md) — ADR 0006: VirtualFeed 与 NovelVirtualFeed 保持分离
- [0007-split-novel-detail.md](0007-split-novel-detail.md) — ADR 0007: 拆分 NovelDetail.tsx 为多个子组件
- [0008-series-sheet-item-tags.md](0008-series-sheet-item-tags.md) — ADR-0008: 系列弹出面板条目展示小说标签
- [0009-search-feature.md](0009-search-feature.md) — ADR 0009: Pixiv 标签搜索功能
- [0010-explicit-scroll-restoration.md](0010-explicit-scroll-restoration.md) — 0010. 滚动恢复必须显式执行，禁止依赖 Virtualizer initialOffset
- [0011-search-entry-into-navbar.md](0011-search-entry-into-navbar.md) — ADR 0011: 搜索入口迁移到 NavBar 中心钮
- [0012-scroll-driven-header-visibility.md](0012-scroll-driven-header-visibility.md) — 列表页 header 滚动驱动显隐与 @solid-primitives 分阶段采用
- [0013-scroll-primitives-unification.md](0013-scroll-primitives-unification.md) — 滚动驱动 UI 原语统一（Phase 2）：createScrolledPast 与 createScrollDirection
- [0014-l1-image-cache-key-set.md](0014-l1-image-cache-key-set.md) — ADR-0014: L1 图片缓存从 Blob LRU 退化为已加载标记集合
- [0015-measure-element-migration.md](0015-measure-element-migration.md) — ADR-0015：虚拟滚动卡片高度从预计算迁移到 DOM 实测
- [0016-tanstack-query-phase2-feed-novel-store.md](0016-tanstack-query-phase2-feed-novel-store.md) — ADR-0016: TanStack Query Phase 2 — feedStore 与 novelStore 迁移
- [0017-virtual-feed-unification.md](0017-virtual-feed-unification.md) — ADR-0017: VirtualFeed/NovelVirtualFeed 统一 — 集成 createFeedVirtualizer
- [0018-settings-split-into-sub-components.md](0018-settings-split-into-sub-components.md) — ADR-0018: 将 Settings 页面拆分为领域子组件
- [0019-extract-usecomments-primitive.md](0019-extract-usecomments-primitive.md) — ADR-0019: 提取 useComments 原语
- [0020-split-uistore-into-nav-and-settings.md](0020-split-uistore-into-nav-and-settings.md) — ADR-0020: 将 uiStore 拆分为导航 store 和设置 store
- [0021-novel-store-migrate-to-create-tq-feed-store-factory.md](0021-novel-store-migrate-to-create-tq-feed-store-factory.md) — ADR 0021: novelStore 迁移到 createTQFeedStore 工厂

## 其他

- [plan-virtual-scroll-migration.md](plan-virtual-scroll-migration.md) — 迁移实施计划：自建虚拟滚动 → TanStack Virtual
- [spikes/bottom-allowance-list-append.md](spikes/bottom-allowance-list-append.md) — Spike：原生 `<list>` 末尾追加 list-item 是否安全

## 被引最多的 ADR（Top 20，全文交叉引用计数）

| ADR | 被引次数 |
| --- | --- |
| ADR-0207 | 103 |
| ADR-0205 | 64 |
| ADR-0123 | 47 |
| ADR-0171 | 47 |
| ADR-0103 | 43 |
| ADR-0037 | 42 |
| ADR-0170 | 40 |
| ADR-0167 | 33 |
| ADR-0214 | 33 |
| ADR-0201 | 32 |
| ADR-0212 | 32 |
| ADR-0139 | 29 |
| ADR-0203 | 29 |
| ADR-0107 | 28 |
| ADR-0120 | 28 |
| ADR-0206 | 26 |
| ADR-0111 | 23 |
| ADR-0168 | 23 |
| ADR-0211 | 21 |
| ADR-0050 | 20 |

## 消费规则

- 读 ADR 前先按本索引对号入座；精确语义以 ADR 正文与源码为准。
- 与源码冲突时按 [docs/agents/domain.md](../agents/domain.md)「标记 ADR 冲突」的句式浮出，不静默覆盖。
- 新增 ADR 后重跑生成脚本；本索引的活性由 AGENTS.md「地图保鲜」自检条目兜底。
