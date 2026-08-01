# ADR 0045: app-lynx 推荐页 scrolltolower 无限加载修复

## 状态

已采纳

## 分类

技术决策 / Bug 修复

## 日期

2026-08-01

## 背景

`packages/app-lynx` 推荐页进入后，`/v1/illust/recommended` 接口无限请求（`offset` 一路递增到 960+），用户感知为"死循环"。

诊断链（通过请求日志逐层排除）：

1. `onMounted` / `fetchFirstPage` / `loadRecommended` 各仅触发 1 次 → **排除重复挂载与重复导航**。
2. 后续全部是 `loadMore`（`offset=30→60→90→…→960`）→ 根因是 **`scrolltolower` 被无限触发**：list 内容高度不足视口 → list 永远处于"已到底部"状态 → 每次加载成功后立即再次触发。
3. 内容高度塌陷的元凶：**web-core 预览下 `<image auto-size>` 不生效**（图片高度为 0），卡片高度 ≈ 0，30 个卡片也无法撑满视口。
4. 第一轮用 `min-height: 300rpx` 保底**无效**——rpx 布局属性在 web-core 预览下塌陷为 0（见 ADR-0044 的 `--rpx-unit` 变量链失效），保底形同虚设。

## 决策

`Recommended.vue` 采用四层防护：

| 层 | 措施 | 防什么 |
|----|------|--------|
| 1. 布局保底 | `.CardImage { min-height: 40vw }`（= 150px @375） | auto-size 失效时卡片高度塌陷（**必须用 vw**，rpx 在 web-core 塌陷） |
| 2. 时间节流 | `loadMore` 内 800ms 间隔检查 | scrolltolower 高频触发 |
| 3. 加载冷却 | 每次加载完成（含 `fetchFirstPage` 完成后）起 3s 内忽略 scrolltolower | web-core 的 list 在内容追加后**延迟误触发** |
| 4. 空页防护 | `fresh.length === 0` 时置 `nextUrl = null` | 服务端返回空页但 next_url 存在时轮询空页 |

关键细节：**第 3 层必须覆盖 `fetchFirstPage`**——第一轮实现只给 `loadMore` 设置冷却，第一页完成后 `lastLoadEndedAt` 仍为 0，web-core 延迟几秒的误触发直接穿过冷却检查。补上后请求次数从"进入 2 次"降为"进入 1 次"。

`lower-threshold-item-count` 由 5 调为 2（更接近底部才触发，缩小误触发面）。

## 核心动机

web-core 的 `<list>` 组件在**内容追加后延迟误触发 `scrolltolower`**（布局重算导致），应用侧无法消除该行为，只能以"加载完成后冷却 + 内容保底高度"双保险防护。原生 LynxView 是否同样存在此问题待 #41 集成后验证。

## 风险与反面

- **3s 冷却的副作用**：用户进入页面后 3s 内快速滚到底，下一页加载会被延迟至冷却结束（MVP 可接受；可改为"用户滚动过才解除冷却"）。
- **min-height 40vw 是近似值**：原生端 auto-size 正常时该值仅作下限，无影响；web 预览端所有卡片等高（40vw），瀑布流真实比例在 web 预览不可见（原生可见）。
- **空页防护依赖 fresh 过滤**：若服务端连续返回重复数据，也会触发终止——属预期防御行为。

### 正面

- 进入推荐页接口请求从无限收敛为 1 次
- 四层防护互相独立，任何一层失效其余仍兜底
- 模式可复用到 NovelList 等其他使用 `<list>` + `scrolltolower` 的页面

### 反面

- 防护属于"绕开 web-core 缺陷"，非根治；web-core 升级后应重新验证能否简化
- 冷却/节流是时间启发式，极端网络环境下边界行为需回归

## 相关

- ADR-0044（rpx 布局属性在 web-core 塌陷的背景）
- `glossary-web-core-pitfalls.md`（web-core 预览已知缺陷术语表）
- 实施提交：`4ce313e fix(app-lynx): 修复推荐页 scrolltolower 无限加载（web-core 误触发）`
