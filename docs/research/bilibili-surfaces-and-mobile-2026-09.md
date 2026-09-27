# bilibili 多端页面令牌一致性 + 移动端 H5 + App 端主题体系 —— 深度网络调研底稿

> **调研日期**：2026-09-27（全部抓取时间 15:00–15:12 CST，抓取窗口约 12 分钟）
> **覆盖范围**：15 个 bilibili 桌面端页面/垂直站 + 3 个 mstation H5 页面 + 2 个主题运行时 JS + 34 个 API 端点探测
> **一手信源**：`*.bilibili.com` / `*.hdslb.com` 实际 HTTP 响应（HTML / CSS / JS 原文），`api.bilibili.com` / `app.bilibili.com` JSON 响应
> **图例**：✅ 已实测确认 ｜ 🟡 部分确认 / 有条件 ｜ ❌ 未能验证（附失败模式）｜ — 该维度不适用

---

## 0. 方法论：三类 HTTP 响应签名（本轮最有复用价值的产物）

突破 WAF 之后，bilibili 对匿名爬取请求只有 **3 种可区分的响应**。这张表是本轮所有"存在 / 不存在"判断的判据，先立在这里：

| 签名 | HTTP | Content-Type | 体积 | 特征 | 判读 |
| --- | --- | --- | --- | --- | --- |
| **JSON 成功** | 200 | `application/json; charset=utf-8` | 46–259 B | `{"code":-101/-400,...,"ttl":1}` | **端点存在且可达**（`code:-101`=需登录，`code:-400`=缺参数） |
| **软 404** | 404 | `text/html` | **1777 B**（`www`/`api`） / 1923 B（`www` HTML 页） | `<title>出错啦! - bilibili.com</title>`，`spm_prefix=333.937` | **端点/页面不存在**。注意这不是 WAF |
| **风控验证码** | 200 | `text/html` | **686 B** | `<title>验证码_哔哩哔哩</title>`，`spm_prefix=333.1291`，含 `_riskdata_.v_voucher` | **风控拦截**，换 UA 绕过 |
| **Go 硬 404** | 404 | `text/plain; charset=utf-8` | **19 B** `404 page not found` | — | `app.bilibili.com` 专用签名 = 端点不存在 |

### 0.1 风控突破（可复现）

桌面 Chrome UA 打 `https://www.bilibili.com/` → **686 B 验证码页**。加 Referer / sec-ch-ua / cookie jar 全部无效。有效突破方式是 **换 UA 为搜索引擎爬虫**：

```bash
# ❌ 失败：桌面 Chrome UA + 完整浏览器头 → 686B 验证码页
curl -s --compressed -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ... Chrome/131.0.0.0' \
     -H 'Referer: https://www.bilibili.com/v/popular/rank/all' -H 'sec-ch-ua: "Chromium";v="131"' \
     -H 'Accept: text/html,application/xhtml+xml,...' https://www.bilibili.com/
# → 200 686  <title>验证码_哔哩哔哩</title>

# ✅ 成功：Googlebot UA → 200 34077 B 真实 SSR 首页
curl -s --compressed \
  -H 'User-Agent: Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' \
  https://www.bilibili.com/
```

实测三连（Baiduspider / Bingbot 同样有效）：Googlebot 34077 B ✅ ｜ Baiduspider 34446 B ✅ ｜ Bingbot 34480 B ✅。
**风控对爬虫 UA 放行、对浏览器 UA 拦截** —— 这解释了为什么首页是本轮唯一"换 UA 才拿到"的页面，也是后续任何自动化复现的必经步骤。

### 0.2 UA 与端点的绑定关系

| UA | 目标 | 结果 |
| --- | --- | --- |
| 桌面 Chrome | `m.bilibili.com/` | **302 → `https://www.bilibili.com/`**（mstation 对桌面 UA 不服务） |
| iPhone Safari | `m.bilibili.com/` | 200 ✅ 真实 mstation |
| iPhone Safari | `m.bilibili.com/v/popular/all` | **404 1777 B「出错啦!」** — 该 H5 路由不存在 |
| iPhone Safari | `m.bilibili.com/comic` / `/manga` / `/my/` | **404 1777 B** — 均不存在 |
| iPhone Safari | `m.bilibili.com/search` | 200 ✅ |
| iPhone Safari | `m.bilibili.com/opus/<id>` | 200 ✅ |

**mstation 现存 H5 路由只有 3 个**：`/`、`/search`、`/opus/<id>`。任务书里给的 `/v/popular/all`、`/comic` 均已下线。

### 0.3 抓取纪律

- 大 CSS 一律 `--compressed` 落盘再解析（`web_fetch` 会截断/乱码）。
- 单页 CSS 全部 < 10 MB 上限，最大一份是 `opus-detail.1.css` = **670 587 B**、`laputa-home` = **386 983 B**，均未触发截断。
- 桌面站绝大多数是 **SSR 外壳**：HTML 里只有页面自身的 CSS，**顶导/底脚的 token 层由 `bili-header.umd.js` 在运行时注入**。静态抓 HTML 会系统性低估暗色支持度 —— 本轮通过读该 JS 源码补齐（见 §1.4）。

---

## 1. 任务 A：多端页面令牌一致性矩阵

### 1.1 主矩阵

> 「引用 `bili-theme/*`」= HTML 中 `<link rel=stylesheet>` 直指官方主题包的页面。
> 「自带 token 层」= 页面自身 CSS 里声明的自定义属性数。
> 所有"引用数"= 全部 CSS 文件 + 内联 `<style>` 合计。

| # | 页面 / 垂直站 | HTTP | CSS 数 | 总字节 | 引用 `bili-theme/*` | 自定义属性（声明 / 唯一） | `bili_dark` | `prefers-color-scheme` | `safe-area-inset` | `env(` | `:focus-visible` | 裸 `:focus` | `prefers-reduced-motion` | 该页独有特征 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | **首页** `www.bilibili.com/` | 200（复核：桌面 UA 亦得 34 124 B 正常 SSR） | 1 | 386 983 | ❌ **0** | 938 / 1071 | 1 | 0 | 0 | 0 | 0 | 2 | 0 | **内联 `@bilibili/b-style(v5.0.0)` 主题**（`:root` + `html.bili_dark` 各 382 条），归一化后与线上包真实漂移 11（亮）/ 12（暗），集中在橙色族 + `Ga12`（见 §1.3 修正说明） |
| A2 | **排行榜** `www.bilibili.com/v/popular/rank/all` | 200 | 2 | 71 659 | ❌ 0 | **0** / 21 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | `token-support="true"` + `themeSwitchHandler`；内联样式硬编码 `1286/1370/1125/1070px` 布局宽 |
| A3 | **专栏首页** `www.bilibili.com/read/home` | 200 | 7 | 30 972 | ✅ **3**（light / light_u / map） | 806 / 806 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 纯 token 消费方，页面自身只加 17 个属性 |
| A4 | **图文详情** `www.bilibili.com/opus/784478474085597189` | 200（`/read/cv23064696` 301 → 此 URL） | 6 | 695 535 | ✅ **3** | 415 / 904 | **7** | 0 | 0 | 0 | **6** | 1 | 0 | 全站唯一把 `:focus-visible` 当规范用的页面；文章 JSON 带 `color` + `dark_color` 双色契约 |
| A5 | **动态** `t.bilibili.com/` | 200 | 3 | 587 755 | ❌ 0 | 491 / 566 | **13** | 0 | 0 | 0 | 0 | 1 | 0 | `html.bili_dark #app{background:#1c2633}` 蓝色系暗底；另引 2 份字体 CSS |
| A6 | **UP 主空间** `space.bilibili.com/2` | 200 | 5 | 316 168 | ❌ 0 | 165 / 336 | **0** | 0 | 0 | 0 | 0 | **6** | 0 | 唯一 0 暗色支持的重页面；`min-width:0px` 断点 |
| A7 | **消息** `message.bilibili.com/` | 200 | 3 | 193 508 | ❌ 0 | 809 / 837 | **7** | 0 | 0 | 0 | 0 | 0 | 0 | 阴影暗色化 `.bili_dark .im-box-shadow{box-shadow:0 2px 4px #2426288a}` |
| A8 | **直播首页** `live.bilibili.com/` | 200 | 1 | 7 543 | ❌ 0 | **0** / 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 暗色完全由**内联脚本**驱动（`lab-style` 属性 + `colorScheme`，见 §1.4），CSS 零参与 |
| A9 | **番剧** `www.bilibili.com/anime/` | 200 | 5 | 130 993 | ✅ **3** | 466 / 802 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 断点最密（13 个 min-width，含 `1559.8px` 这种非整值） |
| A10 | **漫画** `manga.bilibili.com/` 🟡 | 200 | 11 | 76 057 | ❌ 0 | 63 / 100 | **0** | 0 | 0 | 0 | 0 | 0 | 0 | **Tailwind CSS v4.0.14 + `@theme` + `oklch()`**；全站最现代也最孤立 |
| A11 | **搜索** `search.bilibili.com/` | 200 | 7 | 393 299 | ✅ **3** | 368 / 1232 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | token 引用密度最高（1232 个唯一属性名） |
| A12 | **帮助中心** `www.bilibili.com/blackboard/help.html` | 200 | 3 | 217 954 | ❌ 0 | **0** / 86 | 0 | 0 | 0 | 0 | 0 | 6 | 0 | `theme-switch="true"` 属性在 `<script>` 上；Vue-ts SPA，`#app` 空壳 |
| A13 | **活动页（platcomps 系）** `blackboard/activity-5zJxM3spoS.html` | 200 | 3 | 9 429 | ❌ 0 | **0** / 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 独立组件库 `activity.hdslb.com/blackboard/platcomps/`，**零 CSS 变量** |
| A14 | **活动页（2233 系）** `blackboard/era/yellowVSgreen11th.html` | 200 | 14 | 65 597 | ❌ 0 | **0** / 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 组件名带业务前缀（`Eva*` / `Era*` / `Pc*`），逐组件独立 CSS chunk |
| A15 | **直播个人中心** `link.bilibili.com/` | 200 | 3 | 429 624 | ❌ 0 | **0** / 56 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | `origin-trial` + `UnrestrictedSharedArrayBuffer` Chrome 试验标志；自引 iconfont |

**页面级失败记录（不猜测，写实测）**

| 目标 | 实测 |
| --- | --- |
| `www.bilibili.com/blackboard/activity-iBweXQ5Pum.html` | **404** 1923 B「出错啦!」（从 A10 漫画页 grep 到的真实 id，已过期） |
| `www.bilibili.com/blackboard/activity-VgPfPeGRXH.html` | **404** 1923 B |
| `www.bilibili.com/blackboard/activity-list-page.html` | **404** 1923 B |
| `www.bilibili.com/blackboard/activity-I7btnS22Z.html` | 200 1696 B，但 `<title>浏览器升级提示</title>` —— 是 IE11 降级页，非活动页 |
| `www.bilibili.com/vip` | **404** 1923 B |
| `www.bilibili.com/h5/notice` | **404** 1923 B |
| `m.bilibili.com/{v/popular/all, comic, manga, my/}` | **404** 1777 B |
| `https://apps.apple.com/cn/app/bilibili/id377211088` | **404** 958 B（`itunes.apple.com/lookup` 亦返 `resultCount:0`） |
| `https://play.google.com/store/apps/details?id=tv.danmaku.bili&gl=CN` | **404** 872 B `<title>未找到</title>` |

**付费/大会员入口 ❌ 未能取得真实可达页面**。首页 SSR blob、番剧页、漫画页、所有抓到的 HTML 中均未出现 `vip` / `charge` / `pay` 类路由；`www.bilibili.com/vip` 是 404。唯一带"付费"语义的一手证据是 `bili-theme/light.css` 里的 `--Ye*`（Yellow 付费黄）色阶与 mstation 的 `--pay_yellow:var(--Ye5)` 别名 —— **说明大会员/付费在色板里有专属层级，但 Web 端没有独立的付费/会员主题页面可抓**。

### 1.2 断点矩阵（`@media min-width` 全量）

| 页面 | 断点（px，全量） |
| --- | --- |
| A1 首页 | 14, 15, 25, 28, 34, 45, 50, 60, 64, 67, 69, 90, 100, 110, 120, 142, 181, 226, 240, 260, 264, 300, 350, 359, 387, 424, 442, 505, 1000, 1060, 1100, 1140, 1300, 1367, 1400, 1560, 1701, 2060, 2200（**39 个**） |
| A4 opus | 18, 32, 56, 64, 70, 72, 80, 90, 100, 142, 200, 556, 600, 1044, 2561 |
| A5 动态 | 18, 30, 32, 40, 56, 64, 70, 72, 80, 100, 104, 142, 200, 556, 600, 1044, 1140, **1319**, **1320**, 1452, 1680, 2561 |
| A6 空间 | **0**, 24, 25, 34, 40, 52, 72, 80, 100, 122, 130, 140, 1100, 1340, 1560, 1680, 1760, 1860, 2260 |
| A7 消息 | 16, 24, 54, 56, 58, 60, 84, 100, 120, 400 |
| A9 番剧 | 49, 1100, 1140, 1301, 1400, 1441, **1559.8**, 1560, 1600, 1660, 1920, 2061, 2560 |
| A10 漫画 | 30, 200, 1000, 1160, 1300 |
| A11 搜索 | 15, 28, 34, 40, 70, 86, 95, 100, 106, 198, 260, 296, 322, 1100, 1367, 1440, 1600, 1700, 1701, 1920, 2200 |
| A12 帮助 | 10, 22, 30, **35.5**, 50, 60, 100, 150, 180, 200, **375**, 380, 513, **768**, **992**, 1200, 1366, 1600, 1920, 2000 |
| A15 link | 22, 28, 35, 50, 64, 80, 85, 100, 104, 150, 160, 180, 200, 224, 254, 300, 324, 354, 370, 434, 513, 520, 620, 660, 766, **768**, 938, **992**, 1180, 1200（**30 个**） |
| A3 / A8 / A13 / A14 | **0 个** `min-width` 断点 |

**A10 漫画的特殊点**：它的断点不是 px 而是 `rem`，且用 Tailwind v4 range 语法 —— `@media (width>=40rem)` / `48rem` / `64rem` / `80rem` / `96rem`，外加 2 个 `@media (hover:hover)`。**全站唯一一套"移动优先 + rem 断点"的响应式策略**。

### 1.3 一致性矩阵的横向结论

**15 个页面中只有 4 个（26.7%）引用官方 `bili-theme/*` 包**：A3 专栏 / A4 图文 / A9 番剧 / A11 搜索 —— **且这 4 个全部属于 `2233-monorepo` 构建组**。这条相关性是 100% 的（4/4 反向也成立：所有 2233 组页面都引）。

**站内至少 7 套相互独立的设计血脉**：

| 血脉 | 成员 | 令牌机制 | 暗色 |
| --- | --- | --- | --- |
| **① 2233-monorepo + 官方主题包** | 专栏 / 图文 / 番剧 / 搜索 | `<link>` 引 `light.css` + `light_u.css` + `map.css`，页面 CSS 只做消费 | ✅ 靠运行时换 `dark_all` |
| **② 2233-monorepo + 自带副本** | 动态 / 消息 | 页面 CSS 里内联一份 `--Ga*` 色板（491 / 809 条声明） | ✅ `bili_dark` 选择器自绘（13 / 7 处） |
| **③ laputa 系（首页自带副本）** | 首页 / 排行榜 / 空间 | 首页内联 b-style v5.0.0 主题 382+382 条（橙色族已与官方包漂移）；排行榜与空间则完全无 token | 🟡 首页✅（自带副本，局部漂移）、排名与空间❌ |
| **④ fenice 系（直播）** | 直播首页 / link | **零 CSS 变量**，暗色走内联脚本 + `lab-style` 属性 | ✅ 但不在 CSS 层 |
| **⑤ manga-static + Tailwind v4** | 漫画 | `@theme` + `oklch()` + rem 断点 | ❌ 零支持 |
| **⑥ activity-platcomps / 2233-activity** | 2 类活动页 | 逐组件独立 CSS，零变量 | ❌ |
| **⑦ mstation（移动端）** | 移动 H5 | 自带 382 色板 + 80 语义别名（内联在 chunk，非 `<link>`） | 🟡 仅 `html.night-mode` 覆盖弹层组件 |

**漂移点集中在四处**：

1. **首页内联了一份主题副本，且已与线上包漂移**。

   > ⚠️ **本节数值已于 2026-09-27 由第三方复核修正**（复核人重新下载 `light.css` / `dark.css` 与首页 CSS `index-8a65600f.css`，用空白归一化后逐属性比对）。初稿写的「202/382（亮）与 203/382（暗）不同」是**字符串比对的假阳性**：其中 180（亮）/ 179（暗）条仅仅是 `_rgb` 值的空格差异（`0, 0, 0` vs `0,0,0`），归一化后语义完全相同。初稿还把 `--Or4` 误读为 `--Or5`。以下是复核后的真值。

   首页 CSS 的文件头自报 **`@bilibili/b-style(v5.0.0)`**（`//s1.hdslb.com/bfs/static/shanks/laputa-home/assets/index-8a65600f.css`，386 983 B），它内联的 `:root` 与 `html.bili_dark` 各 **382** 条，与官方 `bili-theme v12.0.0` **同名 382 个属性、0 个新增、0 个缺失**。但**归一化后的真实漂移是 11/191（亮，5.8%）与 12/191（暗，6.3%）**——集中在**橙色族 + `Ga12`**：

   | 属性 | 首页内联（b-style v5.0.0） | 线上 `light.css` | 首页内联暗 | 线上 `dark.css` |
   | --- | --- | --- | --- | --- |
   | `--Or4` | `#FF8F53` | `#FFA058` | `#B23F0A` | `#A9490D` |
   | `--Or5` | `#FF661A` | `#FF7F24` | `#E1540D` | `#D66011` |
   | `--Or6` | `#E84B02` | `#E95B03` | `#E67237` | `#DD7C3A` |
   | `--Or1` | `#FFEDE2` | `#FFF0E3` | `#31190F` | `#301B10` |
   | `--Ga12` | `#F6F7F8` | `#F1F2F3` | `#202123` | `#1F2022` |

   即：**除橙色族与 `Ga12` 外，首页与官方包逐值相同**；橙色阶是首页自带的旧快照（饱和度更高），与其余引用 `bili-theme` 的 2233 页面并排时能看到可见色差。**漂移是局部现象，不是系统性脱节**（其余 13 个色相族逐字节一致）。

2. **暗色支持三档并存**：`bili_dark` 有 13 处（动态）/ 7 处（图文、消息）/ 1 处（首页）/ **0 处（空间、漫画、活动页、帮助中心、直播 CSS、link）**。上一轮"站点支持暗色"的印象只在 2233 组成立。

3. **A11 搜索的属性数是唯一属性名的 3.2 倍**（1232 唯一名 / 368 声明），说明大量 `var()` 指向外部注入的令牌（顶导 UMD 运行时注入），静态抓取无法判定其是否有暗色值 —— 记为 🟡。

4. **可访问性基线基本缺失**：`safe-area-inset-*` = **0**、`env(` = **0**，在全部 15 个页面 100% 一致；`prefers-color-scheme` 在 15 个页面全部为 **0**（与上一轮结论一致，已复核）。

   > ⚠️ **本条已部分修正**（2026-09-27 第三方复核）。初稿称「`prefers-reduced-motion` 在 15 个页面 100% 为 0」——**该结论对本轮 15 页语料成立，但不是全站结论**。复核方抓取 `https://www.bilibili.com/video/BV14baT6EEzj/` 的 CSS（`//s1.hdslb.com/bfs/static/jinkela/video/css/video.0.05af4e80….css`，573 972 B）实测：`:focus-visible` = **12**、裸 `:focus` = **23**、`prefers-reduced-motion` = **2**、`cubic-bezier` = **36**。即**视频页存在局部可达性/动效降级实现**。
   > 同时提醒：`cubic-bezier` 计数**依赖语料**——首页 CSS 仅 4 处，视频页 CSS 达 36 处；`:focus-visible` 的绝对值同理随页面 bundle 而变。**任何可达性计数都必须标注统计语料范围**，否则不可比。

### 1.4 运行时主题注入层（静态抓 HTML 会漏掉的部分）

`bili-header.umd.js`（**705 120 B**，`s1.hdslb.com/bfs/seed/laputa-header/`）内含主题常量表（原文）：

```js
function KA(e){return "//s1.hdslb.com/bfs/seed/jinkela/short/bili-theme/".concat(e,".css");}
var sd="light", $L="light_u", yL=["light","dark"], bL="map", AL="light_all", wL="dark_all",
    UA="theme_style", CL="DedeUserID", Xf="__css-map__", rSe="__css-map-filter__";
```

本轮相对上一轮的**增量**：

- 主题包不止 4 个文件。常量里明确有 **`light_all`** 和 **`dark_all`**（上一轮只知 `light/light_u/map/dark`）。
- `theme_style` = cookie 名（常量 `UA`），`DedeUserID` = 登录 cookie（常量 `CL`）→ **"未登录强制亮色"在这份 JS 里得到源码级确认**，与上一轮结论一致。
- `__css-map__` = 主题 `<link>` 元素 id，`__css-map-filter__` = 滤镜降级 `<style>` 元素 id。

A8 直播站则是**另一套独立实现**（内联在 `live.bilibili.com` HTML，14 000+ 字符原文）：

```js
DARKMODE["LIGHT"] = "light"; DARKMODE["DARK"] = "dark";
function setContainerStyle (theme) {
  document.documentElement.setAttribute('lab-style', theme === DARKMODE.DARK ? 'dark' : '');
  document.documentElement.style.colorScheme = theme;      // ← 用 CSS color-scheme 驱动浏览器原生暗 UI
}
var currentThemeStyle = getCookie('DedeUserID') && getCookie('theme_style') === DARKMODE.DARK;
// 客户端注入多主题样式
window['bililiveThemeV2'] = { initThemeWithCSR, changeTheme, DARKMODE };
```

三个此前未记录的事实：

- 直播站用的是 **`lab-style` 属性**，不是 `bili_dark` class；且额外设 `documentElement.style.colorScheme`，让滚动条 / 表单控件等浏览器原生 UI 跟随主题。
- 全局挂在 `window.bililiveThemeV2`，并通过 `window['_']` 别名劫持做兼容（`delete window['_']`）。
- 降级路径有显式告警：`try { darkModeInit() } catch (err) { console.warn('深色模式初始化失败了~~~', err) }` —— 符合"禁止静默降级"。

---

## 2. 任务 B：移动端 H5（mstation）量化解剖

抓取对象：`m.bilibili.com/` `、`/search`、`/opus/784478474085597189`。
CSS 来源：HTML 中 4 个 `<link rel=stylesheet>`（chunk `0/2/6/14`）+ 13 个 `<link rel=prefetch>`（chunk `3,4,5,7,8,9,10,11,12,13,15,16,17,18,19`），本轮**全量下载 19 个 chunk 解析**（chunk `1` 404）。合计 **922 822 B 原始 CSS**。

> ⚠️ **修正上一轮结论**：「mstation 自定义属性 0 个，全硬编码」**不成立**。实测 **551 条自定义属性声明 / 482 个唯一名 / 730 次 `var()` 引用（101 个唯一名）**。真实情况是「**令牌层存在但只用了 20%**」——482 个声明里 **387 个从未被引用**。

### 2.1 栅格基准（修正）

**结论：基准单位 = `0.26667vmin`（= 375px 视口下 1 CSS px = 750 设计稿下 2 px）**，不是上一轮推测的 `0.53333vmin ≈ 4px`。

| 验证项 | 实测 |
| --- | --- |
| 全部 distinct `vmin` 值 | **162 个** |
| 是 `0.53333vmin` 整数倍的 | 88 / 162（**74 个是半整数倍 → 上一轮基准偏粗一倍**） |
| 是 `0.26667vmin` 整数倍的 | **158 / 162 ✅** |
| 4 个离格值 | `4.48vmin`(16.8) / `14vmin`(52.5) / `26.88vmin`(100.8) / `46vmin`(172.5) |

**换算公式**：`1 设计稿 px(750 稿) = 0.53333vmin`；`1 设计稿 px = 2 CSS px @375`。`vmin` 取 `min(vw,vh)`，竖屏下等于 `vw`。

**设计稿 px → 实际单位对照表（按出现频次）**

| 设计稿 px(@750) | 实际 vmin | 频次 | @375 CSS px | @320 | @414 |
| --- | --- | --- | --- | --- | --- |
| 24 | `3.2vmin` | **679** | 12.00 | 10.24 | 15.94 |
| 8 | `1.06667vmin` | 357 | 4.00 | 3.41 | 4.42 |
| 28 | `3.73333vmin` | 342 | 14.00 | 11.95 | 15.46 |
| 20 | `2.66667vmin` | 257 | 10.00 | 8.53 | 11.04 |
| 12 | `1.6vmin` | 239 | 6.00 | 5.12 | 6.62 |
| 32 | `4.26667vmin` | 234 | 16.00 | 13.65 | 17.66 |
| **4** | **`0.53333vmin`** | **224** | **2.00** | 1.71 | 2.21 |
| 40 | `5.33333vmin` | 209 | 20.00 | 17.07 | 22.08 |
| 16 | `2.13333vmin` | 197 | 8.00 | 6.83 | 8.83 |
| 48 | `6.4vmin` | 173 | 24.00 | 20.48 | 26.50 |
| 10 | `1.33333vmin` | 150 | 5.00 | 4.27 | 5.52 |
| 60 | `8vmin` | 124 | 30.00 | 25.60 | 33.12 |
| 26 | `3.46667vmin` | 122 | 13.00 | 11.09 | 14.35 |
| 36 | `4.8vmin` | 121 | 18.00 | 15.36 | 19.88 |
| 34 | `4.53333vmin` | 111 | 17.00 | 14.51 | 18.76 |
| **88** | **`11.73333vmin`** | 111 | **44.00** | 37.55 | 48.59 |
| 80 | `10.66667vmin` | 102 | 40.00 | 34.13 | 44.16 |

> 频次第 7 高的值（`0.53333vmin` ×224）与第 16 高（`11.73333vmin` ×111）合起来说明：H5 的间距台阶以 **4 设计稿 px（2 CSS px）** 为最小单位，而 `.m-navbar` 高度恰好 = **88 设计稿 px = 44 CSS px @375**。

**`px` 单位的真实用量**：`px` 字面量共 **274 处 / 仅 3 个不同值** —— `1px` ×247、`.5px` ×26、`5px` ×1。**`px` 在 mstation 只用于发丝线**（`border` / `transform:scaleY(.5)`），从不参与布局。
**其它单位**：`vw` 35 处、`vh` 10 处、`em` 94 处、**`rem` 0 处、`%`（作为单位字面量）0 处**。

### 2.2 字号阶梯（`font-size` 共 796 条声明 / 27 个不同值）

| 实际值 | @375 CSS px | @750 设计稿 | 频次 | 层级判读 |
| --- | --- | --- | --- | --- |
| `3.2vmin` | **12** | 24 | **210** | 辅助文字 / 图注 / 次要标签 |
| `3.73333vmin` | **14** | 28 | **206** | **正文主力** |
| `3.46667vmin` | **13** | 26 | 89 | 辅助（介于 12/14 之间，密集区） |
| `4.26667vmin` | **16** | 32 | 61 | **标题 / 强调正文**；也是 reset 里的 `button` 继承字号 |
| `2.66667vmin` | **10** | 20 | 43 | 极小辅助 / 时间戳 |
| `5.33333vmin` | **20** | 40 | 24 | 小标题 |
| `4vmin` | 15 | 30 | 21 | 副标题 |
| `4.53333vmin` | 17 | 34 | 10 | 列表标题 |
| `2.93333vmin` | 11 | 22 | 9 | 徽标 |
| `4.8vmin` | 18 | 36 | 8 | 小节标题 |
| `5.86667vmin` | 22 | 44 | 3 | 弹层标题 |
| `5.06667vmin` | 19 | 38 | 1 | 单点使用 |
| `7.46667vmin` | 28 | 56 | 1 | 弹层大标题 |
| `8vmin` | 30 | 60 | 1 | 大数字 / 数据 |
| `14.93333vmin` | 56 | 112 | 1 | 页面级大标题（单点） |

**阶梯判读**：主文字 **14px** / 副文字 **12px** / 标题 **16–20px** / 辅助 **10–11px**。层级只有 **4 档在用**（12/14/16/20 占 501/796 = 63%），其余 10 档都是零星使用 —— **阶梯不成体系，更像"够用就加一档"**。

**发现一处真实缺陷**：`font-size` 声明里混进了 **20 处 `12PX`、9 处 `10PX`、7 处 `13PX`、7 处 `14PX`、6 处 `15PX`、3 处 `17PX`、2 处 `16PX`**（大写 `PX`）—— 这些是**不走 vmin 的固定 px**，在 414px 宽机型上不会缩放，与同页面的 vmin 字号构成两套并存的排版体系。合计 **64/796 = 8.0%** 的字号声明脱离栅格。

**`line-height` 阶梯**（497 条声明，Top 值全部落在同一 0.26667vmin 格上）：`4.53333vmin`(17px) ×58 ｜ `5.33333vmin`(20px) ×55 ｜ `4.26667vmin`(16px) ×44 ｜ `4.8vmin`(18px) ×36 ｜ `5.86667vmin`(22px) ×30 ｜ `8vmin`(30px) ×28 ｜ `3.73333vmin`(14px) ×27 ｜ `3.2vmin`(12px) ×27 ｜ **`11.73333vmin`(44px) ×27**（= `.m-navbar` 高度）。

### 2.3 色彩

| 指标 | 实测 |
| --- | --- |
| 自定义属性**声明** | **551 条 / 482 唯一名** |
| `var()` 引用 | **730 次 / 101 唯一名** |
| 声明了但**从未引用** | **387 个（80.3%）** |
| 引用了但**从未声明** | **6 个**：`--Wh0_u` / `--Wh0_u_rgb` / `--latex-src` / `--list-style-type` / `--marker-color` / `--opus-font-bold` ← **真实未定义引用** |
| 颜色位置**硬编码字面量** | **1654 处** |
| 颜色位置用 `var()` | **601 处** |
| **硬编码率** | **1654 / 2255 = 73.3%** |
| hex 字面量 | 1518 处 / 228 个不同值 |
| `rgb()/rgba()` 字面量 | 168 处 / 25 个不同值 |

**Top 24 硬编码色值**

| 值 | 频次 | | 值 | 频次 |
| --- | --- | --- | --- | --- |
| `#fff` | **330** | | `#e3e5e7` | 28 |
| `#fb7299` | **109** | | `#141414` | 26 |
| `#999` | **105** | | `#eee` | 26 |
| `#212121` | **85** | | `#505050` | 19 |
| `#9499a0` | **72** | | `#fb6699` | 19 |
| `#f69` | **69** | | `#f6f7f8` | 18 |
| `#f4f4f4` | **60** | | `#e5e8ef` | 17 |
| `#18191c` | **55** | | `#757575` | 15 |
| `#f1f2f3` | **41** | | `#222` | 13 |
| `#e7e7e7` | **39** | | `#000` | 13 |
| `#f3f3f3` | **32** | | `#666` | 11 |
| `#61666d` | **32** | | `#484c53` | 9 |

**🚨 一笔被重复计入的品牌色**：`#fb7299`（109 次）与 `#fb6699`（19 次）**并存** —— 前者是旧版 bilibili 粉，后者是当前 `--Pi5`。`#f69`（69 次）= 当前 `--Pi5` 的简写形式。**同一个品牌粉色在 mstation 里有 3 种写法共 197 处**。同理 `#9499a0` = `--Ga5`（72 次硬编码）、`#18191c` = `--Ga10`（55 次）、`#61666d` = `--Ga7`（32 次）、`#e3e5e7` = `--Ga2`（28 次）—— **这些色板值明明已在 `:root` 里声明了，却仍被直接硬编码**。

**Top 10 `rgba()`**

| 值 | 频次 | | 值 | 频次 |
| --- | --- | --- | --- | --- |
| `rgba(0,0,0,.5)` | 41 | | `rgba(0,0,0,.32)` | 10 |
| `rgba(0,0,0,.85)` | 18 | | `rgba(0,0,0,.7)` | 5 |
| `rgba(0,0,0,.3)` | 18 | | 其余各 ≤5 | — |
| `rgba(0,0,0,.4)` | 18 | | `rgba(var(--text_white_rgb)` | 18 ← **唯一正确的 rgba+token 写法** |
| `rgba(0,0,0,.2)` | 18 | | | |

> 阴影遮罩全靠 `rgba(0,0,0,α)` 的 **8 个手调 alpha 档**（.2/.3/.32/.4/.5/.7/.85），没有统一的 `--overlay-*` 层级。

**令牌层结构**（chunk `2.css` 内联，非 `<link>` 引官方包）：
1. `:root` 第 1 块 = **382 条** `--Ga*/--Wh*/--Ba*/--Pi*/--Ma*/--Re*/--Or*/--Ye*/--Lb*/--Ly*/--Lg*/--Gr*/--Cy*/--Bl*` 原始色板 —— 与官方 `bili-theme/light.css` **同名同值**（例：`--Ga0:#f6f7f8`、`--Pi5:#f69`）。
2. `:root` 第 2 块 = **80 条**语义别名层：`--brand_pink:var(--Pi5)`、`--brand_blue:var(--Lb5)`、`--pay_yellow:var(--Ye5)`、`--stress_red:var(--Re5)`、`--bg1:var(--Wh0)`、`--bg2:var(--Ga0)`、`--text1:var(--Ga10)`、`--text2:var(--Ga7)`、`--text3:var(--Ga5)`、`--text4:var(--Ga3)`、`--text_link:var(--Lb7)`、`--text_notice:var(--Ye6)` …
3. chunk `0.css` 另加 2 条组件私有令牌：`--card-cover-ratio:56.25%`、`--brand-pink:#f69…`（**注意此处用了连字符 `--brand-pink`，与语义层的下划线 `--brand_pink` 不是同一个变量**）。

**⇒ mstation 拥有全站最完整的语义令牌分层（382 色板 + 80 语义），但只消费了 101 个，且绕开语义层直接硬编码的占 73%。**

### 2.4 触摸目标（抽样规则：选择器含 `btn|button|tab|item|cell|nav|link|entry|icon|bar__|switch|chip|tag|more|arrow|close|back|list` 且显式声明 `height`/`min-height`，剔除 <10px 的纯图标）**

| 指标 | 实测 |
| --- | --- |
| 有效样本 | **527** |
| **最小值** | **10.00px** |
| P25 | 17.00px |
| **中位数** | **24.00px** |
| P75 | 40.00px |
| 最大值 | 800.00px（长列表容器，非触摸目标） |
| 平均值 | 34.56px |
| **< 44px** | **412 / 527 = 78.2%** ❌ |
| **< 40px** | **383 / 527 = 72.7%** ❌ |
| < 32px | 343 / 527 = 65.1% ❌ |
| ≥ 44px | 115 / 527 = 21.8% |

**18 个最小值样本（全部 < 16px）**

| 高度 | 属性 | 选择器 |
| --- | --- | --- |
| 10.00px | height | `.dyn-header__following__icon` |
| 10.00px | height | `.dyn-icon-badge span` |
| 10.00px | height | `.user-avatar.small .nft-tag` |
| 12.00px | height | `.bm-link-card-match__center__bottom` |
| 12.00px | height | `.bm-link-card-match__team__name` |
| 12.00px | height | `.bottom-tab-header .tab-item.more` |
| 12.00px | height | `.icon-play` |
| 12.00px | height | `.list-more__main .icon-right` |
| 12.00px | height | `.m-error-page .bottom-openapp .icon-right` |

**主导航实测**（唯一量到 44px 的关键组件）：

| 组件 | 声明 | @375 CSS px | 判读 |
| --- | --- | --- | --- |
| `.m-navbar` | `height:11.73333vmin` | **44.00px** | ✅ 恰好压线 |
| `.m-navbar .right` | `height:8vmin` | 30.00px | ❌ |
| `.m-navbar .right .search` | `6.4vmin × 6.4vmin` | **24.00 × 24.00px** | ❌ 搜索入口 |
| `.m-nav-openapp` | `height:8vmin; border-radius:4vmin` | 30.00px | ❌ |
| `.bottom-tab-header` | `height:10.66667vmin` | **40.00px** | ❌ 差 4px |
| `.bottom-tab-header .tab-item` | `padding:0 3.2vmin`（**仅水平 padding，垂直为 0**） | 高 = 父级 40px | 🟡 |

**垂直 padding 分布（触摸元素上）**：12px ×18 ｜ 10px ×17 ｜ 8px ×17 ｜ 7px ×6 ｜ 4px ×6 ｜ 5px ×5 ｜ 1px ×4 ｜ 6px ×3。**大多数靠父容器高度而非自身 padding 撑起可点区** —— `.tab-item` 就是典型（`padding: 0 3.2vmin`）。

> 结论：**mstation 没有"最小触摸目标"约束**。唯一的 44px 是 `.m-navbar` 的整条栏高，导航项实际只有 24px 高。

### 2.5 安全区

| 指标 | mstation | PC 端（15 页合计） |
| --- | --- | --- |
| `safe-area-inset-` | **0** | **0** |
| `env(` | **0** | **0** |
| `constant(`（iOS 11 旧语法） | **0** | **0** |
| `-webkit-fill-available` | **0** | — |
| HTML viewport meta | `width=device-width,user-scalable=no,initial-scale=1,maximum-scale=1,minimum-scale=1,**viewport-fit=cover**` | — |

**🚨 一个精确的"半成品"证据**：mstation **设了 `viewport-fit=cover`**（这是安全区 API 的唯一开关，等价于声明"我要用安全区"），但**全部 922 KB CSS 里没有任何一条规则消费 `safe-area-inset-*` 或 `env()`**。即：**iPhone X 及以上的底部 Home Indicator 区域完全不被避让**。这是本轮最可复现的移动端缺陷。

### 2.6 暗色

| 机制 | mstation CSS 命中 | 判定 |
| --- | --- | --- |
| `bili_dark` | **0** | ❌ 不用 PC 的 class |
| `prefers-color-scheme` | **0** | ❌ 不跟随系统 |
| `[data-theme` / `data-theme=` | **0** | ❌ 无此约定 |
| 独立 dark 资源（`*.dark.css` 等） | **0** | ❌ |
| **`html.night-mode`** | **54 处（31 条唯一规则，跨 9 个 chunk）** | 🟡 **唯一机制** |

**`html.night-mode` 全部规则都属于同一个组件族**（`v-dialog` / `v-switcher` / `v-overlay`，疑似 Vant 系底部弹层/切换器），且**全部硬编码**：

```css
html.night-mode .v-dialog__core{background-color:#141414}
html.night-mode .v-switcher__header{background-color:#141414}
html.night-mode .v-switcher__header:before{background-color:#2a2a2a}
html.night-mode .v-switcher__header__bottom{color:#e1e1e1;background-color:#141414}
html.night-mode .v-switcher__header__tabs__item{color:#b5b5b5}
html.night-mode .v-switcher__header__tabs__item.is-disable{color:#464748}
html.night-mode .v-switcher__content__wrap{background-color:#141414}
html.night-mode .v-switcher__content__item{color:#e1e1e1;background-color:#141414}
html.night-mode .v-switcher{color:#eb7093}     /* ← 品牌粉的暗色变体 */
```

**分 chunk 分布**：`2`(14) / `4`(11) / `14`(16) / `13`(8) / `3,5,6,7,8,10,11`(各 1) / 其余 0。

**⇒ 判定 (b) 的移动端版本：mstation 有暗色，但只是弹层组件的局部补丁，主题类名是第三套（`night-mode`，既非 `bili_dark` 也非 `data-theme`），暗色值不走令牌，且没有任何 JS 侧的主题切换入口证据**（`M_home.html` / `M_search.html` / `M_opus.html` 三个 SSR HTML 中 `bili_dark` = 0、`data-theme` = 0、`night-mode` = 0）。

**App WebView 注入 class 的排查**：`M_opus.html` 中 `dark` 出现 69 次、`theme` 79 次，全部来自**文章 JSON 数据**而非主题机制 —— 逐字节点带 `color` / `dark_color` 双字段：

```
"word":{"words":"要看中英双语的英配小马宝莉…","font_size":17,
        "color":"","dark_color":"","style":{"bold":false,…}}
```

**这是本轮最有借鉴价值的一条设计契约**：opus 图文渲染器在**数据层**就要求作者同时提供亮色与暗色。实测该文 68 个字节点中 67 个两色皆空，1 个 `color:"var(--Ga10, #18191C)"` + 1 个 `dark_color:"#E7E9EB"`。`font_size` 只有 4 档：`17px` ×54、`20px` ×6、`22px` ×4、`24px` ×4。**注意作者填的 `color` 本身就允许写 `var(--Ga10, #18191C)` —— 双色字段与设计令牌打通**。PC 侧 `opus-detail` 同样含 `font_size` ×68 / `dark_color` ×69，**两端共用同一份数据契约**。

### 2.7 手势与下拉刷新

| 指标 | 实测 |
| --- | --- |
| `refresh` | **0** |
| `loading-more` | **0** |
| `scroll-snap` | **0** |
| `swipe` | 19（全部属于 `.v-switcher__content--swipe` 弹层切换） |
| `pull` | 20（全部是图标字体码点） |
| `touch-action` | 4（reset 里 `html body{touch-action:manipulation}`） |
| `-webkit-overflow-scrolling` | 2（`touch`） |
| `overscroll-behavior` | 1 |
| `@media` | **1** —— 全站唯一，且是 `@media print{` |

下拉刷新 UI 确实存在，但**完全由图标字体驱动**（无 CSS 动画）：

```css
.ic_pulldown:before{content:"\E6CA"}
.ic_pullup:before{content:"\E6CB"}
```

**⇒ H5 端无 CSS 层面的下拉刷新实现**（无 `transform: translateY(...)` 状态机），只有"下拉/上拉"两个静态箭头码点 + 68 处 `loading` 字样（多半是 class 名）。`@media` 只出现 1 次且是 `print` —— **H5 端零媒体查询，布局完全靠 vmin 单一套缩放，不做断点适配**。

### 2.8 字体与图标

**`@font-face` 共 13 条声明（去重后 4 个实体）**

| 家族 | 字重 | 资源 | 内联? | 用途 |
| --- | --- | --- | --- | --- |
| `bili-font` | — | `data:application/vnd.ms-fontobject;base64,…`（**9 条声明 = 3 组重复**） | ✅ **base64 内联进 CSS** | **图标字体**（含 `.ic_pulldown` / `.ic_pullup` 等码点） |
| `xx-bin` | 400 | `//s1.hdslb.com/bfs/static/jinkela/long/fonts/xx-bin-Regular.otf` | ❌ 外链 | 正文西文 |
| `xx-bin` | 500 | `…/xx-bin-Medium.otf` | ❌ 外链 | 中等字重 |
| `xx-bin` | 700 | `…/xx-bin-Bold.otf` | ❌ 外链 | 粗体 |

**⇒ 图标是字体，不是 sprite**（本轮实测：非 data 的 `url()` 引用 77 处 / 40 个不同 URL，**全部是独立图片资源，无一个是 sprite 图集**）。自托管 OTF 三档字重来自 `s1.hdslb.com`，图标字体以 base64 WOFF 内联（`vnd.ms-fontobject` 是 IE 兼容的老 MIME，**只对老 IE 生效；现代浏览器拿不到图标** —— 这解释了为何 `bili-font!important` 有 10 处声明却可能不显示）。

**`font-family` 栈（65 条声明 / 15 个不同栈）**

| 频次 | 栈 |
| --- | --- |
| **17** | `PingFang SC,sans-serif` |
| 10 | `bili-font` / `bili-font!important` |
| 10 | `Helvetica Neue,Tahoma,Arial,PingFangSC-Regular,Hiragino Sans GB,Microsoft Yahei,sans-serif` |
| 3 | `-apple-system,BlinkMacSystemFont,PingFang SC,Source Han Sans SC,Helvetica Neue,Microsoft YaHei,Noto Sans CJK SC,WenQuanYi Micro Hei,sans-serif` |
| 3 | `xx-bin` |
| 2 | `xx-bin,sans-serif` |
| 2 | `DIN Alternate`（数字专用） |

reset 里的全局栈（chunk `0.css`）：`NotoSansThai Regular,-apple-system,BlinkMacSystemFont,Helvetica Neue,Helvetica,Arial,PingFang SC,Hiragino Sans GB,Microsoft YaHei,sans-serif`。
**⇒ 15 个字体栈、3 种中文字体首选顺序**（`PingFang SC` 独立 / `PingFangSC-Regular` 无空格 / `NotoSansThai Regular` 打头）—— reset 栈首位的 `NotoSansThai Regular`（泰文）出现在中文站全局字体栈第一位，是明显的复制粘贴残留。

### 2.9 动画曲线（附带量化，因与本项目 Fluent 规范直接可比）

| 曲线 | 次数 |
| --- | --- |
| `@keyframes` | 61 |
| `transition:` | 112 |
| `animation:` | 46 |
| `cubic-bezier(...)` | 14 |
| **`ease` / `ease-in` / `ease-out` / `ease-in-out`（非标准）** | **77** |
| `linear` | 60 |
| **`prefers-reduced-motion`** | **0** |

---

## 3. 任务 C：App / Web 端「主题 / 皮肤」体系

### 3.1 API 探测全记录（可复现）

统一头部（`api.bilibili.com` 与 `app.bilibili.com` 各测一遍）：

```bash
curl -s --compressed \
  -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' \
  -H 'Referer: https://www.bilibili.com/' \
  -H 'Origin: https://www.bilibili.com' \
  -H 'Accept: application/json' \
  'https://api.bilibili.com<ENDPOINT>'
```

| # | 端点 | Host | HTTP | 体积 | CT | 判读 |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | `/x/web-interface/nav/stat` | api | **200** | 49 | json | ✅ **存在**。`{"code":-101,"message":"账号未登录","ttl":1}` |
| C2 | `/x/web-interface/nav` | api | **200** | 259 | json | ✅ **存在**。返回 `{"code":-101,"data":{"isLogin":false,"wbi_img":{"img_url":"…/wbi/7cd08….png","sub_url":"…/wbi/4932c….png"},"ip_region":"CN"}}` |
| C3 | `/x/polymer/web-dynamic/v1/feed/all` | api | **200** | 49 | json | ✅ 存在（同 C1 的未登录响应） |
| C4 | `/x/web-interface/search/square` | api | **200** | 46 | json | ✅ **存在**（`{"code":-400,"message":"请求错误"}` = 缺参数，非缺端点） |
| C5 | `/x/v2/account/mine` | **app** | **200** | 46 | json | ✅ **存在**（`code:-400`）→ 证明 `app.bilibili.com` 可达且非全站拦截 |
| C6 | `/x/web-interface/nav/mini` | api | 404 | 1777 | html | ❌ 软 404「出错啦!」 |
| C7 | `/x/v2/theme/list` | api | 404 | 1777 | html | ❌ **软 404** |
| C8 | `/x/v2/theme/current` | api | 404 | 1777 | html | ❌ **软 404** |
| C9 | `/x/v2/theme` | api | 404 | 1777 | html | ❌ 软 404 |
| C10 | `/x/garb/v2/mall/home/index` | api | 404 | 1777 | html | ❌ 软 404 |
| C11 | `/x/garb/mall/home/index` | api | 404 | 1777 | html | ❌ 软 404 |
| C12 | `/x/v2/garb/mall/home/index` | api | 404 | 1777 | html | ❌ 软 404 |
| C13 | `/x/v2/garb/v2/mall/home/index` | api | 404 | 1777 | html | ❌ 软 404 |
| C14 | `/x/garb/mall/home/space` | api | 404 | 1777 | html | ❌ 软 404 |
| C15 | `/x/v2/vip` ｜ `/x/vip` ｜ `/x/v2/vip/index` ｜ `/x/v2/vip/privilege` ｜ `/x/v2/vip/privilege/list` ｜ `/x/v2/vip/reward` | api | 404 ×6 | 1777 | html | ❌ 全部软 404（**均为本轮自行构造的猜测路径，不构成结论依据**） |
| C16 | `/x/v2/dm/region/list` ｜ `/x/web-interface/article/recommends` ｜ `/x/activity/pgc/season` ｜ `/x/garb/mall/item/home` ｜ `/x/v2/user/me` ｜ `/x/user/web/nav` ｜ `/x/web-interface/theme` ｜ `/x/web-interface/user/theme` ｜ `/x/vip/theme` | api | 404 ×9 | 1777 | html | ❌ 全部软 404（同上，猜测路径） |
| C17 | `/x/v2/theme/list` ｜ `/x/v2/theme/current` ｜ `/x/theme/list` ｜ `/x/v2/garb/mall/home` ｜ `/x/v2/user/me` | **app** | 404 ×5 | **19** | text/plain | ❌ **Go 硬 404**「404 page not found」 |

> **C7–C17 的方法论声明**：这些路径**全部是我按命名规律自行构造的**，不是从任何文档中读到的。它们返回 404 只能证明"**这些具体路径不存在**"，**不能**推出"bilibili 没有主题接口"。我在文档里保留它们只是为了记录尝试面与失败模式，**不作为任何结论的依据**。

**C2 的重要限定**：`/x/web-interface/nav` 是上一轮任务书点名的"最关键一个"。实测它**只返回 `isLogin` / `wbi_img` / `ip_region` 三个字段，匿名态下不含任何主题 / 皮肤 / 设置字段**。由于本轮无登录 Cookie，**登录态下的 `nav` 完整字段未能验证**（记为 🟡）。

### 3.2 官方主题引擎源码（决定性证据）

`https://s1.hdslb.com/bfs/static/jinkela/long/laputa-css/bili-theme.min.js` — **HTTP 200，仅 1 837 B**。全文导出的 API 表面：

```js
e.initThemeWithSSR        (req, theme)   // 服务端：读 req.headers.cookie 里的 theme_style
e.initThemeWithCSR        (theme)        // 客户端：读 document.cookie
e.initTheme               (req, theme, fn)
e.changeTheme             (theme)        // 改写 id=__css-map__ 那个 <link> 的 href
e.initThemeWithSSRByFilter(req, theme, sel, arr)  // 服务端注入 <style id=__css-map-filter__>
e.initThemeWithCSRByFilter(theme, sel, arr)        // 客户端注入同一 <style>
e.changeThemeByFilter                            // = 内部函数 t(e)
e.getTheme                ()             // 读 cookie，默认值 s = "light"
```

常量表（原文）：

```js
const u="__css-map__", i="__css-map-filter__", a="map", l="light_u", s="light", f="theme_style";
//                                                        ↑ 默认主题       ↑ cookie 名
```

**四条决定性事实：**

1. **整个 1837 B 的引擎里，字符串 `dark` 出现 0 次。** 主题引擎本身不知道"暗色"是什么 —— 它只是个"按 cookie 值换 `<link>` 的 href"的函数。
2. **主题值域只有 `"light"` / `"dark"` 两个**（`"light"` 在本文件出现 1 次即默认值 `s`；`"dark"` 的唯一来源是 §1.4 引用的 `live.bilibili.com` 内联枚举 `DARKMODE = {LIGHT:"light", DARK:"dark"}`）。**一个布尔量，没有第三个值**。
3. **存在两条独立的暗色实现路径**：
   - **换资源**：`changeTheme(theme)` → 改 `<link id="__css-map__">` 的 href 到 `bili-theme/{light|light_u|map|light_all|dark_all}.css`（`dark_all` 常量出自 `bili-header.umd.js`）。
   - **算法滤镜**（`changeThemeByFilter`）：对根元素注入 `filter: invert(0.9) hue-rotate(0.5turn)`，对其余所有元素注入 `filter: invert(1) brightness(1) contrast(1) saturate(1) hue-rotate(0.5turn)`。**这是给"没有手写暗色 CSS 的页面"准备的兜底** —— 用滤镜反色，而不是维护第二套色板。
4. **Cookie 写入**：`h.set(e,t,n)` 默认 `{path:"/"}`，`expires` 以**天**为单位（`new Date(Date.now()+864e5*n.expires)`）→ 与上一轮观察到的 365 天一致。`h.get` 支持两种输入：字符串 cookie 头（SSR 路径）或 `document.cookie`（CSR 路径）。

### 3.3 各证据源逐条评估

| 源 | URL / 方式 | HTTP | 结果 | 判读 |
| --- | --- | --- | --- | --- |
| 社区接口文档 `SocialSisterYi/bilibili-API-collect` | `git clone --depth 1` | **clone 成功，但仓库只剩 2 个文件** | **仓库已被永久关停** | ❌ **任务书指定的第 2 号信源已失效**，详见 §3.4 |
| 官方帮助中心 | `www.bilibili.com/blackboard/help.html` | 200 | `app.css`(7 900 B) / `chunk-vendors.css`(210 054 B) / `app.js`(10 533 B) 中「主题 / 皮肤 / 夜间 / 暗黑 / 深色模式 / 个性化」**全部 0 命中**（`chunk-vendors.css` 仅 1 处 `night`，为无关标识符） | ❌ 帮助中心**无任何主题/夜间模式条目** |
| 官方帮助中心（另一入口） | `link.bilibili.com/` | 200 2635 B | `<title id=app-title>个人中心 - bilibili link</title>`，页面正文「主题/皮肤/夜间/暗黑/深色模式」**0 命中** | ❌ |
| 活动中心 | `blackboard/activity-4487`（help 背后的 SPA） | 200 | 同上 0 命中 | ❌ |
| App Store（CN） | `apps.apple.com/cn/app/bilibili/id377211088` | **404 958 B** | 未取得描述文本 | ❌ 未能验证 |
| iTunes Lookup API | `itunes.apple.com/lookup?id=377211088&country=cn` | 200 | **`{"resultCount":0,"results":[]}`** | ❌ 未能验证（CN 区查无此 App） |
| Google Play | `play.google.com/store/apps/details?id=tv.danmaku.bili&hl=zh_CN&gl=CN` | **404 872 B** `<title>未找到</title>` | 未取得描述文本 | ❌ 未能验证 |
| 站点 HTML 全文扫描（18 份） | grep「主题/皮肤/夜间/暗黑/深色模式」 | — | 命中 4 处，**全部是内容文本**：漫画 tags `["战斗","暗黑"]`、番剧简介「以昆虫为主题」、视频标题「最能吃的皮肤转场」「冬季主题更新」 | ❌ 无一是主题功能入口 |
| 移动端 H5 主题入口 | `m.bilibili.com/{, /search, /opus/*}` | 200 ×3 | SSR HTML 中 `bili_dark` = 0、`data-theme` = 0、`night-mode` = 0；**mstation 无 `my/` 路由（404）** | ❌ H5 侧无主题切换入口 |
| 全站唯一的主题切换 UI 痕迹 | `rank` 页 `themeSwitchHandler` ｜ `space` 页 `themeSwitchHandler` ｜ `help` 页 `<script … theme-switch="true">` | — | 3 处，**全部是给顶导 UMD 的配置开关**，切换的仍是 light/dark | 🟡 有 UI，无新能力 |
| 直播站暗色实现 | `live.bilibili.com` 内联脚本 | 200 | `lab-style` 属性 + `colorScheme` + `bililiveThemeV2` + `console.warn` 降级 | ✅ 见 §1.4，仍是二值 |

### 3.4 ❗ 任务书第 2 号信源已被官方施压关停（重要事实）

`https://github.com/SocialSisterYi/bilibili-API-collect`（20 202 stars，创建于 2020-03-04）**已永久关停**：

- `git clone --depth 1` 成功，但工作树**只剩 `README.md` + `reason.jpg` 两个文件**。
- 默认分支已改为 `deprecated`，`git ls-remote --heads` **只返回这一个分支**。
- GitHub API 元数据：`archived: true`、`pushed_at: 2026-01-30T09:06:33Z`、`description: null`。
- README 原文：

  > # Deprecated
  > 本仓库停止维护并永久关停。
  > ## 原因
  > **2026年1月28日**，本仓库维护者收到B站委托的律师事务所发律师函警告邮件，指控本仓库中的项目存在"通过技术手段对哔哩哔哩平台非公开的API接口及其调用逻辑、参数结构、访问控制及安全认证机制进行系统性收集、整理，并以技术文档、代码示例等形式向不特定公众传播"的侵权行为。
  > 即日起停止维护并删除相关文档及源代码。

- Wayback Machine CDX API 对该仓库 `docs/*` 路径的快照查询**返回空**（`from=2024`，无结果），故本轮**无法引用任何已归档的「主题 / 装扮 / 皮肤」章节标题 + URL**。

**⇒ 影响**：任务书要求"在文档里搜主题/装扮/皮肤/大会员相关章节并原样引用章节标题 + URL"这一项**客观上无法完成**。这是失败模式本身，不是跳步。替代路径改用 §3.2 的一手 JS 源码 + §1.4 的 SSR 内联脚本，二者的证据强度**高于**社区二手文档。

---

### 3.5 结论

> ## 选 **(b)：只有亮 / 暗切换**
>
> **存在，但形态极简：一个 cookie + 一个二值枚举 + 两条实现路径。没有主题市场、没有皮肤包、没有会员专属主题。**

**支撑证据（全部一手）**

| 论断 | 证据 | 来源 |
| --- | --- | --- |
| 主题是**持久化的用户偏好** | `theme_style` cookie，365 天，`.bilibili.com` 域，路径 `/`；引擎读它（SSR 读 `req.headers.cookie`，CSR 读 `document.cookie`） | `bili-theme.min.js` 常量 `f="theme_style"`、`h.set` 的 365 天算式；`bili-header.umd.js` 常量 `UA="theme_style"` |
| 主题只有 **2 个取值** | 引擎全文 `"dark"` 出现 **0 次**；`"light"` 是默认值常量 `s="light"`；唯一的 dark 枚举在直播站 `DARKMODE = {LIGHT:"light", DARK:"dark"}` | §3.2、§1.4 |
| 切换 = **换 `<link>` 的 href** | `changeTheme(theme){ document.getElementById("__css-map__").href = p(theme) }`；URL 构造 `KA(e)="//s1.hdslb.com/bfs/seed/jinkela/short/bili-theme/"+e+".css"` | `bili-theme.min.js` + `bili-header.umd.js` |
| 主题包只有 **6 个文件** | `light` / `light_u` / `map` / `dark` / **`light_all`** / **`dark_all`**（`bili-theme/dark_u.css` 仍为 404，任务书已知） | `bili-header.umd.js` 常量 `sd/$L/yL/bL/AL/wL` |
| 暗色有**算法兜底** | `changeThemeByFilter` 注入 `filter: invert(0.9) hue-rotate(0.5turn)`（根）+ `invert(1) brightness(1) contrast(1) saturate(1) hue-rotate(0.5turn)`（其余） | `bili-theme.min.js` |
| **未登录强制亮色** | `getCookie('DedeUserID') && getCookie('theme_style')===DARK` | `live.bilibili.com` 内联脚本；常量 `CL="DedeUserID"` |
| 主题状态是**服务端渲染状态** | 首页 SSR pinia blob 里含 `theme:"light"` 字段，与 `region/lang/homeVersion` 同级 | `www.bilibili.com/`（Googlebot UA） |
| **不存在主题/皮肤 API** | 5 条 `theme` 路径 + 5 条 `garb/mall` 路径在 `api.bilibili.com` 与 `app.bilibili.com` 上**全部软 404 / 硬 404** | §3.1 C7–C14、C17 |
| **帮助中心零条目** | 3 个官方帮助入口的 CSS + JS 全文，「主题/皮肤/夜间/暗黑/深色模式/个性化」0 命中 | §3.3 |
| **大会员无主题权益** | 付费色阶 `--Ye*` 只体现为"支付黄"语义别名 `--pay_yellow`，Web 端无会员主题页（`www.bilibili.com/vip` = 404） | `mstation chunk 2 :root`、§1.1 |

**排除 (a) 与 (c) 的理由**

- 排除 **(a) 有主题功能**：主题的存在形态已被 §3.2 完整枚举 —— 一个 cookie、一个二值枚举、6 个 CSS 文件。没有任何"主题"对象、主题 ID、主题市场、皮肤上传/购买的代码路径或 API。
- 排除 **(c) 未找到证据**：`bili-theme.min.js`（1 837 B）+ `bili-header.umd.js`（705 KB）+ 直播站内联脚本 + 首页 SSR `theme` 字段，四份一手信源互相印证，证据充分。
- **会员主题**：本轮**未能验证**（`/x/v2/vip/*` 全部为本人构造的猜测路径，不作依据；`www.bilibili.com/vip` 404；两个应用商店页面 404）。但由于**主题引擎的值域硬编码为 2 个字符串**、且换主题的载体是一个静态 `<link>`，即使存在会员主题也**无法在现有引擎下表达**（会员主题至少需要"主题 ID → 资源"的多值映射）。这是**结构性论证**，标记为 🟡 而非断言。

**给本项目（Pictelio）的可迁移结论**

1. **「服务端已知主题」值得抄**：首页把 `theme:"light"` 直接放进 SSR 状态，首屏无闪烁。本项目的 F2 引擎预热恰好有同类问题（`openwiki/integrations/android-native.md` §Engine Availability Fallback）。
2. **「暗色兜底用滤镜」是个便宜的降级**：bilibili 对没有暗色 CSS 的页面用 `invert + hue-rotate` 兜底，而不是维护第二套色板 —— 代价是图片与品牌色偏移，但换来了 100% 覆盖率。本项目若要覆盖长尾页面可比对。
3. **不要学它的漂移**：首页自带主题与官方包漂移（暗色 12/191 不一致，集中在橙色族 + `Ga12`）、mstation 品牌粉 3 种写法（197 处）、`safe-area-inset` 开了 `viewport-fit=cover` 却 0 处消费 —— 这三条正是本项目 `AGENTS.md`「Fluent Design 规范 / 禁止硬编码」明令禁止的。

---

## 4. 对上一轮结论的复核结果

| 上一轮结论 | 复核 | 说明 |
| --- | --- | --- |
| 暗色门控是 `html` 上的 class `bili_dark` | 🟡 **部分修正** | PC 2233 组 ✅；**直播站用 `html[lab-style="dark"]` 属性**；**mstation 用 `html.night-mode`**。站内至少 3 套约定 |
| 完全不支持 `prefers-color-scheme` | ✅ **确认** | 15 个 PC 页面 + 922 KB mstation CSS，命中数 **全为 0** |
| 未登录（无 `DedeUserID`）强制亮色 | ✅ **确认并升级为源码级** | 直播站脚本 `getCookie('DedeUserID') && getCookie('theme_style')==='dark'`；`bili-header.umd.js` 常量 `CL="DedeUserID"` |
| `bili-theme/{map,light,light_u,dark}.css`，包头 v12.0.0 | 🟡 **扩充** | 另有 **`light_all` / `dark_all`** 两个常量（`AL` / `wL`）。构建时间 `9/28/2025, 1:33:28 PM` |
| `--bili-*` 前缀在 6 份产物里 0 次 | ➖ 未重测（任务书已判定不再验证） | — |
| mstation `0.53333vmin` ≈ 4px 基准 | ❌ **修正** | 真实基准是 **`0.26667vmin`**（375 视口下 1 CSS px）。`0.53333vmin` = 2 CSS px = 750 稿 4px。162 个 distinct 值中 **74 个是 0.53333 的半整数倍** |
| mstation「自定义属性 0 个，全硬编码」 | ❌ **修正** | 实测 **551 条声明 / 482 唯一名 / 730 次 `var()`**。真实形态是「令牌层完整但只用 101 个（21%），且 1654 处颜色硬编码（73.3%）」 |
| mstation PC 端 `safe-area-inset` = 0 | ✅ **确认并加料** | mstation 也为 **0**，但 **viewport meta 设了 `viewport-fit=cover`** —— 开了开关却无人消费 |
| PC 端 `:focus-visible` / `prefers-reduced-motion` | ✅ **确认并量化** | 15 页合计 `prefers-reduced-motion` = **0**；`:focus-visible` = **6**（全在 opus）；裸 `:focus` = **20** |

---

## 5. 完整来源清单

> 全部抓取时间：**2026-09-27 15:00–15:12 CST**（单次窗口内顺序抓取）
> 桌面 UA：`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`
> 移动 UA：`Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1`
> 爬虫 UA：`Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`

### 5.1 页面 HTML

| # | URL | HTTP | 体积 | 用途 |
| --- | --- | --- | --- | --- |
| S1 | `https://www.bilibili.com/` | 200（爬虫 UA；桌面 UA 686 B 验证码） | 34 077 | A1 首页 |
| S2 | `https://www.bilibili.com/v/popular/rank/all` | 200 | 2 330 | A2 排行榜 |
| S3 | `https://www.bilibili.com/read/home` | 200 | 22 626 | A3 专栏 |
| S4 | `https://www.bilibili.com/read/cv23064696` → **301** → `https://www.bilibili.com/opus/784478474085597189` | 200 | 27 025 | A4 图文 |
| S5 | `https://t.bilibili.com/` | 200 | 1 625 | A5 动态 |
| S6 | `https://space.bilibili.com/2` | 200 | 3 549 | A6 空间 |
| S7 | `https://message.bilibili.com/` | 200 | 2 055 | A7 消息 |
| S8 | `https://live.bilibili.com/` | 200 | 3 316 | A8 直播 |
| S9 | `https://www.bilibili.com/anime/` | 200 | 64 510 | A9 番剧 |
| S10 | `https://manga.bilibili.com/` | 200 | 114 318 | A10 漫画 |
| S11 | `https://search.bilibili.com/` | 200 | 16 073 | A11 搜索 |
| S12 | `https://www.bilibili.com/blackboard/help.html` | 200 | 1 396 | A12 帮助 |
| S13 | `https://www.bilibili.com/blackboard/activity-5zJxM3spoS.html` | 200 | 24 958 | A13 活动（platcomps） |
| S14 | `https://www.bilibili.com/blackboard/era/yellowVSgreen11th.html` | 200 | 18 486 | A14 活动（2233） |
| S15 | `https://link.bilibili.com/` | 200 | 2 635 | A15 link |
| S16 | `https://m.bilibili.com/` | 200 | 34 695 | B 移动首页 |
| S17 | `https://m.bilibili.com/search` | 200 | 4 308 | B 移动搜索 |
| S18 | `https://m.bilibili.com/opus/784478474085597189` | 200 | 16 591 | B 移动图文 |

**失败记录**：`blackboard/activity-iBweXQ5Pum.html` 404 ｜ `activity-VgPfPeGRXH.html` 404 ｜ `activity-list-page.html` 404 ｜ `www.bilibili.com/vip` 404 ｜ `www.bilibili.com/h5/notice` 404 ｜ `m.bilibili.com/v/popular/all` 404 ｜ `m.bilibili.com/comic` 404 ｜ `m.bilibili.com/manga` 404 ｜ `m.bilibili.com/my/` 404 ｜ `m.bilibili.com/`（桌面 UA）302 → www ｜ `apps.apple.com/cn/app/bilibili/id377211088` 404 ｜ `play.google.com/store/apps/details?id=tv.danmaku.bili` 404

### 5.2 主题与字体资源

| # | URL | HTTP | 体积 | 用途 |
| --- | --- | --- | --- | --- |
| S19 | `https://s1.hdslb.com/bfs/seed/jinkela/short/bili-theme/light.css` | 200 | 6 935 | 官方亮色包（包头 `@bilibili/bili-theme(v12.0.0)`，构建 `9/28/2025, 1:33:28 PM`，382 属性） |
| S20 | `https://s1.hdslb.com/bfs/seed/jinkela/short/bili-theme/light_u.css` | 200 | 6 793 | 340 属性 |
| S21 | `https://s1.hdslb.com/bfs/seed/jinkela/short/bili-theme/map.css` | 200 | 2 528 | 80 声明 / 144 提及 |
| S22 | `https://s1.hdslb.com/bfs/seed/jinkela/short/bili-theme/dark.css` | 200 | — | 382 属性，暗色对照基准 |
| S23 | `https://s1.hdslb.com/bfs/static/jinkela/long/laputa-css/bili-theme.min.js` | 200 | **1 837** | **C 的决定性证据**：主题引擎 |
| S24 | `https://s1.hdslb.com/bfs/seed/laputa-header/bili-header.umd.js` | 200 | **705 120** | 主题常量表（`light_all` / `dark_all` / `theme_style` / `DedeUserID`） |
| S25 | `https://s1.hdslb.com/bfs/static/jinkela/long/fonts/xx-bin-{Regular,Medium,Bold}.otf` | 未单独抓取（由 S26–S42 引用） | — | 自托管三档字重 |

### 5.3 页面 CSS（全部 `--compressed` 落盘解析，单文件均 < 10 MB，无截断）

| 页面 | 关键 CSS（字节） |
| --- | --- |
| A1 | `shanks/laputa-home/assets/index-8a65600f.css`（386 983） |
| A2 | `2233-monorepo/popular/static/css/index.307879a4.css`（71 659） |
| A3 | `2233-monorepo/article-home/css/article-home.{0,1,2}…css`（294 / 7 005 / 7 343） |
| A4 | `2233-monorepo/opus-detail/css/opus-detail.{0,1}…css`（25 012 / **670 587**） |
| A5 | `2233-monorepo/dyn-home/static/css/index.2dd6f957.css`（510 359）+ `jinkela/long/font/{medium,regular}.css`（38 644 / 38 752） |
| A6 | `shanks/fresh-space/assets/index-7f7ca3ba.css`（227 526）+ `freshspace-zpjpp3aqht.css`（11 245） |
| A7 | `2233-monorepo/message-pc/static/css/index.547d7edd.css`（144 860）+ `svg-next/font/2024-08-21/BDC-erj847ivanq.css`（47 242） |
| A8 | `static/fenice/home/client/home/assets/index.0476063a.css`（7 543） |
| A9 | `static/home-v3/css/home-v3.{0,1}…css`（98 332 / 3 383） |
| A10 | `manga-static/manga-pc-ssr/assets/static/*.css` ×11，含 `layouts_tailwind-00e65532.1L8YtKU2.css`（39 049）、`swiper`（19 433） |
| A11 | `shanks/laputa-search/assets/index-7b4c9b2c.css`（222 145） |
| A12 | `activity.hdslb.com/blackboard/activity4487/css/{app,chunk-vendors}…css`（7 900 / 210 054） |
| A13 | `activity.hdslb.com/blackboard/platcomps/plat-components/button/1.0.18/index.css`（387）+ `pc-slide-player/0.6.2/index.css`（6 845） |
| A14 | `s1.hdslb.com/bfs/activity-plat/static/10613/…` ×13（6 644 / 6 668 / 18 984 / 5 350 / …） |
| A15 | `live-pkg/live-web-player/sell-video-player.min.css`（1 363）+ `app.97c9bff2ab27f365bf65.css`（412 180）+ `iconfont.css`（16 081） |
| **B** | **`static/jinkela/mstation-h5-new/css/mstation.{0,2,6,14}…css`（`<link>`）+ `{3,4,5,7,8,9,10,11,12,13,15,16,17,18,19}…css`（`<link rel=prefetch>`），19 个 chunk 合计 **922 822 B**；chunk `1` 404 337 B** |

### 5.4 API 端点

| # | URL | HTTP | 体积 | 响应 |
| --- | --- | --- | --- | --- |
| S26 | `https://api.bilibili.com/x/web-interface/nav/stat` | 200 | 49 | `{"code":-101,"message":"账号未登录","ttl":1}` |
| S27 | `https://api.bilibili.com/x/web-interface/nav` | 200 | 259 | `{"code":-101,…,"data":{"isLogin":false,"wbi_img":{…},"ip_region":"CN"}}` |
| S28 | `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all` | 200 | 49 | 未登录 |
| S29 | `https://api.bilibili.com/x/web-interface/search/square` | 200 | 46 | `code:-400` |
| S30 | `https://app.bilibili.com/x/v2/account/mine` | 200 | 46 | `code:-400` |
| S31–S46 | `api.bilibili.com` / `app.bilibili.com` 共 16 条猜测路径（theme / garb / vip / user） | 404 | 1777 / 19 | 软 404「出错啦!」/ Go 硬 404 |
| S47 | `https://api.bilibili.com/x/web/nav/stat`（上一轮的少 `interface` 版） | — | — | WAF HTML（本轮未重测，承上一轮记录） |

### 5.5 第三方与元数据

| # | URL | HTTP | 结果 |
| --- | --- | --- | --- |
| S48 | `https://api.github.com/repos/SocialSisterYi/bilibili-API-collect` | 200 | `default_branch: deprecated`、`archived: true`、`stargazers_count: 20202`、`pushed_at: 2026-01-30T09:06:33Z` |
| S49 | `https://github.com/SocialSisterYi/bilibili-API-collect`（`git clone --depth 1`） | clone 成功 | 工作树仅 `README.md` + `reason.jpg` |
| S50 | `https://raw.githubusercontent.com/SocialSisterYi/bilibili-API-collect/master/README.md` | 200 | 关停声明全文 |
| S51 | `https://web.archive.org/cdx/search/cdx?url=raw.githubusercontent.com/SocialSisterYi/bilibili-API-collect/master/docs/*&from=2024` | 200 | **返回空**（无可用归档快照） |
| S52 | `https://itunes.apple.com/lookup?id=377211088&country=cn` | 200 | `{"resultCount":0,"results":[]}` |
| S53 | `https://apps.apple.com/cn/app/bilibili/id377211088` | 404 | 958 B |
| S54 | `https://play.google.com/store/apps/details?id=tv.danmaku.bili&hl=zh_CN&gl=CN` | 404 | 872 B `<title>未找到</title>` |

---

## 6. 未完成 / 明确放弃项

| 项 | 状态 | 原因 |
| --- | --- | --- |
| 付费 / 大会员页面矩阵 | ❌ 放弃 | `www.bilibili.com/vip` 404；全站 HTML 无 `vip`/`charge`/`pay` 路由；不瞎编 id |
| 社区文档的「主题/装扮/皮肤」章节引用 | ❌ 客观不可得 | 仓库 2026-01-28 已被律师函关停并删档，Wayback 无快照（§3.4） |
| App Store / Google Play 描述文本中的主题提及 | ❌ 未能验证 | 两个商店页对本网络均 404 |
| 登录态 `/x/web-interface/nav` 完整字段 | 🟡 部分 | 本轮无登录 Cookie；匿名态该端点只返 3 个字段 |
| 顶导/底脚 UMD 运行时注入的令牌值 | 🟡 部分 | 需执行 JS 才能取到；本轮只做静态源码分析 |
| mstation 暗色切换的 JS 触发点 | ❌ 未找到 | 3 个 SSR HTML 中 `night-mode` 命中 0；`m.bilibili.com/my/` 404，无设置页可查 |
| 任务书列出的 `m.bilibili.com/{v/popular/all, comic, manga, my/}` | ❌ 已下线 | 全部 404 1777 B |
