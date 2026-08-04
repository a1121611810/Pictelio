# app-lynx R18 遮罩方案 + 骨架屏 —— 功能规格

> 来源：handoff `/var/folders/qk/gx16djf514q79_3qcr9lfkp80000gn/T/handoff-app-lynx-novel-r18-overlay.md`（Grill 澄清阶段已完成，用户逐项拍板）；根因 ADR-0051 过滤策略导致全过滤白屏
> 状态：ready-for-agent

## Problem Statement

app-lynx 用户从 header 进入小说页后，推荐（`/v1/novel/recommended`）与关注（`/v1/novel/follow`）接口均有数据返回，但页面白屏只剩 header。根因：`settingsStore.filterByRestrict` 默认隐藏 R18（`x_restrict===1`）与 R18G（`x_restrict===2`）（ADR-0051），而实测推荐 33 条、关注 30 条小说 `x_restrict` 全部为 1 或 2，过滤后 0 条；`NovelList.vue` 仅当 `novels.length > 0` 才渲染 `<list>`，且推荐 tab 无空态分支 → 白屏。

次生问题：`NovelList.vue` `loadMore` 的空页防护基于**过滤后**长度（`fresh.length === 0 ? null : res.next_url`），全过滤场景直接终止分页，后续页永远加载不出。

另外：小说详情页加载期只显示纯文本「加载中…」，无骨架屏，体验粗糙。

## Solution

**不做过滤，做遮罩**：所有插画与小说列表全量渲染，受限条目盖玻璃遮罩（徽章区分 R-18 / R-18G + 原因文案「该内容已在设置中隐藏」）。遮罩无任何交互（不跳设置、无按钮、无提示），点击不响应。用户在设置中开启对应开关后，遮罩即时响应式消失，不重新请求。

**骨架屏**：小说列表页首屏（含切 tab 重载）显示列表卡骨架；小说详情页 `loading` 期显示标题/作者/正文条骨架，header 骨架期照常渲染。

`filterByRestrict` 整体废弃删除，全仓引用清零。

## User Stories

1. 作为 app-lynx 用户，我进入小说推荐页时能看到完整列表（含受限条目），以便不再面对白屏
2. 作为用户，我进入小说关注页时能看到完整列表（含受限条目），以便知道我关注的作者有更新
3. 作为用户，我在受限小说条目上看到 R-18 / R-18G 徽章与原因说明，以便理解内容为何不可读
4. 作为用户，我点击遮罩时没有任何反应，以便不误触跳转或被打断浏览
5. 作为用户，我在设置中打开「显示 R18」后遮罩立即消失，以便无需刷新即可阅读
6. 作为用户，我在插画推荐/关注/收藏/用户主页列表中看到同样的遮罩行为，以便全站体验一致
7. 作为用户，我在小说详情页打开受限小说时，标题/作者/元信息可见但正文被遮罩挡住，以便知道这是什么作品但不直接暴露内容
8. 作为用户，我直接深链进入受限小说详情时同样看到遮罩，以便无绕过路径
9. 作为用户，我在小说列表首屏加载时看到骨架占位，以便感知加载进度而非面对空白
10. 作为用户，我切换推荐/关注 tab 时同样看到骨架，以便每次加载都有一致的反馈
11. 作为用户，我在小说详情页加载时看到与正文布局一致的骨架（标题条/作者条/正文条错落），以便加载完成后无突兀跳变
12. 作为用户，我在详情页加载期间仍能看到顶部返回栏，以便随时退出
13. 作为用户，我在分页滚动时服务端返回的每一页都能正常追加，以便过滤逻辑不再误杀分页
14. 作为开发者，我希望遮罩样式由统一的设计 token 驱动，以便亮/暗主题与后续维护一致
15. 作为开发者，我希望原生 LynxView（backdrop-filter 不支持）下遮罩自动退化为高不透明度实色盖，以便单一样式源不写双分支

## Implementation Decisions

### 模块与接口

**settingsStore（修改）**
- 新增 `isRestricted(item: { x_restrict: number }): boolean`：纯函数，读 `_showR18`/`_showR18G` ref。`x_restrict===1 && !showR18 → true`；`x_restrict===2 && !showR18G → true`；其余 `false`。响应式——开关变化后所有依赖处即时重算。
- 删除 `filterByRestrict`，全仓引用清零（当前引用：NovelList.vue、Recommended.vue、Following.vue、UserHome.vue、Bookmarks.vue）。

**RestrictOverlay 组件（新增）**
- props：`level: 1 | 2`（1=R-18，2=R-18G）。
- 绝对定位铺满父容器（父容器加 `relative`）。
- 居中渲染：徽章（R-18 / R-18G）+ 单行文案「该内容已在设置中隐藏」（两个级别共用文案，徽章区分级别——用户已确认）。
- 无任何 @tap 绑定、无按钮。需在 web-core 实测确认 tap 不穿透触发下层卡片的 `openDetail`；若穿透，补 `@tap.stop` 空处理器。
- 调用处用 `v-if="isRestricted(item)"` 控制显隐。

**玻璃 token（tokens.css 修改）**
- 新增 `--glassBg` / `--glassBlur` / `--glassSaturate` / `--glassBorder` 四个 token（亮/暗两组——注意：app-lynx 当前 tokens.css 为单一主题无暗色覆写，需与现状对齐：若包内确无暗色主题机制，只定义一组；实施时以 tokens.css 实际结构为准）。
- 命名沿用包内 Fluent 2 camelCase 风格。
- 遮罩样式单源：web-core 完整玻璃（backdrop-filter + 半透明底 + 玻璃边）；原生 LynxView 中 backdrop-filter 被静默忽略，退化为更高不透明度实色盖（亮 `rgba(255,255,255,0.88)` / 暗 `rgba(0,0,0,0.82)`），视觉从「玻璃」退为「磨砂实色盖」，功能无损。禁止硬编码色值。

**SkeletonNovel 组件（新增）**
- 详情骨架：标题条(70%) + 作者条(40%) + 元信息条(30%) + 5~6 条错落正文条(100%/100%/85%/100%/60%)。
- padding/行高/间距与真实内容一致，避免骨架→内容切换 reflow。
- 复用全局 `shimmer` 类（定义在 App.vue L31-52）。

### 页面行为

| 页面 | 行为变更 |
|---|---|
| NovelList.vue | 去过滤；条目盖遮罩；`loadMore` 删除基于过滤长度的空页防护，回归服务端语义（服务端返回空才算空页）；首屏 loading 渲染 4~6 条列表卡骨架（标题+作者+标签条），切 tab 重载同样显示 |
| NovelDetail.vue | 正文区遮罩（标题/作者/元信息可见，正文挡住）；`v-if="loading"` 分支换 `<SkeletonNovel />`；header 骨架期照常渲染 |
| Recommended.vue | 插画卡片去过滤，图片区加遮罩（保留现有 SkeletonCard 骨架与 pending 队列机制） |
| Following.vue | 同上 |
| UserHome.vue | 插画 + 小说两处列表去过滤加遮罩 |
| Bookmarks.vue | 同上 |

### 分页修正语义

所有页面的空页防护统一改为基于**服务端原始返回**判空（`res.novels.length === 0` / `res.illusts.length === 0`），不再基于过滤/去重后长度。

## Testing Decisions

### 测试接缝（seams）

**唯一新接缝：`settingsStore.isRestricted`（纯函数）**。这是本特性唯一的逻辑单元——遮罩显隐的全部判定收敛于此，页面组件只做 `v-if` 绑定。测试通过该函数接口进行，不触碰组件内部。

组件层（RestrictOverlay 渲染、骨架布局）不做单测：纯展示组件，逻辑为零（props → 模板直出），验证靠 web-core 人工预览。这与包内现状一致（包内无任何 .vue 组件测试，测试全部针对 ts 模块）。

### 测试清单

- **新增 `src/stores/settingsStore.test.ts`**（就近测试先例；需将 vitest `include` 扩展为 `['tests/**/*.test.ts', 'src/**/*.test.ts']`）
- 用例矩阵：`x_restrict ∈ {0, 1, 2}` × `showR18 ∈ {on, off}` × `showR18G ∈ {on, off}` 共 12 用例，断言布尔结果
- 纯函数无 IO，无需 mock（settingsStore 依赖 idbKV，测试直接操作导出的 `setShowR18`/`setShowR18G` 或 ref）

### 先例

- `tests/unit.test.ts` 中 `stores/authStore` 测试块：同属 store 测试，直接 import store 函数操作断言
- `tests/unit.test.ts` 中 tailwind↔tokens.css 契约测试：新增玻璃 token 后可参照补一条「token 存在性」契约断言（读 tokens.css 真实源文件比对，符合真实样例硬约束）

### 验证命令

```bash
pnpm check:app-lynx    # 类型检查
pnpm test:app-lynx     # 单测
pnpm dev:app-lynx      # web-core 预览：遮罩玻璃效果 + tap 不穿透 + 骨架
```

真机 LynxView 玻璃退化为实色盖作为后续手动验证项。

## Out of Scope

- 主包 `packages/app`（SolidJS）的 R18 过滤逻辑不动——本次范围仅 `packages/app-lynx`
- 遮罩点击跳转设置页 / 提供开关按钮（用户明确否决）
- 空态引导文案优化（推荐 tab 补空态非本次目标；遮罩方案下全过滤白屏已不可能）
- 插画详情页的遮罩（handoff 未列入；如后续需要单独提）
- 原生 LynxView 的 backdrop-filter 真实效果验证（引擎不支持，退化为实色盖即可）
- ADR-0051 文档修订（实施后由 openwiki 更新流程同步）

## Further Notes

- ADR-0051 的过滤策略被本方案取代：从「过滤隐藏」转为「全量渲染 + 遮罩」。实施完成后 `docs/adr/ADR-0051-lynx-r18-filter.md` 需在 openwiki 更新时标记 superseded（或新增 ADR）。
- UserHome.vue 插画空态存在一个小瑕疵（`v-if` 未排除 `errorMsg`，出错时空态与错误文本可能同显）——顺手修复，不单独列 ticket。
- tokens.css 头部注释（L3）已声明 backdrop-filter 支持度有限，本方案的「单源退化」与该注释一致，无需改注释。
- 遮罩文案「该内容已在设置中隐藏」已经用户确认（2026-08 会话）。
