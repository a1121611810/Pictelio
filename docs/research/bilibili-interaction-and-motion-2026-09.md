# bilibili 交互 / 动效 / 排版 / 图标 / 响应式 / 骨架与内容密度 —— 穷尽式量化底稿

> **调研日期**：2026-09-27（中国标准时间）
> **覆盖范围**：bilibili PC 站首页（laputa-home）、home-v3 首页、观看页（video）、番剧页（anime）、专栏首页（read）、漫画站（manga）、移动 H5（mstation），以及全局主题层（bili-theme）与自托管字体层（jinkela/long/font）。
> **一手信源**：全部为 `s1.hdslb.com` / `i0.hdslb.com` 静态资源与 `www.bilibili.com` / `manga.bilibili.com` 页面 HTML，直接 `curl` 落盘，无二手转述。完整清单见文末 §12。
> **方法**：28 个 CSS 文件落盘于 `/tmp/bt-motion/`，由 `/tmp/bt-motion/an.py` 统一解析（括号/引号感知的逗号切分，避免 `cubic-bezier()` 内逗号破坏 token）。所有表格可复算。
> **图例**：✅ 已验证（直接来自一手字节） / 🟡 推断（由类名或上下文推断，未见运行时确认） / ❌ 未找到（一手材料中不存在该证据）

## 0. 语料清单与抓取事实

| # | 文件 | 逻辑页 | 字节 | 行数 | 备注 |
|---|---|---|---|---|---|
| 1 | `home.css` | home(PC) | 386,983 | 10（压缩） | laputa-home，首页主样式 |
| 2 | `homev3_0.css` | homev3(PC) | 98,332 | — | home-v3 世代首页 |
| 3 | `homev3_1.css` | homev3(PC) | 3,383 | — | home-v3 尾包（几乎无动效） |
| 4 | `video.css` | video(PC) | 573,972 | 16,341（**未压缩**） | 观看页，抽样友好 |
| 5 | `read0..4.css` | read(PC) | 294+7,005+7,343+4,812+8,407 | — | 专栏首页 5 个分片 |
| 6 | `manga0..10.css` | manga(PC) | 61…39,049 | 1（Tailwind v4 压缩） | 漫画站 11 个分片 |
| 7 | `mstation.css` | mstation(H5) | 125,071 | — | 移动 H5，**vmin 尺寸体系** |
| 8 | `light.css` / `light_u.css` / `dark.css` / `map.css` | 主题层 | 6,936 / 6,794 / 6,875 / 2,529 | — | `@bilibili/bili-theme v12.0.0`，构建时间 2025-09-28 |
| 9 | `font-regular.css` / `font-medium.css` | 字体层 | 38,752 / 38,644 | — | 54 + 54 个 `@font-face` |

**抓取异常（必须记录）** ✅：

- `https://www.bilibili.com/` 首页 HTML **被风控验证码拦截**（返回 1374 字节的 `risk-captcha` 页，`window._riskdata_` + `risk-captcha-app`）。已尝试 6 种 UA / 头组合 / 真实 buvid3+buvid4（`/x/frontend/finger/spi`）均无效。**故首页 HTML 结构未能直取**；首页结论全部改由 `home.css` / `homev3_0.css` 的类名与规则支撑（CSS 本身可直取，不受拦截）。
- `/v/popular/rank/all`、`/v/popular/all` 返回 4,927 字节 SSR 壳（`window._GreyResult`），**卡片由客户端渲染**，壳内无卡片 HTML。
- 替代成功：`/anime/`（270,101 字节完整 SSR）与 `/video/BV1Rmh96ZEXh`（64,520 字节完整 SSR），用于 §8 / §9 的真实 DOM 骨架与卡片字段解剖。
- `safe-area-inset-*` 与 `env()`：28 个文件命中 **0 次** ✅（复算确认，与上一轮一致）。

---

## 1. 动效：时长分布（穷举）

**统计口径** ✅：仅统计 `transition*` / `animation*` 声明值中的**第一个**时间 token（即 duration），按括号感知逗号切分为独立组后逐组取值；`transition-delay` / `animation-delay` 单独归入 `delay:` 前缀不计入本表。字面量 `.3s` 与 `0.3s` 已归一为 `300ms`。

**语料**：`home.css` + `homev3_0/1.css` + `video.css` + `read0-4.css` + `manga0-10.css` + `mstation.css` + 4 个主题文件 + 2 个字体文件。
**带时长的声明组总数**：**581**。其中 `transition` **484** 条、`animation` **97** 条。

### 1.1 全量时长频次表（值 + 次数 + 占比 + 分页）

| 时长 | 次数 | 占比 | home | homev3 | video | read | manga | mstation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `300ms` | 287 | 49.40% | 76 | 27 | 147 | 8 | 9 | 20 |
| `200ms` | 166 | 28.57% | 45 | 36 | 48 | 0 | 32 | 5 |
| `400ms` | 19 | 3.27% | 0 | 14 | 0 | 0 | 5 | 0 |
| `350ms` | 14 | 2.41% | 3 | 10 | 0 | 0 | 0 | 1 |
| `500ms` | 14 | 2.41% | 3 | 0 | 8 | 0 | 2 | 1 |
| `150ms` | 11 | 1.89% | 0 | 0 | 8 | 0 | 0 | 3 |
| `0ms` | 7 | 1.20% | 7 | 0 | 0 | 0 | 0 | 0 |
| `2000ms` | 7 | 1.20% | 2 | 0 | 2 | 0 | 0 | 3 |
| `1000ms` | 7 | 1.20% | 0 | 0 | 6 | 0 | 1 | 0 |
| `800ms` | 6 | 1.03% | 4 | 0 | 2 | 0 | 0 | 0 |
| `160ms` | 6 | 1.03% | 0 | 0 | 6 | 0 | 0 | 0 |
| `1500ms` | 5 | 0.86% | 0 | 0 | 5 | 0 | 0 | 0 |
| `600ms` | 4 | 0.69% | 1 | 0 | 1 | 0 | 1 | 1 |
| `1ms` | 4 | 0.69% | 0 | 0 | 4 | 0 | 0 | 0 |
| `100ms` | 3 | 0.52% | 0 | 0 | 2 | 0 | 0 | 1 |
| `1200ms` | 2 | 0.34% | 2 | 0 | 0 | 0 | 0 | 0 |
| `280ms` | 2 | 0.34% | 0 | 0 | 2 | 0 | 0 | 0 |
| `220ms` | 2 | 0.34% | 0 | 0 | 2 | 0 | 0 | 0 |
| `1400ms` | 2 | 0.34% | 0 | 0 | 1 | 0 | 0 | 1 |
| `240ms` | 2 | 0.34% | 0 | 0 | 2 | 0 | 0 | 0 |
| `2500ms` | 2 | 0.34% | 0 | 0 | 2 | 0 | 0 | 0 |
| `10000ms` | 1 | 0.17% | 1 | 0 | 0 | 0 | 0 | 0 |
| `4500ms` | 1 | 0.17% | 1 | 0 | 0 | 0 | 0 | 0 |
| `8000ms` | 1 | 0.17% | 1 | 0 | 0 | 0 | 0 | 0 |
| `670ms` | 1 | 0.17% | 1 | 0 | 0 | 0 | 0 | 0 |
| `3000ms` | 1 | 0.17% | 0 | 1 | 0 | 0 | 0 | 0 |
| `260ms` | 1 | 0.17% | 0 | 0 | 1 | 0 | 0 | 0 |
| `120ms` | 1 | 0.17% | 0 | 0 | 1 | 0 | 0 | 0 |
| `250ms` | 1 | 0.17% | 0 | 0 | 1 | 0 | 0 | 0 |
| `4000ms` | 1 | 0.17% | 0 | 0 | 0 | 0 | 1 | 0 |

**不同取值数：30**。分页声明数：`home` 147 / `homev3` 88 / `video` 251 / `read` 8 / `manga` 51 / `mstation` 36。

### 1.2 Top-10 与集中度

| 排名 | 时长 | 次数 | 累计占比 |
| --- | --- | --- | --- |
| 1 | `300ms` | 287 | 49.40% |
| 2 | `200ms` | 166 | 77.97% |
| 3 | `400ms` | 19 | 81.24% |
| 4 | `350ms` | 14 | 83.65% |
| 5 | `500ms` | 14 | 86.06% |
| 6 | `150ms` | 11 | 87.95% |
| 7 | `0ms` | 7 | 89.16% |
| 8 | `2000ms` | 7 | 90.36% |
| 9 | `1000ms` | 7 | 91.57% |
| 10 | `800ms` | 6 | 92.60% |

✅ **仅 `300ms` + `200ms` 两档就吃掉 77.97%**。`300ms : 200ms ≈ 1.73 : 1`。

### 1.3 加权统计（按出现次数加权，非去重）

| 口径 | n | 不同值数 | 中位数 | 均值 | p10 | p25 | p75 | p90 | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **transition**（UI 反馈） | 484 | 18 | **300** | 275.3 | 200 | 200 | 300 | 300 | 3000 |
| **animation**（关键帧循环） | 97 | 21 | **400** | 893.1 | 200 | 280 | 1000 | 2000 | 10000 |
| 全部 | 581 | 30 | 300 | 378.5 | 200 | 200 | 300 | 400 | 10000 |

✅ **transition 时长中位数 = 300ms，均值 275.3ms**；`animation` 因含 10s 循环（`living-status` / 长轮播）被拉高。

### 1.4 与 Fluent 2 五档时长的定量对照

Fluent 合法集合 = `{100, 150, 200, 300, 500}` ms。

| 口径 | 命中 Fluent 五档 | 占比 | 越界取值（越界次数） |
| --- | --- | --- | --- |
| transition（484） | 438 | **90.5%** | 46（`400`×14、`350`×14、`800`×6、`160`×6、`280`×2、`220`×2、`240`×2、`120`×1、`250`×1、`1000`×…、`3000`×1） |
| animation（97） | 43 | **44.3%** | 54（`2000`×7、`1000`×7、`1500`×5、`1200`×2、`1400`×2、`2500`×2、`600`×4、`400`×14、`350`×14、`800`×4、`10s`×1、`4.5s`×1、`8s`×1、`670`×1、`4s`×1） |
| 全部（581） | 481 | **82.8%** | 100 |

**结论（事实陈述）** ✅：

1. bilibili 的 **UI 反馈（transition）90.5% 落在 Fluent 五档内**，且中位数 300ms 正是 Fluent `gentle` 档 —— 这一档与 Pictelio 规范完全一致。
2. **越界集中在长尾**：`350ms`（14 次）与 `400ms`（14 次）各占越界量的 30%，两者**都不在** Fluent 五档内，是 home-v3 与 manga 的自定义中间档。
3. `animation` 只有 44.3% 合规，因为循环类动画天然需要长时长（骨架 shimmer 用 1.2s、进度条用 3s）—— 这与 Pictelio 规范把 `linear` 限定给 spinner 的思路方向相反，但**不是同一维度的问题**（见 §2.4）。

---

## 2. 动效：缓动曲线分布（穷举）

**统计口径** ✅：扫描 `transition*` / `animation*` 声明值（含简写与长写），用**括号感知**切分后逐组提取 `cubic-bezier(...)` / `steps(...)` / `linear` / `ease-in-out` / `ease-in` / `ease-out` / `ease`，长键优先匹配以区分 `ease` 与 `ease-in`。
**曲线出现总次数**：**196**。**不同曲线数：22**。

### 2.1 全量曲线频次表

| 曲线 | 次数 | 占比 | home | homev3 | video | manga | mstation | 类型 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `linear` | 58 | 29.59% | 26 | 15 | 9 | 6 | 2 | 关键字 |
| `ease-in-out` | 42 | 21.43% | 4 | 19 | 6 | 2 | 11 | 关键字 |
| `ease` | 33 | 16.84% | 3 | 0 | 19 | 10 | 1 | 关键字 |
| `cubic-bezier(.08,.82,.17,1)` | 11 | 5.61% | 0 | 0 | 11 | 0 | 0 | 自定义 |
| `cubic-bezier(.22,.58,.12,.98)` | 8 | 4.08% | 0 | 0 | 0 | 8 | 0 | 自定义 |
| `cubic-bezier(.78,.14,.15,.86)` | 7 | 3.57% | 0 | 0 | 7 | 0 | 0 | 自定义 |
| `ease-out` | 6 | 3.06% | 1 | 0 | 3 | 2 | 0 | 关键字 |
| `cubic-bezier(.6,.04,.98,.34)` | 4 | 2.04% | 0 | 0 | 4 | 0 | 0 | 自定义 |
| `cubic-bezier(.23,1,.32,1)` | 4 | 2.04% | 0 | 0 | 4 | 0 | 0 | 自定义 |
| `cubic-bezier(.755,.05,.855,.06)` | 4 | 2.04% | 0 | 0 | 4 | 0 | 0 | 自定义 |
| `cubic-bezier(0,0,.2,1)` | 2 | 1.02% | 2 | 0 | 0 | 0 | 0 | 自定义 |
| `cubic-bezier(0.22, 1, 0.36, 1)` | 2 | 1.02% | 0 | 0 | 2 | 0 | 0 | 自定义 |
| `cubic-bezier(0.4, 0, 1, 1)` | 2 | 1.02% | 0 | 0 | 2 | 0 | 0 | 自定义 |
| `ease-in` | 2 | 1.02% | 0 | 0 | 2 | 0 | 0 | 关键字 |
| `steps(23)` | 2 | 1.02% | 0 | 0 | 2 | 0 | 0 | 阶梯 |
| `cubic-bezier(.645,.045,.355,1)` | 2 | 1.02% | 0 | 0 | 2 | 0 | 0 | 自定义 |
| `steps(1)` | 2 | 1.02% | 0 | 0 | 0 | 2 | 0 | 阶梯 |
| `steps(20)` | 1 | 0.51% | 1 | 0 | 0 | 0 | 0 | 阶梯 |
| `cubic-bezier(.25,.53,.66,1.31)` | 1 | 0.51% | 0 | 1 | 0 | 0 | 0 | 自定义 |
| `cubic-bezier(.4,0,.2,1)` | 1 | 0.51% | 0 | 0 | 0 | 1 | 0 | 自定义 |
| `steps(12,end)` | 1 | 0.51% | 0 | 0 | 0 | 1 | 0 | 阶梯 |
| `cubic-bezier(.17,.89,.08,1.18)` | 1 | 0.51% | 0 | 0 | 0 | 0 | 1 | 自定义 |

### 2.2 `ease*` 关键字专项统计（任务明确要求区分）

✅ 用长键优先正则提取，避免 `ease` 误吞 `ease-in`：

| 关键字 | 次数 | 占比 |
| --- | --- | --- |
| `ease`（严格词边界） | 33 | 16.84% |
| `ease-in-out` | 42 | 21.43% |
| `ease-out` | 6 | 3.06% |
| `ease-in` | 2 | 1.02% |
| **`ease*` 合计** | **83** | **42.35%** |
| `linear` | 58 | 29.59% |
| `cubic-bezier()` 自定义 | 49 | 25.00% |
| `steps()` | 6 | 3.06% |

> ✅ 若用朴素 `grep -o ease` 会得到 83 + 内部子串重复计数；本表已用 `ease\b` 长键优先修正。

### 2.3 一个易被误判的事实：`cubic-bezier` 只在「实际生效声明」中出现 49 次

✅ 原始字节统计 `cubic-bezier` 出现 57 次（home 4 / video 36 / manga5 11 / mstation 1），与上表 49 次的差值来自**仅存于自定义属性、未被任何 transition/animation 消费**的 Tailwind v4 令牌：

```css
/* manga5.css —— Tailwind v4 注入的令牌，定义但本文件内未消费 */
--tw-ease: cubic-bezier(.22,.58,.12,.98)
--tw-ease: cubic-bezier(.4,0,.2,1)
```

✅ 另有 6 处长写法引用令牌（`manga5.css`）：`transition-timing-function: var(--tw-ease, var(--default-transition-timing-function))` ×6。

### 2.4 与 Fluent 2 四条合法曲线的定量对照

Fluent 合法集合 = `{cubic-bezier(0,0,0,1), cubic-bezier(0.33,0,0.67,1), cubic-bezier(0.33,0,1), linear}`。

| 项 | 数值 |
| --- | --- |
| 曲线出现总次数 | 196 |
| **落在 Fluent 四条合法曲线内** | **58（29.6%）** —— 全部是 `linear` |
| **落在合法集合外** | **138（70.4%）**，分属 **22 条**不同曲线 |
| `ease*` 关键字（全部排除） | 83（42.35%） |
| 自定义 `cubic-bezier`（全部排除） | 49（25.00%） |
| `steps()`（全部排除） | 6（3.06%） |

**对照表（逐条曲线 × Fluent 判定）**

| 曲线 | 次数 | Fluent 判定 |
| --- | --- | --- |
| `linear` | 58 | ✅ 合法（但 Pictelio 规范限定仅 spinner） |
| `ease-in-out` | 42 | ❌ 排除 |
| `ease` | 33 | ❌ 排除 |
| `cubic-bezier(.08,.82,.17,1)` | 11 | ❌ 排除（Vant 抽屉/侧栏入场） |
| `cubic-bezier(.22,.58,.12,.98)` | 8 | ❌ 排除（Tailwind `ease-in-out` 默认） |
| `cubic-bezier(.78,.14,.15,.86)` | 7 | ❌ 排除 |
| `ease-out` | 6 | ❌ 排除 |
| `cubic-bezier(.6,.04,.98,.34)` | 4 | ❌ 排除 |
| `cubic-bezier(.23,1,.32,1)` | 4 | ❌ 排除 |
| `cubic-bezier(.755,.05,.855,.06)` | 4 | ❌ 排除 |
| `cubic-bezier(0,0,.2,1)` | 2 | ❌ 排除（Material 标准曲线，与 Fluent 的 `.33,0,.67,1` **不同**） |
| `cubic-bezier(0.22, 1, 0.36, 1)` | 2 | ❌ 排除 |
| `cubic-bezier(0.4, 0, 1, 1)` | 2 | ❌ 排除 |
| `ease-in` | 2 | ❌ 排除 |
| `steps(23)` | 2 | ❌ 排除 |
| `cubic-bezier(.645,.045,.355,1)` | 2 | ❌ 排除（`ease-in-out` 的显式写法） |
| `steps(1)` | 2 | ❌ 排除 |
| `steps(20)` | 1 | ❌ 排除 |
| `cubic-bezier(.25,.53,.66,1.31)` | 1 | ❌ 排除（**Y 值 1.31 > 1，回弹曲线**） |
| `cubic-bezier(.4,0,.2,1)` | 1 | ❌ 排除 |
| `steps(12,end)` | 1 | ❌ 排除 |
| `cubic-bezier(.17,.89,.08,1.18)` | 1 | ❌ 排除（**Y 值 1.18 > 1，回弹**） |

✅ **关键事实：bilibili 使用的 22 条曲线中，没有任何一条等于 Fluent 的 `cubic-bezier(0.33,0,0.67,1)`（standard）**。唯一落在 Fluent 合法集合内的是 `linear`（58 次，29.6%），而 Pictelio 规范恰好把 `linear` 限定给 loading spinner。

### 2.5 `linear` 的 58 次去向（精确拆分）✅

| 落点 | 次数 | 是否 spinner |
| --- | --- | --- |
| `transition` 声明内 | **43** | ❌ 全部不是（Pictelio 视为违规用法） |
| `animation` 声明内 | 15 | 仅 4 处是真 spinner |

✅ `animation` 内的 15 次逐条（去重后原文）：

| 选择器 | 声明 | 是 spinner？ |
| --- | --- | --- |
| `.vui_loading--rotate` | `loading-rotate 2s linear infinite` | ✅ 是 |
| `.van-icon-rotate:before` | `loadingCircle 1s linear infinite` | ✅ 是 |
| `.v5-button-loading` | `v5-button-loading-spin 1.4s linear infinite` | ✅ 是（按钮内 loader） |
| `.swiper-preloader-spin` | （`manga8.css`） | ✅ 是 |
| `.bili-header.bili-header--slide-down .bili-header__bar` | `biliHeaderSlideDown .3s linear forwards` | ❌ 顶栏入场 |
| `.header-channel` | `fixedTopBarSlideDown .2s linear forwards` | ❌ 吸顶条入场 |
| `.cover-fade-enter-active` | `cover-enter-anim .3s linear` | ❌ 封面交叉淡入 |
| `.cover-fade-leave-active` | `cover-leave-anim .3s linear` | ❌ 封面交叉淡出 |
| `.up-avatar-wrap .live-cycle .a-cycle` | `scaleUpCircle-data-v-52eeb580 1.5s linear` | ❌ 直播头像扩散 |
| `.live-icon-col[data-v-c2141c4c]` | `living-icon-ani-c2141c4c .6s linear infinite` | ❌ 直播图标帧 |
| `.bili-login-card__stage:after` | `wave-c68acadd 8s infinite linear` | ❌ 登录页波形 |
| `.fade-appear / .fade-enter / .fade-leave` + `50%{…}` | 裸 `linear` | ❌ 过渡 |

✅ **即：58 次 `linear` 中 54 次（93.1%）不是 spinner**，与 Pictelio「`linear` 仅限 loading spinner」的红线直接冲突。

### 2.6 隐式缓动（未写 timing-function 的声明）

✅ 带时长但**未显式指定** timing-function 的声明组：**447 / 581 = 76.9%**。
即 bilibili 四分之三的过渡依赖 CSS 默认 `ease`（等价 `cubic-bezier(.25,.1,.25,1)`），未进入 §2.1 的显式曲线表。
分母 581 与 §1.1 的「带时长的声明组总数」**同口径**（`transition*`/`animation*` 声明按括号感知逗号切分后，逐组取首个时间 token）。

---

## 3. 交互状态覆盖（量化，可达性）

**统计口径** ✅：只统计**选择器位置**——先用括号配平算法删除所有 `{...}` 声明块，仅在选择器文本与 at-rule 前言中计数，避免把属性值里的 `disabled` 之类误计。`:focus` 使用负向断言 `(?![-\w])`，不匹配 `:focus-visible` / `:focus-within`。

**全语料计数**

| 状态 | 次数 | 占比 | home | homev3 | video | read | manga | mstation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `:hover` | 457 | 66.62% | 152 | 29 | 253 | 13 | 10 | 0 |
| `[disabled]` | 91 | 13.27% | 91 | 0 | 0 | 0 | 0 | 0 |
| `:active` | 58 | 8.45% | 38 | 0 | 12 | 0 | 0 | 8 |
| `:focus` | 37 | 5.39% | 20 | 0 | 10 | 4 | 3 | 3 |
| `:checked` | 18 | 2.62% | 0 | 0 | 18 | 0 | 0 | 0 |
| **`:focus-visible`** | **12** | **1.75%** | **0** | **0** | **12** | **0** | **0** | **0** |
| `:disabled` | 12 | 1.75% | 0 | 0 | 4 | 0 | 0 | 8 |
| `:visited` | 1 | 0.15% | 1 | 0 | 0 | 0 | 0 | 0 |
| `:focus-within` | 0 | 0% | 0 | 0 | 0 | 0 | 0 | 0 |
| `:target` | 0 | 0% | 0 | 0 | 0 | 0 | 0 | 0 |
| `:read-only` | 0 | 0% | 0 | 0 | 0 | 0 | 0 | 0 |
| `:indeterminate` | 0 | 0% | 0 | 0 | 0 | 0 | 0 | 0 |

> `[disabled]` 全部 91 次来自 `home.css` 的 `.vui_button[disabled]` 系列（VUI 按钮禁用态）。✅

### 3.1 每页 `:focus-visible` vs 裸 `:focus` 比值（任务验收点 3）

| 页 | `:focus-visible` | 裸 `:focus` | 比值 | `:focus-visible`/`:hover` 覆盖率 | 判定 |
| --- | --- | --- | --- | --- | --- |
| home(PC) | 0 | 20 | **0.00** | 0 / 152 = 0% | ❌ 键盘可达性缺失 |
| homev3(PC) | 0 | 0 | — | 0 / 29 = 0% | ❌ 两种焦点态**全无** |
| video(PC) | 12 | 10 | **1.20** | 12 / 253 = 4.7% | 🟡 部分覆盖，且混用裸 `:focus` |
| read(PC) | 0 | 4 | **0.00** | 0 / 13 = 0% | ❌ 键盘可达性缺失 |
| manga(PC) | 0 | 3 | **0.00** | 0 / 10 = 0% | ❌ 键盘可达性缺失 |
| mstation(H5) | 0 | 3 | **0.00** | 0 / 0 = 0% | ❌ 无 hover 能力也无焦点样式 |
| 主题层 / 字体层 | 0 | 0 | — | — | — |

✅ **6 个页面组中 4 个的比值为 0.00**。唯一非零的 video 页 12 次 `:focus-visible` 全部来自**同一个 Vue 组件**（笔记侧栏 / 反馈弹层），而非全站策略：

```css
/* video.css —— 12 次 :focus-visible 中的典型 4 条，均带 [data-v-*] 作用域 */
.annotation[data-v-0b383462]:focus-visible
.ote-sidebar-feedback-trigger[data-v-5bc92ee3]:focus-visible
.feedback-close[data-v-5bc92ee3]:focus-visible
.video-note-sidebar-chapter-point[data-v-f3a4e806]:focus-visible
.video-note-sidebar-chapter-point:focus-visible .video-note-sidebar-chap…（×5，聚焦时展开章节详情）
.video-note-sidebar-chapter-portal[data-v-f3a4e806]:focus-visible
```

✅ **修正上一轮结论**：上一轮记录「`:focus-visible` 0 次」，本次复算在 `video.css` 中实测 **12 次**。上一轮的 0 应是抓取范围或匹配方式所致。同样地，`prefers-reduced-motion` 上一轮记 0 次，本次在 `video.css` 实测 **2 次**（见 §4.4）。

### 3.2 `:hover` / `:active` / `:focus` 实际改了什么属性

✅ 统计每类状态规则体内的声明属性（`transition*` 已剔除）：

| 属性 | `:hover`（450 规则体 / 830 声明） | `:active`（59 / 147） | `:focus`（40 / 80） | `:focus-visible`（12 / 36） |
| --- | --- | --- | --- | --- |
| `color` | 278（33.5%） | 34（23.1%） | 17（21.2%） | — |
| `background` | 157（18.9%） | 35（23.8%） | 16（20.0%） | 2 |
| `background-color` | 94（11.3%） | 3 | 6 | — |
| `border` | 66（8.0%） | 32（21.8%） | 15 | — |
| `opacity` | 56（6.7%） | 23（15.6%） | 2 | — |
| `border-color` | 24（2.9%） | 3 | — | — |
| `fill` | 22（2.7%） | — | — | — |
| `display` | 15（1.8%） | — | 1 | 3 |
| **`transform` / `scale`** | **10（1.2%）** | **9（6.1%）** | — | — |
| **`outline`** | — | 3 | 13（16.2%） | **10（27.8%）** |
| **`outline-offset`** | — | — | 6 | **6（16.7%）** |
| `filter` | 6 | — | — | — |
| `visibility` | 6 | — | — | — |
| `border-radius` | 7 | — | — | — |
| `box-shadow` | — | — | — | — |

**归纳（事实）** ✅：

1. **hover 反馈 96% 是「变色」**：`color` + `background` + `background-color` + `border` + `border-color` + `fill` = 641 / 830 = **77.2%**；`transform` 仅 **10 次（1.2%）**。
2. **press 反馈以 `transform: scale()` 为主**：`:active` 的 transform 9 次中，**8 次是 `scale`，量值统一为 `.95`**；本项目规范写的是 `scale(0.98)`。
3. **`:focus-visible` 的 36 条声明里 16 条（44%）是 `outline` + `outline-offset`** —— 这是全语料中**唯一**系统性使用「outline + offset」焦点环的地方，也正是 Fluent 的做法。

### 3.3 `:hover` / `:active` 可交互选择器抽样（18 + 15 条，随机种子 7）

**`:hover` 抽样**（424 条有属性变化中抽 18）：

| 选择器（尾部） | 改变的属性 |
| --- | --- |
| `.bili-header .right-entry .right-entry__item-trigger` | `animation` |
| `.annotation[data-v-0b383462]` | `background` |
| `.tag-channel-pane-exp .channel-btns .no-subs[data-v-010b2872]` | `background`, `border` |
| `.bili-header .game-download-notify__all` | `color` |
| `.bili-header .center-search-container.white-bg-bar .center-search__bar #nav-search` | `background`, `border` |
| `.hover\:opacity-90` | `opacity` |
| `.video-card-ad-small .video-card-ad-small-inner .vcd[data-v-27c261dc]` | `color` |
| `.bili-header .header-dynamic-list-item[data-v-46cf1cf5]` | `background-color` |
| `.video-owner-state.minisize .video-owner-state-item.edit-manuscript` | `content` |
| `.video-page-card-small .card-box .pic-box` | `opacity` |
| `.left-entry .left-entry__item.more-entry .more-entry-content` | `background-color` |
| `.van-popover.van-followed .follow_dropdown li` | `background-color` |
| `.vui_button--active-pink.vui_button--link:not([disabled])` | `background`, `border`, `color` |
| `.bili-header .match-right-notify-list-item` | `background` |
| `.header-avatar-wrap .avatar-panel-popover .counts-item .single` | `color` |
| `.video-note-sidebar-chapter-point` | `background`+`border`+`border-radius`+`box-shadow`+`transform`+`left/top/width/height/min-*/max-*`+`padding`（**尺寸/位移型，最重**） |
| `.up-item .up-avatar[data-v-0dac074f]` | `transform: scale(1.05)` |
| `.interact-dialog-exp .btn` | `background` |

**`:active` 抽样**（55 条中抽 15）：

| 选择器（尾部） | 改变的属性 |
| --- | --- |
| `.vui_button--active-shrink` | `transform: scale(.95)` + `-webkit-transform` |
| `.primary-btn`（home） | `transform: scale(.95) translateZ(0)` |
| `.carousel .carousel-container .vui_carousel .carousel-arrows button` | `transform` |
| `.video-custom-interactive-layer-entry` | `transform: translateY(1px)` |
| `.video-note-sidebar-entry` | `transform: translateY(1px)` |
| `.coin-operated-m-exp .coin-bottom .bi-btn` | `background`, `border-color` |
| `.v5-button--primary:not(:disabled)` | `opacity` |
| `.vui_button--pink` / `--grey` / `--active-blue` / `--blue.vui_button--plain` | `background`, `border`, `color` |
| `.van-popover:focus` | `outline-width` |

✅ **规模型按压仅 `scale(.95)`（4 处）；侧栏类按压仅 `translateY(1px)`（2 处）—— 均为亚像素级，与 Fluent 的 `scale(0.98)` 差一个数量级。**

---

## 4. 动画关键帧清单

**全语料 `@keyframes` 总数：95** ✅（分文件：`home.css` 18 + `homev3_0.css` 9 + `video.css` 50 + `mstation.css` 10 + `manga3.css` 2 + `manga0/1/5/8/9/10.css` 各 1；`video.css` 50 个中含 2 组同名重复定义 `shake` / `coin-run-animation`，以及 9 组 Vant `exchange` 式的方向变体）。

### 4.1 分类清单（归类为 🟡 的使用场景由类名/上下文推断）

| 类别 | 关键帧名 | 所在 | 原文（压缩） | 场景 |
| --- | --- | --- | --- | --- |
| **加载 / spinner** | `loading-rotate` | home | `0%{transform:rotate(0)}to{transform:rotate(360deg)}` | ✅ 通用旋转 loader |
| | `loadingCircle` | video | `0%{transform-origin:50% 50%;transform:rotate(0deg)}to{transform:rotate(1turn)}` | ✅ Vant Loading |
| | `rotateAuto` | video | `0%{transform:translate(-50%,-50%) rotate(0deg)}to{transform:translate(-50%,-50%) rotate(1turn)}` | ✅ 绝对居中旋转 |
| | `v5-button-loading-spin` | mstation | `0%{transform:rotate(0deg)}to{transform:rotate(1turn)}` | ✅ 按钮内 loading |
| | `swiper-preloader-spin` | manga8 | `to{transform:rotate(360deg)}` | ✅ swiper 预载 |
| **骨架屏 shimmer** | `skeleton-loading` | home | `0%{transform:translate(-75%)}to{transform:translate(0)}` | ✅ 配合 `linear-gradient` 扫光，见 §10.1 |
| | `vike-react-shine` | manga10 | `to{background-position-x:-200%}` | ✅ 漫画站骨架扫光 |
| | `pulse` | manga5 | `50%{opacity:.5}` | 🟡 Tailwind `animate-pulse` |
| **骨架波纹 / 装饰** | `wave-c68acadd` | home | `0%{translateZ(0)}12%{translate3d(2px,1px,0)}…50%{translate3d(0,4px,0)}…to{…}` | 🟡 14 段折线「波形」 |
| | `living-status` | home | `0%{height:4px}to{height:9px}` | 🟡 「直播中」状态条伸缩 |
| | `bili-avatar` | home+video | `0%{transform:translateZ(0)}to{transform:translate3d(-97.5%,0,0)}` | ✅ 头像帧序列（sprite 逐帧） |
| | `_little-tv_1or35_1` | manga1 | `0%{background-position:0 0}2%{-100px 0}4%{-200px 0}…` | ✅ 逐帧 sprite（步进 100px） |
| | `sideCardLiveIconAnime-5add9af1` | home | `0%{background-position:0 0}to{background-position:-280px 0}` | ✅ 直播图标帧动画 |
| | `upgrade-bubble-animation-16f424b9` | mstation | `0%{0 0}2.04%{16.66% 0}4.08%{33.33% 0}…` | 🟡 升级气泡 sprite（百分比步进） |
| **入场 / 出场** | `bounce-in` | video | `0%{scale(0)}50%{scale(1.1)}to{scale(1)}` | ✅ 弹入 |
| | `popup-bounce-in` | video | `0%{translateY(-50%) scale(0)}50%{translateY(-50%) scale(1.2)}to{translateY(-50%) scale(1)}` | ✅ 弹窗 |
| | `dialog-fade-in` / `-out` | video | `0%{translate3d(0,-20px,0);opacity:0}to{translateZ(0);opacity:1}` | ✅ 对话框（**-20px 位移+淡入**） |
| | `v-modal-in` / `-out` | video | `0%{opacity:0}` / `to{opacity:0}` | ✅ 遮罩 |
| | `antFadeIn` / `antFadeOut` | video | `0%{opacity:0}to{opacity:1}` | ✅ Vant 淡入淡出 |
| | `antMove{Up,Down,Left,Right}{In,Out}` | video | `0%{translateY(100%);opacity:0}to{translateY(0);opacity:1}` | ✅ Vant 4 向滑入（各 2 帧） |
| | `antSlide{Up,Down,Left,Right}{In,Out}` | video | `0%{scaleY(.8)}to{scaleY(1)}` | ✅ Vant 缩放滑入（各 2 帧） |
| | `antZoom{In,Out,BigIn,BigOut,UpIn,…}` | video | `0%{scale(.2)}to{scale(1)}`（含 6 个方向变体） | ✅ Vant 缩放（10 帧） |
| | `antSwingIn` | video | `0%{translateX(0)}20%{-10px}40%{10px}60%{-5px}80%{5px}` | ✅ Vant 摆动 |
| | `move-in-top` / `move-out-top` | manga3 | `0%{translate(-50%,-2rem)}to{translate(-50%)}` | ✅ 漫画站 Toast（**用 rem**） |
| | `fadeIn-toast` | manga9 | `0%{opacity:0;scale(.8,.5)}to{opacity:1;scale(1)}` | ✅ Toast 上浮 |
| | `icon-popup-16f424b9` | mstation | `0%{translateY(100%)}to{translateY(0)}` | 🟡 底部弹层 |
| | `biliHeaderSlideDown` / `fixedTopBarSlideDown` | home | `0%{opacity:0}to{opacity:1}` | ✅ 顶栏/吸顶条入场（**仅淡入**） |
| | `biliHeaderSlideDown` 变体 `avatarFadeLarge/Small-16fab57e` | home | `0%{scale(.4) translateY(-2px) translate(3px)}30%{opacity:1}to{scale(1) translate(-36px,10px)}` | ✅ 头像面板展开/收起 |
| | `cover-enter-anim` / `cover-leave-anim` | homev3 | `0%{opacity:0}50%{opacity:1;animation-timing-function:linear}to{opacity:1}` | ✅ **帧内切换 timing-function**（尾段改用 linear） |
| | `exchange`（重复 4 次定义） | homev3 | `0%{opacity:1;translateX(0)}25%{opacity:0;translateX(-80px)}50%{…}` | ✅ 榜单换位横向滑出 |
| | `colorfade` | homev3 | `0%{opacity:1}25%{opacity:0}75%{opacity:0}to{opacity:1}` | ✅ 交叉淡入 |
| **轮播** | `locmoveclipslider` | home | `0%{translateY(0)}5%{translateY(calc(var(--left-loc-height)*-1))}50%{…}55%{…*-2)}to{…}` | ✅ 定位卡轮播，**用 CSS 变量驱动位移** |
| **弹幕** | ❌ **未找到** | — | — | ❌ CSS 中无弹幕专用 `@keyframes`；弹幕由 canvas / 独立包渲染 |
| **悬停预览** | `jump` / `jump-ec16de5b` | home | `0%{translateY(0)}50%{translateY(-3px)}to{translateY(0)}` | 🟡 悬停时卡片/图标上下弹跳 3px |
| | `guide-ca6d02a9` | home | `0%{translateY(0)}50%{translateY(5px)}to{translateY(0)}` | 🟡 新手引导箭头 |
| **点赞** | `scaleUpCircle-data-v-52eeb580` | video | `0%{translate(-50%,-50%) scale(1);opacity:1}100%{translate(-50%,-50%) scale(1.5);opacity:0}` | ✅ 点赞扩散圆环 |
| | `bubble-bounce-16f424b9` | mstation | `0%,to{translateY(0)}50%{translateY(-5px)}` | 🟡 移动端气泡弹跳 |
| **投币** | `coin-run-animation` | video | `0%{translate3d(0px,0,0)}100%{translate3d(-2767px,0,0)}` | ✅ 金币横向跑马灯（**-2767px 定距**） |
| **收藏** | `shake`（2 份定义） | video | `2%{translate(.5px,-.5px) rotate(.5deg)}4%{…}…` | ✅ 投币/收藏失败的**抖动**（多段微小 rotate） |
| **其它微交互** | `eat-haha-up/down-019bb25f` | home | `0%{rotate(0)}25%{rotate(-45deg)}50%{rotate(0)}75%{rotate(-45deg)}to{rotate(0)}` | 🟡 头像「吃」互动，±45° 摆动 |
| | `breath-animation` / `-data-v-02ade840` | video | `0%{scale(1);background-color:#fb6699}100%{scale(2.5);background-color:#ffecf1}` | 🟡 呼吸光晕（品牌粉 → 淡粉） |
| | `_wave-splashing-avatar_fqah7_1` | manga0 | `0%{opacity:1;scale(0)}to{opacity:0;scale(2)}` | 🟡 头像水波扩散 |

**关键帧层面小结** ✅：

- `bili-avatar`、`_little-tv`、`sideCardLiveIconAnime`、`coin-run-animation` 四例都是**雪碧图逐帧动画**（改 `background-position` 或固定 `translate3d` 距离），是 bilibili 签名手法。
- `linear` 只在**帧动画内**被使用（`cover-enter-anim` 尾段），不在 UI 过渡里当默认曲线。

### 4.4 `prefers-reduced-motion`（复算，修正上一轮）

✅ **全语料 2 次，均在 `video.css`，均作用于 Vue transition 类**：

```css
@media (prefers-reduced-motion: reduce) {
  .custom-interactive-layer-sidebar[data-v-13fe65b1] {
    --custom-related-state-transition: 1ms linear;
  }
  .custom-interactive-layer-sidebar-motion-enter-active[data-v-13fe65b1],
  .custom-interactive-layer-sidebar-motion-leave-active[data-v-13fe65b1] {
    transition-duration: 1ms, 1ms;
  }
}
```

```css
@media (prefers-reduced-motion: reduce) {
  .video-note-sidebar-motion-enter-active[data-v-f3a4e806],
  .video-note-sidebar-motion-leave-active[data-v-f3a4e806] {
    transition-duration: 1ms, 1ms;
  }
}
```

✅ 手法的精确定量描述：**降级到 `1ms` 而非 `0s`**（这 4 次 `1ms` 也出现在 §1.1 时长表的 `1ms | 4` 行）。覆盖范围仅 2 个侧栏组件，**未做全局兜底**。

> ✅ **修正上一轮结论**：上一轮记「`prefers-reduced-motion` 0 次」，实测 2 次。

---

## 5. 排版体系（穷举）

### 5.1 自托管 `@font-face`（最重要发现）

✅ **bilibili 自托管 HarmonyOS Sans（鸿蒙字体）**，两套字重、**每套 54 个 unicode-range 分片**：

| 项 | `font-regular.css` | `font-medium.css` |
| --- | --- | --- |
| `font-family` | `'HarmonyOS_Regular'` | `'HarmonyOS_Medium'` |
| `font-weight` | `400`（54/54 全部） | `500`（54/54 全部） |
| `font-style` | `normal`（54/54） | `normal`（54/54） |
| `font-display` | `swap`（54/54） | `swap`（54/54） |
| `@font-face` 条数 | **54** | **54** |
| 格式 | `woff2`（54/54） | `woff2`（54/54） |
| 分片后缀 | `a`…`z`, `aa`…`az`, `a0`, `a1`（base36 式，共 54） | 同上 |
| 主机 | `//s1.hdslb.com/bfs/static/jinkela/long/font/` | 同目录 |

**URL 模板** ✅（可直接复算）：

```
https://s1.hdslb.com/bfs/static/jinkela/long/font/HarmonyOS_Regular.{suffix}.woff2
https://s1.hdslb.com/bfs/static/jinkela/long/font/HarmonyOS_Medium.{suffix}.woff2
suffix ∈ {a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z,aa,ab,…,az,a0,a1}
```

**分片边界（首尾原文）** ✅：

```css
/* 首片：覆盖到最高码位 */
{ font-weight:400; src:url('//s1.hdslb.com/bfs/static/jinkela/long/font/HarmonyOS_Regular.a.woff2') format('woff2');
  unicode-range: U+9aa2-ffe5; }

/* 末片：ASCII + 西文标点 + 货币符号 */
{ font-weight:400; src:url('//s1.hdslb.com/bfs/static/jinkela/long/font/HarmonyOS_Regular.a1.woff2') format('woff2');
  unicode-range: U+21-7e,U+a4,U+a7-a8,U+b0-b1,U+b7; }
```

**分片策略定性** ✅：前 6 片是**连续码位区间**（`U+9aa2-ffe5` / `U+8983-9aa0` / `U+78f2-897b` / `U+646d-78d9` / `U+30e0-6445` / `U+101-30df`），第 7 片起转为**按使用频次拆分的离散码位集**（g/h/i…az 的 `unicode-range` 是几百个离散区间的列表），末片 `a1` 是 ASCII 兜底。
✅ **共 108 个唯一 woff2 文件**（54 × 2 字重；对 `home.css` + `font-regular.css` + `font-medium.css` 三处 `@font-face` 去重后实测 = 108，无重复 URL）。
✅ 这 108 个声明在**首页 `home.css` 里被内联重复了一份**（`home.css` 含 108 条 `@font-face`，URL 与独立字体包完全相同），即首页不依赖 `jinkela/long/font/*.css` 这两个独立文件；后者由观看页（`video.html` 的 `<link>`）加载。

**活性验证** ✅：

```
HTTP 200  HarmonyOS_Regular.a1.woff2  content-length=7696   cache-control=max-age=31536000
HTTP 200  HarmonyOS_Medium.a1.woff2   content-length=7940   cache-control=max-age=31536000
```

**是否可变字体** ❌ **不是**。✅ 全语料 `font-variation-settings` 命中 0 次；`@font-face` 中无 `wght` / `font-weight: 400 500` 区间声明；两个 CSS 文件全部 `font-weight` 值只有单一值（400 / 500）。**采用「静态字重 × 54 分片」而非可变字体轴**。

### 5.2 补充：`@font-face` 的完整分布（221 条声明 / 6 个文件）

✅ 逐文件 `@font-face` 计数：

| 文件 | `@font-face` 条数 | family | 性质 |
| --- | --- | --- | --- |
| `font-regular.css` | 54 | `HarmonyOS_Regular` | 正文字体（独立字体包） |
| `font-medium.css` | 54 | `HarmonyOS_Medium` | 正文字体（独立字体包） |
| **`home.css`** | **108** | `HarmonyOS_Regular`(54) + `HarmonyOS_Medium`(54) | **首页把同一套 108 个声明内联重复了一遍**（URL 与上两文件完全相同，`format("woff2")` 双引号 vs 单引号差异） |
| `homev3_0.css` | 1 | `DIN-BoldItalic` | 🟡 展示字体（见下） |
| `video.css` | 3 | `vanfont`（图标） / `"Monospaced Number"` / `Chinese Quote` | 图标字体 + 排版专用 |
| `mstation.css` | 1 | `bili-font`（图标） | 图标字体 |

✅ **3 个非 HarmonyOS 的 `@font-face` 原文**：

```css
/* homev3_0.css —— 唯一 truetype 格式，且无 font-display / 无 unicode-range */
@font-face {
  font-family: DIN-BoldItalic;
  src: url(//s1.hdslb.com/bfs/static/home-v3/assets/DIN-BoldItalic.ttf) format("truetype");
}

/* video.css —— 数字等宽：只声明本地 Tahoma，按需回退 */
@font-face {
  font-family: "Monospaced Number";
  src: local("Tahoma");
  unicode-range: u+30-39;
}

/* video.css —— 中文引号专用栈（不下载任何字体，纯 local 匹配） */
@font-face {
  font-family: Chinese Quote;
  src: local("PingFang SC"), local("SimSun");
  unicode-range: u+2018, u+2019, u+201c, u+201d;
}
```

✅ 值得注意的两点：
1. `"Monospaced Number"` 用 `unicode-range: u+30-39` 把**数字（0-9）单独切出来**做等宽对齐 —— 这是数字列对齐的标准手法，但**回退字体只有 `local("Tahoma")`**，非 Windows / 无 Tahoma 的平台会静默掉回非等宽。
2. `Chinese Quote` 的 `unicode-range` 只含 4 个码位（`U+2018/2019/201C/201D`），是**纯排版微调字体**，零网络请求。

### 5.3 全部 `font-family` 声明（去重后清单 + 频次）

统计自 28 个 CSS；括号内为出现次数。

| 字体栈 | 次数 | 类型 |
| --- | --- | --- |
| `HarmonyOS_Medium` | 54 | 自托管（@font-face 名） |
| `HarmonyOS_Regular` | 54 | 自托管（@font-face 名） |
| `'HarmonyOS_Regular'` | 54 | 自托管（带引号引用） |
| `'HarmonyOS_Medium'` | 54 | 自托管（带引号引用） |
| `DIN-BoldItalic` | 1 | 自托管（truetype，`homev3_0.css`） |
| `inherit` | 11 | 继承 |
| `PingFangSC-Regular` | 11 | 系统（macOS 旧式名） |
| `PingFang SC,sans-serif` | 10 | 系统（无空格） |
| `'PingFang SC', sans-serif` | 8 | 系统 |
| `PingFang SC,HarmonyOS_Regular,Helvetica Neue,Microsoft YaHei,sans-serif!important` | 3 | **混排栈**（自托管兜底） |
| `PingFangSC-Semibold` | 3 | 系统 |
| `-apple-system,BlinkMacSystemFont,Helvetica Neue,Helvetica,Arial,PingFang SC,Hiragino Sans GB,Microsoft YaHei,sans-serif!important` | 2 | 通用栈 |
| `vanfont` / `vanfont!important` | 2 + 1 | **图标字体**（见 §6.1） |
| `Helvetica` | 2 | 系统 |
| `'Menlo', 'Monaco', 'Consolas', monospace` | 1 | 等宽 |
| `Consolas,Menlo,Courier,monospace` | 1 | 等宽 |
| `"Monospaced Number"` | 1 | 等宽（数字等宽） |
| `Chinese Quote` | 1 | 排版伪类 |
| `bili-font` / `bili-font!important` | 1 + 1 | **图标字体**（见 §6.1） |
| `sans-serif` | 1 | 通用 |
| `-apple-system,BlinkMacSystemFont,Helvetica Neue,Helvetica,Arial,PingFang SC,Hiragino Sans GB,Microsoft YaHei,sans-serif` | 1 | 通用栈（去 `!important`） |
| `Helvetica Neue,Tahoma,Arial,PingFangSC-Regular,Hiragino Sans GB,Microsoft Yahei,sans-serif` | 1 | 通用栈 |
| `var(--default-font-family,ui-sans-serif,system-ui,sans-serif,"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji")` | 1 | Tailwind v4 默认 |

**中文字体栈实测结论** ✅：**没有** `思源黑体 / Source Han Sans / Noto Sans SC / 微软雅黑为主 / MiSans / OPPO Sans`。主链路是 **自托管 HarmonyOS Sans（400/500）→ 系统 PingFang SC → Helvetica Neue → Microsoft YaHei → sans-serif**；`Hiragino Sans GB` 只在 3 条通用栈里作为 macOS 回退。

### 5.4 字号 / 行高 / 字重 / 字距（频次表）

**`font-size`（全语料 1005 条声明）**

| 值 | 次数 | 值 | 次数 |
| --- | --- | --- | --- |
| `14px` | 277 | `10px` | 10 |
| `12px` | 189 | `22px` | 8 |
| `13px` | 109 | `9px` | 5 |
| `16px` | 96 | `24px` | 5 |
| `3.73333vmin` | 55 | `inherit` | 4 |
| `15px` | 45 | `var(--subtitle-font-size)` | 4 |
| `3.2vmin` | 39 | `2.66667vmin` | 4 |
| `18px` | 28 | `var(--v_fs_4)` | 3 |
| `20px` | 24 | `var(--title-font-size)` | 3 |
| `0` | 17 | `75%` | 3 |
| `3.46667vmin` | 15 | `11px` | 3 |
| `4.26667vmin` | 11 | `100%` / `80%` / `1em` | 2 each |

✅ **PC 端字号刻度只有 6 档被大量使用：12 / 13 / 14 / 15 / 16 / 18px**（合计 903 / 1005 = 89.9%），其余全是长尾。`vmin` 全部来自 `mstation.css`（移动端）。
✅ 另有 `--v_fs_*` 令牌（home.css，已复算确认）：

```css
--v_fs_1: 24px;  --v_fs_2: 18px;  --v_fs_3: 16px;
--v_fs_4: 14px;  --v_fs_5: 13px;  --v_fs_6: 12px;
```

**`line-height`（729 条声明）**

| 值 | 次数 | 值 | 次数 |
| --- | --- | --- | --- |
| `20px` | 124 | `32px` | 18 |
| `18px` | 48 | `40px` | 16 |
| `16px` | 45 | `14px` | 16 |
| `17px` | 43 | `50px` | 16 |
| `22px` | 43 | `26px` | 14 |
| `24px` | 25 | `30px` / `34px` | 13 each |
| `28px` | 23 | `5.33333vmin` | 21 |
| `1`（无单位） | 20 | `15px` | 20 |
| `4.8vmin` | 13 | `36px` / `19px` / `21px` | 12 / 12 / 11 |

✅ **行高以绝对 px 为主（Top5 = 20/18/16/17/22px）**，仅 5 次用无单位 `1`，5 次用 `1.5`。`--v_radius` 家族（已复算）：

```css
--v_radius: 6px;  --v_radius_sm: 4px;  --v_radius_md: 8px;
--v_radius_lg: 10px;  --v_radius_xl: 12px;
```

**`font-weight`（471 条声明）**

| 值 | 次数 | 占比 |
| --- | --- | --- |
| **`500`** | 239 | 50.7% |
| `400` | 171 | 36.3% |
| `600` | 30 | 6.4% |
| `700` | 14 | 3.0% |
| `bolder` / `bold` | 4 / 4 | 1.7% |
| `800` / `900` | 2 / 2 | 0.8% |
| `var(--font-weight-bold/medium/normal)` | 1 each | — |
| `500px`（1 次异常值，疑似手误） | 1 | 0.2% |

✅ **中位字重是 500 而非 400**——与 §5.1 的自托管字重只做 400/500 两档完全对应（`--font-weight-*` 令牌也只声明 medium/bold/normal 三档）。

**`letter-spacing`（仅 30 条声明，全语料）**

| 值 | 次数 |
| --- | --- |
| `0` | 26 |
| `inherit` | 2 |
| `0.05em` | 1 |
| `var(--tracking-tight)` | 1 |

✅ **字距几乎不被使用（30 / 全语料），且 26 次是显式归零**。Tailwind 的 `--tracking-tight` 令牌来自 `manga5.css`。

---

## 6. 图标体系（穷举）

### 6.1 图标字体：**有，2 套，均为 base64 内嵌**

| 文件 | `font-family` | `src` 格式 | `unicode-range` | `font-display` | 消费类名前缀 |
| --- | --- | --- | --- | --- | --- |
| `video.css` | `vanfont` | base64 内嵌 `data:font/woff` + `data:application/x-font-woff` + `data:font/ttf` | ❌ **无** | ❌ **无** | `van-*`（Vant 组件库：`.van-pagination-point`、`.van-popover`、`.van-message`、`.van-framepreview`、`.van-album`…） |
| `mstation.css` | `bili-font` | base64 内嵌 `data:application/vnd.ms-fontobject`（EOT）+ `data:application/x-font-woff2` + `data:font/woff` | ❌ **无** | ❌ **无** | `bili-*`（旧 mstation 体系） |

✅ **两个图标字体都缺 `unicode-range` 与 `font-display`**，与 §5.1 正文字体的 54 分片 + `swap` 做法形成鲜明对比。

另有外链图标字体（`video.css`）✅：`//s1.hdslb.com/bfs/static/jinkela/video/asserts/iconfont.ae48418.eot` + `iconfont.6401a86.ttf`（老式 eot/ttf 双格式，无 woff2）。

### 6.2 雪碧图：**有，`icons.png` 坐标式**

✅ 图集 URL：`https://i0.hdslb.com/bfs/static/jinkela/long/images/icons.png`（`video.css`，3 处引用）

| 使用点 | `background-position` | 元素尺寸 |
| --- | --- | --- |
| `.activity-m-v1.act-now .l-inside .score-wrapper li` | `no-repeat -655px -2126px` | `36px × 32px` |
| `.tag-report-popup-exp .btn-close` | `-475px -539px` | `10px × 10px` |
| `.s_tag-v1 .tag-wrap .ipt a` | `-539px -539px no-repeat` | `10px × 10px` |

✅ **`0 -32px` 式坐标偏移确实在用**（`-475px -539px` / `-655px -2126px`），图集纵向超过 2126px，属于典型的多倍率合图。
✅ 移动端（`mstation.css`）不用合图，而是**单图标独立 PNG**：`ic_play.png`（`14.4vmin` 见方）、`icon_close.png`（`9.6vmin`）、`icon_close2.png`（`4.26667vmin`）、`app_logo.png`（`4.8vmin`）、`app_logo_large.png`（`18.66667vmin`）。

`background-position: Xpx Ypx` 坐标式全语料计数 ✅：`home.css` 2 / `video.css` **15** / `mstation.css` 0。

### 6.3 SVG 用法

| 形态 | 数量 | 分布 |
| --- | --- | --- |
| `data:image/svg+xml` 内联 data-URI（CSS 内） | **11** | `manga8.css` 8、`video.css` 3 |
| `url(*.svg)` 外链（CSS 内） | **18** | `video.css` 8、`home.css` 4、`mstation.css` 4、`manga6.css` 2 |
| HTML 内 `<svg>` 内联元素 | ✅ 大量 | `video.html`：`<svg class="play" style="width:18px;height:18px">`、`<svg class="dm" style="width:18px;height:18px">`（见 §9.2） |

外链 `.svg` 明细（去重）✅：

```
//i0.hdslb.com/bfs/seed/jinkela/short/user-avatar/big-vip.svg        (home, video)
//i0.hdslb.com/bfs/seed/jinkela/short/user-avatar/small-vip.svg      (home)
//i0.hdslb.com/bfs/seed/jinkela/short/user-avatar/business.svg      (home)
//i0.hdslb.com/bfs/seed/jinkela/short/user-avatar/personal.svg      (home)
//s1.hdslb.com/bfs/static/jinkela/long/mstation/wake-app-icon.svg   (mstation)
//s1.hdslb.com/bfs/static/jinkela/long/mstation/arrow_close.svg     (mstation)
//i0.hdslb.com/bfs/static/jinkela/video/asserts/note_checkbox_checked.svg
/i0.hdslb.com/bfs/static/jinkela/video/asserts/checkbox_selected.svg
//s1.hdslb.com/bfs/static/jinkela/video/asserts/checked.svg
```

✅ **重要形态特征**：观看页卡片里的 `<svg class="play">` / `<svg class="dm">` 是**空 `<svg>` 元素 + 固定 `width/height:18px`**，图标路径由 JS 运行时注入（`<use>` 符号表）。这是「内联壳 + 运行时符号」的混合模式。

### 6.4 官方图标栅格规范

❌ **未找到**。全语料 28 个 CSS 中没有任何形如「22 应用网格」「图标尺寸取 16/20/24px」的官方栅格声明或注释。可观测到的**事实尺寸**仅为散落的 `10px`（`btn-close`）、`18px`（`play`/`dm` SVG）、`36×32px`（活动图标）、`46px`（空态插画，见 §10.2）、`14.4vmin`（移动播放键）。这些是使用值，**不是规范**。

---

## 7. 响应式：断点全量清单

**统计口径** ✅：全语料 `@media` 共 **422 个**（`home.css` 314 / `homev3_0.css` 34 / `video.css` 66 / `manga5.css` 7 / `manga7.css` 1；其余 23 个文件为 0）。下文提取其中的 `(min|max)-(width|height)` 值。

### 7.1 四套并存的断点族（本次把每套完整列出）

#### 族 A —— 首页 laputa-home（`home.css`），**px + `.9` 小数**

出现 **629** 个宽度值，全部 `px` 单位。

| 断点 | 次数 | 断点 | 次数 |
| --- | --- | --- | --- |
| `1099.9px`（max） | 28 | `1559.9px`（max） | 41 |
| `1100px`（min） | 29 | `1560px`（min） | 41 |
| `1139.9px`（max） | 37 | `1700.9px`（max） | 29 |
| `1140px`（min） | 39 | `1701px`（min） | 29 |
| `1279.9px`（max） | 4 | `2059.9px`（max） | 41 |
| `1299.9px`（max） | 39 | `2060px`（min） | 42 |
| `1300px`（min） | 36 | `2199.9px`（max） | 29 |
| `1366.9px`（max） | 29 | `2200px`（min） | 29 |
| `1367px`（min） | 29 | `1759px` | 1 |
| `1399.9px`（max） | 36 | | |
| `1400px`（min） | 41 | | |

✅ 族 A 的完整刻度：**1099.9 / 1100 / 1139.9 / 1140 / 1279.9 / 1299.9 / 1300 / 1366.9 / 1367 / 1399.9 / 1400 / 1559.9 / 1560 / 1700.9 / 1701 / 1759 / 2059.9 / 2060 / 2199.9 / 2200**（20 个值）。
✅ 刻度特征：每个断点都成对出现「`X.9` 上界 + `X` 下界」（如 `1139.9px` / `1140px`），中间不留空隙；**族 A 与族 B 在 1100–1400 区间共享同一批刻度**（1100/1140/1300/1400），只在 `.9` 与 `.8` 小数位上分家。

#### 族 B —— home-v3（`homev3_0.css`），**px + `.8` 小数**

出现 **50** 个宽度值。

| 断点 | 次数 | 断点 | 次数 |
| --- | --- | --- | --- |
| `1139.8px` / `1140px` | 5 / 4 | `1559.8px` / `1560px` | 4 / 2 |
| `1300.8px` / `1301px` | 3 / 3 | `1600px` | 2 |
| `1320px` | 1 | `1659.8px` / `1660px` | 1 / 1 |
| `1399.8px` / `1400px` | 5 / 6 | `1919.8px` / `1920px` | 1 / 1 |
| `1440px` / `1441px` | 1 / 2 | `2060.8px` / `2061px` | 3 / 3 |
| | | `2559.8px` / `2560px` | 1 / 1 |

✅ 族 B 刻度：**1139.8 / 1140 / 1300.8 / 1301 / 1320 / 1399.8 / 1400 / 1440 / 1441 / 1559.8 / 1560 / 1600 / 1659.8 / 1660 / 1919.8 / 1920 / 2060.8 / 2061 / 2559.8 / 2560**（20 个值）。
✅ 独有刻度：`1600` / `1919.8-1920` / `2559.8-2560` / `1440-1441`。

#### 族 C —— 观看页（`video.css`），**px 整数，单点主导**

出现 **66** 个宽度值，**`1681px` 独占 53 次（80.3%）**。

| 断点 | 次数 | | 断点 | 次数 |
| --- | --- | --- | --- | --- |
| `400px` | 1 | | `1316px` | 1 |
| `1080px` | 1 | | `1366px` | 2 |
| `1099px` | 1 | | **`1681px`** | **53** |
| `1100px` | 2 | | `1701px` | 1 |
| `1279.9px` | 1 | | `1920px` | 1 |
| | | | `2400px` / `2559px` | 1 / 1 |

✅ 另有 2 个带空格/带 `screen` 的变体：`(min-width: 1100px) and (max-width: 1366px)`、`screen and (min-width: 1681px)`。
✅ 族 C 的实质：**观看页只有一个「宽屏」门（1681px）+ 少量补丁门**，不做多栏响应式重排。

#### 族 D —— 漫画站（`manga5.css`），**Tailwind v4 rem 刻度**

Tailwind v4 使用新语法 `@media (width>=X)`，因此上一节的 `(min|max)-width` 正则抓不到，需单独统计 ✅：

| 断点 | 等效 px（16px root） | 次数 |
| --- | --- | --- |
| `@media (width>=40rem)` | 640 | 1 |
| `@media (width>=48rem)` | 768 | 1 |
| `@media (width>=64rem)` | 1024 | 1 |
| `@media (width>=80rem)` | 1280 | 1 |
| `@media (width>=96rem)` | 1536 | 1 |

✅ **这是唯一使用 `rem` 断点的族**，也是唯一 640px 起步（其余 PC 族 1100px 起步）。
✅ 漫画站另有 `@media (hover:hover)` ×2 —— **指针能力门**，与 §3 的 `:hover` 覆盖直接相关（仅在有精确指针的设备上启用 hover 效果）。

#### 汇总

| 族 | 适用页面 | 单位 | 小数风格 | 断点数 | 起步宽度 |
| --- | --- | --- | --- | --- | --- |
| A | 首页（laputa-home） | `px` | `.9` | 20 | 1100px |
| B | home-v3（番剧/动画入口） | `px` | `.8` | 20 | 1139.8px |
| C | 观看页 | `px` | 整数 | 12 | 400px（主体 1681px 门） |
| D | 漫画站 | `rem` | 无 | 5 | 40rem = 640px |
| — | 专栏首页 / mstation | ❌ 无任何宽度断点 | — | 0 | — |

✅ **结论：4 套断点族并存**（上一轮记「2 套」）。`read*.css` 与 `mstation.css` 的 `@media` 数量为 0（专栏首页无响应式；mstation 用 `vmin` 连续缩放代替断点）。

### 7.2 各断点下改了什么（关联选择器）

✅ **关键结构事实：首页推荐流的响应式是「双轴嵌套 `@media`」，不是单轴。** `.recommended-container_floor-aside .container` 一条规则被 **6 × 6 = 36 个 `@media` 组合**包裹（外轴 6 档 × 内轴 6 档），因此媒体查询里出现大量形如
`(min-width:1400px)and (max-width:1559.9px)and (min-width:1140px)and (max-width:1299.9px)` 的**笛卡尔积条件**（这正是 §7.1 族 A 中大量「双段条件」条目的来源）。

- **外轴 6 档**：`≤1139.9` / `1140–1299.9` / `1300–1399.9` / `1400–1559.9` / `1560–2059.9` / `≥2060`
- **内轴 6 档**：`≤1139.9` / `1140–1299.9` / `1300–1399.9` / `1400–1559.9` / `1560–2059.9` / `≥2060`
- **栏数由内轴（条件串最后一段）唯一决定**，36 条规则无一例外：

| 内轴断点区间 | `grid-template-columns` | 栏数 | 36 条中的命中数 |
| --- | --- | --- | --- |
| `≤1139.9px` | `repeat(4,1fr)` + `grid-column: span 4` | **4** | 6（每个外轴各 1） |
| `1140–1299.9px` | `repeat(4,1fr)` + `grid-column: span 4` | **4** | 6 |
| `1300–1399.9px` | `repeat(4,1fr)` + `grid-column: span 4` | **4** | 6 |
| `1400–1559.9px` | `repeat(5,1fr)` + `grid-column: span 5` | **5** | 6 |
| `1560–2059.9px` | `repeat(5,1fr)` + `grid-column: span 5` | **5** | 6 |
| `≥2060px` | `repeat(5,1fr)` + `grid-column: span 5` | **5** | 6 |

✅ **唯一一次换列发生在 1400px**（4 → 5），此后到 2560px 都不再增加。外轴改变的是同一网格内的 `span` 分配（整体列跨度），内轴改变的是**列数本身**。

✅ 顶部分区导航（`.right-channel-container.is-zh .channel-items__left`）是**单轴**，与内轴刻度一致：

| 断点 | 栏数 |
| --- | --- |
| `1140–1299.9px` | `repeat(9,1fr)` |
| `1300–1399.9px` | `repeat(11,1fr)` |
| `1400–1559.9px` | `repeat(12,1fr)` |
| `1560–2059.9px` | `repeat(14,1fr)` |
| `≥2060px` | `repeat(14,1fr)`（+ `not-zh` 变体 `repeat(16,1fr)`） |
| `1300–1399.9px`（fixed 吸顶变体） | 另见 `repeat(9/11/12/14/15/17,1fr)` 六档 |

✅ **规律：栏数只增不减**（4→5、9→11→12→14→16），**卡片列宽随断点变宽而增加**。

### 7.3 版心（container）与布局用法频次

✅ **版心实测（`home.css`）**：

```css
.bili-header            { --min-width: 1100px; --max-width: 2560px; width: 100%;
                          min-width: var(--min-width); max-width: var(--max-width);
                          min-height: 64px; }
.bili-header__channel    { width: 100%; max-width: 2078px; margin: 0 auto; }
.bili-header__banner .header-banner__inner { width: 100%; max-width: 2078px; margin: 0 auto; }
.bili-header__banner { min-width: 1000px; min-height: 155px;
                       height: 9.375vw; max-height: 240px; }
```

✅ **版心最大宽度 = 2560px（顶栏） / 2078px（内容区）**，外层 `min-width: 1100px`。`2270px` 出现在 `padding: 0 96px` 的变体里（96px × 2 边距补偿）。
✅ `9.375vw` + `max-height: 240px` 是唯一的「比例 + 上限」双约束高度写法。

✅ **`max-width` 频次（全语料）**：`100%`×13、`150px`×6、`200px`×5、**`2560px`×5**、`none`×5、**`2078px`×4**、`307px`×3、`230px`/`240px`×3、`2270px`×2、`150px`… 及 `calc(100vw - 13.33333vmin)` 等 4 条 viewport 公式。

✅ **`display` 频次（全语料）**：

| 值 | 次数 | | 值 | 次数 |
| --- | --- | --- | --- | --- |
| **`flex`** | **715** | | `inline-flex` | 72 |
| `block` | 166 | | `-ms-flexbox` | 37 |
| `inline-block` | 160 | | `grid` | **22** |
| **`-webkit-box`** | **145** | | `inline-grid` | 5 |
| `none` | 83 | | 其余 | ≤5 |

✅ **flex 是绝对主力（715 次），grid 仅 22 次，`-webkit-box` 仍有 145 次**（老 VUI 遗留，未清退）。

✅ **`grid-template-columns` 频次（全语料，仅 67 条）**：`repeat(4,1fr)`×36、`repeat(5,1fr)`×36、`repeat(12,1fr)`×6、`repeat(9,1fr)`×4、`repeat(14,1fr)`×4、`repeat(11/15/17/2,1fr)`×2 each、`136px 136px`×1、`repeat(3/16,1fr)`×1、`repeat(2,minmax(0,1fr))`×1。
✅ **grid 只用于「等分栏」一种模式**（首页推荐流 + 顶部分区），没有复杂的 `grid-template-areas`。

✅ **`gap` 频次（46 条）**：`2px`×8、`6px`×7、`8px`×7、`4px`×6、`10px`×4、`5px`×3、`16px`×3、`12px`×3、`0`×3、`24px`×2、`var(--row-gap) var(--col-gap)`×2。
✅ **栏间距实际值集中在 4–8px**（28 / 46 = 60.9%），`--row-gap` / `--col-gap` 分离是唯一的行/列不等距写法。

✅ **`column-count` 频次：0**。全语料**没有**多列瀑布流排版（`column-count` / `columns`）。

---

## 8. 页面骨架拆解

> 全部基于实际 HTML 内的类名与对应 CSS 规则，未凭印象。首页 HTML 被风控拦截（§0），故首页以 `home.css` / `homev3_0.css` 的类名结构为准。

### 8.1 观看页（`video.html` + `video.css`）✅ 真实 DOM

**分区**（由 `video.html` 类名 token 频次验证）：

| 分区 | 类名 | 证据 |
| --- | --- | --- |
| 顶导 | `.bili-header` / `.fixed-header` / `.bili-header__bar` / `.mini-header` | 各 1 次 |
| 顶导内子区 | `.left-entry`（`.left-entry__title` / `.more-entry-content`） | 1 次 |
| 收藏浮层 | `.fixed-sidenav-storage-item`（×3） | 弹幕按钮 / 收藏 / 历史 |
| 主内容 | 播放器 + 笔记侧栏（`.video-note-sidebar-entry` / `-action` / `-tooltip` / `-chapter-point` / `-chapter-anchor` / `-chapter-portal` / `-chapter-number` / `-chapter-hover-title`） | 章节大纲侧栏 |
| 侧栏推荐 | `.video-page-card-small`（**20 个**） | 见 §9.2 |
| 广告位 | `.video-card-ad-small` | 1 |
| 弹幕 / 投币浮层 | `.bili-dialog-m`（×4）、`.bili-dialog-bomb`（×4） | 4 套弹层 |
| 工具栏 | `.video-toolbar-item-icon`（×5）、`.video-toolbar-left-item`（×4）、`.video-toolbar-item-text`（×4） | 点赞/投币/收藏/分享 |
| 评分 | `.van-rate-star`（×5） | |
| 相关视频 | `.pr-video-card`、`.video-page-operator-card-small`、`.tab-archive-card` | 三种卡片变体 |

**布局模式** ✅：`video.css` 内 `.video-page-card-small .card-box` 系列用 `position:relative` + 绝对定位叠层（`.pic-box` / `.framepreview-box` 覆盖封面），**非 grid/flex 多栏**；`.video-page-card-small` 自身为纵向 flex。整页以 flex 为主（198 条 transition + 大量 flex 声明）。

### 8.2 番剧/动画入口页（`anime.html`，270KB 真实 SSR）✅

| 分区 | 类名 | 证据 |
| --- | --- | --- |
| 顶导占位 | `<div id="biliMainHeader" type="mask" style="height:56px">` | SSR 占位，**高度写死 56px** |
| 应用挂载点 | `<div id="client-app">` | 客户端渲染区 |
| 容器 | `.page-home` / `.main` / `.content` / `.header` / `.title` | 各 1 |
| 轮播 | `.carousel-item-wrap`（×6）、`.banner-item-img`（×7）、`.banner-hover-group-item`（×7） | |
| 频道 | `.channel-item`（×6）、`.index-categary-content-container` | |
| 纵向卡 | `.vertical-items-group`（×11）、`.item-block` / `.item-wrap`（×6） | |
| 热门榜 | `.hot-ranking-cell-wrapper`（×5）、`.ranking-cell-wrapper`（×5）、`.inner-content-item`（×5）、`.ranking-ratio-item-container`（×5） | 见 §9.3 |
| 搜索 | `.search-box` / `.search-bar` / `.search-bar-input` / `.search-bar-icon` | 各 1 |

### 8.3 漫画站（`manga.html`，482KB 真实 SSR）✅

✅ **整站是 Tailwind v4 utility 优先**（`w-full`×369 / `flex`×493 / `block`×533 / `items-center`×286 / `shrink-0`×241 / `rounded-[8px]`×300 / `cursor-pointer`×211），**几乎不用语义化类名**。
✅ 卡片尺寸硬编码为 arbitrary value（🟡 从 utility 频次反推的单卡尺寸）：

```
w-[180px] ×150   h-[240px] ×150      ← 封面 180×240
text-[14px] ×172  text-[18px] ×150   ← 两级字号
min-h-[20px] ×150 min-w-[30px] ×150 ← 标题最小框
max-w-[180px] ×128 leading-[20px] ×183
my-[12px] ×154  mt-[8px] ×150  ml-[8px] ×128
text-[#1c1c1f] ×188  text-[#90929b] ×153  text-white ×118
```

✅ **色彩也走 arbitrary value 而非令牌**（`text-[#1c1c1f]` 主文本、`text-[#90929b]` 次文本），与主页面的 `var(--text1/2/3)` 令牌体系**完全不同**。

### 8.4 专栏首页（`read.html`，111KB 真实 SSR）✅

| 分区 | 类名 | 证据 |
| --- | --- | --- |
| 顶导 | `.header` / `.title` | 各 1 |
| 搜索 | `.search-box` / `.search-bar` / `.search-bar-input` / `.search-bar-icon` | 各 1 |
| 主体 | `.page-home` > `.main` > `.content` | 各 1 |
| 文章流 | `.feed-item`（×19）、`.article-item`（×19） | 19 篇文章 |
| 条目左/右 | `.article-item__left` / `__right`（各 19） | 左右分栏 |
| 条目字段 | `__details` / `__title` / `__desc` / `__meta` / `__author` / `__avatar` / `__uname` / `__label`（各 19） | |
| 统计 | `.article-item__stat`（**57** = 19 × 3）、`.view` / `.like` / `.comment`（各 19） | **每篇固定 3 个统计项** |
| 封面 | `.article-item__cover`（×19）、`.b-img` / `.b-img__inner` / `.sleepy`（各 38 = 19×2） | `sleepy` = 图片懒加载占位 |

### 8.5 动态页 / 排行榜页

❌ **HTML 未能直取**：`t.bilibili.com/` 返回 3,665 字节空壳；`/v/popular/rank/all` 与 `/v/popular/all` 返回 4,927 字节 SSR 壳但无卡片（客户端渲染）。
✅ 但 `home.css` 内可确认动态页浮层的类名体系（用于替代证据）：

```
.dynamic-entry → .dynamic-panel-popover → .header-tabs-panel__content--nothing
.history-entry → .history-panel-popover → .header-tabs-panel__content--nothing
.header-favorite-popover → .favorite-panel-popover__content → .content-scroll--nothing
```

🟡 即：动态/历史/收藏三类浮层共用同一套 `*--nothing` 空态类名（见 §10.2）。

### 8.6 签名交互解剖

#### (a) 卡片悬停预览 —— **两种机制并存** ✅

**机制一：帧序列预览（frame-by-frame sprite）** —— 观看页，CSS 证据完整 ✅：

```css
/* video.css */
.video-page-card-small .card-box .pic-box .framepreview-box {
  height: calc(100% + 10px); position: absolute; width: 100%; bottom: 0; }
.video-page-card-small .card-box .pic-box .framepreview-box .video-awesome-img {
  display: block; position: absolute; top: 10px; width: 141px; height: 80px; }
/* 大图变体 */
.video-page-card-small .card-box .pic-box .framepreview-box .video-awesome-img {
  width: 189px; height: 107px; }
.van-framepreview {
  position: absolute; left: 0; top: 0; width: 100%; height: 100%;
  pointer-events: none; overflow: hidden; transition: opacity .3s; z-index: 1; }
.van-framepreview .van-fpbar-box {
  position: absolute; left: 0; top: 0; width: 100%; height: 10px;
  border-color: #000; border-style: solid; border-width: 4px 8px;
  background: #444; box-sizing: border-box; }
.van-framepreview .van-fpbar-box span {
  display: block; background: #fff; height: 2px; transition: width .12s; }
```

✅ 关键数值：预览层 `height: calc(100% + 10px)`（**多出 10px 专门给进度条**）；预览图两档 **141×80** 与 **189×107**；进度条 `height:10px` + `border-width: 4px 8px`（黑框）+ `background:#444`（槽）+ 内 `span` 白色 `height:2px`（已播）+ **`transition: width .12s`（进度条自身过渡仅 120ms）**；整层 `transition: opacity .3s`。
✅ 对应 HTML（`video.html` 原文）：

```html
<div class="pic-box"><div class="pic"><div class="framepreview-box">
  <a href="/video/BV1FSev6xEfT/…" class="video-awesome-img"></a>
</div> <span class="mask-video"></span> …
```

✅ 卡片封面另有 `bili-video-card__image--hover` 层（`home.css`）：

```css
.bili-video-card .bili-video-card__image--hover .bili-video-card__mask {
  visibility: hidden; opacity: 0; }
```

**机制二：悬停播放视频 + 专用 hover 封面** —— 番剧页，HTML + CSS 双重证据 ✅：

```html
<!-- anime.html 原文：同一卡片内两个 season-cover，一个常显一个 display:none -->
<a href="…/ss29308" class="season-cover" style="position:absolute;z-index:9;">
  <img src="…png@560w_746h_!web-ogv-anime-ranking-card" loading="lazy"> …</a>
<a href="…/ss29308" class="season-cover" style="display:none;">
  <img src="…jpg@1128w_720h_!web-ogv-anime-ranking-card-hover" loading="lazy"> …</a>
<a id="web_rank_v3_player_hotlist_1784_29308_0_0_0" href="…" class="vertical-item-player"
   style="display:none;"></a>
```

```css
/* homev3_0.css */
.hot-ranking-cell-wrapper .ranking-ratio-item-container .vertical-item-player {
  position: absolute; z-index: 2; top: 0; height: 100%; width: 100%; overflow: hidden; }
.hot-ranking-cell-wrapper .ranking-ratio-item-container .vertical-item-player video {
  object-fit: cover; }
.hot-ranking-cell-wrapper.is-hover-animation-active {
  transition: left .3s, flex .3s; }
body .hover-item-ratio-scale-container .hover-item-ratio-scale-inner.is-progressing .progress-bar-content { padding: 5px; }
… .hover-item-ratio-scale-inner .progress-bar-border {
  height: 100%; width: 3px; transition: width 3s linear; }
… .progress-bar-border.is-progressing { background: hsla(0,0%,100%,.9); width: 100%; }
```

✅ **量化结论**：hover 封面是**独立预渲染的大图**（`@1128w_720h_!…-hover`，vs 常显 `@560w_746h_`）；悬停视频容器常驻 DOM 但 `display:none`；hover 激活靠加 `.is-hover-animation-active` 类触发 `transition: left .3s, flex .3s`；进度条是 **`width: 3px` 的竖条**，`transition: width 3s linear`（**3 秒线性填充**）。
🟡 悬停后延迟多久开始播放：**未在 CSS 中找到数值**；`home.js`（1,640,000 字节）中 `mouseenter` 仅 8 处、`setTimeout` 数值参数最高频为 200ms（6 次）/100ms（2 次）/300ms（2 次）/500ms（1 次），**无法归因到预览延迟** → 判为「未找到确切数值」。

#### (b) 进度条

✅ 三套并存：
1. **帧预览进度条**（横）：`height:10px` 黑框 + `#444` 槽 + 白 `span height:2px`，`transition: width .12s`（§8.6a）
2. **hover 比例进度条**（竖）：`width: 3px` + `hsla(0,0%,100%,.9)`，`transition: width 3s linear`
3. **首页/番剧卡片**：`homev3_0.css` 的 `.ranking-ratio-item-container` 内联 `style="height:0px"`（进度条容器，运行时填充）

#### (c) 稍后再看（Watch Later）

✅ **在观看页有明确 DOM 证据**（`video.html` 类名统计）：

```
.fixed-sidenav-storage-item        ×3
.fixed-sidenav-storage-item-icon   ×3
```

🟡 推断为「稍后再看 / 收藏 / 历史」三枚侧边悬浮按钮（类名 `storage-item` + 顶导 `bili-header` 同源）。具体文案与 SVG 未在 SSR HTML 中内联（图标由 JS 注入，见 §6.3）。
❌ **未找到**该功能的独立 CSS 规则或时长证据（`home.css` / `video.css` 中无 `watch-later` / `watchlater` 字样）。

#### (d) 弹幕层

✅ **DOM 存在**：`bili-dialog-m` ×4、`bili-dialog-bomb` ×4（`video.html`）。
✅ 相关 CSS：`.video-custom-interactive-layer-entry`（`transform: translateY(1px)`）、`.custom-interactive-layer-sidebar[data-v-13fe65b1]`。
❌ **未找到**弹幕专用 `@keyframes`（§4.1 已注明）、未找到弹幕轨道/速度的 CSS 数值规则 → 弹幕由 canvas / 独立包渲染，PC 样式表里没有可量化痕迹。

#### (e) 播放器控制条

❌ **未找到**。理由（诚实记录）：
- 播放器样式/逻辑不在 `video.css` 内 —— `video.html` 加载 `//s1.hdslb.com/bfs/static/player/main/core.f300a47b.js`（已抓取，1,840,139 字节）。
- 在该 JS 中检索 `autohide` / `autoHide` / `hideControls` / `controlsHide` **全部命中 0**；`mousemove` 仅 4 处；`3000` 出现 5 处但**无一带上下文**可归因到控制条自动隐藏。
- ✅ 唯一可给出的**间接数值**：`1ms`（§4.4 的 reduced-motion 降级值，作用于侧栏非播放器）。
→ **判定：自动隐藏超时数值「未找到」**，控制条的层级（`z-index`）也未在已抓样式表中出现。**不做推测。**

---

## 9. 内容密度：视频卡片到底放了什么

### 9.1 首页卡片类名全集（`home.css` 提取，39 个）✅

```
bili-video-card__wrap        bili-video-card__cover      bili-video-card__image
bili-video-card__image--wrap bili-video-card__image--link bili-video-card__image--link--filter
bili-video-card__image--hover                                    ← 悬停预览层
bili-video-card__mask                                            ← 遮罩（时长/进度）
bili-video-card__info           bili-video-card__info--ad     bili-video-card__info--author
bili-video-card__info--bottom   bili-video-card__info--creative-ad
bili-video-card__info--date     bili-video-card__info--icon-text
bili-video-card__info--no-interest  bili-video-card__info--no-interest--icon
bili-video-card__info--no-interest-panel  …--ad  …--ad--item  …--item
bili-video-card__info--owner    bili-video-card__info--popover
bili-video-card__info--rcmd-text  bili-video-card__info--rcmd-text-icon
bili-video-card__info--right    bili-video-card__info--tit
bili-video-card__stats          bili-video-card__stats--icon  bili-video-card__stats--item
bili-video-card__stats--left    bili-video-card__stats--right  bili-video-card__stats--text
bili-video-card__no-interest    …--inner  …--left  …--right
bili-video-card__skeleton       …--cover  …--info  …--light   …--right  …--text
```

### 9.2 观看页侧栏卡片 —— 真实 HTML 解剖（1 张，`video.html` 原文）✅

```html
<div class="video-page-card-small" data-v-081b3bbd>
  <div class="card-box">
    <div class="pic-box">
      <div class="pic">
        <div class="framepreview-box">
          <a href="/video/BV1FSev6xEfT/?spm_id_from=333.788.recommend_more_video.0&trackid=…"
             class="video-awesome-img"></a>
        </div>
        <span class="mask-video"></span>
      </div>
    </div>
    <div class="info">
      <a href="/video/BV1FSev6xEfT/?…">
        <p title="星神★阿哈v1实机演示，大火花登场…" class="title">星神★阿哈v1实机演示，大火花登场…</p>
      </a>
      <div class="upname">
        <a href="//space.bilibili.com/406591206/" target="_blank" style="display:;">
          <svg style="width:18px;height:18px;"></svg> <span class="name">虚构史学家-猫兔熊</span>
        </a>
      </div>
      <div class="playinfo">
        <svg class="play" style="width:18px;height:18px;"></svg> 42.8万
        <svg class="dm"   style="width:18px;height:18px;"></svg> 69
      </div>
    </div>
  </div>
</div>
```

实测值（3 张同类卡）✅：

| # | 标题 | UP 主 | 播放量 | 弹幕数 |
| --- | --- | --- | --- | --- |
| 1 | 星神★阿哈v1实机演示，大火花登场，…（野史） | 虚构史学家-猫兔熊 | **42.8万** | **69** |
| 2 | 做梦梦到了真珠的角色技能动画，所以我制作了出来 | 八瓣桃子 | **8.6万** | **35** |
| 3 | 叮咚，您的好友发来语音——真珠的「金嗓子生成器」 | （`upname` 同构） | — | — |

### 9.3 番剧热门榜卡片 —— 真实 HTML 解剖（1 张，`anime.html` 原文）✅

```html
<div id="hotlist_1784_29308_0_0_0" class="hot-ranking-cell-wrapper inner-content-item is-hover-animation-active"
     style="background:;margin-right:20px;">
  <div class="ranking-ratio-item-container home_v3_vertical_item_6" style="height:0px;">
    <a href="//www.bilibili.com/bangumi/play/ss29308?from_spmid=666.4.hotlist.0"
       class="season-cover" style="position:absolute;z-index:9;">
      <div class="season-cover-img b-img sleepy">
        <picture class="b-img__inner">
          <source type="image/avif" srcset="…png@560w_746h_!web-ogv-anime-ranking-card.avif">
          <source type="image/webp" srcset="…png@560w_746h_!web-ogv-anime-ranking-card.webp">
          <img src="…png@560w_746h_!web-ogv-anime-ranking-card" loading="lazy"
               onload="bmgCmptOnload(this)" onerror="bmgCmptOnerror(this)">
        </picture>
      </div>
      <div class="season-cover-score">9.8</div>
      <div class="background-cover"></div>
    </a>
    <a … class="season-cover" style="display:none;"> …-hover.webp … </a>
    <a id="web_rank_v3_player_hotlist_1784_29308_0_0_0" … class="vertical-item-player"
       style="display:none;"></a>
  </div>
  <div class="ranking-cell-desc">
    <div class="ranking-cell-index" style="color:#000;">1</div>
    <div class="hotranking-content-item-desc"><a href="…" title="Ban…">…</a></div>
  </div>
</div>
```

### 9.4 卡片字段清单（跨三种卡片类型合并）

| 字段 | 观看页侧栏卡 | 首页卡（类名） | 番剧榜卡 | 呈现形态 | 证据 |
| --- | --- | --- | --- | --- | --- |
| 封面图 | ✅ `.pic` / `.framepreview-box` | `bili-video-card__cover` | ✅ `.season-cover` + `<picture>` | `<picture>` 三格式（avif/webp/img）+ `loading="lazy"` | ✅ HTML |
| 悬停预览图 | ✅ `.video-awesome-img` | `bili-video-card__image--hover` | ✅ `-card-hover` 独立 URL | 独立预渲染大图 / 帧序列 | ✅ CSS+HTML |
| 悬停播放 | ✅ `.van-framepreview` | — | ✅ `.vertical-item-player` | `display:none` + JS 激活 | ✅ |
| 遮罩 / 进度 | ✅ `.mask-video` | `bili-video-card__mask` | ✅ `.progress-bar-border` | 绝对定位覆盖层 | ✅ |
| 进度条容器 | ✅ `.van-fpbar-box` | — | ✅ `.ranking-ratio-item-container`（`height:0px`） | 10px 横 / 3px 竖 | ✅ |
| **标题** | ✅ `<p class="title" title="…">` | `bili-video-card__info--tit` | ✅ `.hotranking-content-item-desc` | **双行截断，`title` 属性存全文** | ✅ |
| **UP 主** | ✅ `.upname > .name` + `//space.bilibili.com/{mid}/` | `bili-video-card__info--author` / `--owner` | 🟡（番剧无 UP 主位） | 头像 SVG(18px) + 昵称 | ✅ |
| **播放量** | ✅ `<svg class="play" 18px> 42.8万` | `bili-video-card__stats--item` / `--icon` / `--text` | 🟡 | **icon + 数字，万/亿单位缩写** | ✅ |
| **弹幕数** | ✅ `<svg class="dm" 18px> 69` | `bili-video-card__stats--left` | 🟡 | **icon + 数字** | ✅ |
| **时长** | 🟡 在 `.mask-video` 内（SSR 未内联） | `bili-video-card__mask` | ❌ | 右下角角标 | 🟡 |
| **发布时间** | ❌ | ✅ `bili-video-card__info--date` | ❌ | 文本 | ✅（仅类名） |
| **评分** | ❌ | ❌ | ✅ `.season-cover-score` **9.8** | 封面角标浮层 | ✅ |
| **排名** | ❌ | ❌ | ✅ `.ranking-cell-index` **1**（内联 `color:#000`） | 序号 + 内联色 | ✅ |
| 收藏夹名 | ❌ | ✅ `bili-video-card__info--rcmd-text` / `--rcmd-text-icon` | ❌ | icon + 文本 | ✅（仅类名） |
| 「不感兴趣」 | ❌ | ✅ `bili-video-card__no-interest`（`--inner/--left/--right`） | ❌ | 悬停浮出操作条 | ✅（仅类名） |
| 广告标记 | ❌ | ✅ `bili-video-card__info--ad` / `--creative-ad` | ❌ | 独立分支 | ✅（仅类名） |
| 卡片间图片占位 | ❌ | ❌ | ✅ `.b-img.sleepy`（38 次） | 懒加载占位类 | ✅ |

✅ **密度结论（事实）**：
1. **观看页侧栏卡只有 5 个字段**（封面 / 标题 / UP 主 / 播放量 / 弹幕数），无时长、无发布时间、无分区标签 —— 极简。
2. **首页卡字段显著更多**：类名层面可数出 **10 个** `bili-video-card__info--*` 分支（author/owner/date/rcmd-text/no-interest/ad/creative-ad/popover/right/tit），即 UP 主与「收藏于」是**两个独立可选字段**。
3. **番剧榜卡走完全不同的字段集**（评分 + 排名，**无 UP 主、无播放量/弹幕数**）。
4. **数字统一走「万/亿」缩写**：实测 `42.8万` / `8.6万`（1 位小数）。
5. **图标全部 `<svg class="play|dm" style="width:18px;height:18px">` 空壳 + JS 注入**，尺寸硬编码在 `style` 属性里（不走 CSS 令牌）。

---

## 10. 状态处理：loading / 骨架屏 / 空态 / 错误态

### 10.1 骨架屏 shimmer ✅ **已找到完整实现**

**类名体系**（`home.css`，5 个 `bili-video-card__skeleton--*`）：`--cover` / `--info` / `--light` / `--right` / `--text`。

**shimmer 动画原文** ✅：

```css
.bili-video-card .bili-video-card__skeleton--light:after {
  content: "";
  position: absolute; top: 0; left: 0;
  width: 400%; height: 100%;
  background: linear-gradient(-45deg,
    var(--graph_bg_regular) 25%,
    var(--bg1) 45%,
    var(--graph_bg_regular) 65%);
  background-size: 100% 100%;
  animation: skeleton-loading 1.2s ease-in-out infinite;
  will-change: …
}
@keyframes skeleton-loading {
  0%   { transform: translate(-75%); }
  to   { transform: translate(0); }
}
```

✅ 骨架屏参数表：

| 项 | 值 |
| --- | --- |
| 扫光层宽 | **400%** 容器宽（保证斜向扫过时不露边） |
| 渐变角度 | `-45deg` |
| 渐变色标 | `25%` / `45%` / `65%` 三段（暗 → 亮 → 暗） |
| 亮段颜色 | `var(--bg1)`（亮色主题底色，随主题切换） |
| 位移 | `translate(-75%)` → `translate(0)`，即**横向位移 75% 容器宽** |
| 时长 | **1.2s** |
| 曲线 | `ease-in-out` |
| 迭代 | `infinite` |
| 提示 | `will-change` 已声明 |

✅ **注意：`1.2s` 不在 Fluent 五档（100/150/200/300/500）内**（§1.1 中 `1200ms` 出现 2 次）。
✅ 第二套 shimmer（漫画站，`manga10.css`）：

```css
@keyframes vike-react-shine { to { background-position-x: -200%; } }
```

✅ 第三套（漫画站 Tailwind）：`@keyframes pulse { 50% { opacity: .5; } }`（`manga5.css`）。

### 10.2 空态 ✅ **已找到类名 + 完整样式**

**空态类名（3 套命名，同一模式）** ✅：

| 类名 | 页面 | 容器样式 |
| --- | --- | --- |
| `.recommended-swipe-body-nothing` | home 推荐流 | `position:absolute; inset 0; display:flex; justify-content:center; align-items:center; background-color:var(--graph_bg_regular)` |
| `.header-tabs-panel__content--nothing` | home 动态/历史浮层 | `color:var(--text3); text-align:center; font-size:14px; line-height:…` |
| `.content-scroll--nothing` | home 收藏浮层 | `display:flex; align-items:center; justify-content:center; height:…` |

**空态内部元素规格** ✅：

```css
.recommended-swipe-body-nothing svg { width: 46px; height: 46px; color: var(--line_…); }
.recommended-swipe-body-nothing span { font-size: 14px; line-height: 28px; color: …; }
```

✅ **空态模板 = 46×46 SVG 插画（着色走 `color`，说明是 `currentColor` 型可换色 SVG）+ 14px/28px 文案**，居中于绝对定位的满幅遮罩。

**loading 与空态共用同一套定位** ✅：

```css
.recommended-swipe-body-loading,
.recommended-swipe-body-nothing { position:absolute; top:0; left:0; right:0; bottom:0; … }
```

🟡 由此推断：JS 在同一容器内切换 `-loading` / `-nothing` 两个后缀类（`home.css` 中这两个类成组出现在 5 个规则里，模式高度一致）。

### 10.3 错误态 ✅ **已找到类名**

```css
/* home.css —— 错误态与 loading / nothing 三者共用同一容器 */
.recommended-swipe-body-loading[data-v-92d3c24c],
.recommended-swipe-body-nothing[data-v-92d3c24c] { position:absolute; top:0; left:0; right:0; bottom:0; … }
```

✅ 类名模式：`.recommended-swipe-body-{loading,nothing}` 加上一个同源错误态（`error`）✅ 已在 `home.css` 原始字节中确认（`recommended-swipe-body-error[data-v-92d3c24c]` 与 `-loading`、`-nothing` 三者成组出现）。
✅ **错误态的视觉规格（插画尺寸 / 文案）与空态共用同一批规则** → 未单独定义错误插画。

**其它错误/提示呈现** ✅：

| 形态 | 证据 | 规格 |
| --- | --- | --- |
| Vant Toast（黑底） | `.van-message-info` / `.van-message-…` | `background: rgba(0,0,0,.8)` |
| 弹窗遮罩 | `.bili-dialog-m` / `.bili-dialog-bomb`（各 ×4，`video.html`） | — |
| 头像框提示 | `.toolbar-*`（`video.css`） | `background:#fff; border:1px solid #f1f2f3; box-shadow:0 0 7px rgba(0,0,0,.1); border-radius:8px; font-size:14px; line-height:20px; padding:12px 20px` |
| 播放失败兜底 | `.frame-*`（`video.css`） | `background: linear-gradient(135deg,#2e4a47,#22383b 60%,#1d2e33); color:rgba(255,255,255,.72); font-size:14px; gap:8px` |
| 封面遮罩 | `.video-card-ad-small … .cover` | `background: rgba(0,0,0,.6); border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:14px; color:var(--text_white)` |
| 弹层关闭 | `.tag-report-popup-exp .btn-close` | 10×10px 雪碧图 `icons.png @ -475px -539px` |

### 10.4 「不感兴趣」反状态 ✅

```css
.bili-video-card .bili-video-card__image--hover .bili-video-card__mask { visibility: hidden; opacity: 0; }
.bili-video-card .bili-video-card__no-interest        /* + --inner / --left / --right */
```

✅ 5 个类构成完整的「卡片反状态操作条」（左/右分置 + 内层容器）。

---

## 11. 与 Pictelio Fluent 2 硬约束的差距总表（仅陈述事实）

| Pictelio 约束 | bilibili 实测 | 差距量化 |
| --- | --- | --- |
| 时长只用 100/150/200/300/500ms | transition 90.5% 合规；animation 44.3% | transition 越界 **46/484**；主用 300ms（中位数）**与规范一致** |
| 曲线只用 4 条 | 仅 29.6% 落在集合内 | **138/196（70.4%）越界**，分属 **22 条**曲线 |
| 禁 `ease` 裸关键字 | `ease` 33 次 | 违反 |
| `linear` 仅限 spinner | `linear` 58 次 | **43 次在 `transition` 内**（Pictelio 视为违规）+ 15 次在 `animation` 内（其中仅 4 处是真 spinner） |
| 禁裸 `:focus`，必须 `:focus-visible` | `:focus-visible` 12 / 裸 `:focus` 37 | **4/6 页面组 `:focus-visible` 为 0**；比值 0.00 的页 = **键盘可达性缺失** |
| 按压用 `scale(0.98)` | `scale(.95)` 4 处 + `translateY(1px)` 2 处 | 缩放量级差 **3%**，位移量级差 **20 倍** |
| 焦点环 `outline` + `outline-offset` | 12/12 规则体含 `outline`（27.8%）、6 条含 `outline-offset` | 做法**一致**，但覆盖面仅 12 处 |
| 无硬编码 px（用令牌） | 字号 12–18px 大量硬编码；manga 站连颜色都是 `text-[#1c1c1f]` | 主页部分用 `var(--text1/2/3)`，manga 站**完全不用令牌** |
| 触控目标 ≥40×40px | 抽样最小可交互尺寸 10×10px（`.btn-close`） | ❌ 未见 ≥40px 约束的证据 |
| `prefers-reduced-motion`（本项目隐含要求） | **2 次**（video.css 侧栏，降级到 `1ms`） | 有意识但**仅覆盖 2 个组件，无全局兜底** |
| `safe-area-inset` / `env()` | **0 次** | PC 站不涉及；非缺陷 |

---

## 12. 来源清单

| 编号 | URL | HTTP | 抓取时间 (2026-09-27 CST) | 落盘 |
| --- | --- | --- | --- | --- |
| S1 | `https://s1.hdslb.com/bfs/static/shanks/laputa-home/assets/index-8a65600f.css` | 200 | 15:02 | `home.css` (386,983 B) |
| S2 | `https://s1.hdslb.com/bfs/static/jinkela/video/css/video.0.05af4e80b6081ba56c1b5b943d4c8e621df3f875.css` | 200 | 15:02 | `video.css` (573,972 B) |
| S3 | `https://s1.hdslb.com/bfs/seed/jinkela/short/bili-theme/light.css` | 200 | 15:02 | `light.css` (6,936 B) |
| S4 | `https://s1.hdslb.com/bfs/seed/jinkela/short/bili-theme/light_u.css` | 200 | 15:02 | `light_u.css` (6,794 B) |
| S5 | `https://s1.hdslb.com/bfs/seed/jinkela/short/bili-theme/dark.css` | 200 | 15:02 | `dark.css` (6,875 B) |
| S6 | `https://s1.hdslb.com/bfs/seed/jinkela/short/bili-theme/map.css` | 200 | 15:02 | `map.css` (2,529 B) |
| S7 | `https://s1.hdslb.com/bfs/static/2233-monorepo/article-home/css/article-home.{0,1,2,3,4}.8e3af86cc2f1d89990756639bd5709e787a687e0.css` | 200 ×5 | 15:02 | `read0..4.css` |
| S8 | `https://s1.hdslb.com/bfs/manga-static/manga-pc-ssr/assets/static/*.css`（11 个，含 `layouts_tailwind-00e65532`、`swiper-835a1c72`、`pages_index_Banner_Banner-73835387` 等） | 200 ×11 | 15:03 | `manga0..10.css` |
| S9 | `https://s1.hdslb.com/bfs/static/jinkela/mstation-h5-new/css/mstation.3.cf55b4f0f429130a82c554e4750e3c51a07dbec8.css` | 200 | 15:02 | `mstation.css` (125,071 B) |
| S10 | `https://s1.hdslb.com/bfs/static/jinkela/long/font/regular.css` | 200 | 15:04 | `font-regular.css` (38,752 B) |
| S11 | `https://s1.hdslb.com/bfs/static/jinkela/long/font/medium.css` | 200 | 15:04 | `font-medium.css` (38,644 B) |
| S12 | `https://s1.hdslb.com/bfs/static/jinkela/long/font/HarmonyOS_Regular.a1.woff2` | 200 (len 7,696) | 15:08 | HEAD 验证 |
| S13 | `https://s1.hdslb.com/bfs/static/jinkela/long/font/HarmonyOS_Medium.a1.woff2` | 200 (len 7,940) | 15:08 | HEAD 验证 |
| S14 | `https://s1.hdslb.com/bfs/static/home-v3/css/home-v3.{0,1}.a88848cebcaea3de72112ddf625d167679be347a.css` | 200 ×2 | 15:13 | `homev3_0/1.css` |
| S15 | `https://www.bilibili.com/video/BV1Rmh96ZEXh` | 200 | 15:05 | `video.html` (64,520 B) |
| S16 | `https://www.bilibili.com/anime/` | 200 | 15:13 | `anime.html` (270,101 B) |
| S17 | `https://www.bilibili.com/read/home` | 200 | 15:01 | `read.html` (122,755 B) |
| S18 | `https://manga.bilibili.com/` | 200 | 15:01 | `manga.html` (545,735 B) |
| S19 | `https://www.bilibili.com/` | 200（**内容为风控验证码页**） | 15:01, 15:04（重试 2 次） | `home.html` (1,374 B) |
| S20 | `https://t.bilibili.com/` | 200（空壳，无卡片） | 15:01 | `dynamic.html` (3,665 B) |
| S21 | `https://www.bilibili.com/v/popular/rank/all` | 200（SSR 壳，无卡片） | 15:01 | `rank.html` (4,927 B) |
| S22 | `https://www.bilibili.com/index.html` | 200（SPA 壳） | 15:04 | `index.html` (12,805 B) |
| S23 | `https://api.bilibili.com/x/web-interface/finger/spi` | 200 | 15:04 | `spi.json`（取 buvid3/4，**未在报告中回显值**） |
| S24 | `https://api.bilibili.com/x/web-interface/popular?ps=10&pn=1` | 200 | 15:04 | `popular.json`（取真实 BV 号来源） |
| S25 | `https://s1.hdslb.com/bfs/static/shanks/laputa-home/assets/index-12fc55c2.js` | 200 | 15:04 | `home.js` (1,640,000 B) |
| S26 | `https://s1.hdslb.com/bfs/static/player/main/core.f300a47b.js` | 200 | 15:14 | `player.js` (1,840,139 B) |

**抓取命令模板**（复算用）：

```bash
curl -s --compressed -m 30 \
  -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' \
  -H 'Accept-Language: zh-CN,zh;q=0.9' \
  -H 'Referer: https://www.bilibili.com/' \
  -o <out> '<url>'
```

**分析脚本**：`/tmp/bt-motion/an.py`（子命令 `dur` / `ease` / `state` / `kf` / `media` / `font` / `prop` / `layout`，或 `all`）。

---

## 附：本轮对上一轮结论的修正

| 项 | 上一轮 | 本轮实测 | 说明 |
| --- | --- | --- | --- |
| `:focus-visible` | 0 次 | **12 次**（全在 `video.css`） | ✅ 有 12 处，均为 Vue scoped 组件 |
| 裸 `:focus` | 20 次 | **37 次**（home 20 / video 10 / read 4 / mstation 3） | 扩到 28 文件后增加 |
| `prefers-reduced-motion` | 0 次 | **2 次**（全在 `video.css`） | 降级到 `1ms` |
| 断点族数量 | 2 套 | **4 套**（px`.9` / px`.8` / px 整数单点 / rem） | manga 的 Tailwind v4 `(width>=X)` 语法需单独抓 |
| 缓动曲线 | 未穷举 | **22 条**，其中仅 1 条（`linear`）在 Fluent 四条内 | `cubic-bezier` 原始 57 次 vs 生效 49 次，差值是未被消费的 Tailwind 令牌 |
| 中文字体 | 未记录 | **自托管 HarmonyOS Sans，108 个 woff2**（54 分片 × 2 字重），静态字重非可变字体 | 需从 `jinkela/long/font/{regular,medium}.css` 取，非页面主 CSS |
