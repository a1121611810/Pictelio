# Web-core 预览已知缺陷与防护 — 术语表

> 范围：`packages/app-lynx` 在 web 预览（`@lynx-js/web-core`）下渲染行为与真实原生 LynxView 的差异，以及为绕开这些缺陷建立的应用层防护。配套 ADR：[ADR-0044-lynx-responsive-units.md](./ADR-0044-lynx-responsive-units.md)、[ADR-0045-lynx-scrolltolower-infinite-loading.md](./ADR-0045-lynx-scrolltolower-infinite-loading.md)、[ADR-0048-lynx-recommended-card-layout.md](./ADR-0048-lynx-recommended-card-layout.md)。

## 核心术语

| 术语 | 定义 |
|------|------|
| **渲染位置（iframe/shadow）** | lynx web-core 把渲染内容放在 `lynx-view` 元素内的 **srcdoc iframe + shadow root** 中——`document.querySelectorAll('*')` 不穿透，会误判"页面空白"。**自动化探测必须递归遍历 `shadowRoot` 与 `IFRAME.contentDocument`**（详见 ADR-0047）。Tailwind utility 出现在 x-view/x-text 的 className 上，可据此验证样式。 |
| **web-core** | Lynx 的 Web 模拟渲染层（`@lynx-js/web-core`），浏览器中运行，是 web 预览（`__web_preview`）的实现。**与原生 LynxView 行为存在差异，是多数 dev-only bug 的来源。** |
| **rpx 布局属性塌陷** | web-core 把 rpx 布局属性（padding/height/margin 等）转成 `calc(N * var(--rpx-unit))`，而 `--rpx-unit` 基于 cqw 容器查询引用自身宽度 → 循环失效 → 属性塌成 0。**布局保底/尺寸必须用 vw 或 px，不能写 rpx**（详见 ADR-0044）。 |
| **auto-size 失效** | `<image auto-size>`（按图片宽高比自适应）在 web-core 预览下不生效，图片高度为 0。**必须配 min-height 保底**，否则卡片塌陷。 |
| **scrolltolower 误触发** | `<list>` 的 `@scrolltolower` 触底事件在 web-core 下于**内容追加后延迟误触发**：list 内容高度不足视口（如卡片塌陷）时永远处于"已到底部"状态 → 无限触发 → 无限分页请求（见 ADR-0045）。 |
| **加载冷却（load cooldown）** | 防 scrolltolower 误触发的应用层防护：每次加载完成后 N ms（本项目 3s）内忽略 `scrolltolower`。**必须覆盖首屏加载（fetchFirstPage）完成点**，否则第一页完成后的延迟误触发会穿过检查。 |
| **时间节流（throttle）** | 800ms 间隔检查，防 scrolltolower 高频触发。与冷却独立：冷却期内触发被忽略且不更新节流时间戳。 |
| **min-height 保底** | 给可能塌陷的元素设 `min-height`（用 vw！）保证内容高度下限。web 预览下兜底，原生下被真实布局覆盖。 |
| **空页防护（empty-page guard）** | `loadMore` 返回 `fresh.length === 0` 时置 `nextUrl = null` 终止分页，防服务端返回空页但 next_url 仍存在时轮询空页。 |
| **HMR 不可靠** | rspeedy dev 对 vue-lynx `<style scoped>` 样式与组件热更新支持不完整（错误如 `lynx.requireModuleAsync is not a function`、hot-update 404）。**样式改动后建议直接重启 dev server + 强刷**，不要依赖 HMR。 |
| **百分比宽度基准异常** | web-core 下元素的 `width: %` 相对**根容器（视口）**而非父元素（实测 `<input>`、`list-item`、`x-image`）。嵌套百分比场景才暴露：父 `85%` + 子 `100%` → 子按视口宽度计算；瀑布流 `list-item` 被拉成视口宽（超出列宽被 `overflow-hidden` 裁剪）。**防护：普通 flex 子元素用 flex stretch 拉伸替代百分比；瀑布流 `list-item` / `x-image` 禁用 `w-full`，宽度交给 list 引擎约束为列宽**（见 ADR-0048）。 |
| **list-item margin 失效** | 瀑布流（waterfall）`<list-item>` 自身的 margin/padding **不参与布局**（相邻 item 零间隙，x/y/w/h 均不含 margin），卡片"粘在一起"；且 **list-item 内部任何 `view` 包裹会导致引擎定位计算崩**（所有 item 重叠在起点）。**防护：间距用 `<list>` 官方属性 `list-main-axis-gap`（行距）/ `list-cross-axis-gap`（列距），经 vue-lynx `:style` 对象绑定传入**（attribute 形式不响应，style 绑定生成 `--list-*-axis-gap` CSS 变量才生效，见 ADR-0048）。 |
| **widthFix 不存在** | web-core 源码（`web-core-main-chunk.js`）的 `<image>` mode 仅映射 `aspectFit`（`object-fit: contain`）、`aspectFill`（`object-fit: cover`）、`center` 三种；`widthFix` / `heightFix` 等**静默回退默认 `fill`**（图片拉伸变形）。**防护：方形缩略图用 `aspect-ratio: 1/1` 方形容器 + `aspectFill`**，不依赖 mode 的比例计算（见 ADR-0048）。 |
| **aspect-ratio 方形容器** | 方形缩略图（`square_medium` 360×360）完整显示不裁剪的标准方案：容器 `aspect-ratio: 1/1`（高度 = 宽度）+ `mode="aspectFill"`（`object-fit: cover`）。web-core 与原生 LynxView 均支持 `aspect-ratio`（原生差异：`auto` 值不支持）。 |
| **rem 单位风险** | web-core 的 wasm 转换模板含 `calc(N * var(--rem-unit))` 引用，但 client.css 未定义 `--rem-unit`——理论会塌陷；**原型实测 Tailwind 默认 rem 档未塌陷**（当前 web-core 未实际启用该转换）。防护：配置层仍禁 rem（Tailwind spacing/fontSize 顶层替换为 vw/rpx），防 web-core 未来升级启用转换。 |
| **Tailwind JIT 类名扫描** | Tailwind v3 JIT 只编译源码**字面量**类名——动态拼接类名不会生效。防护：动态类用互斥全字符串三元（如 `cond ? 'a-class' : 'b-class'`），且新类后需重启 dev server（HMR 不扫新类）。 |
| **vw 原生解析** | `transformVW` 默认关闭时 vw 由浏览器 CSSOM 原生解析（不经 cqw 变量链）——web 预览下唯一可靠且响应式的长度单位（详见 ADR-0044）。 |

## 缺陷与防护对照

| web-core 缺陷 | 表现 | 防护 |
|---------------|------|------|
| rpx 布局属性塌陷 | 间距/高度为 0，布局挤在一起 | 布局尺寸一律 vw/px，不用 rpx |
| auto-size 失效 | 图片高度 0，卡片塌陷 | `min-height: NNvw` 保底 |
| scrolltolower 误触发 | 无限分页请求 | 加载冷却 + 节流 + threshold 调小 + 空页防护 |
| 百分比宽度基准异常 | `list-item`/`x-image` 被拉成视口宽，超出列被裁剪 | 瀑布流 item 禁用 `w-full`，宽度交 list 引擎；普通 flex 子项用 stretch |
| list-item margin/padding 失效 + 内部 view 崩 | 卡片无间距；内部包裹 view 时所有 item 重叠 | list 官方 `list-main-axis-gap`/`list-cross-axis-gap`（style 对象绑定） |
| widthFix 不存在 | mode 静默回退 fill，图片拉伸变形 | 方形图用 `aspect-ratio: 1/1` + `aspectFill` |
| HMR 不生效 | 改动不反映到页面 | 重启 dev server + 强刷 |

## 项目现状（2026-08）

`Recommended.vue` 与 `NovelList.vue` 均已应用上述全部防护（提交 `4ce313e` / `a3f5b21`）。原生 LynxView 是否受同样缺陷影响待 #41 集成后验证（可能全部不需要这些防护）。

**Tailwind 迁移后**（ADR-0046，提交 `062c7db` + `e210b48`–`1321330`）：6 页面全部改为 Tailwind utility；spacing=vw、fontSize=rpx、colors=Fluent 语义色板（引用 tokens.css 变量）；Tailwind 默认 rem 档经顶层替换排除；动态类用互斥全字符串（JIT 字面量扫描）。

**自动化视觉验证**（ADR-0047）：6 页面在默认浏览器（Vivaldi 持久 profile）+ 登录态真实数据下全部验证通过；探测必须穿透 lynx-view 内 iframe/shadow（详见"渲染位置"术语）。

**推荐列表卡片布局修复**（ADR-0048，提交 `a9274aa`）：`Recommended.vue` 瀑布流卡片禁用 `w-full`（宽度交 list 引擎约束为列宽）、方形缩略图用 `aspect-[1/1]` 方形容器 + `aspectFill`、卡片间距用 list 官方 `list-main-axis-gap`/`list-cross-axis-gap`（vue-lynx `:style` 对象绑定）。**Tailwind class 改动后 lynx 样式表不热更新，必须整页刷新验证**（HMR 只更新 DOM class，不更新 shadowRoot 内注入的编译 CSS）。

**详情页大图修复 + 骨架屏**（提交 `d62d1e2`）：`IllustDetail.vue` 大图改用 API 宽高比动态 `aspect-ratio` + `aspectFill`（widthFix 不存在导致高度 0 的同类坑）；推荐列表与详情页补 shimmer 骨架屏（`App.vue` 全局 `@keyframes shimmer` + `linear-gradient`，web-core 实测支持，原生待 #41 验证）。
