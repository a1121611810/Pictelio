# 发版前 QA 转换清单（双引擎转换矩阵 · 手工版）

> **每行源自真实缺陷回归（ADR-0162/0163），发版前必过；发现缺陷先登记本清单再修。**
>
> 断言口径为**内容断言**（数值/内容对比），禁止单纯「页面存在」类存在性检查（#374 口径修订）。spec 唯一事实源：`docs/specs/qa-defense-lines.md` §3.T2（首版矩阵 R1-R4，每行 = 一个已收口缺陷的回归）。

## 前置条件

- **BENCH_NAV=1 构建的 debug APK**（full 包即可）：lynx benchNav 钩子受 JS `__BENCH_NAV__` + 原生 `BuildConfig.DEBUG` 双门禁，release 包不含钩子。
- 真实账号已登录（R1 相关作品段、R3 收藏数依赖真实数据）。
- 已装模拟器或真机 + adb；**真机验收优先**（四个源缺陷均为真机形态）。

## 导航方式

- **lynx 侧进入目标表面一律用 benchNav 深链，不用模拟点击**（真机 `input tap` 对放射 FAB 环项 hit-test 不可靠，ADR-0136）：

  ```bash
  adb shell am start --es benchNav <scenario> -n io.pictelio.app/.MainActivity
  ```

  场景名：`illust`（`/illusts` 插画流）、`carousel`（推荐轮播）。搜索表（SearchSheet）暂无 benchNav 场景：先 `illust` 进插画流，再手动点 FAB 菜单「搜索」打开。
- **webview 侧手动导航**（R4 为基线对照，走真实用户路径）。

## R1 lynx 插画流：详情返回后相关作品段 + 滚动位置

**缺陷源**：ADR-0162——lynx 瀑布流中途插入 list-item 被 vue-lynx patch 静默丢弃，注入行从不渲染或「隔几个卡才出现」。

**操作步骤**：

1. `adb shell am start --es benchNav illust -n io.pictelio.app/.MainActivity` 进 lynx 插画流。
2. 等首屏出图后**截图 A**（或记住首屏第一张卡与滚动位置）。
3. 点击屏幕中部一张插画卡进入详情。
4. 系统返回回插画流，**截图 B**。

**内容断言**（禁存在性）：

- 定位刚浏览的那张卡（锚点卡）：卡**内部**存在「相关作品」展开段（头行 + 2×2 缩略图网格），不是列表中独立的一行，也不是「隔了几个卡才出现」。
- 对比截图 A/B：滚动位置不回顶，首屏元素一致。

**预期结果**：相关段紧贴锚点卡内渲染；返回后滚动位置保持。

## R2 lynx 搜索：翻页 + scope 切换

**缺陷源**：ADR-0163 背景表——URL polyfill `.hostname` 为 undefined 致翻页请求必败；scope 切换整表替换 patch 错位。

**操作步骤**：

1. benchNav `illust` 进插画流 → 点 FAB 菜单「搜索」打开 SearchSheet。
2. 搜多结果词（如 `風景`），记录结果行数 N1 与最后一行内容。
3. 滚动到列表底部，等第二页加载完成，记录行数 N2。
4. 切「小说」scope，逐行观察列表行类型。

**内容断言**（禁存在性）：

- N2 > N1（翻页后行数确实增加），且全程无「加载更多失败」横幅。
- 切「小说」scope 后：列表全部为小说行，无插画行残留（逐行核对行类型）。

**预期结果**：第二页正常追加；scope 切换后行类型整体切换、无错位残留。

## R3 lynx 推荐轮播：换卡后收藏数与内容刷新

**缺陷源**：ADR-0163 背景表——init-only props 在复用宿主下状态冻结（收藏数冻结在首卡）。

**操作步骤**：

1. `adb shell am start --es benchNav carousel -n io.pictelio.app/.MainActivity` 进推荐流，定位轮播卡。
2. 记录第 1 张卡的收藏数与标题/图片。
3. 滑动轮播 ≥2 张，逐张记录收藏数与标题/图片。

**内容断言**（禁存在性）：

- 每张卡的收藏数两两不同（对比帧文本数值；若真实数据碰巧同值，换一批数据复测）。
- 每张卡标题/图片随 index 变化，与推荐数据中对应作品一致（非首卡内容冻结）。

**预期结果**：滑动换卡后收藏数与内容随作品刷新，不冻结在首卡。

## R4 webview 搜索：基线对照

**定位**：R2 同序列在 webview 引擎的基线——webview 侧应全过；R2 失败而 R4 通过 = lynx 平台层缺陷（而非业务代码缺陷），登记时注明差异。

**操作步骤**：

1. 切到 webview 引擎（客户端切换页 `/client-switch`），从首页导航栏搜索入口进入搜索页。
2. 执行与 R2 相同序列：搜多结果词 → 滚到底等第二页 → 切「小说」scope。

**内容断言**：同 R2（行数增加、无失败横幅、scope 切换后无插画行残留）。

**预期结果**：webview 基线全过；R2/R4 双引擎对照成立。

## 结果登记

- 每行结果记「过 / 缺陷（issue 链接）」；发现缺陷先开 GitHub issue 并回填本清单，再进入修复（issue 流程见 `docs/agents/issue-tracker.md`）。
- 矩阵行扩展（收藏页、关注列表、排行榜、多图详情）走 spec `docs/specs/qa-defense-lines.md` §6 扩展路径；新增行同样必须内容断言。
