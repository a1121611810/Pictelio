# 门禁索引：改什么 → 要看哪几个门禁（2026-10-18）

> 起因：维护者反馈测试门禁「过于复杂、笨重」。前两轮盘点（[文件级锚点审计](./gate-requirement-anchor-audit-2026-10.md)、[字面量级普查](./unanchored-literal-census-2026-10.md)）证明**门禁本身大多有效、不能删**，真正的问题是**改一处代码时不知道该看哪些测试**。本文是那张查找表。

标记说明：`A/B/C` = 锚点档次（见锚点审计）；`误红N` = 字面量普查判定的「因合理重构会误红」条目数，**数字越高越可能在你不改需求时被拦**。

> ⚠️ **保鲜注（2026-10-23）**：本表是 **2026-10-18 盘点快照**——每行的「门禁数 / 档次·误红数」
> 取自那两次盘点（[锚点审计](./gate-requirement-anchor-audit-2026-10.md)、
> [字面量普查](./unanchored-literal-census-2026-10.md)）。**未参与那两次盘点的门禁没有档位可填**
> （不编造数据），故它们**不在本表内**。此后新增的门禁（2026-10-23 一轮 issue 收口）列在下方；
> 改到对应被测对象时请**一并看**它们。下次做盘点时把这几道并入「一、按被测对象索引」即可。
>
> | 表外新增门禁 | 被测对象 | 来源票 |
> | --- | --- | --- |
> | `tests/meThemeColorOptions.test.ts` | `src/pages/Me.vue` | #776 主题色块清单收敛 |
> | `tests/dialogThemeFlipContract.test.ts` | `src/App.vue` + `src/components/SearchSheet.vue` | #1018 常驻弹层跨明暗翻转 |
> | `tests/novelIntroNarrowViewport.test.ts` | `src/pages/NovelIntro.vue` + `src/components/AppIcon.vue` | #756 极窄屏降级矩阵 |
> | `tests/unit/stores/novelTranslateStoreCancelWindow.test.ts` | `src/stores/novelTranslateStore.ts` | #760 翻译 store 取消窗口竞态 |
> | `tests/unit/api/nativeTranslate.test.ts`（内容策略分类组） | `src/api/contentPolicy.ts`（**判据本体**）+ `src/api/nativeTranslate.ts` | #1063 服务端内容策略拦截归因 |
> | `tests/unit/api/translate.test.ts`（内容策略分类组） | `src/api/contentPolicy.ts`（**判据本体**）+ `src/api/translate.ts` | #1063 服务端内容策略拦截归因 |

## 用法

1. 改了 `src/` 下的文件 → 在「一」里查该路径，只读它列出的门禁
2. 改了 `src/` 下**任何**文件 → 还要留意「二」（全仓扫描型，与你改哪个文件无关也会红）
3. 命中「三」→ 改 `src/` 业务代码不受它们影响，**不必读**（但改动它们自己的被测对象时要看，见该节说明）

## 一、按被测对象索引（点对点）

共 138 个被测对象有专属门禁，按门禁数降序。
「改这个文件 → 只看这几个测试」就是查这张表。

| 被测对象 | 门禁数 | 门禁（档次·误红数） |
| --- | --- | --- |
| `src/pages/Me.vue` | 8 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/hardcodeColorGate.test.ts`（B档·误红4） · `tests/m3-segmented-button-migration-gate.test.ts`（B档） · `tests/m3-switch-migration-gate.test.ts`（B档·误红1） · `tests/md3FilledTextField.test.ts`（B档） · `tests/typographyFontWeight.test.ts`（B档·误红4） · `tests/unit.test.ts`（A档·误红15） · `tests/unit/utils/appearanceClasses.test.ts`（B档·误红15） |
| `src/App.vue` | 7 | `src/components/motionDurationTokens.template.test.ts`（B档·误红10） · `src/composables/useReducedMotion.test.ts`（A档·误红5） · `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/hardcodeColorGate.test.ts`（B档·误红4） · `tests/md3GuardScans.test.ts`（B档·误红10） · `tests/unit.test.ts`（A档·误红15） · `tests/unit/utils/appearanceClasses.test.ts`（B档·误红15） |
| `src/stores/settingsStore.ts` | 5 | `src/stores/settingsStore.test.ts`（A档·误红12） · `tests/contract/aiFilterModeSettingsBaseline.test.ts`（A档） · `tests/contract/i18nLanguageKeyContract.test.ts`（A档·误红2） · `tests/contract/novelExportSettingsBaseline.test.ts`（A档·误红1） · `tests/contract/webdavSettingsBaseline.test.ts`（A档·误红6） |
| `src/components/GlobalFab.vue` | 4 | `src/components/motionDurationTokens.template.test.ts`（B档·误红10） · `src/composables/useReducedMotion.test.ts`（A档·误红5） · `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/md3GuardScans.test.ts`（B档·误红10） |
| `src/pages/IllustDetail.vue` | 4 | `src/composables/useReducedMotion.test.ts`（A档·误红5） · `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/fabOcclusionBand.test.ts`（B档·误红10） · `tests/typographyFontWeight.test.ts`（B档·误红4） |
| `src/pages/UserHome.vue` | 4 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/md3GuardScans.test.ts`（B档·误红10） · `tests/novelIntroEntryGuards.test.ts`（B档·误红1） · `tests/typographyFontWeight.test.ts`（B档·误红4） |
| `src/pages/Watchlist.vue` | 4 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/fabOcclusionBand.test.ts`（B档·误红10） · `tests/md3GuardScans.test.ts`（B档·误红10） · `tests/novelIntroEntryGuards.test.ts`（B档·误红1） |
| `src/components/BookmarkButton.vue` | 3 | `src/components/BookmarkButton.host-matrix.test.ts`（A档·误红1） · `src/components/motionDurationTokens.template.test.ts`（B档·误红10） · `src/composables/useReducedMotion.test.ts`（A档·误红5） |
| `src/components/GlassCard.vue` | 3 | `src/components/motionDurationTokens.template.test.ts`（B档·误红10） · `src/composables/useReducedMotion.test.ts`（A档·误红5） · `tests/md3GuardScans.test.ts`（B档·误红10） |
| `src/components/M3Switch.vue` | 3 | `src/components/motionDurationTokens.template.test.ts`（B档·误红10） · `src/composables/useReducedMotion.test.ts`（A档·误红5） · `tests/m3-switch-migration-gate.test.ts`（B档·误红1） |
| `src/components/RefreshableList.vue` | 3 | `src/components/motionDurationTokens.template.test.ts`（B档·误红10） · `src/composables/useReducedMotion.test.ts`（A档·误红5） · `tests/md3GuardScans.test.ts`（B档·误红10） |
| `src/components/SearchSheet.vue` | 3 | `src/components/SearchSheet.test.ts`（A档·误红9） · `tests/md3FilledTextField.test.ts`（B档） · `tests/novelIntroEntryGuards.test.ts`（B档·误红1） |
| `src/pages/Bookmarks.vue` | 3 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/md3GuardScans.test.ts`（B档·误红10） · `tests/novelIntroEntryGuards.test.ts`（B档·误红1） |
| `src/pages/DownloadManager.vue` | 3 | `src/pages/downloadManagerTemplate.test.ts`（A档） · `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/md3FilledTextField.test.ts`（B档） |
| `src/pages/NovelDetail.vue` | 3 | `src/pages/novelDetailSelection.template.test.ts`（A档·误红2） · `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/typographyFontWeight.test.ts`（B档·误红4） |
| `src/pages/NovelList.vue` | 3 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/md3GuardScans.test.ts`（B档·误红10） · `tests/novelIntroEntryGuards.test.ts`（B档·误红1） |
| `src/pages/Recommended.vue` | 3 | `src/composables/useReducedMotion.test.ts`（A档·误红5） · `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/novelIntroEntryGuards.test.ts`（B档·误红1） |
| `src/router.ts` | 3 | `tests/agentsMdMd3Baseline.test.ts`（B档·误红5） · `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/novelIntroEntryGuards.test.ts`（B档·误红1） |
| `src/utils/backupCore.ts` | 3 | `src/utils/backupCore.test.ts`（A档·误红5） · `tests/contract/aiFilterModeSettingsBaseline.test.ts`（A档） · `tests/contract/webdavBackupFormatContract.test.ts`（A档·误红14） |
| `src/components/ActionButton.vue` | 2 | `src/components/ActionButton.template.test.ts`（A档·误红5） · `tests/md3GuardScans.test.ts`（B档·误红10） |
| `src/components/AppIcon.vue` | 2 | `src/components/BookmarkButton.host-matrix.test.ts`（A档·误红1） · `tests/md3GuardScans.test.ts`（B档·误红10） |
| `src/components/M3SegmentedButton.vue` | 2 | `tests/m3-segmented-button-migration-gate.test.ts`（B档） · `tests/unit/utils/appearanceClasses.test.ts`（B档·误红15） |
| `src/components/PagePickerSheet.vue` | 2 | `src/components/PagePickerSheet.test.ts`（B档·误红1） · `tests/md3GuardScans.test.ts`（B档·误红10） |
| `src/components/SettingsEndpoint.vue` | 2 | `tests/m3-switch-migration-gate.test.ts`（B档·误红1） · `tests/md3FilledTextField.test.ts`（B档） |
| `src/components/UserRow.vue` | 2 | `tests/fabOcclusionBand.test.ts`（B档·误红10） · `tests/md3GuardScans.test.ts`（B档·误红10） |
| `src/composables/motion.ts` | 2 | `src/composables/useReducedMotion.test.ts`（A档·误红5） · `tests/motionContract.test.ts`（B档·误红7） |
| `src/composables/useReducedMotion.ts` | 2 | `src/composables/useReducedMotion.test.ts`（A档·误红5） · `tests/motionContract.test.ts`（B档·误红7） |
| `src/composables/useSheetDismiss.ts` | 2 | `src/composables/useReducedMotion.test.ts`（A档·误红5） · `tests/motionContract.test.ts`（B档·误红7） |
| `src/pages/FollowList.vue` | 2 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/md3GuardScans.test.ts`（B档·误红10） |
| `src/pages/IllustList.vue` | 2 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/md3GuardScans.test.ts`（B档·误红10） |
| `src/pages/Login.vue` | 2 | `tests/md3FilledTextField.test.ts`（B档） · `tests/typographyFontWeight.test.ts`（B档·误红4） |
| `src/pages/MuteTags.vue` | 2 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/fabOcclusionBand.test.ts`（B档·误红10） |
| `src/pages/MyPixiv.vue` | 2 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/md3GuardScans.test.ts`（B档·误红10） |
| `src/pages/Notifications.vue` | 2 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/md3GuardScans.test.ts`（B档·误红10） |
| `src/pages/Ranking.vue` | 2 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/md3GuardScans.test.ts`（B档·误红10） |
| `src/pages/Shelf.vue` | 2 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/novelIntroEntryGuards.test.ts`（B档·误红1） |
| `src/pages/TagNeighbors.vue` | 2 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/md3GuardScans.test.ts`（B档·误红10） |
| `src/pages/WatchLater.vue` | 2 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/fabOcclusionBand.test.ts`（B档·误红10） |
| `src/services/backupWiring.ts` | 2 | `src/services/backupWiring.test.ts`（A档·误红1） · `tests/contract/novelExportSettingsBaseline.test.ts`（A档·误红1） |
| `src/utils/appearanceClasses.ts` | 2 | `tests/hardcodeColorGate.test.ts`（B档·误红4） · `tests/unit/utils/appearanceClasses.test.ts`（B档·误红15） |
| `src/utils/backupService.ts` | 2 | `src/utils/backupService.test.ts`（A档·误红2） · `tests/contract/webdavBackupFormatContract.test.ts`（A档·误红14） |
| `src/utils/fabGeometry.ts` | 2 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/fabGeometry.test.ts`（B档） |
| `src/utils/webdavCredentials.ts` | 2 | `src/utils/webdavCredentials.test.ts`（B档·误红1） · `tests/contract/webdavSettingsBaseline.test.ts`（A档·误红6） |
| `src/api/client.ts` | 1 | `src/api/client.test.ts`（B档·误红3） |
| `src/api/illust.ts` | 1 | `src/api/illust.test.ts`（A档） |
| `src/api/notification.ts` | 1 | `src/api/notification.test.ts`（A档） |
| `src/api/ranking.ts` | 1 | `src/api/ranking.test.ts`（A档） |
| `src/api/rateLimitBackoff.ts` | 1 | `src/api/rateLimitBackoff.test.ts`（B档） |
| `src/api/search.ts` | 1 | `src/api/search.test.ts`（A档·误红1） |
| `src/api/translate.ts` | 1 | `tests/unit/api/translate.test.ts`（A档·误红2） |
| `src/components/BookmarkPanel.vue` | 1 | `tests/md3FilledTextField.test.ts`（B档） |
| `src/components/CarouselSkeleton.vue` | 1 | `tests/md3GuardScans.test.ts`（B档·误红10） |
| `src/components/CarouselSwiper.vue` | 1 | `src/components/CarouselSwiper.test.ts`（A档·误红3） |
| `src/components/CommentInputBar.vue` | 1 | `tests/md3FilledTextField.test.ts`（B档） |
| `src/components/ContinueRow.vue` | 1 | `tests/fabOcclusionBand.test.ts`（B档·误红10） |
| `src/components/FabAllowanceSpacer.vue` | 1 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） |
| `src/components/RankingEntryCard.vue` | 1 | `tests/fabOcclusionBand.test.ts`（B档·误红10） |
| `src/components/RestrictedNovelCard.vue` | 1 | `tests/md3GuardScans.test.ts`（B档·误红10） |
| `src/components/SeriesSheet.vue` | 1 | `src/components/SeriesSheet.template.test.ts`（A档·误红5） |
| `src/components/SkeletonCard.vue` | 1 | `tests/md3GuardScans.test.ts`（B档·误红10） |
| `src/components/SkeletonNovel.vue` | 1 | `tests/md3GuardScans.test.ts`（B档·误红10） |
| `src/components/TranslateModeSwitch.vue` | 1 | `tests/m3-segmented-button-migration-gate.test.ts`（B档） |
| `src/components/illustTypeBadges.ts` | 1 | `src/components/illustTypeBadges.test.ts`（A档） |
| `src/composables/heroTransition.ts` | 1 | `src/composables/useReducedMotion.test.ts`（A档·误红5） |
| `src/composables/routeTransition.ts` | 1 | `src/composables/useReducedMotion.test.ts`（A档·误红5） |
| `src/composables/useBookmarkMutation.ts` | 1 | `src/composables/useBookmarkMutation.test.ts`（A档） |
| `src/composables/useBookmarkPanel.ts` | 1 | `src/composables/useBookmarkPanel.test.ts`（A档·误红6） |
| `src/composables/useLongPress.ts` | 1 | `src/composables/useLongPress.test.ts`（A档·误红2） |
| `src/composables/useTagMuteVisible.ts` | 1 | `tests/unit/composables/useTagMuteVisible.test.ts`（A档） |
| `src/composables/useTextSelection.ts` | 1 | `src/composables/useTextSelection.test.ts`（A档·误红1） |
| `src/errorPrototype/ErrorPagePreview.vue` | 1 | `tests/agentsMdMd3Baseline.test.ts`（B档·误红5） |
| `src/i18n/locales/en/novelTranslate.ts` | 1 | `tests/unit/i18n/novelTranslate.test.ts`（A档·误红6） |
| `src/i18n/locales/zh-CN/novelTranslate.ts` | 1 | `tests/unit/i18n/novelTranslate.test.ts`（A档·误红6） |
| `src/pages/AdvancedSettings.vue` | 1 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） |
| `src/pages/ContinueReading.vue` | 1 | `tests/novelIntroEntryGuards.test.ts`（B档·误红1） |
| `src/pages/ErrorPage.vue` | 1 | `tests/typographyFontWeight.test.ts`（B档·误红4） |
| `src/pages/Following.vue` | 1 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） |
| `src/pages/NetworkCheck.vue` | 1 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） |
| `src/pages/PlatformCheck.vue` | 1 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） |
| `src/pages/UpdatePage.vue` | 1 | `tests/typographyFontWeight.test.ts`（B档·误红4） |
| `src/pages/Updates.vue` | 1 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） |
| `src/primitives/collectTagNeighbors.ts` | 1 | `src/primitives/collectTagNeighbors.test.ts`（A档·误红3） |
| `src/primitives/createBookmarkToggle.ts` | 1 | `src/primitives/createBookmarkToggle.test.ts`（A档·误红1） |
| `src/primitives/createGlobalFab.ts` | 1 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） |
| `src/primitives/createMixFeed.ts` | 1 | `src/primitives/createMixFeed.test.ts`（B档·误红4） |
| `src/primitives/createNovelTranslator.ts` | 1 | `tests/unit/primitives/createNovelTranslator.test.ts`（A档·误红1） |
| `src/primitives/createRankingFeed.ts` | 1 | `src/primitives/createRankingFeed.test.ts`（A档） |
| `src/primitives/createTextSelection.ts` | 1 | `src/primitives/createTextSelection.test.ts`（A档·误红7） |
| `src/primitives/createWatchlistPrompt.ts` | 1 | `src/primitives/createWatchlistPrompt.test.ts`（A档·误红2） |
| `src/primitives/createWatchlistToggle.ts` | 1 | `src/primitives/createWatchlistToggle.test.ts`（A档） |
| `src/primitives/measureRects.ts` | 1 | `src/primitives/measureRects.test.ts`（A档·误红1） |
| `src/primitives/measureTextRect.ts` | 1 | `src/primitives/measureTextRect.test.ts`（A档·误红1） |
| `src/primitives/novelContentFitsViewport.ts` | 1 | `src/primitives/novelContentFitsViewport.test.ts`（A档） |
| `src/primitives/novelNavigationTarget.ts` | 1 | `src/primitives/novelNavigationTarget.test.ts`（A档） |
| `src/primitives/rankingDate.ts` | 1 | `src/primitives/rankingDate.test.ts`（A档） |
| `src/primitives/rankingEntryState.ts` | 1 | `src/primitives/rankingEntryState.test.ts`（A档） |
| `src/primitives/rankingNotice.ts` | 1 | `src/primitives/rankingNotice.test.ts`（A档） |
| `src/primitives/rankingRows.ts` | 1 | `src/primitives/rankingRows.test.ts`（A档） |
| `src/primitives/selectionToolbarGeometry.ts` | 1 | `src/primitives/selectionToolbarGeometry.test.ts`（A档·误红4） |
| `src/primitives/truncateForSearch.ts` | 1 | `src/primitives/truncateForSearch.test.ts`（C档·误红5） |
| `src/primitives/useSearch.ts` | 1 | `src/primitives/useSearch.test.ts`（A档·误红4） |
| `src/primitives/watchlistFeed.ts` | 1 | `src/primitives/watchlistFeed.test.ts`（A档·误红3） |
| `src/primitives/watchlistPrompt.ts` | 1 | `src/primitives/watchlistPrompt.test.ts`（A档） |
| `src/stores/browsingHistoryStore.ts` | 1 | `src/stores/browsingHistoryStore.test.ts`（A档·误红3） |
| `src/stores/continueReadingStore.ts` | 1 | `src/stores/continueReadingStore.test.ts`（A档·误红3） |
| `src/stores/modalStack.ts` | 1 | `src/stores/modalStack.test.ts`（A档） |
| `src/stores/novelTranslateStore.ts` | 1 | `tests/unit/stores/novelTranslateStore.test.ts`（A档·误红3） |
| `src/stores/relatedInjection.ts` | 1 | `src/stores/relatedInjection.test.ts`（A档·误红9） |
| `src/stores/searchHistoryStore.ts` | 1 | `src/stores/searchHistoryStore.test.ts`（A档） |
| `src/stores/searchSheetStore.ts` | 1 | `src/stores/searchSheetStore.test.ts`（A档） |
| `src/stores/tagNeighbor.ts` | 1 | `src/stores/tagNeighbor.test.ts`（B档·误红9） |
| `src/stores/watchLaterStore.ts` | 1 | `src/stores/watchLaterStore.test.ts`（A档·误红2） |
| `src/stores/watchlistStore.ts` | 1 | `src/stores/watchlistStore.test.ts`（A档） |
| `src/utils/adaptiveTagFit.ts` | 1 | `src/utils/adaptiveTagFit.test.ts`（A档·误红1） |
| `src/utils/bookmarkTags.ts` | 1 | `src/utils/bookmarkTags.test.ts`（A档·误红4） |
| `src/utils/darkMode.ts` | 1 | `src/utils/darkMode.test.ts`（A档·误红3） |
| `src/utils/downloadManager.ts` | 1 | `src/utils/downloadManager.test.ts`（A档·误红4） |
| `src/utils/downloadQueueCore.ts` | 1 | `src/utils/downloadQueueCore.test.ts`（A档·误红2） |
| `src/utils/downloadsViewModel.ts` | 1 | `src/utils/downloadsViewModel.test.ts`（A档·误红4） |
| `src/utils/filesystemTranslationCache.ts` | 1 | `tests/unit/utils/filesystemTranslationCache.test.ts`（B档·误红3） |
| `src/utils/firstLoadView.ts` | 1 | `src/utils/firstLoadView.test.ts`（A档） |
| `src/utils/galleryDownload.ts` | 2 | `src/utils/galleryDownload.test.ts`（A档·误红1） · `src/utils/galleryDownload.namingEmptySegment.test.ts`（档位未登记·#757 后新增） |
| `src/utils/gallerySaver.ts` | 1 | `src/utils/gallerySaver.test.ts`（A档·误红1） |
| `src/utils/lynxClipboard.ts` | 1 | `src/utils/lynxClipboard.test.ts`（A档·误红2） |
| `src/utils/lynxDownloadExecutor.ts` | 1 | `src/utils/lynxDownloadExecutor.test.ts`（A档） |
| `src/utils/lynxSelectionEngine.ts` | 1 | `src/utils/lynxSelectionEngine.test.ts`（A档·误红2） |
| `src/utils/lynxShare.ts` | 1 | `src/utils/lynxShare.test.ts`（A档·误红1） |
| `src/utils/novelDownloadStatus.ts` | 1 | `src/utils/novelDownloadStatus.test.ts`（A档） |
| `src/utils/novelNavigation.ts` | 1 | `tests/novelIntroEntryGuards.test.ts`（B档·误红1） |
| `src/utils/safeArea.ts` | 1 | `src/utils/safeArea.test.ts`（B档·误红4） |
| `src/utils/safeParseUrl.ts` | 1 | `src/utils/safeParseUrl.test.ts`（B档·误红1） |
| `src/utils/tagChips.ts` | 1 | `src/utils/tagChips.test.ts`（A档） |
| `src/utils/themeColor.ts` | 1 | `tests/hardcodeColorGate.test.ts`（B档·误红4） |
| `src/utils/translationCache.ts` | 1 | `tests/unit/utils/translationCache.test.ts`（B档·误红1） |
| `src/utils/utf8.ts` | 1 | `tests/unit/utils/utf8.test.ts`（B档） |
| `src/utils/viewportGeometry.ts` | 1 | `src/utils/viewportGeometry.test.ts`（B档·误红1） |
| `src/utils/viewportSizeBridge.ts` | 1 | `src/utils/viewportSizeBridge.test.ts`（B档） |
| `src/utils/webDavBridge.ts` | 1 | `tests/contract/webdavBridgeJavaContract.test.ts`（A档·误红13） |

## 二、全仓扫描型门禁（改任意 `src/**` 都会经过）

共 2 个。它们的判据对象是**目录树**而不是具体文件，无法点对点映射——
改 `src/` 下任何文件后，这两个都会跑；改动前扫一眼它们的扫描根。

| 门禁 | 行数 | 说明 |
| --- | --- | --- |
| `tests/helpers/walkProductionVue.test.ts`（B档） | 67 | 遍历器的自检测试（其余矩阵型门禁依赖它） |
| `tests/mojibakeGuard.test.ts`（C档·误红5） | 520 | 遍历 `src/**` 生产 .vue 全树，扫描 U+FFFD 替换字符 |

## 三、无 `src/` 被测引用的门禁

共 54 个：**改 `src/` 业务代码不会让它们变红**，日常改业务时不必读。
但「不被 src 改动影响」≠「无被测对象」——部分门禁的被测对象在 `src/` 之外：

- `scripts/*.sh`（取证脚本静态不变量，如 `captureScriptInvariants`）
- `styles/tokens.css`（MD3 令牌，如 `md3ConfigTokens`）
- `AGENTS.md` / `docs/**`（文档不变量）
- 纯函数模块（无 `.vue` 接线，改业务页面不影响）

| 门禁 | 行数 | 档次 |
| --- | --- | --- |
| `src/api/illustRelated.test.ts` | 42 | A |
| `src/components/AdaptiveTagRow.template.test.ts` | 66 | B |
| `src/components/BookmarkButton.template.test.ts` | 149 | A |
| `src/components/BookmarkPanel.template.test.ts` | 214 | A |
| `src/components/BottomSheet.template.test.ts` | 181 | B |
| `src/components/IllustTypeBadgeRow.template.test.ts` | 194 | A |
| `src/components/M3SegmentedButton.template.test.ts` | 194 | A |
| `src/components/M3Switch.template.test.ts` | 152 | A |
| `src/components/NovelExportSheet.template.test.ts` | 93 | A |
| `src/components/RankingEntryCard.template.test.ts` | 70 | A |
| `src/components/RelatedInlineSection.template.test.ts` | 45 | A |
| `src/components/TextSelectionToolbar.template.test.ts` | 83 | A |
| `src/pages/IllustDetail.template.test.ts` | 136 | A |
| `src/pages/IllustList.template.test.ts` | 69 | A |
| `src/pages/Notifications.iconProxyContract.test.ts` | 253 | A |
| `src/pages/PlatformCheck.template.test.ts` | 100 | B |
| `src/pages/Ranking.template.test.ts` | 78 | A |
| `src/pages/TagNeighbors.template.test.ts` | 274 | A |
| `src/pages/advancedImageCacheTemplate.test.ts` | 102 | B |
| `src/pages/meDownloadNaming.template.test.ts` | 91 | A |
| `src/pages/meWebdavTemplate.test.ts` | 121 | A |
| `src/pages/myPixivPage.template.test.ts` | 173 | A |
| `src/pages/recommendedBleedHeader.template.test.ts` | 176 | B |
| `src/stores/browsingHistoryStore.pure.test.ts` | 109 | A |
| `src/stores/browsingHistoryWiring.template.test.ts` | 187 | B |
| `src/stores/continueReadingStore.pure.test.ts` | 62 | A |
| `src/stores/continueReadingWiring.template.test.ts` | 259 | A |
| `src/stores/deliveryProbeContract.test.ts` | 672 | A |
| `src/utils/buildImageTasks.test.ts` | 140 | A |
| `src/utils/buildUgoiraTask.test.ts` | 93 | A |
| `src/utils/clipboardBridgeContract.test.ts` | 64 | B |
| `src/utils/darkModeJavaContract.test.ts` | 522 | B |
| `src/utils/galleryBridgeContract.test.ts` | 155 | B |
| `src/utils/safeAreaJavaContract.test.ts` | 201 | B |
| `src/utils/ugoiraFramesTask.test.ts` | 69 | B |
| `tests/adrClaimConsistency.test.ts` | 306 | B |
| `tests/captureScriptInvariants.test.ts` | 1086 | B |
| `tests/contract/illustTypeBadgeTruthTable.test.ts` | 16 | A |
| `tests/hardcode-gate.test.ts` | 144 | B |
| `tests/homeBleedHeaderFlag.test.ts` | 156 | A |
| `tests/immersiveScrimContrast.acceptance.test.ts` | 392 | B |
| `tests/md3ConfigTokens.test.ts` | 1371 | B |
| `tests/md3TailwindArtifact.test.ts` | 290 | B |
| `tests/mdTokenRefs.test.ts` | 57 | B |
| `tests/meNotificationsTemplate.test.ts` | 55 | A |
| `tests/meNovelIntroTemplate.test.ts` | 59 | A |
| `tests/novelRecommendedApi.test.ts` | 66 | A |
| `tests/palettes-drift.test.ts` | 163 | A |
| `tests/recommendedNovelBookmark.test.ts` | 59 | A |
| `tests/statusBarContrast.test.ts` | 354 | B |
| `tests/tagMuteTemplate.test.ts` | 229 | A |
| `tests/topInsetMetrics.test.ts` | 210 | B |
| `tests/unit/api/translateFrameChannel.test.ts` | 746 | A |
| `tests/unit/utils/translationCacheFilesystemBranch.test.ts` | 83 | B |

## 四、摩擦热点：改动时最该重点看的被测对象

排序 = 门禁数 × 2 + 误红条目合计。这是最容易「改完被一堆不相干的测试拦住」的地方。

| 被测对象 | 门禁数 | 误红条目合计 | 门禁 |
| --- | --- | --- | --- |
| `src/App.vue` | 7 | 63 | `src/components/motionDurationTokens.template.test.ts`（B档·误红10） · `src/composables/useReducedMotion.test.ts`（A档·误红5） · `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/hardcodeColorGate.test.ts`（B档·误红4） · `tests/md3GuardScans.test.ts`（B档·误红10） · `tests/unit.test.ts`（A档·误红15） · `tests/unit/utils/appearanceClasses.test.ts`（B档·误红15） |
| `src/pages/Me.vue` | 8 | 43 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/hardcodeColorGate.test.ts`（B档·误红4） · `tests/m3-segmented-button-migration-gate.test.ts`（B档） · `tests/m3-switch-migration-gate.test.ts`（B档·误红1） · `tests/md3FilledTextField.test.ts`（B档） · `tests/typographyFontWeight.test.ts`（B档·误红4） · `tests/unit.test.ts`（A档·误红15） · `tests/unit/utils/appearanceClasses.test.ts`（B档·误红15） |
| `src/components/GlobalFab.vue` | 4 | 29 | `src/components/motionDurationTokens.template.test.ts`（B档·误红10） · `src/composables/useReducedMotion.test.ts`（A档·误红5） · `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/md3GuardScans.test.ts`（B档·误红10） |
| `src/pages/Watchlist.vue` | 4 | 25 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/fabOcclusionBand.test.ts`（B档·误红10） · `tests/md3GuardScans.test.ts`（B档·误红10） · `tests/novelIntroEntryGuards.test.ts`（B档·误红1） |
| `src/components/GlassCard.vue` | 3 | 25 | `src/components/motionDurationTokens.template.test.ts`（B档·误红10） · `src/composables/useReducedMotion.test.ts`（A档·误红5） · `tests/md3GuardScans.test.ts`（B档·误红10） |
| `src/components/RefreshableList.vue` | 3 | 25 | `src/components/motionDurationTokens.template.test.ts`（B档·误红10） · `src/composables/useReducedMotion.test.ts`（A档·误红5） · `tests/md3GuardScans.test.ts`（B档·误红10） |
| `src/pages/IllustDetail.vue` | 4 | 23 | `src/composables/useReducedMotion.test.ts`（A档·误红5） · `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/fabOcclusionBand.test.ts`（B档·误红10） · `tests/typographyFontWeight.test.ts`（B档·误红4） |
| `src/stores/settingsStore.ts` | 5 | 21 | `src/stores/settingsStore.test.ts`（A档·误红12） · `tests/contract/aiFilterModeSettingsBaseline.test.ts`（A档） · `tests/contract/i18nLanguageKeyContract.test.ts`（A档·误红2） · `tests/contract/novelExportSettingsBaseline.test.ts`（A档·误红1） · `tests/contract/webdavSettingsBaseline.test.ts`（A档·误红6） |
| `src/pages/UserHome.vue` | 4 | 19 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/md3GuardScans.test.ts`（B档·误红10） · `tests/novelIntroEntryGuards.test.ts`（B档·误红1） · `tests/typographyFontWeight.test.ts`（B档·误红4） |
| `src/utils/backupCore.ts` | 3 | 19 | `src/utils/backupCore.test.ts`（A档·误红5） · `tests/contract/aiFilterModeSettingsBaseline.test.ts`（A档） · `tests/contract/webdavBackupFormatContract.test.ts`（A档·误红14） |
| `src/components/UserRow.vue` | 2 | 20 | `tests/fabOcclusionBand.test.ts`（B档·误红10） · `tests/md3GuardScans.test.ts`（B档·误红10） |
| `src/utils/appearanceClasses.ts` | 2 | 19 | `tests/hardcodeColorGate.test.ts`（B档·误红4） · `tests/unit/utils/appearanceClasses.test.ts`（B档·误红15） |
| `src/components/BookmarkButton.vue` | 3 | 16 | `src/components/BookmarkButton.host-matrix.test.ts`（A档·误红1） · `src/components/motionDurationTokens.template.test.ts`（B档·误红10） · `src/composables/useReducedMotion.test.ts`（A档·误红5） |
| `src/components/M3Switch.vue` | 3 | 16 | `src/components/motionDurationTokens.template.test.ts`（B档·误红10） · `src/composables/useReducedMotion.test.ts`（A档·误红5） · `tests/m3-switch-migration-gate.test.ts`（B档·误红1） |
| `src/pages/Bookmarks.vue` | 3 | 15 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/md3GuardScans.test.ts`（B档·误红10） · `tests/novelIntroEntryGuards.test.ts`（B档·误红1） |
| `src/pages/NovelList.vue` | 3 | 15 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/md3GuardScans.test.ts`（B档·误红10） · `tests/novelIntroEntryGuards.test.ts`（B档·误红1） |
| `src/utils/backupService.ts` | 2 | 16 | `src/utils/backupService.test.ts`（A档·误红2） · `tests/contract/webdavBackupFormatContract.test.ts`（A档·误红14） |
| `src/components/ActionButton.vue` | 2 | 15 | `src/components/ActionButton.template.test.ts`（A档·误红5） · `tests/md3GuardScans.test.ts`（B档·误红10） |
| `src/components/M3SegmentedButton.vue` | 2 | 15 | `tests/m3-segmented-button-migration-gate.test.ts`（B档） · `tests/unit/utils/appearanceClasses.test.ts`（B档·误红15） |
| `src/pages/MuteTags.vue` | 2 | 14 | `tests/bottomOcclusionAllowance.test.ts`（A档·误红4） · `tests/fabOcclusionBand.test.ts`（B档·误红10） |

## 附：运行时长真相（不要照着直觉优化）

全量 `pnpm test` **27 秒 / 300 文件 / 4367 用例**。逐文件耗时排行（实测）：

| 文件 | 耗时 | 性质 |
| --- | --- | --- |
| `tests/findPaletteSwatches.test.ts` | 20.7s | spawn Python ×16（1080×2160 饱和度扫描） |
| `tests/pngLuma.test.ts` | 7.8s | 同上 |
| `tests/findWideSolid.test.ts` | 7.1s | 同上 |
| `tests/scriptExitCodes.test.ts` | 6.6s | 同上 |
| `tests/findUiBand.test.ts` | 5.6s | 同上 |
| 其余 294 个文件合计 | < 10s（并行） | 普通单测 |

**结论：这套套件的墙钟已经接近最优，不要为它做结构性改造。**

- 这 5 个 spawn 门禁单文件合计 **47.8 秒**，但它们**并行执行**，墙钟只等于最长的那个（20.7s）。
  拆成「串行独立阶段」反而会让总墙钟变成 `≈3s + 48s ≈ 51s`，**慢一倍**。
- 不是 Python 启动慢：解释器启动 19ms、`import PIL` 19ms，每次调用约 1.2s 全是脚本自身计算。
- 隔离单跑该文件只要 10.8s，在全量里变 20.7s——差额是 300 worker 争抢 CPU 造成的，
  但争抢同时让 294 个普通单测也并行跑完，**净收益为零**。
- 唯一的真杠杆是优化 `scripts/find-palette-swatches.py` 本身的算法，但它是
  `scripts/capture-md3-matrix.sh` 的承重证据脚本（`set_palette` 的唯一 oracle），
  不该在门禁重评里动。

## 口径与局限

1. 被测对象的判定 = 同名配对（`X.test.ts` ↔ `X.ts`）**或**测试源码内出现该文件路径字面量。**仅 `import` 的依赖不算**——构建过程中 `src/api/types.ts` 曾因类型导入被误挂 16 个门禁，已剔除。
2. 全仓扫描型的判定 = 测试内出现共享遍历器 / 硬编码扫描根，**且**其路径字面量里没有具体`.vue`/`.ts` 文件名（判据对象是目录而非文件）。矩阵型门禁（如 `md3GuardScans`、`hardcodeColorGate`、`bottomOcclusionAllowance`）扫描的是**具名组件列表**，已归入第一节按组件索引。
3. 覆盖范围：app-lynx 的 158 个「引用文档」测试文件。`packages/android-host` 的测试与其余共享包的测试未纳入（JVM/纯逻辑，与 lynx 源码不同源）。⚠️ **这里不写 android-host 的测试文件数**：该数字随分支增删而漂，写死必然过期（#1047 第 4 轮 Standards 轴 S-N6 实测：本仓此处的旧值在 `main` 上就不成立）⇒ 要核实时按 `find packages/android-host -name "*.test.ts" -not -path "*/node_modules/*" | wc -l` 现算。
4. 档位与误红数来自两轮盘点，**未复核的反向锁候选不在其中**——见普查文档的复核状态表。
5. 本表由静态路径引用提取得出，**不含运行时动态加载的对象**；若某门禁在运行期读文件而源码里只有变量拼接路径，可能漏映射。发现漏映射时以本文档第 2 条口径手工补。

---
*索引由脚本从 158 个测试文件的路径引用机械提取生成；原始数据 `/tmp/gate-audit/index.json`（临时，不入仓）。*
