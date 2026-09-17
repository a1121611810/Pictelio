# ADR-0165: lynx 正文选中与自绘操作菜单的契约

- 状态：accepted
- 日期：2026-09-17
- 关联：wayfinder 地图 #558（决策全清）、#559（设备实证）、#560（复制通道）、spec `docs/specs/app-lynx-novel-text-selection.md`、取证报告 `docs/research/lynx-text-selection-device-probe.md`（分支 `probe/text-selection-559`，含实现期复验证据与探针页）、`packages/app-lynx/CONTEXT.md`（词条：正文选中 / 操作菜单 / 选中文本通道）、ADR-0123（原生命中测试不认 `pointer-events`）、ADR-0131（内容区尺寸契约）、ADR-0134（正文列表虚拟化）

## 背景

lynx 小说详情页此前无法选中正文文字（只能整章导出）。要让用户长按选词并弹出自己的菜单（复制 / 搜索），必须开启引擎的原生选中能力——而这条路有三个**无法从代码自明**的平台事实，且其中两个只有在真机上才会暴露：

1. **选中属性必须静态字面量**：`:custom-context-menu="expr"`（动态布尔绑定）会被 vue-lynx 吞掉，引擎自带的 ActionMode 菜单（复制/全选）照旧弹出，自绘菜单无法接管；改成静态 `custom-context-menu="true"` 后引擎菜单消失。同批静态 `text-selection="true"` / `flatten="false"` 生效（`flatten="true"` 静态负控 → 长按 0 次 `selectionchange`，即 `flatten=false` 是选中的硬前提）。
2. **运行时没有 `navigator`**：剪贴板既无 `navigator.clipboard`（对象不存在），引擎也没有内置剪贴板 JS API（`liblynx.so` 内 `clipboard` 零命中）→ 「复制」必须自建原生通道。
3. **选中事件的索引是 UTF-16 码元，且可能落在代理对中间**：某段文本 35 码元 / 34 码点，选中末位字符引擎给 `(34,35)`（只有码元解释成立）；**判决实验**：长按 emoji 右侧的「与」给 `(14,15)`——码元解 = 「与」（手指所在字）、码点解 = 「英」，唯一确定码元域。而选中 emoji 时引擎给 `(11,12)` = 高代理单元 —— 直接 `String.slice` 会得到半个字符（粘贴显示 ◇?）。同时 `getTextBoundingRect` 遇**整段** range 必失败（`code:1`），需把测量范围收敛到 `len-1`。

另有两个交互事实（同为设备实证）：

4. **点空白不派发清空事件**：点正文会派发 `start === -1`（选区与手柄消失），点列表空白/页头**什么都不派发** → 菜单不会自己收，宿主必须转发 `@tap`（tap-away）。
5. **长按抬手的 release 会被判为 tap**：若不保护，刚弹出的菜单会被用户自己这次长按的抬手收掉 → 宿主 `@longpress` 打标 + 模块消费该次 tap（`useLongPress.consumeLongPress` 同款惯例）。

## 决策

1. **选中能力按静态字面量契约启用**：正文段落 `<text>` 上写死 `text-selection="true"` / `flatten="false"` / `custom-context-menu="true"`，并配稳定 `id` 与 `:bindselectionchange`。**禁止**改为动态绑定；由源级守卫测试（`novelDetailSelection.template.test.ts`）钉住形态，防回归。
2. **一个深模块吃掉整条链**：`primitives/createTextSelection.ts`（框架无关、依赖注入）负责事件解析 → 索引切片 → 异步测矩 → 定位 → 五条收起路径 → 动作执行与反馈；`composables/useTextSelection.ts` 只是 Vue 薄绑定；`components/TextSelectionToolbar.vue` 是哑视图。端口恰好三个：引擎（`createLynxSelectionEngine`：vw 换算 + 校准 + 尽力清选）、剪贴板（`createLynxClipboard` + `PictelioClipboardModule`）、搜索（`openSearch` 幂等吞词的唯一收编点）。
3. **索引按码元解释并吸附代理对**：越界判定用 `String.length`（码元）；切片前把 range 向外吸附到代理对边界（`start` 指到低代理 → 退一位；`end-1` 是高代理 → 进一位）。普通文本是恒等变换。
4. **测量范围收敛**：`end === 码元数`（整段）时测量 `[start, len-1)`；若退化（只选末位单字符）再向左扩一位；仍退化则只 warn 不出菜单。
5. **可见性 ⇔ modalStack 注册**：仅在测量成功、工具栏可见时注册返回键消费；拖手柄重测期间**保留上一次成功位置**（不逐帧隐藏 → 不闪烁，且不变式天然成立）；测量失败沿用上次位置或保持隐藏，绝不猜位置。
6. **收起四条路径**：① 点正文/点别处（引擎清空事件或宿主 `@tap` tap-away）② 列表滚动（BT `@scroll` + `:scroll-event-throttle="0"`，隐藏态零成本早退）③ 返回键（modalStack，先关菜单 → 再清选 → 再返回页面）④ 切章/卸载。长按抬手的那次 tap 被消费，不算「点别处」。
7. **复制无乐观态**：以原生 `ok === "1"` 判成功；模块缺失/失败可见（原位「复制失败」+ warn），禁假成功（#568 教训）。
8. **原生选区清除是尽力而为**：`setTextSelection` 退化参数调用失败只 warn 一次；滚动收起后引擎高亮可能残留（新选中/点正文会自然清掉），记为已知项而非缺陷。

## 后果

- 小说正文获得与系统一致的选中体验 + 自绘 M3 菜单；跨段选中、划线批注、分享/翻译选中均不在本决策范围（跨段的程序化 `setTextSelection` 能力已验证可用，将来可直接复用）。
- **模板接线不可类型化**：三条静态属性、`@longpress`/`@tap` 转发、`:scroll-event-throttle="0"` 都活在模板里，只能靠源级守卫 + 设备验收（web-core 预览对 `custom-context-menu` 零实现，预览不构成证据）。
- 缺陷面收窄为三条可测断言：索引单位（码元 + 吸附）、测量范围（非全量）、可见性与注册同寿命；三者都有 node 单测与设备证据（emoji 复制粘贴、整段选中、长按抬手、空白点击、返回键）。
- 剪贴板通道（`PictelioClipboard`）从此可用于任何 lynx 文本复制需求；`NetworkCheck` 的假成功 bug（#568）有了正确的落点。
