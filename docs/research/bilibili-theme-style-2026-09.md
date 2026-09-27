# bilibili 主题（外观/theming）体系与视觉设计风格：事实调研

> 调研日期：**2026-09-27**（v2 深挖轮，同日补三份底稿）
> 覆盖范围：PC Web 主题令牌体系（首页 / 视频页 / 搜索页 / 漫画站 / 动态 / 空间 / 消息 / 排行 / 番剧 / 专栏 / 直播 / 活动页等 16 个面）、移动端 H5（mstation，922 KB CSS）、官方主题包全部 6 个文件、暗色运行时机制、动效 / 交互态 / 排版 / 图标 / 响应式穷尽统计、App 端主题能力
> 一手信源：bilibili 生产环境静态产物（HTML / CSS / JS bundle / 字体 CSS / 运行时 UMD），全部实际抓取并可复算
> **图例**：✅ 一手产物已验证 ｜ 🟡 二手或推断，未验证 ｜ ❌ 已验证为「不存在」｜ — 未找到可验证证据（≠ 没有）
>
> ⚠️ **本文档是汇总层，是客观事实调研，不是给 Pictelio 的方案建议。** §5 的对照表只陈述事实差距。
> 各章节的逐条来源编号、完整表格与可复算口径在底稿中：
> - `docs/research/bilibili-theme-tokens-full-2026-09.md`（917 行）令牌体系全量：40 语义 + 191 原语 light⇄dark 并排表、`_all` 探测、漂移全量 diff
> - `docs/research/bilibili-surfaces-and-mobile-2026-09.md`（745 行）16 页面令牌一致性矩阵、mstation 量化解剖、App 端主题结论
> - `docs/research/bilibili-interaction-and-motion-2026-09.md`（1373 行）动效 / 交互态 / 排版 / 图标 / 断点 / 骨架 / 内容密度穷尽频次表

---

## 0. 深挖轮推翻的 9 条结论（含本文档 v1 自身的 4 条错误）

第一轮（v1）只覆盖 4 个页面、表格是抽样的，且有几处把**局部观察当成了全局结论**。深挖轮用全量比对 + 独立复核后，以下 9 条必须修正——**其中 4 条是 v1 自己的错误**：

| # | v1 / 流传说法 | 深挖轮核实结果 | 证据强度 |
|---|---|---|---|
| 1 | 「bilibili 用 `--bili-*` CSS 变量」 | ❌ **完全不存在**。首页 HTML / 首页 CSS（386,983 B）/ 视频页 HTML+CSS / 搜索页 / 首页 JS 多份产物 grep 命中 **0 次** | ✅ |
| 2 | 「PC 端品牌色是粉 `#FB7299`」 | 🟡 **一半对**。PC 官方包 v12 的粉色令牌是 **`--Pi5: #FF6699`**；`#FB7299` 在移动 H5 才是高频色（197 处，3 种写法混用） | ✅ |
| 3 | 「UI 主色是粉」 | ❌ **反了**。首页 CSS 中 `var(--brand_blue)` 引用 **39 次** vs `var(--brand_pink)` **9 次**，粉色集中在大会员/装扮语境，**蓝才是通用交互强调色** | ✅ |
| 4 | **v1 错误**：暗色下 `--Wh0_u` 无原语可解析，是「结构缺口」 | ❌ **不是缺口**。存在第三个文件族 `light_u.css`（340 定义），值与 `light.css` **完全相同**且**永不随主题变化**——它是刻意的**主题不变层**。`dark_u.css` 404 无实际影响 | ✅ |
| 5 | **v1 错误**：`:focus-visible` 全站 **0** 次，`prefers-reduced-motion` **0** 次 | ❌ **v1 从未抓到视频页 CSS 就下了全局结论**。视频页 CSS 实测 `:focus-visible` = **12**、`prefers-reduced-motion` = **2**（降级到 `1ms`）。但两者在首页 CSS 确实为 0——**计数必须标注语料范围** | ✅ |
| 6 | **v1 错误**：移动 H5 栅格基准是 `0.53333vmin`（≈4px） | ❌ **基准是 `0.26667vmin`**。mstation 全部 vmin 值中 **4927/4934（99.9%）** 是 `0.26667vmin` 的整数倍（375 视口下 = 1 CSS px = 750 设计稿 2px）；按 v1 的 4px 基准算会有 74 个值变成半整数 | ✅ |
| 7 | **v1 错误**：移动 H5「自定义属性 0 个，全硬编码」 | ❌ 实测 **551 条声明 / 482 个唯一名 / 730 次 `var()`**。真实形态是「**令牌层完整（382 色板 + 80 语义别名）但只消费 101 个（21%）**，同时有 1500+ 处颜色硬编码」——是「建了不用」，不是「没有」 | ✅ |
| 8 | **底稿内部冲突已仲裁**：首页主题副本与官方包「202/382（亮）、203/382（暗）处不同」 | ❌ 那是**字符串比对的假阳性**——其中 180/179 条仅是 `_rgb` 的空格差异（`0, 0, 0` vs `0,0,0`），且把 `--Or4` 误读为 `--Or5`。**归一化后真实漂移 = 11/191（亮，5.8%）+ 12/191（暗，6.3%）**，集中在橙色族 + `Ga12` | ✅ 独立复核 |
| 9 | 「bilibili 有完整主题/皮肤体系（App 主题、大会员主题、主题编辑器）」 | ❌ **App 端只有亮/暗切换**。决定性证据：1,837 B 的主题运行时全文 `dark` 出现 0 次，值域硬编码为 `"light"` / `"dark"` 两个字符串。**无主题市场、无皮肤包、无主题编辑器** | ✅ |

> 另有 1 条 v1 结论被**加强**而非推翻：`__css-map-filter__` 的 CSS 内容仍未在任何已抓产物中找到（❌），但其**开关契约**已从运行时源码完整还原（✅），且「暗色靠全局反色滤镜兜底」的猜想被**证伪**（`invert` / `hue-rotate` 在页面 bundle 中 0 命中）。

---

## 1. 一句话结论

bilibili Web 的外观体系是**三层令牌 + 一次 link 换片**：最底层是 191 个颜色原语（14 色相族 × 11 阶 + 36 中性），中层是 40 个语义别名，中层**与主题无关**、亮暗共用同一份；切暗色只做一件事——把一个 `<link>` 的 href 从 `light_all.css` 换成 `dark_all.css`。**没有 `prefers-color-scheme`、没有 `color-scheme`、没有 `data-theme`、没有 CSS 滤镜兜底。** 而这套优雅的分层只在引用官方包的页面上成立：站内实际并存 **7 套设计血脉**，首页自带一份**已漂移**的旧主题，移动 H5 则是另一套「建了令牌却 79% 不用」的体系。

---

## 2. 主题 / 外观体系

### 2.1 官方主题包：6 个文件，3 层架构 ✅

```
https://s1.hdslb.com/bfs/seed/jinkela/short/bili-theme/{map,light,light_u,dark,light_all,dark_all}.css
```

| 文件 | HTTP | 定义数 | 层级 | 随主题变化？ |
|---|---|---|---|---|
| `map.css` | 200 | **80** | 语义层：40 语义名 → 原语引用（+ 40 个 `_rgb` 孪生项，**1:1 严格配对无例外**） | ❌ **亮暗共用同一份** |
| `light.css` | 200 | **382** | 原语层：191 个颜色原语 + 191 个 `_rgb` | ✅ 亮色值 |
| `dark.css` | 200 | **382** | 原语层：同上 | ✅ 暗色值 |
| `light_u.css` | 200 | **340** | `_u` 变体层（170 个原语的 `_u` 版本） | ❌ **主题不变层**（值与 `light.css` 逐字相同） |
| `light_all.css` | 200 | **802** | = `map` ∪ `light` ∪ `light_u` 的**精确并集** | ✅ |
| `dark_all.css` | 200 | **802** | = `map` ∪ `dark` ∪ `light_u` 的**精确并集** | ✅ |
| ~~`dark_u.css`~~ | **404** | — | 不存在——但因 `_u` 是主题不变层，**404 无实际影响** | — |

文件头自报：**`@bilibili/bili-theme(v12.0.0)` / 构建时间 `9/28/2025, 1:33:28 PM` / 「哔哩哔哩主题设置（支持SSR）」** ✅。`@bilibili/bili-theme` 与 `@bilibili/b-style` 在 npm 上均为 404（内部包，非公开）。

**语义层（`map.css`）是本轮最有参考价值的结构**：`--brand_pink: var(--Pi5)`、`--text1: var(--Ga10)`、`--bg1: var(--Wh0)`、`--line_light: var(--Ga1_s)`……业务代码只认语义名，**切主题时语义层一行不动**，只换原语层。这比「每个主题文件把全部语义值抄一遍」更抗漂移。

### 2.2 暗色机制：纯 link 换片，无任何兜底 ✅

| 机制项 | 结论 |
|---|---|
| 门控 | `html` 上的 **class `bili_dark`**（PC 2233 组）；**直播站用 `html[lab-style="dark"]` 属性**；**mstation 用 `html.night-mode`** → 站内 **3 套约定** |
| 切换手段 | 改写 `<link id="__css-map__">` 的 href（`light_all` ⇄ `dark_all`） |
| `prefers-color-scheme` | ❌ **全站 0 命中**（16 个 PC 页面 + 922 KB mstation CSS 全部为 0） |
| `color-scheme` / `html[dark]` / `[data-theme]` | ❌ 全 0 命中 |
| 全局反色滤镜（`invert` / `hue-rotate`） | ❌ 页面 bundle 中 0 命中（独立主题运行时 JS 里有 `changeThemeByFilter`，但不在页面产物中） |
| 令牌 `!important` 覆盖 | ❌ 0 命中 |
| 持久化 | **Cookie `theme_style`**，365 天，`domain: .bilibili.com`（非 localStorage） |
| 登录门控 | 未登录（无 `DedeUserID` Cookie）**强制亮色**——直播站脚本为 `getCookie('DedeUserID') && getCookie('theme_style')==='dark'` |
| 变更广播 | `document` 派发 `CustomEvent("biliThemeChange", {detail:{theme}})` |
| 防 FOUC | SSR 输出 3 个 `<link>`，主题层那个带 `id="__css-map__"` |

### 2.3 暗色下的色彩变化规律 ✅

- **189/191 个原语在暗色下都变了**；唯二不变的是 `--Ba0` 和 `--Ba0_t`。
- 品牌粉 **`--Pi5: #FF6699` → `#D44E7D`**、品牌蓝 **`--Lb5: #00AEEC` → `#0087BD`**：**降饱和 + 压暗**，不是简单反相。
- `--text_white` / `--graph_white` 指向 `--Wh0_u`，因 `_u` 是主题不变层，**在暗色下恒为 `#FFFFFF`**。

### 2.4 令牌漂移：局部现象，不是系统性脱节 ✅

首页 CSS（`//s1.hdslb.com/bfs/static/shanks/laputa-home/assets/index-8a65600f.css`，386,983 B，文件头 `@bilibili/b-style(v5.0.0)`）内联了一份自己的主题：`:root` 与 `html.bili_dark` **各 382 条**，与官方包**同名 382 个属性、0 新增、0 缺失**。归一化空白后全量比对：

| | 交集 | 真实不同 | 占比 | 涉及色相族 |
|---|---|---|---|---|
| 亮色 | 191 原语 | **11** | 5.8% | `Or0–Or9` + `Ga12` |
| 暗色 | 191 原语 | **12** | 6.3% | `Or0–Or10` + `Ga12` |

代表性差异（首页自带 vs 官方 v12）：

| 属性 | 首页亮 | 官方亮 | 首页暗 | 官方暗 |
|---|---|---|---|---|
| `--Or5` | `#FF661A` | `#FF7F24` | `#E1540D` | `#D66011` |
| `--Or4` | `#FF8F53` | `#FFA058` | `#B23F0A` | `#A9490D` |
| `--Ga12` | `#F6F7F8` | `#F1F2F3` | `#202123` | `#1F2022` |

即：首页渲染的是**饱和度更高的旧橙**，与其余引用 `bili-theme` 的页面并排能看到可见色差。**其余 13 个色相族逐值相同**。

### 2.5 尺度层与组件级令牌 ✅

- 另有 **87 个 `--v_*` 尺度令牌**（如 `--v_fs_1..6` = 24/18/16/14/13/12px、`--v_radius` = 6px、`_sm/_md/_lg/_xl` = 4/8/10/12px）——与色彩令牌**分离的第三层**。
- 组件级作用域令牌确实存在：视频页 `--custom-related-*` 共 16 个、首页 `--title-font-size` / `--layout-padding` / `--col-gap` / `--cover-radio` 等，另有跨页面的 `--custom-*` 族。

### 2.6 `__css-map-filter__`：内容 ❌ / 契约 ✅

运行时 JS 会操作一个 `<style id="__css-map-filter__">`：亮色下其内容以 `/* */` **整段注释**发出，暗色时用正则剥掉首尾注释符就地启用（`^[/*]+|[*/]+$`，带幂等守卫）——目的是**零网络请求**地启用一小段补充样式。**但该元素的实际 CSS 内容未在任何已抓产物中找到**（9 个来源全部 0 命中，SSR 页面里也不存在该元素）。

---

## 3. 站内有 7 套设计血脉 ⚠️ 这是本项目最该记住的一条

16 个页面/垂直站里，**仅 4 个（27%）引用官方 `bili-theme/*` 包，且这 4 个同属 2233 monorepo**。其余各垂直站各自为政：

| # | 血脉 | 代表面 | 令牌来源 | 暗色 |
|---|---|---|---|---|
| ① | **2233 monorepo** | 视频页 / 搜索页 / 图文 / 消息 | ✅ 引用官方 `bili-theme`（`seed/` 目录） | ✅ `bili_dark` |
| ② | laputa 系 | 首页 | ⚠️ 自带 b-style v5.0.0 主题（橙色族已漂移） | ✅ `bili_dark`（仅 1 处） |
| ②' | laputa 系 | 排行榜 / 空间 | ❌ **完全无令牌层** | ❌ |
| ③ | 动态（t.） | 动态页 | 自有 | ✅ `bili_dark`（13 处） |
| ④ | 直播 | 直播站 | 自有 | ⚠️ `html[lab-style="dark"]`（**另一套约定**） |
| ⑤ | 漫画站 | manga | Tailwind v4（`(width>=40rem)` 语法），**颜色全走 `text-[#1c1c1f]` 完全不用令牌** | ❌ |
| ⑥ | mstation | 移动 H5 | 自带 382 色板 + 80 语义别名，**但只用 21%** | ⚠️ `html.night-mode`（56 处，仅覆盖弹层组件） |
| ⑦ | 活动页 / 帮助中心 / link | 活动页等 | 无 | ❌ |

**安全区与动效降级基线全线缺失**：`safe-area-inset-*` 与 `env()` 在全部 16 个页面 + mstation 922 KB CSS 中**命中 0 次**。

---

## 4. 视觉设计语言（摘要，全表见底稿）

### 4.1 色彩 ✅
语义令牌 → 原语 → 色值三段映射完整，191 个原语的 light⇄dark 并排对照见令牌底稿 §2。**移动 H5 的品牌粉有 3 种写法并存 197 处**：`#fb7299`×109 / `#f69`×69 / `#fb6699`×19。

### 4.2 排版 ✅
- **自托管 HarmonyOS Sans：108 个 woff2**（54 个 `unicode-range` 分片 × 400/500 两个字重，`font-display: swap`）。分片策略：前 6 片连续码位、后 47 片按使用频次拆离散集、末片 ASCII。**不是可变字体**（`font-variation-settings` 0 命中）。
- 另有 `DIN-BoldItalic`（truetype，数字用）、`"Monospaced Number"`（仅 `u+30-39` 十个数字码位）、`Chinese Quote`（4 码位纯 local）。
- 字号 12–18px 区间大量**硬编码**，而 `AGENTS.md` 明令禁止。

### 4.3 动效 ✅
| 维度 | 实测 |
|---|---|
| `transition` 时长 | **中位数 300ms**（与 Fluent 300ms 档一致），**90.5% 落在 Fluent 五档内**；越界 46/484（`350ms`×14、`400ms`×14） |
| `animation` 时长 | **仅 44.3% 合规**（循环类动画天然长时长） |
| 缓动曲线 | **22 条不同曲线，仅 29.6% 落在 Fluent 四条合法集合内**（138/196 越界） |
| 隐式缓动 | **76.9% 的过渡完全不写 `timing-function`**，吃 CSS 默认 `ease`（`ease` 裸关键字 33 次） |
| `linear` | 58 次，其中 **43 次在 `transition` 内**（非 spinner 用途） |
| `prefers-reduced-motion` | 2 次，且只覆盖 2 个组件，**无全局兜底** |

### 4.4 交互态与可达性 ✅
- `:hover` 457 次 / `:focus` 37 次 / `:focus-visible` 12 次（**语料依赖**）。
- **6 个页面组中 4 组的 `:focus-visible` 计数为 0** → 键盘可达性缺失面很大。
- 12 条 `:focus-visible` 规则**都用了 `outline`**（其中 6 条带 `outline-offset`）——做法与规范一致，只是覆盖面仅 12 处。
- 按压反馈实测 `scale(.95)`×4 + `translateY(1px)`×2，**缩放量级比规范的 `scale(0.98)` 差 3%，位移量级差 20 倍**。

### 4.5 响应式：断点是 4 套不是 2 套 ✅
1. 首页 px `.9` 系（20 档）
2. `home-v3` px `.8` 系（20 档）
3. 观看页 px 整数单点（**1681px 独占 53/66 条规则**）
4. **漫画站用 rem**（Tailwind v4 的 `(width>=40rem)` 新语法，正则容易漏抓）

首页推荐流是 **6×6 嵌套 `@media` 笛卡尔积**，栏数由内轴决定，实际只在 1400px 处 4 列 → 5 列。

### 4.6 图标 ✅
以**字体图标 + 雪碧图**混用为主；`@font-face` 里的图标字体配 `unicode-range` 做子集化。**未找到官方图标栅格规范**（28 个产物中无任何声明）。

### 4.7 移动端栅格与触摸目标 ✅（修正 v1）
- 基准 `0.26667vmin`；`px` 单位全站只用于发丝线（274 处，仅 `1px` / `.5px` / `5px` 三个值）。
- **触摸目标严重偏小**：527 样本中位数 **24px**、最小 **10px**、**78.2% 小于 44px**。
- `viewport-fit=cover` 已设，但 `env()` **0 命中**——**开了开关没人消费**。

### 4.8 App 端主题能力：只有亮/暗切换 ❌
决定性证据是 1,837 B 的主题运行时：**全文 `dark` 出现 0 次**，`"light"` 是默认值常量，唯一的 dark 枚举在直播站；切换即改 `<link id="__css-map__">` 的 href。**无主题市场、无皮肤包、无主题编辑器**（Web 端主题菜单源码里只有 `dark` / `light` 两个 `value`）。唯一持久化状态就是 `theme_style` Cookie。

---

## 5. 与本项目 Fluent 2 硬约束的定量差距（仅陈述事实）

| Pictelio 约束 | bilibili 实测 | 差距 |
|---|---|---|
| 时长只用 100/150/200/300/500ms | transition **90.5%** 合规；animation 44.3% | transition 越界 46/484；主用 300ms **与规范一致** |
| 曲线只用 4 条 | **仅 29.6%** 合法，22 条曲线 | 138/196（70.4%）越界 |
| 禁 `ease` 裸关键字 | `ease` 33 次；76.9% 过渡不写 timing-function | 违反 |
| `linear` 仅限 spinner | 58 次，43 次在 `transition` 内 | 违反 |
| 禁裸 `:focus`，必须 `:focus-visible` | focus-visible 12 / focus 37 | **4/6 页面组为 0** |
| 按压用 `scale(0.98)` | `scale(.95)`×4 + `translateY(1px)`×2 | 差 3% / 20 倍 |
| 焦点环 `outline` + `offset` | 12/12 用 `outline`，6 条带 offset | **做法一致**，覆盖面仅 12 处 |
| 无硬编码 px / 硬编码色值 | 字号 12–18px 大量硬编码；mstation 品牌粉 3 种写法 197 处；manga 站连颜色都写死 | 违反 |
| 触控目标 ≥40×40px | 中位数 24px、最小 10px、78.2% < 44px | 违反 |
| 令牌单一来源、不得漂移 | 7 套设计血脉；首页副本与官方包漂移 11–12 个原语 | 违反 |
| 亮暗主题须有系统级响应 | `prefers-color-scheme` 全站 0 命中；需登录 + Cookie | 违反 |

**值得学的两点**：① 三层令牌 + 语义层主题无关的切分方式；② `transition` 时长主用 300ms 这类中间档，而不是全站 150/200ms 一刀切。

---

## 6. 未解决 / 明确放弃（不要当成「不存在」）

1. **`__css-map-filter__` 的 CSS 内容**：契约已还原，内容在 9 个来源中均未出现（❌ 未找到）。
2. **`_s` / `_t` / `_e` / `_u` 四个语义后缀的官方定义**：值已验证（全名未找到证据）🟡。
3. **登录态 `/x/web-interface/nav` 完整字段**：无登录 Cookie 时被风控拦截，未验证。
4. **大会员专属主题 / 装扮体系**：结构上引擎值域只有 2 个字符串无法表达多主题映射 🟡（因应用商店页 404，未作断言）。
5. **风控绕过方法的可复现性存在分歧**：一份底稿报告桌面 UA 必得 686 B 验证码页、需 Googlebot UA；独立复核用**普通桌面 UA 拿到 34,124 B 正常 SSR 首页**。结论：**风控是概率性/时段性的，不可作为稳定手段依赖**。
6. **移动 App 原生包内的主题资源**：无 APK/IPA 逆向能力，未验证。
7. **`SocialSisterYi/bilibili-API-collect` 已于 2026-01-28 被 B 站委托律所发律师函永久关停**（仓库仅剩 2 文件、`archived: true`、Wayback 无快照）——这条社区最高可信二手信源**客观失效**，需另找替代。
8. **官方 VI / 设计系统文档**：`www.bilibili.com/blackboard/` 404，无公开设计规范站点。
9. **Bilibili-Evolved 仓库当前 404**，无法用作变量名的第三方交叉验证源。
10. **播放器控制条自动隐藏时长、悬停预览延迟数值、弹幕层 CSS**：在 1.84 MB 播放器 JS 中检索无果，判「未找到」，未推测。
11. **顶导 UMD 运行时注入的 1232 个令牌**是否有暗色值：静态抓取无法判定 🟡。

---

## 7. 来源清单（汇总层只列主干，完整清单见各底稿）

| # | 来源 | 状态 | 抓取时间 |
|---|---|---|---|
| S1 | `https://s1.hdslb.com/bfs/seed/jinkela/short/bili-theme/map.css` | 200 / 2,529 B | 2026-09-27 |
| S2 | `.../bili-theme/light.css` | 200 / 6,936 B | 2026-09-27 |
| S3 | `.../bili-theme/dark.css` | 200 / 6,875 B | 2026-09-27 |
| S4 | `.../bili-theme/light_u.css` | 200 / 6,794 B | 2026-09-27 |
| S5 | `.../bili-theme/light_all.css` | 200 / 15,937 B（802 定义） | 2026-09-27（复核） |
| S6 | `.../bili-theme/dark_all.css` | 200 / 15,876 B（802 定义） | 2026-09-27（复核） |
| S7 | `.../bili-theme/dark_u.css` | **404** / 287 B | 2026-09-27（复核） |
| S8 | `https://www.bilibili.com/` 首页 CSS `//s1.hdslb.com/bfs/static/shanks/laputa-home/assets/index-8a65600f.css`（`@bilibili/b-style v5.0.0`） | 200 / 386,983 B | 2026-09-27（复核） |
| S9 | `https://www.bilibili.com/video/BV14baT6EEzj/`（引 `bili-theme/{map,light,light_u}.css` + `long/font/{regular,medium}.css` + `jinkela/video/css/video.0.05af4e80….css`） | 200 / 54,879 B HTML | 2026-09-27（复核） |
| S10 | 视频页 CSS `//s1.hdslb.com/bfs/static/jinkela/video/css/video.0.05af4e80b6081ba56c1b5b943d4c8e621df3f875.css` | 200 / 573,972 B | 2026-09-27（复核） |
| S11 | `//s1.hdslb.com/bfs/static/jinkela/long/font/regular.css` + `medium.css` | 200 / 各 54 个 `@font-face` | 2026-09-27（复核） |
| S12 | `https://m.bilibili.com/`（20 个 `jinkela/mstation-h5-new/css/mstation.N.cf55b4f0….css` chunk，合并 922,485 B） | 200 | 2026-09-27（复核） |
| S13 | `//s1.hdslb.com/bfs/seed/laputa-header/bili-header.umd.js`（705,120 B，主题常量表来源） | 200 | 2026-09-27 |
| S14 | 主题运行时 `bili-theme.min.js`（1,837 B） | 200 | 2026-09-27 |
| S15 | `https://api.bilibili.com/x/web-interface/nav/stat` | 200 JSON `{"code":-101,"message":"账号未登录"}` | 2026-09-27 |
| S16 | `https://registry.npmjs.org/@bilibili/bili-theme` / `@bilibili/b-style` | **404**（内部包） | 2026-09-27 |
| S17 | `https://github.com/SocialSisterYi/bilibili-API-collect` | **已关停 / archived**（2026-01-28 律师函） | 2026-09-27 |
| S18 | 漫画站 `https://manga.bilibili.com/`（Tailwind v4 系） | 200 | 2026-09-27 |

---

## 附：方法学备注（供复算）

- 所有 CSS/HTML 一律用 `curl -s --compressed` 落盘再解析——**不加 `--compressed` 会拿到 gzip 原始字节**。
- CSS 自定义属性的**最后一条声明常常没有尾随 `;`**，用 `([^;}]+)` 类正则解析会漏掉它（本次就因此误判过一次「`--shadow` 缺 `_rgb` 孪生项」）。
- **`_rgb` 孪生项的空格差异会造成 diff 假阳性**——比对前必须做空白归一化，否则会把「相同」判成「不同」（本次 202/382 的假阳性即由此而来）。
- 令牌值比对要用**具名匹配**（`--Or5:`）而非按位置取第 N 个匹配，否则极易把 `Or4` 读成 `Or5`。
- 任何「某特性全站为 0」的结论都必须标注**语料范围**：`:focus-visible` 在首页 CSS 是 0、在视频页 CSS 是 12；`cubic-bezier` 在首页是 4、在视频页是 36。
