# ADR-0196：app-lynx 溯源（Source tracing）——外部反向搜图服务

- 状态：**Superseded by ADR-0197（2026-09-27 产品决策变更）**
  - **为何被取代**：本方向撞防盗链硬约束 → 需上传通道 → 撞 Cloudflare 质询 → 与 #607「单 Lynx 引擎」架构冲突（三重复杂度）。产品改做「标签近邻」，**根本不碰图片**，上述问题整体消失。
  - **本文档的调研结论仍然有效**，且已被 ADR-0197 的「调研结论 1–4」部分复用（tags 关联度降序、`translated_name` 为 `None`、官方 related 的分工关系、站外溯源的能力边界）。**若将来重启站外溯源，直接复用本文的防盗链 / 竞品 / 中转服务取证，无需重做调研。**
  - 保留全文不删：它是「做了→验证→因架构与风险放弃」这一决策过程的完整记录。
- 日期：2026-09-27（转 Superseded 同日）
- 关联：issue #606（Lynx 单引擎化地图，本 ADR 挂其下）、#607（终态 = WebView 线下线）、`packages/app-lynx/CONTEXT.md`「溯源（Source tracing）」词条、webview 端图床设置范式（`SettingsImage.tsx` / `ImageHostSettings.tsx` / `imageHostStore.ts`）、`NetDiagProbe.java`（网络探测基座）、`PictelioAppModule.openUrl`（外链打开）、`composables/useLongPress.ts`（长按范式）、ADR-0129（通栏连续多图列表）、ADR-0103（账号级键契约与 PrefsStorage seam）、ADR-0187（标签静音，`relatedInjection` 过滤链）、ADR-0189（NovelIntro 动作行）、竞品调研 `docs/research/competitor-comparison-2026-09.md`

## 背景

Pictelio 缺「以图搜源」类能力，全仓无任何搜图代码。竞品侧：Pixiv-Shaft（`utils/ReverseImage.java`，约 200 行）提供 SauceNAO / TinEye / IQDB / Ascii2D 四引擎；pixez-flutter、Pixiv-SwiftUI、Pivlite 亦有。是本轮竞品对比中**成本最低、差异感最强**的空白项之一。

但直接照抄 Shaft 的"四引擎"存在两个此前未被识别的问题，本 ADR 的决策均围绕它们展开。

### 问题一：这个功能的实际可用性绑定用户网络环境

2026-09-27 国内网络实测（`curl`，本机）：

| 目标 | 结果 |
| --- | --- |
| `i.pximg.net` | ❌ SSL RST（SNI 阻断） |
| `saucenao.com` | ❌ SSL RST |
| `iqdb.org` | ❌ SSL RST |
| `ascii2d.net` | ✅ HTTP 200 / 0.98s |
| `tineye.com` | ⚠️ HTTP 403（WAF 拒绝非浏览器 UA） |
| `www.google.com` | ✅ HTTP 302 / 0.75s |

两项推论：

1. **Shaft 的四引擎对国内用户实际只有 1 个（Ascii2D）可用**——「四引擎」在可达性上并不成立。
2. **溯源的前提是用户能看见这张图**。Pictelio 的直连能力已于 2026-09-08 移除（`bf32620e`，OPPO 真机 Android 9 Conscrypt 实测无 SNI ClientHello 指纹级 100% RST），故**国内无代理用户根本加载不出 Pixiv 图片，溯源无从触发**。

即：这不是一个"无条件补齐竞品差距"的功能，而是一个**可用性高度依赖用户网络环境**的功能。开发者无法替用户判断哪个引擎可达——**这个判断必须交还给用户**。这是 D3/D6 的根本动因。

### 问题二：多引擎的语义与图床的多 host 不同

webview 图床支持多 host 同时启用（`fluent-checkbox` 多选），但那是**自动择优**语义（`race`/`weighted` 打全部、取最快），一个动作、引擎自己决定。溯源的多引擎**不能照搬**：多个引擎产出的是多份互不相干的搜索结果，用户不可能同时看，也不该由产品替他在几个结果源之间静默选一个。

这是本 ADR 唯一一处**有意偏离图床范式**的地方（D9）。

### 边界澄清：做什么、不做什么

「以图搜源」这个名字指向四种不同需求，本 ADR 只取其中两种：

| 场景 | 是否做 | 理由 |
| --- | --- | --- |
| 溯源：查该图更早的发布出处 | ✅ | Pixiv 存在大量搬运与二次发布，真实痛点 |
| 同图扩散：查该图/同画师在别处的版本 | ✅ | 与溯源共用同一机制，合并为同一功能 |
| 反查：从相册选外部图，确认是否 Pixiv 作品 | ❌ | 入口在相册、图片来源是外部文件，是另一交互范式 |
| 角色识别 / 图生 tags | ❌ | 本质是图像识别而非搜源，且 IQDB 对 Danbooru 索引的覆盖决定它能否成立 |

**取舍（已接受）**：因此功能名定为「溯源」而非「以图搜源」——后者暗示支持传入任意图片，范围更宽，本功能不支持。见 `CONTEXT.md` 词条的 `_Avoid_`。

## 调研结论

1. **原生能力基本齐备**。原图 URL 取值有 `utils/galleryDownload.ts:245` `originalPageUrls()`（已在下载链使用）；系统浏览器打开有 `PictelioAppModule.openUrl` + `utils/nativeUrl.ts:8`（现成消费方：`updateStore` / `Ranking.vue` / `notificationTarget`）；长按手势有 `composables/useLongPress.ts`（500ms / 10px 容差 / `consumeLongPress` 吞 tap，已有 2 处成熟消费方：静音标签、收藏面板）；底部弹层 + 返回键栈有 3 个现成实例（`absolute inset-0` + `stores/modalStack.ts`）。**落地成本确实低。**
2. **详情页是通栏连续列表**（ADR-0129），**没有「当前页」概念**，页码仅是角标文本。行级按钮只能作用于作品级（首页图），"作用于指定页"需另设入口。
3. **B 入口手势挂点——原判「无先例」已推翻（2026-09-27 复检）**：`SkeletonImage.vue` / `CoverImage.vue` 均无 `defineEmits` 属实，但仓库内有**三层独立证据**证明落点可通：① class fallthrough 已穿**两层组件链**在生产运行（详情页头像 `<SkeletonImage class="w-[10.667vw] rounded-full">` 视觉生效）；② tap 落在 `<image>` 上**会冒泡到祖先 plain `<view>`**（真机取证：作者行头像命中、`IllustList.vue:309-311` 的 `@tap.stop` 只有冒泡上来才有意义）；③ 详情页 `<scroll-view>` 内的 `@touchstart` 触摸通道**真机 E2E 已验收**（`lynx-bookmark-tags.spec.ts:16-19`）。经自建探针补齐 Vue 层缺口：`@touchstart` 编译为 `onTouchstart`，**未声明时落到单根组件的根 `<view>`**，`<image>` 仍只拿 `onLoad/onError`。
   **仍未验证**：真机 Lynx 是否把 fallthrough 的 `onTouchstart` 派发成 `touchstart`（`vue-lynx/runtime` 的 `on*` → `__AddEvent` 编码路径在 minified 的 web-core/native 侧不可读）；`touch*` 是否与 `tap` 走同一条命中路径（只有 `tap` 有真机证据）；`<image>` 能否像 `<view>` 一样收手势（ADR-0055 只证伪了 `<text>` 与 `<list-item>`，`<image>` 未被点名）。
   **两个已确认的陷阱**：给 `CoverImage`/`SkeletonImage` 加 `defineEmits(['touchstart',...])` 会把监听器当组件事件吞掉、**根元素反而拿不到**；Fragment 多根组件会整批丢弃 fallthrough 并 Vue warn。
   **一条 ADR 红线**：ADR-0147 决策 1（不可变）——app-lynx 中交互控件**不得以 absolute/fixed 覆层盖在 `<scroll-view>` 之上**（真机实测覆层收不到 tap）。故「透明热区 overlay」方案被否决为默认形态。
4. **上传通道不存在**：`PictelioImageService` 非 JS 桥（无 `@LynxMethod`），Gallery/Downloader 只回 uri。若某引擎只能上传，需新增"图片字节回传 JS"的原生通道。
5. **各引擎是否支持 URL 检索（而非仅上传）未实测**。`i.pximg.net` 是否强制 Referer 亦**未能验证**——国内网络下连接在 TLS 握手阶段即被 RST，三种请求（无 Referer / 带 Referer / 裸请求）均拿不到 HTTP 状态码；仓内证据仅表明本项目自身下载必须注入 `Referer: https://app-api.pixiv.net/`（`PixivImageLoader.java:176`），**不能推出**第三方引擎也会被拒（`i.pximg.net` 通常是公开 CDN）。→ 见 D4 与 spec 首条验收项。
6. **图床配置不进 WebDAV 备份**：`imageHostStore` 用独立存储键 `image_host_settings`，不在 `settingsStore` 备份域内（`backupWiring.ts:34-46` 只备份 settingsStore 的 rawValues + `BACKUP_SET_KEYS` 两个 set 键）。这是设备级配置的既有先例。

## 原型验证结论（LOGIC prototype · 2026-09-27）

状态机的边界最容易在纸面上想错，故先行原型验证再落 spec。原型为**丢弃式单文件 HTML**（`packages/app-lynx/prototype/SourceTracingStateMachine.prototype.html`，标注 PROTOTYPE · THROWAWAY）：设置页草稿操作 + 模拟详情页按钮三态 + 五个引导走查 + 自由操作台，配套 Node 断言脚本**直接提取原型 `<script>` 内的状态机代码执行**（跑原型本身，非副本），**25 条断言全部通过**。

**核心产出：门控优先级链（D4 与 D6 的相对次序，原文未写明）**

| 优先级 | 条件 | 按钮形态 | 说明文案指向 |
| --- | --- | --- | --- |
| 1（最高） | 作品受限（R18/R18G） | 置灰 | 「受限内容不可溯源」 |
| 2 | 总开关关（已保存态） | **隐藏** | —— |
| 3 | 总开关开 ∧ 零引擎 | 置灰 | 「已开启但未选择任何引擎」 |
| 4 | 生效 | 可用 | 已启用引擎数 / 上次引擎 |

**内容门控必须压过配置门控**——这是原型抓出的最易错项：R18 作品即使用户配置也有问题，说明文案也必须说「受限内容」而非「配置不完整」，否则把内容门控误报成用户的配置错误。断言 `W4` 专门钉死此点（清空引擎集合后仍须返回「受限内容」）。

**其余已验证不变量**

| 编号 | 不变量 | 验证方式 |
| --- | --- | --- |
| I1 | 草稿隔离：详情页按钮只读 **SAVED**，草稿开着总开关时按钮仍隐藏 | W1 四步递进 |
| I2 | 生效 = `master ∧ 引擎数 ≥ 1` | W1/W2 |
| I3 | 零引擎 → 置灰（非隐藏）+ 指向「未选择任何引擎」 | W2 |
| I4 | 保存永不拒绝：总开关关却勾了引擎、总开关开却零引擎，两种组合均允许提交 | 独立断言组 |
| I5 | 关总开关时引擎选择**保留**（照图床 `host.enabled` 独立于 `masterEnabled` 语义） | W5 双变体对照 |
| I6 | 记忆引擎不在已启用集 → 回落选择器并改记 | W3 |

**原型暴露的一个次级决策**：单引擎时保存应自动记住该引擎（W1 断言「单引擎时自动记忆」）。否则用户只开一个引擎仍要每次选，属无谓摩擦。已折入 D7。

**I5 的变体结论**：原型同时实现「关总开关时清空引擎选择」的变体以供对照。判定为**保留**为默认（与图床一致，关总开关是"门"不是"清空"），清空变体仅作反面对照保留在原型中，不进实现。

## 决策

**D1 功能边界——只做「溯源」，入口为作品详情页。**
术语定为「溯源」（Source tracing），语义 = 把当前作品的原图交给外部反向搜图服务，跳转其结果页，用于查证该图更早的发布出处。排除「相册反查外部图」与「角色识别」。写入 `packages/app-lynx/CONTEXT.md` 词条（含 `_Avoid_` 排除项）。作用对象为**作品级**（单图作品 = 该图；多图作品 = 首页图）。

**D2 引擎集——四个全列、默认全关；排除 Google Lens。**
引擎清单：Ascii2D / SauceNAO / IQDB / TinEye。**全部默认关闭**，由用户按自身网络环境自行勾选——这正是问题一的直接解法：可达性判断从开发者转移到用户，我们既不替用户猜、也不因为"某引擎国内不可达"就不做它。
**排除 Google Lens**：它无公开 URL 检索入口（只能上传），会单独把功能拖进"下载图片 → 新增原生模块回传字节 → multipart 上传"这条贵得多的路，破坏整个功能的成本结构。
**取舍（已接受）**：默认全关 = 零配置用户装完看不到这个功能，需要在设置页讲解文案里说清它是可选能力（见 D6）。

**D3 传递方式——按引擎能力二分：URL 直传优先（IQDB 类已验证可行）+ multipart 上传兜底（TinEye 类已验证失败）。**

**防盗链事实（12 个真实 `img-original` URL 实测，非推测）**：

| 请求 | 结果 |
| --- | --- |
| `Referer: https://app-api.pixiv.net/` | **200** image/jpeg（实测 431 KB – 8.30 MB 五档） |
| 无 Referer / 任意其它站 Referer（saucenao.com、ascii2d.net） | **403**（nginx） |
| 换 UA 不影响 | curl / Go / python-requests / Wget / Googlebot / Chrome 桌面与移动、带与不带 `Accept: image/*`、显式空 Referer，**无一例外 403** |

**防盗链的作用面**：`img-original` 与 `c/*/img-master` 同样生效；**裸 `/img-master/` 路径无效**（即便带正确 Referer 也 404），只有 `/img-original/` 与 `c/<尺寸>_.../img-master/...` 可解析。
**诊断约束**：无 Referer 时**恒 403**，因此**无法区分"被防盗链拦截"与"文件不存在"**——404 信号只在带 Referer 时才出现。这对错误归因有直接影响（任何"取图失败"在无 Referer 语境下都不可诊断）。

**⚠️ 归因（三轮反转后的定论，勿再改）——IQDB 成功的原因是它内置 pixiv Referer 注入，不是 IP 信誉差异。**

| 轮次 | 曾经的归因 | 为何被推翻 |
| --- | --- | --- |
| 1 | 「防盗链对所有 fetcher 一律 403 → URL 直传不可用」 | TinEye 原文「could not read that image url」看似坐实 |
| 2 | 「差异来自出口 IP 信誉（本机为香港机房 ASN，被拦；IQDB 服务器被放行）」 | **解释不通**：weserv.nl / Photon / DuckDuckGo 都是正常数据中心 IP，同样被拒，不是香港机房 |
| 3 ✅ | **IQDB 内置了 pixiv.net 的 Referer 注入特判** | 其响应正文直接写明：`Retrieving https://i.pximg.net/… <!-- Is pixiv.net, inserting referrer… -->` |

**定论**：`i.pximg.net` 的防盗链是**无差别**的（无 Referer 恒 403，换 UA 无效）；**IQDB 是唯一已知自带 pixiv Referer 注入的引擎**，所以只有它能 URL 直传成功。轮次 2 的「IP 信誉」猜测是错的，已作废。

**由此得到一条确定性判据**：某引擎能否 URL 直传，取决于**它是否为 pixiv.net 注入 Referer**，而不是取决于用户网络环境。已实测：

| 引擎 | URL 直传 | 机制 |
| --- | --- | --- |
| **IQDB** | ✅ **VIABLE**（1.25MB 与 8.30MB 均 `referrer-injected`，稳定复现） | 内置 Referer 注入 |
| **TinEye** | ❌ 实测失败（原文「could not read that image url … Try downloading … and uploading」） | 无注入；且 SPA 无服务端表单，curl 只能拿到 4247B 骨架页，**其结论必须以真实浏览器为准** |
| **Ascii2D** | ❌ 未能验证（我们的请求被 Cloudflare managed challenge 挡） | 无注入 |
| **SauceNAO** | ❌ 未能验证（Cloudflare） | 无注入；`/help` `/api_help` `/api-doc` `/doc` 全 404，15MB 上限说法**无一手证实** |

**所以「按引擎能力二分」不是保守设计，而是有明确机制支撑的必然划分**：具备 pixiv 特判的走 URL 直传，其余必须走上传。

**IQDB 的异步两段式（实现约束）**：POST 先返回约 2.7KB 的中间页（`Retrieving…` + `urlsize`/`urlstat` 占位），前端轮询后才出约 24KB 的结果页（含 `% similarity` 行）。→ **单次 POST 不足以判定成败**；取证脚本改用「是否出现 `inserting referrer` 标记」作判据（稳定复现、不依赖时序）。这也意味着：**跳浏览器给用户看是正确形态**（浏览器会自行轮询），而 App 侧若要程序化获取结果页，必须实现轮询。

**排除"存在免 Referer 的 CDN 入口"（负面结论，2026-09-27）**：
`i` / `i2` / `i3` / `i4` / `img` / `image` 六个 `.pximg.net` 域名，**无 Referer 时一律 403**（均 146B nginx 页）。→ **不存在可供第三方引擎直接拉取的免 Referer 入口**，上传路径因此是必然而非可选。

**取证方法学的自检（务必保留）**：本机代理使用 fake-ip（DNS 一律解析到 `198.18.x.x`），故"域名能解析"不构成"域名真实存在"的证据。必须用**对照请求**区分 403 的来源：

| 对照 | 结果 | 判定 |
| --- | --- | --- |
| 目标无 Referer | 403 / 146B | 真实 nginx 防盗链 |
| 目标带 Pixiv Referer | 200 / 1,252,218B | 真实图片 |
| **不存在的域名** | **000 / 0B** | 代理**不伪造 403**，故前面的 403 确来自目标站 |
| 目标上的不存在文件 + 带 Referer | 404 / 58B | 真实 404，**字节数与 403 不同** → 二者可区分 |

推论：「无 Referer 时 403 与『文件不存在』不可区分」成立；「带 Referer 时可区分」也成立。取证脚本已内建这三组对照。

### 竞品一手实况：Pixiv-Shaft（`CeuiLiSA/Pixiv-Shaft`，分支 `classic`）

`app/src/main/java/ceui/lisa/utils/ReverseImage.java`（103 行）的类注释**完整记录了失败史**，是本次调研信息量最高的一手资料：

1. **早期实现 = 我们原本的计划，且已失败**：自己用 OkHttp 发 multipart POST，把返回 HTML 塞进 WebView 的 `loadDataWithBaseURL` 回放。
   **失败原因（其 issue #733）**：SauceNAO 与 ascii2d 把上传接口放到 Cloudflare JS 质询后面，headless 请求一律拿到 `403 cf-mitigated: challenge` 的「Just a moment...」页。**换 UA、补 Rails `authenticity_token`、补全套浏览器指纹头，全是 403。** 且质询页在 `loadDataWithBaseURL` 里**没有真 origin、没有 cookie jar，永远解不开**。
2. **最终形态 = 交给 WebView 做**：类注释原文——「上传这件事只能交给 WebView 自己做——它是真浏览器，能跑质询 JS、能存 `cf_clearance`，质询解不开时也能把它如实显示给用户去点」。
3. **实际机制**：打开**引擎首页**（`uploadPageUrl` 就是 `https://saucenao.com/` / `https://ascii2d.net/`，不是上传页）→ WebView 真实 GET 拿 cookie → **由页面自己 POST**；图片预先复制进 `cache/reverse_search/` 并转成 **FileProvider 的 `content://` Uri**（注释：WebView 走 `ContentResolver`，读不到私有目录的 `file://`）→ 用户点文件选择器时该图被直接顶进去，不重挑。
4. **真机验证边界（Pixel 8 / Android 16）**：上传 POST 发得出去；拿回来的是**可交互的 Cloudflare Turnstile**（不是解不开的死页）；**但引擎侧仍可能反复下发质询——multipart 的文件体过不了质询重放**；且 WebView 的 UA 自带 `wv` 标记，本就更容易被判可疑。其结论原话：「**这属于引擎的风控范围，不是这里能修的，也不该靠伪造 UA 去绕**」。
5. **引擎只有两个**：代码里 `ReverseProvider` 仅 `SauceNao` 与 `Ascii2D`（README 宣称的 TinEye / IQDB **未实现**）。`IMAGE_MAX_SIZE = 15 * 1024 * 1024`，注释写明是 SauceNao 的限制。
6. **入口支持外部 Uri**：`searchFrom(Activity, Uri source, ...)` 支持分享进来的图（云相册 `content://` 读它会先联网下载，必须子线程否则 ANR）。

**对我们的决定性影响（架构冲突）**：Shaft 这条路**依赖 WebView**（需要真 origin + cookie jar + 能跑质询 JS），而 Pictelio 正在按 #607 **下线 WebView / Capacitor、收敛为单 Lynx 引擎**。二者直接冲突。
→ 故 D3 的上传路径在当前架构方向下**不可实施**；仅 **IQDB（URL 直传，不依赖 WebView）** 一条路与架构相容。

### 竞品一手实况（二）：Pixeval —— 唯一完整的 A 类参考实现，且**推翻 Shaft 的失败结论**

**独立实测（本会话复现，非转述）**：

| 动作 | 结果 |
| --- | --- |
| ① 带 `Referer: https://app-api.pixiv.net/` 下载真实原图 | **200 / 1,252,218B**（绕过防盗链） |
| ② **SauceNAO multipart POST**（`-F db=999 -F numres=8 -F file=@…`，桌面 Chrome UA） | **200 / 23,054B / `<title>Sauce Found?` / 相似度 52.36% · 47.41% · 47.09%** |
| ③ IQDB multipart POST（`file=` + `service[]`） | **200 / 2,741B / `Search results`**（异步中间页，需轮询） |
| ④ SauceNAO `GET /search.php?url=` | **403 Cloudflare managed challenge** → **SauceNAO 只能走上传，不能走 URL 检索** |

**结论：普通 HTTP 客户端的 multipart 上传走得通，不需要 WebView。**

**⚠️ 这直接推翻 Pixiv-Shaft 的失败结论。** 其 `ReverseImage` 注释称「自己用 OkHttp 发 multipart POST 一律 403，换 UA / 补 authenticity_token / 补全套浏览器指纹头全是 403，这条路已经彻底走不通」，遂改用 WebView。**但本会话以普通 curl 复现成功。** 最可能的差异在 **UA**：Shaft 走的是 App 自带 UA（含 `wv` 标记或 Pixiv App UA，Cloudflare 更易判可疑），而实测用桌面 Chrome UA 即通过。
**教训（写进 spec 的实施约束）**：**竞品的失败经验不可直接照搬，必须复核其请求细节（UA / 头 / 方法 / 端点），否则会继承一个本可绕开的架构限制。** 我们差点因为 Shaft 的注释而放弃 A 类、被迫依赖一个正在下线的 WebView。

**Pixeval 的 A 类实现（`PixevalMcpService.SauceNao.cs`，可抄的粒度）**：
- 入参 `illustrationId` + `page` → 走已登录 App API 拿元数据 → 取 `OriginalUrl` → **带 Referer 下载原图字节** → `MultipartFormDataContent`（字段 `file`，文件名 `img`）POST `saucenao.com/search.php`，带 `db=999`（**含 Pixiv 索引**）
- 结果解析后**回查 Pixiv 作品详情**并映射深链
- 三个增量优势：**不需要用户选文件**（吃 `illustrationId`）、`output_type=Json` 免 HTML 解析、顺带做成 MCP 工具
- 另有 C 类入口：文件（`LoadAsync(Stream)`）+ **剪贴板粘贴**（`PasteAsync`，比相册选择器更轻）

**⚠️ 一条被自证否证的推测（记录以免后人重犯）**：曾推断「720px 压缩是为避开 Cloudflare 质询死锁的必要条件」——因为 Shaft 的 1.8MB 上传触发了质询。**本会话实测否证**：

| 上传物 | 字节 | 结果 | CF 质询迹象 |
| --- | --- | --- | --- |
| 720px/q0.75 压缩图 | 64,961 | `Sauce Found?` 52.33% | 0 |
| **原图（未压缩）** | **1,252,218** | `Sauce Found?` **52.36%** | 0 |

→ **质询并非按大小必然触发**；Shaft 的失败更可能来自 UA（App 自带 UA 含 `wv` 标记）或频率/时机。**720px 压缩仍应采用**，但理由是它把上传体积压到 **1/19**（64KB vs 1.25MB，流量与耗时）、降低触发风控的**概率**、对引擎更友好——**不是"必须否则死锁"**。
**仍需处理**：质询是概率性事件，失败模式必须显式暴露（可重试提示），**不得静默失败**（测试硬约束 #3）。

**失败机制的准确表述（Shaft issue #733 补充，本会话未独立复现）**：其老实现**从不检查 `isSuccessful()`**，把质询页当「结果」塞进 WebView；修复后仍卡，因**质询通过后 Cloudflare 需重放原请求，而带 1.8MB 文件体的 multipart POST 重放不了**。
**教训**：**「引擎服务端代拉 URL」与「客户端上传」的风险是两种**——前者不可控（防盗链），后者可控（我方字节），但仍可能遇概率性质询。

**压缩参数（SauceNAOStore.swift 与 Pixeval 独立实现却一致，说明是社区调出的最优值）**：长边 >720px 时压到 720px + JPEG q0.75；小于 720 直接放行。

**社区共识的 Referer 取值（7 个独立项目一致）**：**图床用 `https://www.pixiv.net/`，App API 用 `https://app-api.pixiv.net/`**。实测 `https://www.pixiv.net` 亦 200 → 判定规则是「Referer 是否属于 pixiv 域」，而非「是否等于 app-api」。（本项目现状用 app-api，有效；采纳社区值可降低风控概率。）

**`i.pixiv.re` / `i.pixiv.nl` 图床中转**（`pixiv.cat/reverseproxy.html` 官方文档）：无 Referer 直取 **200 且 md5 与官方源一致**；响应头 `x-proxied-by: Pixiv.CatDE`、`server: cloudflare`，即它是**注入 Referer 的反代**（不存在的路径同样返回 404/403，证明纯注入不伪造）。社区 12 万+ 代码命中，是中文社区事实标准。**但 `i.pixiv.cat`（文档主推）实测 500 已失效。**
**取舍（已接受）**：**只作兜底逃生口，不进默认路径**——本项目已有 `/pixiv-img/` 原生代理（应复用它取字节），且第三方中转是单点依赖。

**IQDB 的隐藏约束**：裸发 `?url=` 只回表单页（"first-party cookies must be allowed"），**必须先让浏览器接受过 iqdb.org 的 cookie**，否则会静默降级成表单页。

**IQDB 成功取到像素的证伪测试**（排除"伪造相似结果"）：伪造 DNS 主机 → 返回 `Could not resolve host name`；伪造 pximg 路径 → 返回 `Not an image or image format not supported … Make sure … the server does not block hotlinking`。403 的 HTML 页面不可能产出感知哈希匹配。
**最可能的根因**：本机代理出口为**香港 AS63473（机房 ASN，信誉差）**，被防盗链按 IP 信誉拦；IQDB 自己的服务器反被放行。**故差异是 fetcher 依赖的，不能一概而论。**

**因此按引擎能力二分，不做全局取舍**：
- **URL 直传优先**（对已验证可用的引擎，首选 IQDB）——零图片副本、隐私面最小、零流量开销。
- **multipart 上传兜底**（对已验证 URL 直传失败的引擎，如 TinEye）——需新增取字节 + 上传能力。
- **两者的选择按引擎配置化**，不硬编码。

**上传路径的关键约束（实测数据支撑）**：IQDB 有隐藏表单字段 `MAX_FILE_SIZE=8388608`（**8 MiB**），而真实原图**经常超过**（实测 8.30 MB / 8.40 MB）→ **上传必须降级到 `c/*/img-master` 变体，不得直接投 `_p0.jpg` 原图**。SauceNAO 的 15 MB 上限说法**未获一手证实**（`/help`、`/api_help`、`/api-doc`、`/doc` 全 404）。

**逐引擎的 URL 检索能力（一手取证）**：

| 引擎 | URL 检索 | 端点 / 字段 | CSRF | 备注 |
| --- | --- | --- | --- | --- |
| **IQDB** | ✅ 已端到端验证 | `POST /`，`url=` 或 `file`，`service[]`、`forcegray` | 无 | `service[]` 默认全勾；`1`=Danbooru、`2`=Konachan、`3`=yande.re、`4`=Gelbooru、`5`=Sankaku、`11`=Zerochan、`13`=Anime-Pictures。**无 Pixiv 索引**（只能命中被转载到 booru 的作品） |
| **TinEye** | ✅ 入口存在 | SPA 提交 `FormData`，input `name='url'`、`maxlength=100000`；结果路由 `/search/:queryHash`，组件名 **`PublicSearchPage`**（公开） | — | **但 URL 直传实测失败**（见上） |
| **SauceNAO** | ✅ 入口存在 | `POST https://saucenao.com/search.php`，`multipart/form-data`，字段 `file` / `url`（`id='urlInput'`），`dbs[]` 选索引（0,2,3,5,8,9,10,11,12,15,16,18,19,20,21） | 无 | 端到端**未能验证**（我们程序化 POST 撞 Cloudflare） |
| **Ascii2D** | ✅ 入口存在 | `POST /search/uri`，字段 **`uri`** + `utf8` + **`authenticity_token`**（Rails CSRF，会话级） | **需要** | 文件上传走 `/search/file` + `file`；端到端**未能验证**（Cloudflare managed challenge，纯 HTTP 客户端清不掉） |

**架构落点（关键简化）——凡需上传，全程在 Java 侧完成，只把结果页 URL 回传 JS。**
不采用「JS 下载图片 → 上传」，那需要把图片**字节跨 Native 桥回传 JS**（大文件低效；现有 `PictelioImageService` 非 JS 桥、Gallery/Downloader 只回 uri）。
新增 lynx NativeModule，内部**自行完成**「用既有 `PixivImageLoader` 取字节（该管线天然带正确 Referer 与 UA）→ 按目标引擎降级到合适尺寸 → 组 multipart → POST → 解析结果页 URL」，**只向 JS 返回 URL 字符串**。JS 侧随即 `openExternalUrl`。
D8 的可达性探测落在同一 module 内，同样只回传状态摘要。
**取舍（已接受）**：上传逻辑在 Java 侧，新增原生代码与对应 Robolectric 单测面。

**D4 内容门控——R18 / R18G 作品禁溯源，按钮置灰 + 说明（非隐藏）；且内容门控优先级高于任何配置门控。**
溯源是把作品推到 Pixiv 之外的动作，R18G 尤其敏感，故禁。UI 落点取**置灰 + 说明**而非隐藏：隐藏会让受限用户以为功能不存在；`ActionButton` 已有现成 `disabled → opacity-50 + pointer-events-none` 态，`NovelIntro` 也在 R18 态置灰 CTA（ADR-0189），与既有立场一致。
**门控优先级链**（原型验证钉死，见「原型验证结论」）：内容门控（R18）> 总开关关（隐藏）> 零引擎（置灰）> 可用。四级互斥且**说明文案各不相同**——尤其内容门控必须压过配置门控，否则会把内容门控误报成用户的配置错误。
**取舍（已接受）**：不做"可点 + 二次确认"形态——那等于把硬门控降级成提示。

**D5 配置结构——仿 webview 图床范式；总开关 + 引擎多选。**
- **Me 页入口卡片**（照 `SettingsImage.tsx:250-290`）：图标 + 标题 + 摘要（关闭时显示默认文案；开启时显示**已启用引擎数**）+ **总开关** + `>` chevron → 导航进独立页。
- **独立页**：顶部**讲解文案** → **总开关**（页面内再一份，照 `ImageHostSettings.tsx`）→ **引擎列表**，每引擎一个 `M3Switch`（多选、可同时开多个）→ 底部**保存**按钮。
- **引擎语义 = 图床的 host 语义**（多选 checkbox）；引擎之间无"模式"单选层——不需要，因为它们产出的是多份结果而非一条择优路径。
- **总开关是"门"**：关闭时引擎区整体降透明 + 所有子控件 `disabled`（照 `ImageHostSettings.tsx` 的 `opacity-60` + `disabled` 范式）。
- **唯一有意偏离图床之处：草稿 + 保存。** 图床子项是即时生效的（`updateHost` 直接写 store）；本功能要求**点「保存」才生效**。理由：溯源要把链接交给第三方服务，多一步显式提交是合适的。

**D6 提交语义——草稿隔离；允许保存不校验；生效与否由单一纯函数运行时判定。**
- **草稿隔离**：在点「保存」之前，详情页溯源按钮**完全按已保存的旧值走**（旧值关闭即关闭）。
- **保存不校验**：「总开关开 + 零引擎」这一组合**允许保存**。保存按钮的职责是"提交配置"，不是"校验配置合法性"；在保存时拦截会让用户在字段间反复试错。
- **生效判定 = 单一纯函数**：`生效 ⟺ 总开关开 ∧ 已启用引擎数 ≥ 1`。判定逻辑集中在纯函数（对齐本上下文「推导逻辑留纯函数」惯例，如 `deriveCoverState`），可单测，不散落 UI 各处。
- **零引擎时的 UI**：按钮**置灰**（非隐藏）并给出"已开启总开关但未选择任何引擎"的说明。理由同上 D4：隐藏会让用户以为功能不存在。
- **设置页本身要如实呈现"当前草稿 ≠ 当前生效"**，否则用户会误以为点了开关就生效了。

**D7 多引擎交互——选择器 + 记忆上次选择。**
点击溯源按钮 → 弹出引擎选择器（只列**已保存生效**的引擎）→ 选择后跳转。**记忆上次选择**（设备级键，不进备份），下次直接跳。
- 排除「固定用第一个」：在用户明确勾选了多个引擎的前提下，用哪一个应当是他的选择而非我们的默认。
- 排除「依次打开多个浏览器标签」：结果互不相干，同时开多个不可用。
- 单独记上次选择而非依赖"列表顺序"，因为列表顺序会随引擎增删变化。
**单引擎特例**：已保存配置中仅一个引擎启用时，保存即自动记住该引擎（W1 断言），用户无须每次选择。

**D8 探测——独立页提供引擎可达性探测，复用既有基座。**
照图床独立页的 `probeHosts` 范式：逐个探测已勾选引擎的可达性并给结果汇总。复用 `NetDiagProbe.java`，不新写网络探测。
这条直接呼应问题一的实测差异：让"哪个引擎能到"从用户踩坑变成用户看得见。

**D9 备份归属——设备级，不进 WebDAV。**
照 `image_host_settings` 的既有先例（D6 调研结论第 6 条）。溯源配置属设备级偏好而非跨设备资产；"上次选择的引擎"同理。
**取舍（已接受）**：换设备后需重新勾选引擎。

**D10 B 入口形态——绑既有 in-flow 包裹 `<view>`，不做组件透传，不做覆层热区。**
长按某张图溯源该页，**手势绑在详情页多图/单图两分支已有的 `relative` 包裹 `<view>` 上**（`v-for` 的索引直接给出页号），而非绑在 `CoverImage`/`SkeletonImage` 组件标签上。
**理由三条**：① 改动面最小且落在仓库已验证的形状上（同款包裹 view 已承载 `@tap.stop` / `@tap`）；② 避开「误加 `defineEmits` 即静默失效」的新陷阱；③ 天然规避 ADR-0147 的 scroll-view 覆层红线。
**组件透传是等价的备选实现**（改动量相同、零组件改动），若选用必须补一条源级守卫锁死「`CoverImage`/`SkeletonImage` 不得声明 `touch*` emits」。
**残余未知**（真机二分收敛，不成立则退回 A 入口，不硬上）：真机是否派发 fallthrough 的 `onTouchstart`；`touch*` 是否与 `tap` 同命中路径。
**A 入口（动作行 → 首页图）不受此影响，始终可得。**


## 备选与否决理由（汇总）

| 备选 | 否决理由 |
| --- | --- |
| 功能名沿用「以图搜源」 | 该名指向"可传入任意图片"的范围（背景·边界澄清），本功能只吃当前作品的原图；名实不符会在用户预期与实际行为间制造缺口 |
| 支持从相册选图反查（场景 B） | 入口从作品详情页搬到相册，图片来源变外部文件，是另一交互范式与另一套权限/隐私叙事，不在本期 |
| 支持角色识别 / 图生 tags（场景 C） | 本质是图像识别而非搜源；且能否成立取决于 IQDB 对 Danbooru 索引的覆盖，属未验证依赖 |
| 弹层列出全部页供选择（作用对象 C） | 会与 `PagePickerSheet` 的"选中页"语义重叠，两个弹层争抢同一心智位置；长按入口（作用对象 B）语义更干净且已有 `useLongPress` 范式可抄 |
| 照 Shaft 做四引擎并默认全开 | 实测其四引擎对国内用户仅 Ascii2D 可达（背景·问题一）；默认全开等于让多数用户点了没反应 |
| 引擎列表只列 Ascii2D（图床式的"够用即可"） | 把可达性判断替用户做了；而该判断因用户网络环境而异（国内/海外/代理）——正是 D2 选"全列 + 全关"的动因 |
| 纳入 Google Lens | 无公开 URL 检索入口，只能上传，会单独把功能拖进"下载 → 新增原生通道回传字节 → multipart"这条成本高一量级的路，破坏 D3 的成本结构 |
| 多引擎时依次打开多个浏览器标签 | 结果互不相干，同时开多个不可用 |
| 多引擎时固定用列表第一个 | 用户已明确勾选多个，用哪一个应是其选择而非产品默认；且列表顺序会随引擎增删变化 |
| 溯源按钮在受限作品上**隐藏** | 隐藏会让受限用户误以为功能不存在；置灰 + 说明才能表达"这里有功能，但门控不让用" |
| 溯源按钮在受限作品上可点 + 二次确认 | 等于把 R18 硬门控降级为提示，与既有立场冲突 |
| 零引擎时**不保存**该组合 / 保存时拦截 | 保存按钮职责是"提交配置"而非"校验合法性"，拦截会让用户在字段间反复试错；生效判定是运行时纯函数职责 |
| 零引擎时**隐藏**溯源按钮 | 同"隐藏"一条：表达不了"你开了总开关但没选引擎"这个具体状态 |
| 照图床做子项**即时生效**（无保存按钮） | 溯源要把链接交给第三方服务，缺一次显式提交；这是本 ADR 唯一有意偏离图床范式处 |
| 引擎可达性交给用户盲试（不做探测） | 实测差异明确存在（背景·问题一），让用户能一键测出来优于逐个踩坑 |
| 图床式"模式单选"层（4 选 1） | 引擎产出的是多份结果而非一条择优路径，模式单选语义不成立；引擎语义 = 图床的 host 语义（多选） |
| 溯源配置进 WebDAV 备份 | 设备级偏好而非跨设备资产；`image_host_settings` 已是此归属的既有先例 |
| webview 端同批实现 | webview 正在下线（#607），本期 lynx-only |

## 后果

- 正面：补齐成本最低、差异感最强的竞品空白项；落地几乎全走现成能力（原图 URL 取值 / `openUrl` / `useLongPress` / `BottomSheet` + `modalStack` / `M3Switch`），无新增原生依赖即可完成 A 入口；引擎可达性探测让"哪个引擎能用"从踩坑变成可见。
- 取舍（已接受）：零配置用户装完看不到溯源（默认全关，D2）——换来的是不替用户猜可达性；多图作品溯源默认只作用于首页图（B 入口取决于 spike）；溯源配置换设备后需重勾（D9）。
- 风险：各引擎是否支持 URL 检索**未实测**，`i.pximg.net` 是否强制 Referer **未验证**（国内网络 TLS 阶段即 RST，三种请求均取不到状态码）——D3 的 URL 直传路径成立与否未定，spec 首条验收项即为此；若不成立则需新增"图片字节回传 JS"原生通道，工作量与主路径差一个量级。
- 已知不解决：国内无代理用户即使开启溯源也用不了（图都加载不出，背景·问题一）。直连已因真机证据移除（`bf32620e`），重开需换技术族，不在本 ADR 范围。
- 后续候选（不在本期）：Google Lens 纳入（需先有上传通道）、B 入口的弹层选页变体、引擎清单扩容、webview 端对等实现（但 webview 正在下线）。

## 未决 / 留给 spec 的项

- 各引擎检索 URL 的逐字模板与参数编码（须实测确证，不凭记忆）。
- IQDB 作为多库聚合器是否需要额外指定目标库参数。
- 引擎可达性探测的判定标准（HTTP 状态码 / 时延阈值）与超时值。
- 独立页讲解文案的具体内容与分节。
- 路由命名与 i18n 键位。
