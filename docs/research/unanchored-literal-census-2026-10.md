# 未锚定字面量普查（2026-10-18）

> 上一轮《约定层门禁 · 需求锚点审计》按**文件级**判定：156/158 有书面来源，裁撤方向不成立。
> 但审计发现文件内部混着无源断言。本轮把判据收紧到**字面量级**，回答一个问题：
> **哪些测试钉死了具体值，而仓内没有任何文档要求它是这个值？**
> 这类断言是重构误红的直接来源——代码合理重构后测试变红，但它当初挡住的不是任何需求。

## 方法

16 个只读 agent 并行，对 158 个测试文件逐一提取「钉死的字面量」（`expect(...).toContain/toBe/toMatch`
等断言中的具体字符串、数值、单位值、类名、文案），再到仓内文档查出处。

**出处仅限**：代码注释、被测源码注释、测试文件自身头注——**均不算出处**。
查不到即判「未锚定」。在此基础上再判「是否会因合理重构误红」。

## 总览

| 指标 | 值 |
| --- | --- |
| 钉死字面量总数（16 块合计） | **2,002** |
| 未锚定 | **806（40.3%）** |
| 会因合理重构误红 | **581（29.0%；占未锚定 72%）** |

> 逐文件表覆盖 153/158 个文件（1,940 / 786 / 567）；其余 5 份报告格式差异未能解析，
> 已按 agent 报告的块级合计计入总览，故总览值略高于逐文件表之和。

## 四类未锚定形态（按误红危害排序）

| 形态 | 典型例子 | 为何误红 |
| --- | --- | --- |
| **① 逐字钉源码行** | `expect(src).toContain('if (longPress.consumeLongPress()) return')` | 变量改名即红，语义等价 |
| **② 逐字钉 UI 文案** | `expect(zh['me.content.novelIntroFirstDesc']).toBe('关闭后，点击小说将直接进入正文')` | spec 只给 i18n 键名，文案零出处；改一次文案红一片 |
| **③ 无出处的计数/阈值** | `toBeGreaterThanOrEqual(10)`、`toBeCloseTo(31.34, 2)`、`SETS` 键序断言 | 随实现自然演进而漂移 |
| **④ warn 前缀与降级文案** | `toHaveBeenCalledWith('[settingsStore] WebDAV 自动备份周期非法，维持默认 7:')` | `conventions.md:138` 只要求「带模块前缀」，未规定整句 |

**规律**：文档几乎总是规定**行为**、很少规定**字符串**。唯一被三处文档逐字钉住的同类文案
（`当前环境不支持保存到相册`）恰好是**行为与文案一起写进 spec** 的。
⇒ 补文档时对这类字面量应连文案一起钉，而不是事后补。

## 「反向锁」候选：测试锁的值与文档相抵触 —— 逐条复核

> ⚠️ **本节 8 条候选中有 2 条被推翻、1 条被改判**。agent 报告的冲突结论噪声约一半，
> 下列复核状态由主 agent 独立 grep 确认，**未标注「✅已复核」的一律不得直接采信**。
>
> **✅ 已处置（2026-10-18 当日）**：下表 #1 / #2 / #3 三条已复核为真的文档漂移**当场修完**，
> 本节保留原样作为审计留痕。#4 属 ADR 未回写后续决策、#7 / #8 未复核，均留待后续处理。

| # | 候选冲突 | 复核状态 |
| --- | --- | --- |
| 1 | `backupCore.test.ts` 钉 `sets` 键名 `{ blocked_user_ids, reported_ids }`，而 `docs/specs/webdav-backup.md:52` 写的是 `{"blocked_users", "report_records"}` | ✅ **已复核为真，但方向相反**：`blocked_user_ids/reported_ids` 在 **src 2 文件 + tests 2 文件**命中、spec **零命中**；`blocked_users/report_records` 只在 spec 命中。⇒ **spec 是孤例（陈旧）**，实现与测试自洽且有真实抓包支撑。处置：修 spec，不是修测试 |
| 2 | `watchLaterStore.test.ts` 钉 warn 前缀 `[watchLaterStore]`，`ADR-0191:31` 写 `[watchLater]` | ✅ **已复核为真**：src 两处均用 `[watchLaterStore]`，ADR 是孤例。⇒ **ADR 陈旧**，测试与实现一致。处置：回写 ADR |
| 3 | `docs/research/lynx-text-selection-device-probe.md` 被 5 个文件引为 oracle，但**该文件不存在** | ✅ **已复核为真**（`ls` 确认不存在；引用者含 `createTextSelection.test.ts` / `lynxSelectionEngine.test.ts` / `measureTextRect.test.ts` / `selectionToolbarGeometry.ts` 等）。⇒ 溯源断链，须改指到真实出处（`ADR-0165:13`）或补建该文档 |
| 4 | `SearchSheet.test.ts:110` 钉 `z-40`，而 `ADR-0132:16` 明写搜索弹层「DOM 顺序后置覆盖（**不依赖 z-index**）」 | ⚠️ **改判**：ADR 确实这么写，但 `SearchSheet.vue:492` 有源码留痕「z-40 vs GlobalFab 同层时 DOM 后序胜出」，实现有意保留且测试与实现一致。⇒ 不是测试问题，是 **ADR 未回写后续决策** |
| 5 | `m3-switch-migration-gate.test.ts:42` 断言 `Me.vue ≥10`，而 ADR-0179:84 与 spec:228 都写 `≥6`，「测试比文档更严」 | ❌ **推翻**：`app-lynx-m3-switch.md:41/:163/:190` 三处均要求 `Me.vue + SettingsEndpoint.vue` **合计 ≥12**，测试拆成 `10 + 2 = 12`，与文档完全一致。agent 结论错误 |
| 6 | `TagNeighbors.template.test.ts` 钉 `rounded-[var(--md-shape-full)]`，照 AGENTS.md「新代码用档位名」整改反而顶红 | ❌ **推翻**：AGENTS.md 原文是「存量 `rounded-[var(--md-shape-*)]` 是**只读**写法，**不必迁移**」；且全仓有 **108 处** `shape-full`、91 处 `medium` 属主流写法。测试锁存量写法不违反任何规则 |
| 7 | `adaptiveTagFit.test.ts` 钉 `31.34` 而 `ADR-0149:24/:60` 记 `31.33`，按文档订正反而转红 | ❌ **推翻**（2026-10-18 复核）：不是冲突，是两个不同来源的数——ADR 记的是**真机测量值**，测试断言的是**合成 fixture 的计算值**，两者各自成立。`toBeCloseTo(31.34, 2)` 精度 0.005，31.33 确实会红，但那说明 fixture 算得对，不说明文档错 |
| 8 | `ugoiraFramesTask.test.ts` 钉 `ugoira_123_apng`，而 `download-manager.md:34` 规定 id 为 `<illustId>_<kind>_<page\|fmt>_<seq>`（段序相反且有 seq） | ⚠️ **确认为真，但需人工裁定**（2026-10-18 复核）：`src/utils/galleryDownload.ts:412` 实现确为 `` `ugoira_${illust.id}_${format}` ``，spec 的模板多一个 `<seq>` 且段序不同。**唯一性在实现下仍成立**（同一作品+同一格式只导一次），故不影响正确性；但 spec 描述了一套代码未实现的 id 方案。改哪边都会动下载队列身份，**不得由审计单方面改动** |

### 补留档（**非「反向锁」候选**，不计入本节 8 条）：跨引擎恢复时 lynx 静默丢弃 `sets` —— 该 warn 吗？

> **该 warn 吗？——裁定：要 warn，但只在真丢数据时 warn**（issue #1059，2026-10-23 拍板）。
> 本问句此前**未留档**（同批的 ② 号条目已留档），由 #1059 补上：
>
> - **问题**：跨引擎恢复时 lynx 静默丢弃 `sets`（屏蔽用户 / 举报记录）——该 warn 吗？
> - **裁定（条件告警）**：仅当恢复计划的 `sets` 里**至少有一个非空数组**时，输出**一条**带
>   模块前缀的 `console.warn`（前缀 `[backupWiring]`，附被丢弃的键名与条数）；
>   `sets` 为 `{}` 或数组全空则**不告警**（本客户端自产备份恒为空 ⇒ 零噪声）；
>   只落日志，**不做用户可见提示**（恢复摘要页与 i18n 不变）。
> - **书面依据**：`docs/specs/webdav-backup.md` §3.2「丢弃必须可见」（spec 已落档）+ issue #1059
>   ——裁定不留在 issue 评论里。
> - **留档性质**：本块只是该审计问句的处置指针，**不改**上方「反向锁」表的条目数与编号。

## 计数「自相矛盾」复核结论（2026-10-18）

曾报 `tests/md3ConfigTokens.test.ts` 三处下界互相打架（`:460 ≥60` / `:1196 ==59` / `:1167 ==46`）。
**复核后不成立**——三者量纲不同，不是同一个数：

| 位置 | 实际含义 |
| --- | --- |
| `:1167 == 46` | `MD3_COLOR_ROLES` 全集长度（46 个色角色） |
| `:1186 == 36` | `MD3_NON_COLOR_ROLES` 全集长度（36 个非色角色） |
| `:1196 == 59` | `PER_BLOCK_ROLE_COUNT_LOWER_BOUND` 常量声明值 |
| `:460 ≥ 60` | 对**每块色板实际抽到的角色数**的下界断言 |

唯一残留的小瑕疵：`PER_BLOCK_ROLE_COUNT_LOWER_BOUND` 命名为 LOWER_BOUND 却取 59，而同文件断言要求
`≥60`，两者差 1。不构成矛盾（一个是命名常量、一个是断言阈值），但属于该清理的命名噪音。

## 正面对照组：证明「零误红」是可做到的

这些文件未锚定字面量为 0，可作为其余文件的整改模板：

| 文件 | 为什么做到了 |
| --- | --- |
| `tests/downloadManagerTemplate.test.ts` | 注册表驱动 + 无硬编码计数 + 文案取自 spec（`'删除文件与记录'` 在 `download-manager.md:78/79` 逐字可查） |
| `tests/watchlistPrompt.test.ts` | `app-lynx-novel-series-watchlist.md:193` 连「阈值边界 69%/70%、dwell 9s/10s」的测试要求都逐条点名 |
| `tests/m3-segmented-button-migration-gate.test.ts` | 8 条断言字面量全部能在 spec §5.5 找到逐字出处 |
| `tests/contract/clipboardBridgeContract.test.ts` | 8/8 锚定，`app-lynx-novel-text-selection.md:74` 把 Java 侧形态逐条写死 |
| `tests/md3FilledTextField.test.ts` / `md3TailwindArtifact.test.ts` | 判据直接取自 ADR 表格，未引入自造数值 |

## 口径分歧（影响数字，须统一后重算）

各 agent 对以下三点的口径不一致，是各块数字差异大的主要原因：

1. **`docs/research/**` 算不算出处**——多数 agent 判「不算（是审计产物/回归报告，非需求源）」，
   少数判「算（仓内真实书面文档）」。若改判为有效，未锚定数下降约 15-20%。
2. **「概念锚定」vs「字面锚定」**——文档写了同一件事的另一种措辞时，是否算锚定。
   多数 agent 从严（判未锚定），会使计数偏高，但方向符合本轮目的。
3. **fixture / 探针常量是否计入**——测试内部自造的合成值一律不计。

## 建议（按可执行性排序）

1. **先修三处已复核的文档漂移**（#1 spec 备份键名、#2 ADR-0191 warn 前缀、#3 device-probe 断链）。
   这是纯文档修补，零风险，且能让 3 条「假冲突」消失。
2. **不要按「未锚定字面量数」批量删断言**。581 个误红项里绝大多数锚的是**实现形态**
   （逐字源码行、i18n 键名、类串），不是用户可感知的规则；删它们等于放弃跨端契约与接线防线。
3. **真正的整改动作是「补源」**：按上面总结的规律——文档规定行为时**连文案/数值一起钉**。
   优先补形态①③（纯实现形态），形态②（文案）可改为从 locale 字典读取而非硬编码期望值。
4. **给 agent 结论加复核步骤**。本轮 8 条「冲突」候选里 3 条不成立，
   说明 agent 报的「文档冲突」必须主 agent 独立 grep 确认后才能写进结论。

## 逐文件明细

| 文件 | 行数 | 考察字面量 | 未锚定 | 会重构误红 |
| --- | --- | --- | --- | --- |
| `src/components/BookmarkPanel.template.test.ts` | 214 | 34 | 30 | 30 |
| `src/components/BottomSheet.template.test.ts` | 181 | 24 | 20 | 20 |
| `tests/md3ConfigTokens.test.ts` | 1371 | 45 | 27 | 20 |
| `src/pages/myPixivPage.template.test.ts` | 173 | 26 | 17 | 17 |
| `tests/unit.test.ts` | 2487 | 40 | 21 | 15 |
| `tests/unit/utils/appearanceClasses.test.ts` | 422 | 32 | 17 | 15 |
| `src/pages/TagNeighbors.template.test.ts` | 274 | 20 | 15 | 14 |
| `tests/contract/webdavBackupFormatContract.test.ts` | 215 | 55 | 20 | 14 |
| `tests/contract/webdavBridgeJavaContract.test.ts` | 178 | 40 | 19 | 13 |
| `src/pages/PlatformCheck.template.test.ts` | 100 | 14 | 12 | 12 |
| `src/stores/settingsStore.test.ts` | 2495 | 40 | 26 | 12 |
| `src/pages/meDownloadNaming.template.test.ts` | 91 | 14 | 11 | 11 |
| `tests/captureScriptInvariants.test.ts` | 1086 | 45 | 22 | 11 |
| `tests/tagMuteTemplate.test.ts` | 229 | 20 | 13 | 11 |
| `src/components/motionDurationTokens.template.test.ts` | 934 | 34 | 13 | 10 |
| `tests/fabOcclusionBand.test.ts` | 553 | 20 | 10 | 10 |
| `tests/md3GuardScans.test.ts` | 1989 | 33 | 12 | 10 |
| `src/components/AdaptiveTagRow.template.test.ts` | 66 | 14 | 9 | 9 |
| `src/components/SearchSheet.test.ts` | 622 | 43 | 12 | 9 |
| `src/pages/Ranking.template.test.ts` | 78 | 12 | 9 | 9 |
| `src/stores/relatedInjection.test.ts` | 346 | 10 | 10 | 9 |
| `src/stores/tagNeighbor.test.ts` | 609 | 14 | 11 | 9 |
| `src/utils/darkModeJavaContract.test.ts` | 522 | 30 | 12 | 9 |
| `src/stores/browsingHistoryWiring.template.test.ts` | 187 | 10 | 8 | 8 |
| `src/stores/deliveryProbeContract.test.ts` | 672 | 16 | 11 | 8 |
| `src/pages/IllustList.template.test.ts` | 69 | 10 | 7 | 7 |
| `src/primitives/createTextSelection.test.ts` | 494 | 16 | 7 | 7 |
| `tests/motionContract.test.ts` | 606 | 20 | 9 | 7 |
| `src/composables/useBookmarkPanel.test.ts` | 402 | 16 | 8 | 6 |
| `src/pages/IllustDetail.template.test.ts` | 136 | 9 | 7 | 6 |
| `src/stores/continueReadingWiring.template.test.ts` | 259 | 15 | 9 | 6 |
| `tests/contract/webdavSettingsBaseline.test.ts` | 89 | 13 | 6 | 6 |
| `tests/meNovelIntroTemplate.test.ts` | 59 | 11 | 6 | 6 |
| `tests/unit/api/translateFrameChannel.test.ts` | 746 | 14 | 7 | 6 |
| `tests/unit/i18n/novelTranslate.test.ts` | 199 | 7 | 7 | 6 |
| `src/components/ActionButton.template.test.ts` | 208 | 16 | 5 | 5 |
| `src/components/NovelExportSheet.template.test.ts` | 93 | 10 | 5 | 5 |
| `src/components/SeriesSheet.template.test.ts` | 337 | 28 | 6 | 5 |
| `src/composables/useReducedMotion.test.ts` | 622 | 28 | 10 | 5 |
| `src/pages/advancedImageCacheTemplate.test.ts` | 102 | 7 | 5 | 5 |
| `src/primitives/truncateForSearch.test.ts` | 34 | 6 | 5 | 5 |
| `src/utils/backupCore.test.ts` | 224 | 14 | 6 | 5 |
| `tests/agentsMdMd3Baseline.test.ts` | 420 | 30 | 8 | 5 |
| `tests/mojibakeGuard.test.ts` | 520 | 12 | 7 | 5 |
| `src/components/IllustTypeBadgeRow.template.test.ts` | 194 | 14 | 5 | 4 |
| `src/components/TextSelectionToolbar.template.test.ts` | 83 | 18 | 9 | 4 |
| `src/primitives/createMixFeed.test.ts` | 1112 | 22 | 6 | 4 |
| `src/primitives/selectionToolbarGeometry.test.ts` | 51 | 12 | 5 | 4 |
| `src/primitives/useSearch.test.ts` | 1008 | 11 | 6 | 4 |
| `src/utils/bookmarkTags.test.ts` | 108 | 5 | 4 | 4 |
| `src/utils/downloadManager.test.ts` | 302 | 13 | 5 | 4 |
| `src/utils/downloadsViewModel.test.ts` | 182 | 9 | 4 | 4 |
| `src/utils/safeArea.test.ts` | 190 | 8 | 4 | 4 |
| `tests/bottomOcclusionAllowance.test.ts` | 669 | 28 | 6 | 4 |
| `tests/hardcodeColorGate.test.ts` | 191 | 7 | 4 | 4 |
| `tests/meNotificationsTemplate.test.ts` | 55 | 10 | 4 | 4 |
| `tests/typographyFontWeight.test.ts` | 305 | 12 | 4 | 4 |
| `src/api/client.test.ts` | 1024 | 9 | 3 | 3 |
| `src/components/CarouselSwiper.test.ts` | 294 | 10 | 3 | 3 |
| `src/components/RankingEntryCard.template.test.ts` | 70 | 8 | 3 | 3 |
| `src/pages/recommendedBleedHeader.template.test.ts` | 176 | 12 | 3 | 3 |
| `src/primitives/collectTagNeighbors.test.ts` | 507 | 18 | 4 | 3 |
| `src/primitives/watchlistFeed.test.ts` | 322 | 6 | 4 | 3 |
| `src/stores/browsingHistoryStore.test.ts` | 361 | 8 | 4 | 3 |
| `src/stores/continueReadingStore.test.ts` | 320 | 5 | 3 | 3 |
| `src/utils/darkMode.test.ts` | 433 | 14 | 3 | 3 |
| `src/utils/safeAreaJavaContract.test.ts` | 201 | 19 | 3 | 3 |
| `tests/recommendedNovelBookmark.test.ts` | 59 | 12 | 3 | 3 |
| `tests/unit/stores/novelTranslateStore.test.ts` | 1754 | 22 | 4 | 3 |
| `tests/unit/utils/filesystemTranslationCache.test.ts` | 330 | 14 | 6 | 3 |
| `src/composables/useLongPress.test.ts` | 116 | 8 | 2 | 2 |
| `src/pages/novelDetailSelection.template.test.ts` | 52 | 8 | 2 | 2 |
| `src/primitives/createWatchlistPrompt.test.ts` | 411 | 9 | 2 | 2 |
| `src/stores/watchLaterStore.test.ts` | 336 | 5 | 2 | 2 |
| `src/utils/backupService.test.ts` | 336 | 12 | 2 | 2 |
| `src/utils/lynxClipboard.test.ts` | 60 | 5 | 2 | 2 |
| `src/utils/lynxSelectionEngine.test.ts` | 107 | 6 | 2 | 2 |
| `src/utils/downloadQueueCore.test.ts` | 451 | 16 | 4 | 2 |
| `tests/adrClaimConsistency.test.ts` | 306 | 10 | 3 | 2 |
| `tests/contract/i18nLanguageKeyContract.test.ts` | 133 | 9 | 3 | 2 |
| `tests/mdTokenRefs.test.ts` | 57 | 3 | 2 | 2 |
| `tests/unit/api/translate.test.ts` | 729 | 20 | 3 | 2 |
| `src/components/BookmarkButton.host-matrix.test.ts` | 780 | 13 | 1 | 1 |
| `src/api/search.test.ts` | 509 | 12 | 1 | 1 |
| `src/components/M3SegmentedButton.template.test.ts` | 194 | 16 | 1 | 1 |
| `src/components/PagePickerSheet.test.ts` | 185 | 10 | 1 | 1 |
| `src/composables/useTextSelection.test.ts` | 48 | 5 | 4 | 1 |
| `src/pages/Notifications.iconProxyContract.test.ts` | 253 | 16 | 5 | 1 |
| `src/primitives/createBookmarkToggle.test.ts` | 115 | 8 | 1 | 1 |
| `src/primitives/measureRects.test.ts` | 98 | 8 | 2 | 1 |
| `src/primitives/measureTextRect.test.ts` | 77 | 8 | 3 | 1 |
| `src/services/backupWiring.test.ts` | 267 | 9 | 2 | 1 |
| `src/stores/browsingHistoryStore.pure.test.ts` | 109 | 5 | 3 | 1 |
| `src/utils/adaptiveTagFit.test.ts` | 73 | 12 | 6 | 1 |
| `src/utils/buildImageTasks.test.ts` | 140 | 10 | 1 | 1 |
| `src/utils/buildUgoiraTask.test.ts` | 93 | 8 | 2 | 1 |
| `src/utils/galleryDownload.test.ts` | 507 | 15 | 1 | 1 |
| `src/utils/gallerySaver.test.ts` | 115 | 6 | 1 | 1 |
| `src/utils/lynxShare.test.ts` | 29 | 3 | 2 | 1 |
| `src/utils/safeParseUrl.test.ts` | 143 | 8 | 4 | 1 |
| `src/utils/ugoiraFramesTask.test.ts` | 69 | 5 | 2 | 1 |
| `src/utils/viewportGeometry.test.ts` | 77 | 6 | 2 | 1 |
| `src/utils/webdavCredentials.test.ts` | 108 | 4 | 1 | 1 |
| `tests/contract/novelExportSettingsBaseline.test.ts` | 64 | 9 | 1 | 1 |
| `tests/immersiveScrimContrast.acceptance.test.ts` | 392 | 14 | 4 | 1 |
| `tests/m3-switch-migration-gate.test.ts` | 65 | 4 | 1 | 1 |
| `tests/novelIntroEntryGuards.test.ts` | 71 | 8 | 1 | 1 |
| `tests/topInsetMetrics.test.ts` | 210 | 10 | 5 | 1 |
| `tests/unit/primitives/createNovelTranslator.test.ts` | 693 | 9 | 4 | 1 |
| `tests/unit/utils/translationCache.test.ts` | 505 | 18 | 4 | 1 |
| `tests/unit/utils/translationCacheFilesystemBranch.test.ts` | 83 | 6 | 3 | 1 |
| `src/api/rateLimitBackoff.test.ts` | 310 | 8 | 0 | 0 |
| `src/api/notification.test.ts` | 133 | 8 | 0 | 0 |
| `src/api/illust.test.ts` | 156 | 7 | 0 | 0 |
| `src/api/illustRelated.test.ts` | 42 | 3 | 0 | 0 |
| `src/api/ranking.test.ts` | 50 | 4 | 0 | 0 |
| `src/components/M3Switch.template.test.ts` | 152 | 18 | 0 | 0 |
| `src/components/illustTypeBadges.test.ts` | 36 | 8 | 0 | 0 |
| `src/composables/useBookmarkMutation.test.ts` | 373 | 16 | 1 | 0 |
| `src/pages/downloadManagerTemplate.test.ts` | 41 | 4 | 0 | 0 |
| `src/primitives/createRankingFeed.test.ts` | 141 | 7 | 1 | 0 |
| `src/primitives/novelContentFitsViewport.test.ts` | 221 | 10 | 6 | 0 |
| `src/primitives/rankingNotice.test.ts` | 46 | 7 | 7 | 0 |
| `src/primitives/rankingEntryState.test.ts` | 25 | 5 | 5 | 0 |
| `src/primitives/rankingRows.test.ts` | 58 | 8 | 1 | 0 |
| `src/primitives/novelNavigationTarget.test.ts` | 26 | 4 | 0 | 0 |
| `src/primitives/rankingDate.test.ts` | 18 | 3 | 3 | 0 |
| `src/primitives/createWatchlistToggle.test.ts` | 83 | 5 | 1 | 0 |
| `src/primitives/watchlistPrompt.test.ts` | 142 | 4 | 1 | 0 |
| `src/stores/continueReadingStore.pure.test.ts` | 62 | 3 | 1 | 0 |
| `src/stores/searchSheetStore.test.ts` | 139 | 1 | 1 | 0 |
| `src/stores/searchHistoryStore.test.ts` | 184 | 3 | 0 | 0 |
| `src/stores/modalStack.test.ts` | 120 | 5 | 0 | 0 |
| `src/stores/watchlistStore.test.ts` | 109 | 0 | 0 | 0 |
| `src/utils/clipboardBridgeContract.test.ts` | 64 | 8 | 0 | 0 |
| `src/utils/galleryBridgeContract.test.ts` | 155 | 8 | 1 | 0 |
| `src/utils/lynxDownloadExecutor.test.ts` | 169 | 4 | 1 | 0 |
| `src/utils/firstLoadView.test.ts` | 99 | 2 | 0 | 0 |
| `src/utils/novelDownloadStatus.test.ts` | 101 | 5 | 0 | 0 |
| `src/utils/tagChips.test.ts` | 101 | 5 | 0 | 0 |
| `src/utils/viewportSizeBridge.test.ts` | 68 | 6 | 0 | 0 |
| `tests/contract/illustTypeBadgeTruthTable.test.ts` | 16 | 0 | 0 | 0 |
| `tests/contract/aiFilterModeSettingsBaseline.test.ts` | 78 | 7 | 0 | 0 |
| `tests/hardcode-gate.test.ts` | 144 | 2 | 2 | 0 |
| `tests/helpers/walkProductionVue.test.ts` | 67 | 1 | 1 | 0 |
| `tests/homeBleedHeaderFlag.test.ts` | 156 | 4 | 1 | 0 |
| `tests/m3-segmented-button-migration-gate.test.ts` | 88 | 8 | 0 | 0 |
| `tests/md3FilledTextField.test.ts` | 455 | 13 | 2 | 0 |
| `tests/md3TailwindArtifact.test.ts` | 290 | 14 | 2 | 0 |
| `tests/novelRecommendedApi.test.ts` | 66 | 7 | 0 | 0 |
| `tests/statusBarContrast.test.ts` | 354 | 22 | 9 | 0 |
| `tests/unit/composables/useTagMuteVisible.test.ts` | 83 | 6 | 4 | 0 |
| `tests/unit/utils/utf8.test.ts` | 52 | 8 | 8 | 0 |

---

*普查由 16 个只读 agent 并行执行；原始分块产出在 `/tmp/gate-audit/lit-chunk-*.md`（临时目录，不入仓）。「反向锁」一节的复核状态由主 agent 独立 grep 确认，与 agent 原始报告可能不一致，以本文为准。*
