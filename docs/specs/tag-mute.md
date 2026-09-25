# Spec：标签级静音（Tag Mute）

> 状态：`implemented` 待回写 ｜ 日期：2026-09-26 ｜ 依据：ADR-0187 + `docs/adr/glossary-tag-mute.md`
> 双端范围：webview（packages/app）+ lynx（packages/app-lynx）

## Problem Statement

用户无法按标签隐藏作品。过滤链（R18/R18G、屏蔽用户、AI 三态）全部是内容属性判定，没有用户自建词表维度。竞品（pixez/Shaft/Pixeval/PBD/pixiv-viewer）均有标签级屏蔽能力。

## Solution

本地静音标签集合（账号级键 `mute_tags_${uid}`，string[]），双端同键；在两端过滤链注入「标签命中即移除」谓词；标签 chip 长按静音；设置/Me 提供管理界面。

## User Stories

1. 作为用户，我在插画/小说详情页长按一个标签，它被加入静音词表，Feed 中含该标签的作品不再出现。
2. 作为用户，我在设置（webview）/Me 内容组（lynx）打开静音标签管理页，能看到全部已静音标签并逐个移除。
3. 作为用户，我在 webview 静音的标签，切换到 lynx 引擎后同样生效（共享账号级键）。
4. 作为用户，我在排行榜页静音某标签后，被移除的条目留名次空洞（后续名次不前移）。
5. 作为用户，我的静音词表随 WebDAV 备份/恢复迁移。

## 数据流

```
[长按 chip] → muteStore.add(name.trim()) → 持久化 mute_tags_${uid}
   → webview: settings registry 写 SharedPreferences（经既有 settings 通道）
   → lynx: prefs().set → PictelioPrefs → SharedPreferences "CapacitorStorage"
[Feed 组装] → 过滤函数读快照 Set<string>
   → webview: filterFeedIllusts/filterNovels/filterUserPreviews 内 mutedTags() 快照
   → lynx: settingsStore.isTagMuted(item) 在各数据组装点应用
[备份] → 账号级域收编：webview `ACCOUNT_KEY_PREFIXES` 增 `mute_tags_`（经 accountKeys 通道而非 sets 域——uid 过滤与跨引擎恢复都必须走 accountKeys）；lynx `backupAccountKeys` 含该键
```

## 状态变化

| 状态 | 触发 | 结果 |
| --- | --- | --- |
| 未静音 → 已静音 | 长按 chip | 集合新增 trim 后 name；轻提示；该标签在当前视图不消失（已渲染列表不回溯移除，v1 只影响后续组装——见边界 #4） |
| 已静音 → 未静音 | 管理页移除 | 集合删除；下次组装恢复显示 |
| 空 → 非空 | 首次静音 | 管理页空态 → 列表态 |
| 启动 | app 启动 | `load()` 读持久化集合进内存（webview `__root` 启动装载同 blockStore；lynx settingsStore 初始化时装载） |

## 边界条件

1. **空 tags / undefined**：`item.tags` 缺失或空数组 → 不命中，直接放行。
2. **重复添加**：Set 语义幂等；管理页不重复显示。
3. **含空白标签**：存储与匹配均 trim；服务端会把含空格的收藏标签切分（生态位），静音集合对「切分后片段」同样按字面匹配——不做特殊处理。
4. **已渲染列表不回溯**：长按静音后当前已挂载列表不移除已渲染卡片（避免列表跳动）；下拉刷新/分页后生效。测试断言「组装层过滤」，不断言视图热更新。
5. **排行榜名次保序（lynx）**：先赋名次（预过滤下标+1）后过滤，移除留洞；webview 由 `flattenIllusts` 既有保序路径天然继承（过滤在 flatten 前应用与 R18 同位）。
6. **相关注入行（lynx）**：`relatedInjection.ts` 过滤链追加静音一环；锚点本身被静音时不再注入（锚点过滤后判空跳过）。
7. **加载失败/持久化失败**：读失败 → 空集合并 `console.warn`（模块前缀），禁静默降级；写失败 → lynx 提示「静音未生效」（`prefs().set` 可 await）；webview registry set 为 fire-and-forget（`SettingHandle.set(): void`），写失败可见性经 registry warn 管线，UI 级失败提示挂账（code-review Round 1 裁定）。
8. **webview 盲区**：搜索结果与浏览历史不过滤（现状口径，R18/屏蔽同样不覆盖）。
9. **快照语义（Round 1 修订）**：静音集合在组装点以**非响应式快照**读取（webview `untrack`、lynx plain Set 缓存）——集合变化只影响后续组装（刷新/分页重新装配），不触发已渲染列表热重算（同时规避 ADR-0162 原生 list 中途移除风险；webview 侧亦保持行为一致）。

## Implementation Decisions

- webview：新 store `stores/muteTagStore.ts`（键/校验/集合 API，形态对齐 blockStore）；过滤注入 `utils/r18Filter.ts` 三函数；chip 长按挂 `SearchableTag`（props 透传开关，默认开）+ `IllustTags`；管理 `components/MuteTagSheet.tsx`（复刻 BlocklistSheet）+ `SettingsContent` 行 + `SettingsDialogs` 装配；i18n 新域 `muteTag`（zh/en 双份，per-domain satisfies）。
- lynx：`settingsStore.ts` 新增集合键 + `isTagMuted` 谓词 + 装载逻辑；组装点过滤（推荐/插画/小说列表、收藏、关注、用户主页、搜索行、相关行、排行榜名次后置过滤）；chip 长按挂详情页标签行/`TagChipRow`/`AdaptiveTagRow`（`useLongPress`，view 层）；管理页 `pages/MuteTags.vue` + 路由 `/mute-tags`（requiresAuth）+ Me 内容组入口行；i18n `misc.ts`（zh/en）。
- 类型：不动 `api/types.ts`（tags 形态已有）。
- 禁改共享键名：`mute_tags_` 前缀逐字双端一致。

## Testing Decisions

- **真值表**：`isTagMuted` 语义双端 differential（命中/未命中/空 tags/trim 边界/translated_name 不参与）——webview `tests/unit/differential/` + lynx `tests/differential/`（复制 r18FilterTruthTable 模式）。
- **store 单测**：add/remove/has/load 双路径（持久化成功 + 读失败降级 warn），webview 复制 `blockStore.test.ts` registry mock 模式；lynx 复制 settingsStore 测试的 prefs mock 模式。
- **过滤注入回归**：webview `r18Filter.test.ts` 增补静音用例（真实 PixivIllust/PixivNovel 形状工厂）。
- **契约测试**：键名逐字一致——lynx `settingsStore.test.ts` 扩展 exportRawValues/importRawValues 键清单断言（ranking_entry 同款）；webview 备份 sets 清单断言扩展。
- **UI**：webview 组件测试（MuteTagSheet 移除交互）；lynx template 测试（chip 长按 emit）。
- IO 边界硬约束：所有持久化读写函数成功+失败双路径覆盖。

## Out of Scope

- webview 搜索/浏览历史补过滤（盲区，独立立项）
- 确认弹窗 / toast 撤销
- 翻译名/归一化匹配
- 服务端官方 mute 对接（`is_muted` 字段消费）
- 已渲染列表热移除
- 共享包抽取

## Further Notes

- 实施前缺陷记录：无。
- 真机验收批次：双端长按手势（原生约束：手势绑 view 层）+ 跨引擎词表迁移模拟器走查，发版前按 checklist 执行（与 #709 同批次）。
