# Spec: app-lynx 推荐轮播打磨 R2（封面比例显示 / 轮播吸附阈值+fling / 冷启动沉浸骨架 / 标签胶囊行）

- 状态：draft（Grill 已收敛并确认，2026-08-28；待 to-tickets 确认后进实现）
- 日期：2026-08-28
- 关联：`docs/adr/ADR-0118-app-lynx-recommended-carousel-polish-r2.md`、ADR-0115（推荐轮播）、ADR-0117（CoverImage 深模块）、`packages/app-lynx/CONTEXT.md`（新增 4 词条）、`docs/specs/app-lynx-recommended-carousel.md`（轮播原始 spec）、`docs/specs/app-lynx-recommended-carousel-image-fab-polish.md`（图片三态）
- 前置：已有推荐轮播的**细化打磨**（4 点），不改数据层（createMixFeed / time-merge 语义不变）、不动其它页面。

## 1. 背景与根因

推荐轮播（ADR-0115）与图片三态（ADR-0117）上线后，真机/web 反馈 4 个体验问题：

1. **封面被裁**：滑页封面 `aspectFill` 全屏铺满，宽度虽满但高度被裁切，整图不可见。
2. **翻页手势太重**：吸附判定「round 最近页」（阈值 = 50% 屏宽）+ 无 fling，体感「快滑满一整个屏幕宽度才切到下一页」。
3. **冷启动无骨架**：首载只有「加载中…」文字；冷启动（首帧 token 未恢复、401 补拉）存在无占位空白窗口；原始 spec §2.5 承诺的「沉浸卡规格骨架」未落地。
4. **无标签**：滑页信息区不展示作品标签（数据已含 `tags` + `translated_name`）。

**形态决策（Grill 确认）**：图片贴顶、宽满、高按原图比例（超高图回退 aspectFill）；吸附阈值降为 1/3 + fling 甩动；首载渲染沉浸卡规格骨架；滑页 scrim 区展示标签胶囊行。

## 2. 产品行为

### 2.1 封面比例显示（R1）

- 滑页封面：**贴顶、宽度占满滑页、高度按原图比例**——不裁切、不变形，整图可见。
- 显示高度用作品元数据**预计算**（插画 `width/height`；小说无尺寸字段，方形封面按 1:1），不等图加载。
- **超高图**（按比例高度 ≥ 滑页可视区高）：回退 `aspectFill` 裁切（不溢出、不引入页内滚动）。
- 小说封面与插画同规则。
- 底部渐变 scrim 信息区**保持在屏幕底部**：图短时，图与 scrim 之间露出 surface 背景；信息不压图（scrim 不叠在图上）。
- 图片三态（骨架 / 图片 / 失败+重试）保留（CoverImage 承载）。

### 2.2 轮播手势（R2）

- 吸附阈值从「50% 最近页」改为 **1/3 屏宽**：拖过 1/3 松手翻页，未过回弹。
- 新增 **fling 甩动判定**：快速滑动（速度超阈值）即使未到 1/3，也**沿速度方向**翻页；慢拖仍按阈值。
- **上一张 / 下一张对称生效**；吸附动画保留（现有缓动不改）。
- 手势阈值参数收敛为常量（页面级/模块级），不做设置项。

### 2.3 冷启动沉浸骨架（R3）

- 首载（渲染流为空）显示**沉浸卡规格骨架**：上部全宽 shimmer 图区 + 底部 scrim 区域文字条（标题 / 作者 / 徽章位占位），取代「加载中…」文字。
- 触发 = **渲染流为空即显**（不依赖 loading 标志），冷启动请求发出前立即出现。
- 首载失败：骨架换成现有整页错误提示（槽位不变）。
- **已有数据时刷新：不闪骨架**（保留当前轮播卡片，现状已如此，维持）。
- 与「图片三态」的图级骨架不同层：页级首载占位。

### 2.4 标签胶囊行（R4）

- 滑页 scrim 区新增标签行：**插画 + 小说统一展示**。
- 位置：**类型徽章行下方、标题上方**。
- 形态：M3 assist-chip（同「类型徽章行」：`bg-secondary-container` / `text-label-medium` / `md-shape-small`），文本 `translated_name || name` 带 `#` 前缀。
- 数量：**最多 3 个，超出折叠为「+N」**（N = 未展示数），单行不换行。
- **纯展示不可点**（app-lynx 无搜索路由）。

## 3. 技术设计

### 3.1 吸附判定扩展（R2）

- `swiperMath` 新增纯函数：`calcSnapTarget(offset, itemWidth, opts)`——入参含位置、页宽、可选速度（px/ms）与阈值常量；语义 = 1/3 屏宽阈值 + fling 速度判定，双向对称；返回吸附目标 offset（仍经既有 `clampOffset` 钳制）。`calcNearestPage` 保留为教程原义（旧 oracle 对照，不再被轮播调用）。
- `CarouselSwiper` 触摸链路补速度采样：`touchmove` 记录位移/时间（轻量，不做高频 ref 风暴），`touchend` 计算速度传入 `calcSnapTarget`。
- 阈值与 fling 速度常量集中在 `swiperMath`（纯常量，可测），页面不散写魔数。

### 3.2 封面比例显示（R1）

- `CoverImage`（深模块，小接口）全 bleed 模式扩展显示方式：新增可选 `fit?: 'cover' | 'width-fill'`（默认 `cover` = 现状，仅推荐轮播改用 width-fill；box 模式不受影响、无 blast radius）+ width-fill 用 `ratio?: string`（如 `"1 / 1"`）。
- 显示参数由**纯函数推导**：`deriveCoverDisplay({ imgWidth?, imgHeight?, viewportWidth, viewportHeight })` → `{ fit: 'width-fill' | 'cover', ratio?: string }`——按比例高度 < 可视区高 → width-fill + ratio；≥ 可视区高（超高图）→ cover（aspectFill 回退）；尺寸缺失（小说）→ 按 1:1。可视区尺寸由调用方从 `SystemInfo` 派生（px），纯逻辑 node 可测。
- `RecommendedCover` 透传 fit/ratio；滑页 scrim 信息区保持 `absolute bottom-0`（图短时下方露出背景）。

### 3.3 沉浸骨架（R3）

- 新建页级首载骨架组件（沉浸卡规格）：全宽 shimmer 图区 + scrim 区域文字条占位（复用现有 shimmer 微光样式面，M3 surface 令牌）。
- `Recommended.vue` 首载分支：`items.length === 0` 且无错误 → 骨架组件（不再用「加载中…」文字，也不依赖 `loading`）；错误槽位不变；有数据分支不变。

### 3.4 标签胶囊行（R4）

- 新建展示组件 + 纯逻辑：`resolveTagChips(tags, max = 3)` → `{ chips: string[], overflow: number }`（`translated_name || name` + `#` 前缀，超出折叠计数；node 可测）。
- 组件渲染 M3 assist-chip 行（形态同「类型徽章行」），置于 scrim 区类型徽章下方、标题上方；插画与小说共用。

### 3.5 约束（沿用 AGENTS）

- 先渲染后加载：首帧先出骨架再发请求；无路由级阻塞。
- 竞态防护：手势/骨架/图片状态各自独立，不污染其它滑页（沿用 generation/`watch(src)` 复位模式）。
- 非静默降级：尺寸缺失（小说 1:1 假定）、`translated_name` 缺失（回落 `name`）为**显式契约**，必要时 `console.warn`（带模块前缀）。
- 样式：Tailwind utility + M3 令牌，不新增手写 scoped CSS。

## 4. 测试

### 单测（node，新建/修改；oracle 均注明来源）

| 用例 | 断言（oracle） |
|------|----------------|
| `calcSnapTarget`：1/3 阈值翻页/回弹边界（0.32 vs 0.34 屏宽） | 阈值语义（Grill 确认：拖过 1/3 翻页）；边界值表格 |
| `calcSnapTarget`：fling 快甩短距离（位移 < 1/3 但速度超阈值）翻页 | 速度判定语义；方向 = 速度方向 |
| `calcSnapTarget`：慢拖未过阈值回弹；双向对称（左滑/右滑同规则） | 对称性性质 |
| `calcSnapTarget`：非法输入（NaN / 页宽 ≤ 0）返回 0 | 防 NaN 污染 transform（沿用现有 `calcNearestPage` 惯例） |
| `deriveCoverDisplay`：方形/竖长/横长/超高图 → width-fill / cover 回退 | 按比例高 ≥ 可视区高 → cover（Grill 确认规则）；1:1 方图 → width-fill |
| `deriveCoverDisplay`：尺寸缺失（小说）→ 1:1 width-fill | 小说方形封面契约 |
| `resolveTagChips`：≤3 全显 / >3 折叠 +N / `translated_name` 优先 | 3+N 折叠规则（Grill 确认）；`translated_name || name` 契约 |

（组件渲染行为——比例显示、fling 手感、骨架、chip 行——属 Lynx 渲染面，归 web-core + 模拟器/真机验证闭环，node 不直接测组件模板。）

### 验证闭环

- `pnpm check:app-lynx`（tsc）+ 单测全绿。
- **web-core 预览实测**：封面整图可见不变形（方图/竖长图/超高图回退）；拖 1/3 翻页、快甩短距离翻页、未过 1/3 回弹、上一张对称；冷启动首帧先出沉浸骨架再出图、刷新不闪骨架；标签行 3+N、`#` 前缀、插画/小说都有。
- **模拟器实测**：同上清单 + 图片三态/重试/点卡进详情/受限跳过/单刷新 FAB 无回归。真机确认通过前不得宣称完成（沿用既有闭环）。

## 5. 验收条件

- 每张滑页封面**整图可见、不变形**：宽满、高按原图比例；超高图不溢出（回退裁切）；小说封面同规则。
- 拖过 **1/3 屏宽**松手翻页；**快甩**（速度超阈值）短距离也翻页；未过阈值回弹；上一张/下一张对称；吸附动画保留。
- 冷启动/首载：**先出沉浸骨架**（shimmer 图区 + 文字条）再出图；刷新（有数据）不闪骨架；失败显示整页错误。
- 滑页 scrim 区显示**标签胶囊行**：插画 + 小说统一、最多 3 个 + 「+N」、`#` 前缀、纯展示。
- 其余行为不变：点卡进详情（`/illust/$id` / `/novel/$id`）、受限跳过、单刷新 FAB、图片三态（骨架/失败/重试）、无限滑流。

## 6. 排除项（本轮不做）

- app-lynx 新增搜索路由（标签纯展示，不可点）。
- 页内滚动 / 超高图可滚动查看。
- 位移放大（加速跟手）。
- 吸附阈值 / fling 速度做成用户设置项。
- 其它列表页（插画/小说/关注/收藏/用户主页/追更）的封面比例与标签改动。
- 指示器（既有排除，ADR-0115 spec §6）。
- 数据层改动（createMixFeed / time-merge 不动）。

## 7. Ticket 拆解（to-tickets 草稿，待用户确认）

| # | Ticket | 内容 | 前置 | 波次 |
|---|--------|------|------|------|
| T1 | 吸附判定扩展（阈值 1/3 + fling） | `swiperMath` 新增 `calcSnapTarget`（阈值/fling 常量）+ `CarouselSwiper` 速度采样接线 + 单测 | 无 | 波 1 |
| T2 | CoverImage 比例显示模式 | `fit: 'width-fill'` + `ratio` 支持 + `deriveCoverDisplay` 纯函数 + 单测 | 无 | 波 1 |
| T3 | 标签胶囊行 | `resolveTagChips` 纯逻辑 + chip 行展示组件 + 单测 | 无 | 波 1 |
| T4 | 沉浸骨架组件 | 页级首载骨架（shimmer 图区 + 文字条） | 无 | 波 1 |
| T5 | Recommended.vue 接入 | 比例显示（fit/ratio）+ 骨架触发（空流即显）+ 标签行接入 + 新手势接线 | T1, T2, T3, T4 | 波 2 |
| T6 | 验证闭环 | 单测全绿 + check + web-core 实测 + 模拟器清单 | T5 | 波 3 |

并发策略：波 1 = T1 / T2 / T3 / T4 并行（互不依赖）；波 2 = T5（集成）；波 3 = T6（验证）。每 ticket 走 TDD + 自测 + code-review。
