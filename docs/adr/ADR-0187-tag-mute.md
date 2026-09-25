# ADR-0187：标签级静音（本地标签词表过滤）

- 状态：Accepted
- 日期：2026-09-26
- 关联：`docs/adr/glossary-tag-mute.md`（术语表）、`docs/specs/tag-mute.md`（规格）、ADR-0092（createPersistedSet）、ADR-0103（账号级内容设置跨引擎契约）、ADR-0155（AI 三态过滤）、ADR-0160（收藏加标签——双端文档三件套先例）、ADR-0158（排行榜名次保序）

## 背景

Pictelio 的内容过滤链目前只有三个谓词：R18/R18G 分级（账号级开关）、屏蔽用户（本地集合 `blocked_user_ids`）、AI 三态（模式驱动）。用户无法按**标签**隐藏作品——例如静音「R-18G」「グロ」「AI生成」等个人厌恶词。竞品面：pixez（`mute_store` BanTag）、Shaft（按标签/作者静音）、Pixeval（`BlockedTags`）、PBD（按用户屏蔽标签）、pixiv-viewer（标签黑名单）均具备，属差距清单 P1 项（2026-09-25 复验报告）。

现状事实（file:line 见调研取证）：

- webview 过滤链集中在 `packages/app/src/utils/r18Filter.ts` 的 `filterFeedIllusts` / `filterNovels` / `filterUserPreviews` 三个纯函数，被 10 处调用点消费（首页六 feed、相关作品行、排行榜、用户作品页、关注列表）；函数内已有 `blockedIds()` **整集快照读**先例（避免逐条挂 N 个 signal 源）。
- webview 搜索（`searchStore.ts:125-130`）与浏览历史（`SideNavShell.tsx:77-82`）**现有过滤就未覆盖** R18/屏蔽（仅 AI 或无）。
- lynx 端谓词在 `stores/settingsStore.ts`（`isRestricted`/`shouldHideByAi` 等），列表走**遮罩**（RestrictOverlay/AiRestrictedIllustCard）；但**数据层过滤**同样有先例：related 注入行（`stores/relatedInjection.ts:48`）与 AI 仅看态（`composables/useAiOnlyVisible.ts`）。
- lynx 无任何集合型 store（`settingsStore.ts:107-111` 注释明示「sets 在 app-lynx 暂无对应 store」）；集合持久化最接近的先例是 `searchHistoryStore`（idbKV）与 ADR-0103 账号级共享键（`show_r18_${uid}`，PictelioPrefs 经 SharedPreferences "CapacitorStorage"，双端逐字同键 + 契约测试）。
- 标签数据形态双端一致：`{ name: string; translated_name?: string }`；规范化先例仅 `trim()`（`bookmarkTags.ts:55`）。

## 调研结论

1. webview 注入面极窄：改三个过滤函数即覆盖全部 10 处消费点，无需逐 store 改造。
2. lynx 双路皆可：遮罩路（列表全量渲染+盖卡）与过滤路（数据层移除）均有先例；「静音」的用户预期是**看不见**，与 R18 的「提示存在但可解锁」语义不同，过滤路更贴合，且实现面小于遮罩路（无需新遮罩卡变体）。
3. 跨引擎同步有现成契约：ADR-0103 明言「未来任何设置要跨 client 同步：沿用本契约（共享存储 + 双端实现 + 契约测试）」，Native 桥（PictelioPrefs）已就绪。
4. 匹配语义无复杂度空间：搜索入口与展示均以原始 `tag.name` 为锚（translated_name 仅展示），规范化先例仅 trim。

## 决策

**D1 数据模型与存储——账号级共享键 `mute_tags_${uid}`，沿用 ADR-0103 契约。**
类型 `string[]`（JSON 数组），元素为 trim 后的原始标签名。webview 侧经 settings registry 账号级机制（对齐 `show_r18_${uid}` 的 defineFactory 路径）暴露集合 API（`values(): Set<string>` / `add` / `remove` / `has` / `load`，形态对齐 `createPersistedSetSetting`）；lynx 侧经 `prefs()`（PictelioPrefs → SharedPreferences "CapacitorStorage"）读写同键。双端键名逐字一致 + 契约测试钉住（先例：`ranking_entry` 双端逐字同键测试）。纳入备份域：webview 加入备份 sets 清单（`backupCore.ts`/`backupWiring.ts`），lynx 加入 `backupAccountKeys`。
否决「设备级独立键」（`searchHistoryStore` 式 idbKV）：静音词表是用户口味数据，与 R18/AI 同类，跨设备/跨引擎迁移价值高（换引擎不丢词表），且备份域已为账号级 sets 预留形状。

**D2 匹配语义——trim 后对原始 `tag.name` 精确相等，不做归一。**
集合存储与匹配均使用 `name.trim()`；无大小写折叠、无全半角归一、不匹配 `translated_name`。
否决模糊/归一匹配：无生态先例（pixez/Pixeval 均精确），过归一会产生「静音一个误伤一片」的不可预期行为；否决翻译名匹配：`translated_name` 仅部分存在且非唯一，双源匹配会造成静音集合语义分裂。

**D3 webview 注入——三个过滤函数内并排一个谓词，快照读。**
`filterFeedIllusts` / `filterNovels` / `filterUserPreviews` 内新增 `mutedTags()` Set 快照（复制 `blockedIds()` 整集读模式），命中即从结果剔除。10 处调用点零改动自动覆盖。webview 搜索与浏览历史**维持现状口径**（与 R18/屏蔽一致），作为盲区挂账（见后果节）。

**D4 lynx 注入——数据层过滤（非遮罩），两处特殊语义。**
新增判定函数（settingsStore 内，与 `isRestricted` 同区）：`isTagMuted(item): boolean`（`item.tags` 任一 `name.trim()` 命中集合）。在 lynx 各数据组装点应用移除：推荐/插画/小说列表、收藏、关注、用户主页、搜索结果行、相关注入行（`relatedInjection.ts` 过滤链追加一环）。两处特殊语义：
- **排行榜页**：先按页序赋名次（rank = 预过滤下标 + 1），后应用静音过滤——移除条目**留名次空洞**，与 webview 排行榜 R18 语义对齐（ADR-0158 保序精神），跨页名次不漂移。
- **搜索行遮罩态**：`SearchSheet` 的 `isRowMasked` 不纳入静音（静音行直接不渲染，无需遮罩态）。
否决遮罩路：需新增遮罩卡变体 ×N 组件，实现面大且与「静音=不可见」预期相悖。

**D5 UI——长按标签静音 + 管理界面。**
入口：双端标签 chip **长按（500ms）即静音**并给轻提示（复用既有长按先例：webview `IllustDetail.tsx` longPressTimer、lynx `useLongPress`），不做确认弹窗（误操作可经管理页恢复）。覆盖面：webview `SearchableTag`（单一 chip 原语，6 消费文件自动生效）+ 详情页 `IllustTags`；lynx 详情页标签行、`TagChipRow`、`AdaptiveTagRow`（注意原生约束：手势绑 view 层）。
管理：webview 设置「内容」组加「管理静音标签」行 → `MuteTagSheet`（复刻 `BlocklistSheet` 形态：底部 Sheet + 列表行「标签名 + 取消静音」+ 空态）；lynx `Me.vue` 内容组加入口行 → 新路由页 `/mute-tags`（列表 + 移除 + 空态，信息架构对齐 Watchlist 先例）。
否决长按弹二级菜单：两端菜单基建成本高于收益；否决立即弹确认：二次点击成本伤害高频操作。

**D6 不做共享包。**
匹配谓词是平凡纯逻辑（trim + Set.has），双端各自实现 + differential 真值表测试（先例：`r18FilterTruthTable.test.ts` 双端模式）。ADR-0103 §6 明示该场景「不做共享包」。

## 备选与否决理由（汇总）

| 备选 | 否决理由 |
| --- | --- |
| 遮罩渲染（lynx R18 式） | 组件变体成本高；语义不符（静音应不可见） |
| 服务端官方 mute 对接 | 官方 mute 是账号级服务端能力，无第三方写端点实证；`is_muted` 字段消费另行挂账 |
| 归一化匹配（小写/NFKC） | 误伤风险 + 无先例 |
| 确认弹窗 | 高频操作摩擦；管理页兜底足够 |
| webview 搜索/历史一并补过滤 | 超出票面（该两处 R18/屏蔽也不覆盖，属独立缺口），避免范围扩散 |

## 后果

- 正面：webview 一处改动覆盖 10 表面；lynx 首次获得集合型账号级 store，跨引擎恢复词表可用（备份 sets 不再单边为空）。
- 取舍（已接受）：webview 搜索与浏览历史不过滤静音标签（与 R18/屏蔽现状口径一致，盲区在 `docs/specs/tag-mute.md` 挂账）；匹配不含翻译名与归一化；长按无确认（依赖管理页恢复）。
- 中性：静音是本地词表，卸载/清数据即失（WebDAV 备份可迁移）；不与官方 mute 同步。
- 后续候选（不在本期）：搜索/历史盲区补齐、静音时的 toast 撤销操作、按标签维度统计被滤条数。
