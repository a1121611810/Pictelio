# ADR-0135: 列表滚动指示条（滚动信号面复用，wayfinder #304 / #318）

- 状态：accepted
- 日期：2026-09-02
- 关联：ADR-0110（平台事实勘误来源）、ADR-0134（novel-detail 虚拟化，signal 面首次在工程使用）、`packages/app-lynx/CONTEXT.md`（滚动信号面 / 滚动指示条词条）
- 来源：wayfinder #304 「Lynx 滚动跟手性追平 webview」→ #310 列表方案选型（B1/B2/H6 全部止损）→ #318 信号面复用；官方 tutorial-gallery 参照 + 真机 ABBA 实测

## 背景

#304 地图终点「列表场景修复方案选型」（#310）经真机 ABBA 实测后三个候选全部止损：B1 增量渲染（页面 sync 增量 push）两轮配对 -0.1pp——机制已证伪（vue-lynx `main-thread/dist/list-apply.js` 的 `flushListUpdates()` 本来就是 `reported→items.length` 增量上报，BT 全量 map 换引用不导致 MT 重发）；B2 lower-threshold 提前（2→6/5→10）初测 -11.8pp 复测 +4.2pp 未确认；H6 estimated/preload 参数 -0.4pp~+4.8pp 无改善。测量学发现：OPPO R11s 同会话漂移 ≈ 4.3pp/轮——跨会话对比一律无效，必须同会话相邻 A 点插值配对。

随后 #318 转向「滚动信号面复用」——官方 tutorial-gallery 例证 `scroll-event-throttle="0"` 时 `<list>` 的 `@scroll` 可用（**ADR-0110「list 零派发」的根因是 throttle=100，真机复测推翻**）。三个候选（滚动指示条 / 速度感知图片降载 / 滚动态 UI 降载）中用户拍板优先实测滚动指示条（候选③）。

## 决策

1. **列表滚动指示条**：`<list>` 绑 `@scroll` + `scroll-event-throttle="0"` 驱动右缘竖条指示（高度=视口/内容比例、top=位置比例、滚动停止 500ms 后淡出）。**真机 ABBA 配对实测：jank 0.1930 → 0.1686 / 0.1131（-2.4~-8pp），P90 帧时长 19.4ms → 10-14.6ms（近减半）；drag 场景 0.119→0.049 (-7pp)。** 双轮一致且复测更强，非漂移——首个稳定越过 ≥2pp 止损线的修复。
2. **信号面节流**：`@scroll` 每帧 ~60Hz 派发（中位 18ms）为 BT 成本；指示条 UI 更新节流到 ~30Hz（33ms 阈值），停止后 500ms 定时器淡出，onUnmounted 清理。
3. **实现细节（真机实证，禁止回退）**：
   - 指示条节点必须在 `RefreshableList`（relative）容器内——原生 LynxView 以最近 view 祖先为定位锚点（ADR-0131）；
   - 显隐用 **opacity 而非 v-if**（v-if 每帧 flip 重建视图）；
   - 颜色用内联 rgba（`bg-surface-on-variant/50` Tailwind 透明度语法在原生 Lynx 不生效）。
4. **范围**：插画 waterfall（IllustList）为第一落地场景（主战场）；小说列表/详情是否扩展另列 ticket。
5. **验收口径**（沿用 C）：≥2pp 止损 + 真机主观双轨；同会话 ABBA 配对为唯一有效口径。

## 被考虑的方案

- **速度感知图片降载（候选①）**：@scroll 速度阈值 > 延迟新 cell 图片 src 绑定。技术可行（CoverImage 三态机已具备 imageSrc 边界），但图片链路已有引擎级 lazy-load（视口内 ~10 张），**增量收益未量化**——留后续独立 A/B（#318 候选空间）。
- **滚动态 UI 降载（候选②）**：滚动中抑制非核心渲染，价值小于图片，暂缓。
- **MTS 滚动条（官方 GalleryComplete 主线程版）**：`:main-thread-bindscroll` + `'main thread'` 指令——**仍 0 次派发**（2026-09-02 同轮复测与 NovelDetail 一致），桥保留待上游，不可用。
- **不做（维持现状）**：#310 止损结论保持（B1/B2/H6 不落地），但信号面已验证可用——放弃是低估已实证的杠杆。

## 后果

- 正面：目标场景（插画瀑布流）跟手性主观轴补上滚动条（webview 有、lynx 之前无的视觉差）；量化 jank 同步改善。
- 负面：`@scroll` 每帧事件的 BT 成本入账（被 30Hz UI 节流 + 500ms 停止淡出约束到最小）；信号面消费需遵循节流约定。
- 待验证项：跨页面扩展（小说列表/详情）时需逐场景 ABBA 复核（漂移口径）。
- 上游跟踪：MTS 派发（vue-lynx #302 / SDK 升级触发重估）；速度感知降载（#318 余项，触发条件 = 滚动条落地后抽空 A/B）。
