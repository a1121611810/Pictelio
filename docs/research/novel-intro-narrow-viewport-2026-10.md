# NovelIntro 动作行极窄屏（<320dp）降级矩阵 —— 实现记录与取证交接（票 #756）

- 日期：2026-10-23
- 范围：`packages/app-lynx/src/pages/NovelIntro.vue`（动作行 Row 1）+ 新增源级守卫 `packages/app-lynx/tests/novelIntroNarrowViewport.test.ts`
- 父票：#744（Spec: lynx 稍后看）· ADR-0191 D5 · ADR-0189

## 1. 结论

ADR-0189 spec §12 挂账的「<320px → 2×2 网格」降级矩阵**已落地**（未走「正式豁免 <320px」那条路）。
五动作版本按 ADR-0191 D5 后果段的扩容要求，矩阵取 **2 列 × 3 行（6 格，5 动作 + 1 空占位）**。

降级分支是**条件渲染**（`v-if`），不是「两支都渲染再靠 CSS 隐藏」——只有一支进 DOM，可被源级断言钉住。

## 2. 依据（oracle 溯源）

| 依据 | 位置 | 口径 |
|---|---|---|
| 降级阈值 + 降级形态 | `docs/specs/app-lynx-novel-intro-action-row.md:404` | 风险表那一行（#756 已订正并标记「已落地」）：「… ｜ 视口宽 < 320px ｜ **已实现**：降级为 **2 列 × 3 行**（5 动作 + 1 空占位，空位固定右下角…）」。⚠️ 该行原文是四动作时代的「改 2×2 网格布局」计划口径，已随五动作扩容订正 |
| ADR 决策（D1 五按钮同行的否决理由） | `docs/adr/ADR-0189-lynx-novel-intro-action-row.md:32`、`:36`、`:100`（正文为**决策史**，原样保留） | 「< 320px 规格降级到 2×2 网格已在 spec §12 风险表挂账」；风险表列「极窄屏（视口宽 < 320px）需降级为 2×2 网格布局」。⚠️ 同文件第 5 行有 #756 订正横幅，把该口径订正为 2 列 × 3 行 |
| 五动作扩容口径 | `docs/adr/ADR-0191-lynx-watch-later.md:64` | 后果段：「小说介绍页 Row 1 由四动作增至五动作（…极窄屏 `< 320px` 降级矩阵需在 spec 同步扩容）」 |
| 触控下限 40px | 票 #756 验收标准第 2 条 | T3 实测口径 |
| 单位换算（750rpx = 屏宽） | `docs/adr/glossary-lynx-units.md`「换算速查」 | 1rpx = 0.1333vw；px = 逻辑像素（= dp） |
| 间距/字号档位单一事实源 | `packages/app-lynx/tailwind.config.ts` | `theme.spacing` / `theme.fontSize` |

## 3. 降级矩阵（2 列 × 3 行）

读取顺序 = 单行分支的既有顺序（收藏 → 追更 → 下载 → 目录 → 稍后看）：

```
行 1 │ 收藏      │ 追更
行 2 │ 下载      │ 目录
行 3 │ 稍后看    │ （空占位）
```

排布理由（写在代码注释里，`NovelIntro.vue:586` 起）：

1. **空位固定在右下角**：五动作填不满 2×3（6 格），缺口放在末尾 ⇒ 网格读序与单行分支一致，不会读成「收藏/追更…稍后看被挤到第三行」。
2. **格位恒在、条件渲染挂在动作上**：追更 / 目录 仅 `novel.series` 存在时渲染（ADR-0189 D8/D9），缺席时该格即为空占位（与在场格同宽）⇒ 网格恒为规整 2 列，**不出现中间空洞**。
3. **行间距用 spacing 档位**（`mt-2` = 2.133vw），不写 px 字面量（MD3 令牌纪律）。

代码位置：

- 判定与阈值：`packages/app-lynx/src/pages/NovelIntro.vue:227`（`NARROW_VIEWPORT_DP = 320`）、`:233`（`declare const SystemInfo`）、`:240`（`viewportWidthDp()`）、`:252`（`narrowViewport`）
- 宽屏分支（保持原样不动）：`NovelIntro.vue:519`
- 极窄屏分支：`NovelIntro.vue:586`（矩阵注释）→ `:603`（容器）

## 4. 判定口径

- 阈值 **320 是逻辑宽（dp），不是物理像素**：判定走 `SystemInfo.pixelWidth / SystemInfo.pixelRatio`（`NovelIntro.vue:240`）。
  本仓同款换算 5 处：`utils/viewportGeometry.ts:43`、`components/CarouselSwiper.vue:66`、`pages/Recommended.vue:188`、`components/GlobalFab.vue:80`，以及**本轮新增的第 5 处** `pages/NovelIntro.vue:242`（术语表「跨边界数值」条点名 4 处，第 5 处即本票新增）。
- **web-core 预览无 `SystemInfo`** ⇒ 兜底 375（iPhone 逻辑宽近似，同 `Recommended.vue:187`）⇒ 预览恒走宽屏分支（预览不是取证环境）。
- **Lynx 无响应式视口宽度事件**（`SystemInfo` 是只读全局，仓内既有用法同此）⇒ setup 期取一次快照；本页全屏不滚动、无横竖屏切换场景，旋转后需重进页面才重算。
- 宽屏分支与极窄屏分支用**互补条件**（`v-if="!narrowViewport"` / `v-if="narrowViewport"`），非 `v-if`/`v-else`：
  既有源级断言 `src/pages/watchLaterEntry.template.test.ts:62` 以「**首个** `<view class="flex-1 min-w-0" @tap.stop>`」为锚点，宽屏在前 ⇒ 该锚点仍指向宽屏分支的第五动作，覆盖不被降级分支稀释。

## 5. 触控目标下限算式（票 #756 验收口径：≥ 40px）

### 5.1 输入（全部来自独立来源）

| 量 | 值 | 出处 |
|---|---|---|
| 动作行左右内边距 | `px-6` = **6.400vw / 侧**（**只扣 scrim 的 px-6**） | `tailwind.config.ts` spacing 6（scrim `px-6`）。⚠️ **订正（2026-10-23，F2）**：原表还扣了卡片的 `px-4`，但**动作行不是那张卡片的子节点**——`NovelIntro.vue` 的 DOM 是 scrim（`:405` `px-6`）→ 信息卡（`:422` `px-4`，**在 `:501` 就闭合**）→ 动作行（`:519` 宽屏 / `:603` 极窄屏）是 **scrim 的直接子节点** ⇒ `px-4` 不参与动作行宽度 |
| 可用宽 | `W × (1 − 2×6.400/100)` = **0.872 W** | 推导 |
| 图标高 | **6.4vw**（`leading-none` ⇒ 行高 = 字号） | `components/AppIcon.vue` 缺省 `size: 6.4` |
| 图标↔标签间距 | `mt-1` = **1.067vw** | `components/ActionButton.vue` |
| 标签行高 | `label-small` = 32rpx = **4.2667vw** | `tailwind.config.ts` fontSize 四元组（32rpx × 100/750） |
| 上下内边距 | `py-2` ×2 = **4.266vw** | `components/ActionButton.vue` |

### 5.2 算式

```
可用宽 A(W)      = W × 0.872
极窄屏格宽        = A(W) / 2 = 0.436 W        （2 列）
极窄屏格高        = 16.000vw = 0.159997 W     （6.4 + 1.067 + 4.2667 + 4.266）
宽屏单钮宽        = A(W) / 5 = 0.1744 W        （5 等分）
```

> ⚠️ **订正（2026-10-23，Spec 轴 Round 2 复核 F2）**：原算式为 `0.78666 W`（多扣了卡片 `px-4`），
> 已被真机 UI 树**证伪**：300dp 视口下行容器 x=69 w=942px ⇒ 行内宽 **261.67dp = 0.87233W**
> （精确对应 `px-6` = 6.400vw），每格 **130.8dp**；旧算式预测 118.0dp，**与实测矛盾**。
> 修正后算式**预测值 = 实测值**（130.8dp / 261.6dp），旧算式已被实测推翻。

### 5.3 结果

| 场景 | 视口宽 | 宽度 | 高度 | ≥40px？ |
|---|---|---|---|---|
| 极窄屏分支（分支上边界） | 320dp | **139.52px** | 51.20px | ✅ 两维均达标 |
| 极窄屏分支（现实最窄机型） | 280dp | **122.08px** | 44.80px | ✅ 两维均达标 |
| 宽屏分支（分支下边界） | 320dp | **55.81px** | 51.20px | ✅ |

**触底宽度（算式可复核）**

```
高度触底：40 / 0.159997 = 250.01dp  ⇒ **两个分支的格高相同** ⇒ 两者的保底视口都是 250.01dp
宽度触底（极窄屏）：40 / 0.436   =  91.74dp  ⇒ 宽度维度不是瓶颈
宽度触底（宽屏）  ：40 / 0.1744  = 229.36dp  ⇒ 宽度维度同样不是瓶颈（< 250.01dp）
```

⇒ **订正后的结论（与旧结论不同）**：40px 触控下限的**约束项始终是高度（250.01dp）**，
两个分支**同**；宽度维度在宽屏分支（229.36dp）本就**不是瓶颈**（旧算式误判为 254.24dp 才是瓶颈）。
⇒ 降级的真实收益**不是**「把保底视口拉得更低」，而是**把每个可点区的宽度余量放大 2.5 倍**：
320dp 处 55.81px → 139.52px（对高度余量 51.20−40 = 11.20px 而言，宽度余量从 15.81px 变 99.52px）。
现实最窄机型（Galaxy Fold 封面屏 280dp）落在两档之上，双维度均达标。

> ⚠️ 票面「320px 视口约 54px/钮」与本表 55.81px 的差异：票面是 T3 实测值；本表按 **vw 制内边距**
> （`px-6` = 6.400vw/侧）与理想 5 等分推导。两者同在 50–57px 区间，结论（≥40px）一致。

## 6. 测试

新增 `packages/app-lynx/tests/novelIntroNarrowViewport.test.ts`（20 用例，全绿）：

```
cd packages/app-lynx && pnpm exec vitest run tests/novelIntroNarrowViewport.test.ts
→ Test Files  1 passed (1) / Tests  20 passed (20)
```

钉住的内容：① 降级分支存在且是条件渲染（不是 CSS 隐藏）；② 矩阵逐格断言 `[[bookmark, watch], [download, series], [later, empty]]`（3 行 × 2 列）；③ 宽屏分支仍是单行 5 等分（无 `flex-wrap` / `flex-col`）；④ 触控下限（**算式写进断言**：从 `tailwind.config.ts` 解析 spacing/fontSize、从 `AppIcon.vue` 解析图标尺寸后现算，含 250dp（高度）/ 229.36dp（宽屏宽度）触底宽度、三个尺寸漂移报警值与「算式 = 真机实测」对照断言）；⑤ 五个动作标签的 i18n 键在 zh-CN / en 双向字典中真实存在且非空；⑥ 阈值 320 与 spec §12 风险表、ADR-0191 D5 后果段的 oracle 链接，另有 ADR-0189 顶部 #756 订正横幅的同口径链接（ADR / spec / 实现三者）。

回归（未跑全仓门禁，按约定由上游集中跑）：`src/pages/novelIntro.template.test.ts`、`src/pages/watchLaterEntry.template.test.ts`、`tests/novelIntroEntryGuards.test.ts`、`src/components/WatchlistAction.host-matrix.test.ts`、`tests/hardcode-gate.test.ts`、`tests/md3GuardScans.test.ts`、`tests/mdTokenRefs.test.ts`、`tests/adrClaimConsistency.test.ts`、`src/components/{ActionButton,BookmarkButton}.template.test.ts`、`tests/lynxUnsupportedTailwindClasses.test.ts` —— 全部通过；`vue-tsc --noEmit -p src/tsconfig.json` 通过。

**门禁规模登记（规模线 30%，Standards 轴 2026-10-23 复核）**：本门禁 **274 行**（B1 算式订正新增「算式 = 真机 UI 树实测」对照断言后；Standards 轴第 6 轮 Spec 轴 F6 补「两分支 <WatchlistAction> 均带 :key」remount 契约断言再增 8 行）；按**最保守的单一被测对象**
口径（`src/pages/NovelIntro.vue` **746 行**）= **36.7% > 30% 规模线**（多被测对象读法下该门禁同时读
`tailwind.config.ts` / `AppIcon.vue` / spec / 两份 ADR，比值远低于 30%，此处仍按最保守口径登记）。
处置：① 每条断言都对应一个**真实缺陷类**（矩阵形状 / 条件渲染分支 / 触控下限算式 / i18n 键存在性 /
oracle 链接），删任一条都留一个无人钉的分支；② 已做**变异验证**（形状错位 / 漏主题 / 键写错三形态全红）；
③ **后续若再扩测点，须先拆文件**（真门禁 / 验收组分离），不得继续加码。

**门禁已知失效面（门禁冻结线 #5：不得只记它抓到了什么）**：

1. **源级断言，不渲染、不取像素** ⇒ 本门禁只证明「源码结构 + 算式输入」正确，**不证明渲染后的实际触控尺寸**；
   尺寸结论以 §9 的真机 UI 树取证为准（300dp 实测每格 130.8dp / 行内宽 261.7dp）。
2. **算式输入来自 `tailwind.config.ts` 与 `AppIcon.vue`** ⇒ 这两处的形态变化（token 改名、图标尺寸挪位）会让解析取不到值；
   取不到值是 **fail-loud**（断言转红），但**不会**提示「需重新标定」——该职责由「漂移报警」用例承担。
3. **只钉源码里的 320dp 阈值与分支条件** ⇒ 运行中改密度 / 横竖屏切换不重算这类**运行时行为不在覆盖内**（见 §8 残留 1）。
4. **不覆盖 Lynx/Yoga 的实际布局实现**（`min-width: auto` 是否生效）⇒ 已登记为 §8 残留 2 的真机待量项。

## 7. 截图取证交接（上游执行）

### 7.1 进入路径

- 路由：`/novel/:id/intro`（name `novel-intro`，`packages/app-lynx/src/router.ts:127`）。
- 触发：小说列表 `/novels`（或收藏 / 用户主页 / 追更 / 推荐轮播 / 搜索弹层等 6 个入口）点小说 → `utils/novelNavigation.ts:32-37` 的 `openNovel()`；设置 `novel_intro_first` **默认开** ⇒ 进介绍页（关掉则直达正文）。
- 介绍页上滑/不需要滚动，动作行固定在底部 scrim 卡片内（Row 2 是全宽主 CTA「开始阅读」）。

### 7.2 五个按钮的标签与相对位置

极窄屏（2 列 × 3 行）下的相对位置：

| 格位 | 动作 | 屏上文字（zh-CN） | 屏上文字（en） | 图标 |
|---|---|---|---|---|
| 行1 左 | 收藏 | **无文字标签**（心形 + 收藏数 chip） | — | `favorite_border` |
| 行1 右 | 追更 | 追更 / 已追更 | Follow / Following | `star_outline` |
| 行2 左 | 下载 | 下载 / 已下载 | Download / Downloaded | `file_download`（已下载 = `check`） |
| 行2 右 | 目录 | 目录 | Series | `list` |
| 行3 左 | 稍后看 | 稍后看 / 已在稍后看 | Watch Later / In Watch Later | `schedule`（LATER_ICON） |
| 行3 右 | — | **空占位**（无内容） | — | — |

宽屏（≥320dp）则是**同一顺序的单行 5 等分**：收藏 · 追更 · 下载 · 目录 · 稍后看。

### 7.3 造极窄视口（<320dp）

两台本机 AVD（`packages/android-host/tests/android-e2e/env.ts:139`）：

| AVD | 端口 | 屏幕 | 密度 | 逻辑宽 | 走哪支 |
|---|---|---|---|---|---|
| `pictelio_ui`（android-34） | 5556 | 1080×2160 | 480 | **360dp** | 宽屏 |
| `pictelio_low`（android-28） | 5554 | 720×1280 | 320 | **360dp** | 宽屏 |

⇒ **两台 AVD 默认都不是极窄屏**，必须临时改密度/尺寸（`emulator-5556` 上直接改）：

```bash
# 320dp（分支边界，验证「不进降级」）
adb -s emulator-5556 shell wm size 1080x2160
adb -s emulator-5556 shell wm density 540        # 1080 / (540/160) = 320dp

# 300dp / 280dp（验证「进降级 + 触控下限」）
adb -s emulator-5556 shell wm density 576        # 1080 / 3.6 = 300dp
adb -s emulator-5556 shell wm size 840x1680 && adb -s emulator-5556 shell wm density 480   # 840/3 = 280dp

# 还原
adb -s emulator-5556 shell wm size reset && adb -s emulator-5556 shell wm density reset
```

⚠️ **改完密度必须重启 App 再进页面**：`main/AndroidManifest.xml:34` 声明了 `android:configChanges="…|density"`，Activity 不会重建 ⇒ `SystemInfo.pixelRatio` 在进程内可能是旧值，而 `narrowViewport` 是 setup 期快照。
⇒ 流程：改密度 → `adb shell am force-stop <pkg>` → 重启 App → 进 `/novel/:id/intro` → 截图。

### 7.4 可复用的 e2e 基础设施

- **没有现成的 NovelIntro 专用 spec**（`packages/android-host/tests/android-e2e/specs/` 12 个 spec 里最接近的是 `lynx-bookmark-tags.spec.ts` 与 `transition-matrix.spec.ts`，两者都只覆盖列表页/小说正文页，不进介绍页）。
- 可复用的**工具层**（不用改它们）：
  - `packages/android-host/tests/android-e2e/driver.ts`（Appium 驱动）
  - `packages/android-host/tests/android-e2e/ui-tree.ts`（uiautomator 树，用于按文字定位按钮）
  - `packages/android-host/tests/android-e2e/pixel.ts`（截图）
  - `packages/android-host/tests/android-e2e/avd.ts` + `env.ts`（AVD 起停，`pictelio_ui` = 5556）
  - `packages/android-host/tests/android-e2e/evidence/`（既有取证截图目录）
- 建议新增 spec 时对齐的既有形态：`specs/lynx-bookmark-tags.spec.ts`（Lynx 页断言）。

## 8. 残留与风险

1. **判定是 setup 期快照**：横竖屏切换 / 运行中改密度不会重算（需重进页面）。Lynx 无响应式视口宽度事件，仓内既有用法同此（`CarouselSwiper.vue:66`、`Recommended.vue:188`）。
2. **宽屏分支的收藏格可能比理论 1/5 更宽**：`min-width: auto`（Yoga 是否实现自动最小尺寸未实测）会让 chip 的 min-content 宽（≈0.224W，3 位计数时）挤占其余 4 列（≈0.1744W ≈ 55.8dp @320dp）。仍 ≥40dp，但**比本表 55.81dp 的理想值更小** ⇒ 真机截图请一并量一下宽屏分支的按钮宽。
3. **极窄屏分支下 `<250dp` 的高度 <40px**（宽度仍 >40px 到 101.7dp）：低于 250dp 的视口无现实机型（Galaxy Fold 封面屏 280dp 已是常见最窄），若未来要支持需另设最小高度策略。
4. **五动作的两处复制**：宽屏与极窄屏两个分支的按钮标记是两份源码（Lynx 模板无异构 slot 列表渲染的干净写法）。改文案/图标时**两个分支都要改**；`tests/novelIntroNarrowViewport.test.ts` 的「每个 i18n 键两分支各出现一次」断言是防漂移的机器防线。
5. ~~**spec §12 的风险表原文仍是「4 按钮同行 / 2×2 网格」**~~ → **已订正（2026-10-23，#756）**：spec §12 风险表那一行已改为「**已实现**：降级为 2 列 × 3 行（5 动作 + 1 空占位，空位固定右下角…）」，ADR-0189 顶部加「订正（2026-10-23，#756）」横幅把「2×2」订正为「2 列 × 3 行」（正文按 ADR 惯例原样保留作决策史）。`tests/novelIntroNarrowViewport.test.ts` 的 oracle 链接断言随 spec 同步，并新增 ADR-0189 横幅链接 ⇒ ADR / spec / 实现三者同口径有机器防线。

---

## 9. 真机取证（2026-10-23，父 agent 实测补齐 AC 第 3 条）

**环境**：模拟器 `emulator-5556`（Android 14 / API 34，1080×2160@480dpi）· debug 包
`io.pictelio.app.debug`（**ADR-0227 后的新 applicationId**；本轮构建含本实现）。
**造极窄视口**：`adb shell wm density 576` ⇒ 1080/576×160 = **300dp**；对照档 `wm density 540` ⇒ **320dp**。
⚠️ 改密度后必须 `force-stop` 再重启（manifest `configChanges` 含 `density` ⇒ Activity 不重建，`narrowViewport` 是 setup 期快照）。

**帧**（`docs/research/assets/novel-intro-narrow-viewport/`）：

| 文件 | 视口 | 内容 |
|---|---|---|
| `novel-intro-300dp-2x3-matrix.png` | 300dp | **降级矩阵实拍**：行1 收藏\|追更、行2 下载\|目录、行3 稍后看\|**空占位**、行4 全宽「开始阅读」 |
| `novel-intro-320dp-single-row-control.png` | 320dp | **边界对照**：单行 5 动作（宽屏分支）——判定条件是「< 320dp 降级」，故 320dp 本身**不**降级，与实现一致 |
| `ui-tree-300dp-action-row.json` | 300dp | UI 树导出（ADR-0223 通道），含每个动作可点击祖先框的精确几何 |

**实测触控尺寸**（UI 树 `position.frameInScreen`，300dp 视口下 1dp = 3.6px；取**带 tap 事件的最近祖先**＝真实可点击框）：

| 动作 | 可点击框 (px) | 换算 (dp) | ≥40dp |
|---|---|---|---|
| 追更 | x=540 y=1270 **471×173** | **130.8 × 48.1** | ✅ |
| 下载 | x=69 y=1466 **471×174** | **130.8 × 48.3** | ✅ |
| 目录 | x=540 y=1466 **471×174** | **130.8 × 48.3** | ✅ |
| 稍后看 | x=69 y=1663 **471×173** | **130.8 × 48.1** | ✅ |
| 收藏（chip） | 心形 69×70 + 计数 chip 80×46 | 见帧 | ✅ |

- **实测值 = 本文档 §算式的估值**（§算式订正后预测格宽 130.8dp @300dp）：真实格宽 **130.8dp** = 行内宽 261.7dp ÷ 2（`flex-1` 两等分）⇒ 订正后的算式与实测**逐值吻合**（旧算式预测 118.0dp，已被实测证伪，见 §5.2 订正）。
- **格高实测 48.1–48.3dp**（估值 48.0dp）⇒ 触控下限 40dp 余量 **+8.1dp**。
- **空占位确认**：UI 树第 3 行右格**无任何子节点**（既无文本也无图标节点）⇒ 恒定 2 列、无中间空洞，与实现一致。

**两条附带发现（已另开票跟踪 → [#1062](https://github.com/a1121611810/Pictelio/issues/1062)，不在本票范围）**

1. **「开始阅读」主 CTA 在 <312.5dp 视口下触控高度 <40dp**：其高度是 `h-[12.8vw]`（vw 相对视口）⇒ 300dp 时实测 **261.7 × 38.3 dp**（UI 树实测）⇒ 低于 40dp 触控下限。**这是既有几何事实**（主 CTA 不在本次降级分支内），与本次实现无关，但在同一极窄屏场景下被量到。
2. **320dp 边界档的收藏计数 chip 会折行**：`novel-intro-320dp-single-row-control.png` 中计数 `878` 被折成「87 / 8」两行（宽屏分支 5 等分时 chip 的 min-content 宽挤压）⇒ 极窄屏分支（2 列）下不复现（`1099` 单行）。**边界档的观感瑕疵**，不影响可点性。

**复现命令**

```bash
adb shell wm density 576            # 300dp
adb shell am force-stop io.pictelio.app.debug
adb shell am start -n io.pictelio.app.debug/io.pictelio.app.LynxActivity
adb shell input tap 900 157         # 顶栏「小说」
sleep 6; adb shell input tap 540 756   # 第一本小说 → 介绍页
adb exec-out screencap -p > narrow.png
# UI 树（ADR-0223 通道）取精确几何
adb shell am start -n io.pictelio.app.debug/io.pictelio.app.LynxActivity --es uiTreeDump 1
adb pull /sdcard/Android/data/io.pictelio.app.debug/files/ui-tree/ui-tree-hot-0ms-1-*.json
adb shell wm density reset           # 还原
```
