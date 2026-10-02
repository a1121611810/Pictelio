# Lynx 单位与 web-core 换算机制 — 术语表

> 范围：`packages/app-lynx` 响应式布局涉及的单位、换算关系与 web-core 渲染机制。配套 ADR：[ADR-0086-lynx-responsive-units.md](./ADR-0086-lynx-responsive-units.md)。

## 核心术语

| 术语 | 定义 |
|------|------|
| **px** | Lynx 绝对长度单位，= 逻辑像素（1/96 inch），等同 iOS pt / Android dp。**不随屏幕宽度缩放**。macOS/Windows 平台不支持。 |
| **ppx** | Lynx 物理像素单位，= 屏幕上一个真实像素的尺寸。Web 平台不支持。 |
| **rpx** | Lynx 响应式像素，官方一等公民单位。换算：**750rpx = 屏宽**（iPhone6：375px = 750rpx，1rpx = 0.5px）。随屏宽线性缩放。 |
| **vw / vh** | 视口单位：1vw = 1% 视口宽，1vh = 1% 视口高。**vh 只适合 `100vh` 满屏场景**，手机高度差异大，不可用于间距/字号。 |
| **cqw / cqh** | CSS 容器查询单位：1cqw = 1% 容器查询宽度。web-core 用它实现 vw/rpx 的换算基准。 |
| **375 设计稿** | 以 375px（iPhone 逻辑宽）为设计基准的换算约定：`1px = 0.2667vw`、`1rpx = 0.5px`。 |
| **--rpx-unit** | web-core 注入的 CSS 变量（`calc(1cqw / 7.5)`，定义在 `lynx-view`），rpx 经它换算。**引用自身容器宽度，预览环境循环失效**（见 ADR-0086）。 |
| **--vw-unit / --vh-unit** | web-core 的 vw/vh 换算变量（`1cqw` / `1cqh`），同样基于容器查询。 |
| **transformVW / transformVH / transformREM** | `lynx-view` 可选属性（默认关闭）。**关闭时 vw/vh/rem 不经过变量链，由浏览器原生解析**——这是 vw 在 web 预览可靠的原因。 |
| **token_transformer.rs** | web-core 的样式单位转换器（Rust wasm），把 rpx/vw/vh/rem/ppx 统一转成 `calc(N * var(--xxx-unit))` 模板。 |
| **auto-size** | `<image>` 组件的原生属性：不显式设宽高时按图片固有宽高比自适应。**web-core 下为 `display: contents`，不参与尺寸计算（失效）**。已不用于封面/大图——方形缩略图用 `aspect-ratio: 1/1`、详情大图用 API 宽高比动态 `aspect-ratio`（见 ADR-0048）。 |
| **web-core** | Lynx 的 Web 模拟渲染层（`@lynx-js/web-core`），运行在浏览器，是 web 预览（`__web_preview`）的实现。 |

## 换算速查（375 设计稿）

```
750rpx = 100vw = 屏宽
1rpx  = 0.5px = 0.1333vw
1px   = 2rpx  = 0.2667vw
1vw   = 3.75px = 7.5rpx
vw 值 = rpx 值 / 7.5
```

## 跨边界数值：从原生拿到的数默认是物理像素（2026-10-02 补）

⚠️ **本仓最易踩的一条单位陷阱**：Android 原生 API（`WindowInsetsCompat.getInsets()`、
`View.getWidth()` 等）返回的是**物理像素**，而 Lynx 的 `px` 是**逻辑像素**（= dp）。
直接 `+ 'px'` 拼进样式 ⇒ **按 density 倍放大**。

- **换算**：`逻辑px = 物理px / SystemInfo.pixelRatio`（= density）；
  物理像素要原样落地则用 **`ppx`** 单位（仅原生支持，web 不支持）。
- **仓库惯例**：一律在**取数的那一层**换算，下游只管消费。本仓既有 5 处同款换算
  （`viewportGeometry.ts` / `CarouselSwiper.vue` / `Recommended.vue` / `GlobalFab.vue`）
  —— 它们的共同点都是**除以 `pixelRatio` 后再喂给 `px`**。
- **实例（已修）**：ADR-0168 的 insets 管线漏了这道换算，导致状态栏 72 物理 px
  被渲染成 216 物理 px，所有页面 header 上方凭空多 144px 空白，且**随设备而变**
  （mdpi 恰好正确、density 3.0 错 3 倍）。修法 = `safeArea.ts` 成为唯一换算点。
- **怎么自查**：`dumpsys` 拿平台真值，再与截图像素量出的实际值对拍，**比的是幅值不是有无**。
  定性判据（「状态栏区域染了 surface 色」）在放大 N 倍后依然成立 ⇒ **测不出这类缺陷**。
  干净的单元素对照：拿一个写死 `1px` 的边框（如 `border-b-[1px]`）量它占几个物理像素行，
  直接读出该设备上 `1px` 的真实倍率。

## 单位可靠性矩阵（关键差异）

| 单位 | web 预览（web-core） | 原生 LynxView（Android/iOS） |
|------|---------------------|------------------------------|
| px | ✅ 原生解析 | ✅ 全平台（macOS/Windows 除外） |
| rpx（字号） | ✅ 实测正常（独立路径） | ✅ 原生引擎直接处理 |
| rpx（布局属性） | ❌ 走 `--rpx-unit` 变量链，预览环境塌成 0 | ✅ 原生引擎直接处理 |
| vw | ✅ 默认不转换、浏览器原生解析 | ✅ 官方文档全平台支持 |
| border-width / 阴影 | ✅ px 物理值，不缩放 | ✅ |

## 项目现状（2026-08）

`packages/app-lynx` 按 ADR-0086 采用：**字号/行高 rpx、宽高/间距/圆角 vw、边框/阴影 px**。推荐页封面原用 auto-size（ADR-0086 时期的方案），ADR-0048 起改为 **`aspect-ratio: 1/1` 方形容器**（web-core 下 auto-size 失效）。tokens.css 的 `--fontSize*` / `--spacing*` 令牌当前零引用（页面硬编码），清理时收敛。
