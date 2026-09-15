# ADR-0162: lynx 相关作品注入行改为锚点卡内展开段（瀑布流 list-item 中途插入被 patch 丢弃）

- 状态：accepted（2026-09-16）
- 关联：spec `docs/specs/related-injection.md` §5.2 v2；ADR-0107（vue-lynx patch 框架 bug 家族）；ADR-0150；issue ①（用户报告「关联作品不在刚看的图文后面，隔了几个才出现」）

## 背景

相关作品注入行（spec related-injection）lynx 端 v1 渲染形态：把 `RelatedRow` 作为 **full-span list-item** 织入插画瀑布流（`displayItems` 交织流，行插在锚点卡后）。用户报告行「不在刚看的图文后面，而是隔了几个才出现，看不出关联性」。

模拟器取证（2026-09-15，pictelio_ui）：

1. related 请求真实发出（logcat `method_invoker`：BACK 回列表瞬间 `PictelioApi.request.GET`）；
2. 注入开关确认开启、无失败 warn（lynx console 走 `lynx_console.cc` 可观测）；
3. 行数据就位，但扫过 4+ 屏**从未渲染**；
4. 用户所见「隔几个才出现」= 后续分页 patch 后行偶尔物化。

结论：**向原生瀑布流 `<list>` 中途插入 list-item 被 vue-lynx patch 静默丢弃**——ADR-0107 D4 框架 bug 家族的第三个实证形态（整体替换错位、单项移除留空位之外的新成员：中途插入丢弃）。**不是** waterfall full-span 几何偏移（初始假设证伪）。

## 决策

渲染缝从「列表条目交织」下沉为「锚点卡 list-item 内部展开段」（方案 B）：

- 列表只渲染纯插画流（`visibleIllusts`），`displayItems` 交织层删除；
- store 新增 `rowFor(tab, anchorId)` 渲染查询（状态机不变）；
- 锚点卡 list-item 内部、`openDetail` 冒泡域外的兄弟位条件渲染 `RelatedInlineSection.vue`（哑组件）：头行 + loading 骨架 / 2×2 网格（`RELATED_GRID_SIZE=4`，20vw 缩略图）互斥双分支；
- 收起 = `removeRow`，段内缩略图点击 = `openRelated`（不记锚点）。

### 备选与否决理由

- **A. 插入后 refreshEpoch 整树重建**：行位置正确，但 lynx list 无 scroll-to-offset API（FAB 回顶即靠重建实现），重建必然甩回顶部——从详情返回丢阅读位置，不可接受。
- **C. 行追加列表末尾 + 锚点标题标注**：追加是已证明安全的 patch 路径，但违反「行紧贴锚点」硬验收。

### 风险验证（T0 spike，2026-09-16 模拟器）

item 内部内容变更（生长/收缩）与 list 级条目插入是不同风险面。spike 四场景：S1 点卡返回段渲染在 ♥ 正下方且列表无错位/滚动保持 ✓；S2 收起干净收缩、瀑布流自然补位 ✓；S3 清空路径由 S2（同收缩路径）+ 既有 refreshEpoch 重建覆盖；S4 tab 切换重建正常 ✓。**gate 通过后才实施打磨。**

## 后果

- 双端渲染形态合法分叉：webview 单列交织行维持 v1 形态；lynx 卡内展开段。行为语义（状态机/上限/去重/缓存/清空时机）双端不变。
- 已知代价：段被限制在 48.4vw 列宽内（4 张缩略图，v1 full-span 为 8 张）——紧贴硬验收优先。
- 平台事实沉淀：lynx 瀑布流 list-item **插入=丢弃 / 移除=留空位 / 替换=错位**，任何列表结构变更都必须走 `:key` 整树重建或避免结构变更（与 ADR-0107 D4、ADR-0112 D5 合并阅读）。
- 源级守卫：`IllustList.template.test.ts`（禁止 displayItems 回流）+ `RelatedInlineSection.template.test.ts`（哑组件边界）。
