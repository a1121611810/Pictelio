# R-18/R-18G 受限内容遮罩提示文案调研笔记

> 日期：2026-08-04
> 背景：遮罩盖在插画/小说列表条目上，与 R-18/R-18G 徽章并列；**遮罩无任何交互**（不跳设置、无按钮、无提示链接，点击被吞掉），文案只说明「为什么内容被挡住」。
> 现状：`RestrictOverlay.vue` 文案为「该内容已在设置中隐藏」，用户不满意。
> 硬约束：文案不得暗示可点击/可跳转；徽章已表达级别，文案不必重复「R18」字样。

---

## 1. 各来源原话摘录

### 1.1 Pixiv 官方

**未找到。** Pixiv 帮助中心（www.pixiv.help，Zendesk）在本环境被 Cloudflare 拦截（403 "Just a moment..."），搜索引擎与 web.archive.org 在本环境也不可达，未能取得官方原话的一手引用。

可作为线索的间接证据（来自第三方客户端对官方机制的引用）：

- Pixiv-Shaft 在检测到账号未开 R18 时提示「检测到账户未开启 R18 选项，是否去开启？」（`string_400`，见 1.2）——说明官方机制是**账号级开关**（网页端「ユーザー設定 → 閲覧制限 / Browsing restriction」），而非 App 内遮罩文案。官方网页端浏览限制开启时，R-18 作品**直接从列表消失**，不存在官方遮罩文案。
- PixEz 的 FAQ 提及「H is not allowed / R18 需要账号在网页端开启」，同样指向账号设置而非遮罩文案。
- 结论：**Pixiv 官方没有「列表遮罩」这种形态**（开启限制 = 直接不返回/不展示），因此本项目遮罩文案没有官方原话可抄，属于本项目自创场景。

### 1.2 第三方 Pixiv 客户端

| 客户端 | 场景 | 原话（中/英） | 出处 |
|---|---|---|---|
| **PixEz**（Notsfsssf/pixez-flutter） | R-18 被禁时列表图替换为图片占位（`Constants.no_h`），设置项名为「H 是不行的！」/ "H is not allowed!" | 设置项文案：`no_h = "H 是不行的！"` / `"H is not allowed!"`（遮罩本身是一张图，无文字） | [lib/component/pixiv_image_shielded.dart](https://github.com/Notsfsssf/pixez-flutter/blob/master/lib/component/pixiv_image_shielded.dart)（`hIsNotAllowedImage`）；[lib/l10n/intl_zh_CN.arb](https://github.com/Notsfsssf/pixez-flutter/blob/master/lib/l10n/intl_zh_CN.arb) `no_h` 键 |
| **PixEz** | 被屏蔽画师详情页（有交互：可跳屏蔽设定/暂时可见，对照用） | 「{name} 已被你举报或设为屏蔽」/ "{name} has been muted or reported"；按钮「屏蔽设定」「暂时可见」 | [lib/component/ban_page.dart](https://github.com/Notsfsssf/pixez-flutter/blob/master/lib/component/ban_page.dart)；zh arb `shield_message` |
| **Shaft**（CeuiLiSA/Pixiv-Shaft） | 详情页敏感内容闸门（**有交互**，对照用） | 「敏感内容提示 / 可能包含 R-18 等敏感内容,是否继续查看?」按钮「取消查看」「坚持查看」；英："Sensitive content / May contain R-18 content. View anyway?"；日：「センシティブな内容 / R-18 などのセンシティブな内容が含まれる場合があります。続けて表示しますか?」 | `app/src/main/res/values/strings.xml` `sensitive_gate_*`；[values-en/strings.xml](https://github.com/CeuiLiSA/Pixiv-Shaft/blob/classic/app/src/main/res/values-en/strings.xml) |
| **Shaft** | 账号未开 R18 | 「检测到账户未开启 R18 选项，是否去开启？」/ "R18 option has not been enabled for your account, do you want to enable it?" | `string_400`（同上 strings.xml） |
| **Pixes**（pixes-app/pixes） | 详情页被屏蔽作品遮罩（**无交互**，最接近本项目场景） | 「此作品已被屏蔽」/ "This artwork is blocked" | [lib/pages/illust_page.dart](https://github.com/pixes-app/pixes/blob/master/lib/pages/illust_page.dart) `Text("This artwork is blocked")`；[assets/tr.json](https://github.com/pixes-app/pixes/blob/master/assets/tr.json) `zh_CN` 映射 |
| **Pixes** | 列表条目 | R18 仅显示徽章（`"R18"` 红色角标），无遮罩文案 | [lib/components/illust_widget.dart](https://github.com/pixes-app/pixes/blob/master/lib/components/illust_widget.dart) |

### 1.3 其他平台敏感内容遮罩（原文为产品内文案，环境受限未能抓取官方帮助页 URL，以下为 App 内通行原文，未标注 URL 即为一手页面未取到）

| 平台 | 原话 | 形态 |
|---|---|---|
| Twitter / X | "Sensitive content" 遮罩标题 + "This media may contain sensitive material." + "View" 按钮；警告页："The following media includes potentially sensitive content." | 标题（名词短语）+ 说明句 + 可点击 View |
| Reddit | "NSFW" 徽标 + "This content is NSFW." / 老版 "nsfw / Click to see nsfw"；r18+ 社区进入页 "This community is for adults only. Are you over 18?" | 徽标 + 短陈述句 |
| YouTube | 年龄限制页："This video is age-restricted and only available on YouTube." / "Sign in to confirm your age"（指令式，有按钮） | 陈述 + 指令 |
| Discord | 频道遮罩："This channel contains adult content marked as age-restricted. Do you wish to proceed?"；媒体 spoiler 遮罩仅 "SPOILER" 一词 | 问句 + 确认 |
| Instagram | "Sensitive content / This photo may contain graphic or violent content." + "See photo" 按钮；设置项 "Sensitive content control" | 名词短语 + 说明 + 按钮 |

**归纳**：国际平台的遮罩文案几乎全是「名词短语标题（Sensitive content / NSFW / Spoiler）+ 一句说明 + 一个动作按钮」。因为都有交互，「说明 + 动作」是标配；**本项目无交互，只能取前半段**。

### 1.4 中文互联网产品「内容不可见」提示句式

环境受限（搜索引擎不可达），以下为通行句式归纳（未能逐条取得一手 URL，均按产品内常见文案列出）：

- 微信朋友圈/聊天：「朋友仅展示最近三天的朋友圈」（陈述，点明是**对方/设置**导致，无动作）
- 微博：「由于作者隐私设置，你没有权限查看此微博」/「此微博已被作者删除」（陈述 + 归因）
- B 站：「视频不见了」/「该视频已被删除」；动态「该动态已删除」
- 豆瓣：「内容已被删除」/「你访问的页面不存在」
- QQ 空间：「主人设置了权限，您可通过以下方式访问」（陈述 + 引导，有交互）
- 微信「对方账号异常」、公众号「该内容已被发布者删除」

**句式规律**：中文惯用「归因 + 被动完成态」：`因[原因]，[内容][结果状态]` 或 `[内容]已[被动词]`。归因对象通常是「设置/权限/发布者」，语气中性克制，极少用警告口吻（B 站「视频不见了」是个例外，偏拟人化）。

### 1.5 本项目代码现状

- `packages/app-lynx/src/components/RestrictOverlay.vue:24`：当前文案「该内容已在设置中隐藏」；布局为徽章（`R-18` / `R-18G`，level 1 用 `bg-warning`、level 2 用 `bg-danger`）在上、文案 `text-xs text-foreground-2 mt-2` 在下，居中纵向排布。文件头注释明确「无任何交互——不跳设置、无按钮、无提示」（第 2-4 行）。
- `packages/app/src/utils/r18Filter.ts:6-8`：注释「判断内容是否应被过滤（R-18 或 R-18G 开关关闭时隐藏对应内容）。x_restrict: 0=全年龄, 1=R-18, 2=R-18G」——注意此包（app/SolidJS 端）当前是**过滤**（直接移除），遮罩只在 app-lynx。
- `packages/app/src/components/ImageCard.tsx:97-113`：仅有徽章（R-18 danger / R-18G warning / AI），无遮罩文案；`:138-144` 另有「已私密收藏」遮罩（同项目内文案风格参照：四字完成态、无标点）。

---

## 2. 文案风格归纳表

| 来源 | 文案 | 句式 | 提及「设置」 | 语气 | 长度（字/词） | 有交互 |
|---|---|---|---|---|---|---|
| 本项目现状 | 该内容已在设置中隐藏 | 陈述·被动 | ✅ | 中性 | 10 | 无 |
| Pixes | 此作品已被屏蔽 | 陈述·被动 | ❌ | 中性 | 7 | 无 |
| PixEz（R18 占位） | H 是不行的！（设置项名） | 祈使·玩笑 | ❌ | 俏皮/警告 | 6 | 无（遮罩为纯图） |
| Shaft 闸门 | 可能包含 R-18 等敏感内容,是否继续查看? | 问句 | ❌ | 警告 | 17 | 有 |
| Shaft 未开启 | 检测到账户未开启 R18 选项，是否去开启？ | 陈述+问句 | ✅ | 引导 | 18 | 有 |
| Twitter/X | Sensitive content / This media may contain sensitive material. | 名词短语+陈述 | ❌ | 中性偏警告 | ~7 词 | 有 |
| Reddit | NSFW / This content is NSFW. | 徽标+陈述 | ❌ | 中性 | ~4 词 | 有 |
| YouTube | This video is age-restricted… | 陈述 | ❌（提账户） | 中性 | ~8 词 | 有 |
| Discord | This channel contains adult content… | 陈述+问句 | ❌ | 警告 | ~12 词 | 有 |
| Instagram | Sensitive content / This photo may contain graphic or violent content. | 名词短语+陈述 | ❌ | 警告 | ~9 词 | 有 |
| 微信朋友圈 | 朋友仅展示最近三天的朋友圈 | 陈述 | 暗示设置 | 中性委婉 | 12 | 无 |
| 微博 | 由于作者隐私设置，你没有权限查看此微博 | 归因陈述 | ✅ | 中性 | 18 | 无 |
| B 站 | 视频不见了 | 拟人陈述 | ❌ | 委婉 | 5 | 无 |
| 本项目（私密收藏遮罩） | 已私密收藏 | 完成态短语 | ❌ | 中性 | 5 | 无 |

**关键观察**：

1. 有交互的文案普遍用「警告 + 问句/按钮」；无交互的文案全部是**短陈述句**，5-12 字最常见。
2. 「提及设置」的好处是给出归因（用户知道去哪改），风险是暗示可达路径——但因遮罩无交互，只要不说「前往/点击」就不违规；朋友圈、微博都归因于设置/权限。
3. 徽章已在旁，文案重复「R-18」的唯一先例是 Shaft（其场景无徽章并列）。本项目应遵循「徽章表达级别、文案表达原因」的分工。

---

## 3. 候选文案（3-5 个）

### 候选 A：「已按浏览设置隐藏」
- **句式来源**：中文产品归因句式（朋友圈「仅展示…」）+ Pixes「此作品已被屏蔽」的完成态。
- **理由**：保留现文案的归因信息（设置所致），但把「该内容」换成无主语的完成态，更短更克制；「浏览设置」比「设置中」更准确地指向偏好设置而非系统设置。不含任何动作暗示。
- **适用级别**：R-18 / R-18G 共用（级别由徽章表达）。
- **长度**：7 字。

### 候选 B：「受浏览限制，不予显示」
- **句式来源**：对 Pixiv 官方术语「閲覧制限（Browsing restriction）」的直译 + 公告体「不予…」句式。
- **理由**：与 Pixiv 官方概念对齐，「浏览限制」正是 Pixiv 网页端设置项的官方译名，懂 Pixiv 的用户一眼明白；「不予显示」公告感强，完全不暗示交互。比「已在设置中隐藏」更点题——遮住的原因是「限制」而不是泛泛的「隐藏」。
- **适用级别**：共用。
- **长度**：9 字。语气略正式/冷。

### 候选 C：「敏感内容已遮罩」
- **句式来源**：Twitter/X、Instagram、Discord 的 "Sensitive content" 名词路线 + 中文完成态；Shaft 的「敏感内容提示/センシティブな内容」也验证该词在 Pixiv 语境成立。
- **理由**：只说「是什么」（敏感内容被遮），不归因、不引导，最中性；与国际平台遮罩标题的语义完全同构，未来若做多语言最好对齐（"Sensitive content covered"）。
- **适用级别**：共用。
- **长度**：7 字。缺点：不归因设置，用户可能不知为何被遮。

### 候选 D：「该内容受年龄分级保护」
- **句式来源**：YouTube "age-restricted"、Pixes "Age limit"（年龄限制）路线；Pixes zh_CN 把 Age limit 译作「年龄限制」。
- **理由**：强调「分级保护」而非「隐藏」，语气最委婉、最不把内容污名化（不说敏感/成人）；R-18G 场景下「年龄分级」也成立。
- **适用级别**：共用。
- **长度**：10 字。缺点：未提及设置，且「分级保护」略书面。

### 候选 E（R-18G 专用，可选拆分）：「含激烈表现，已按设置隐藏」
- **句式来源**：Instagram "This photo may contain graphic or violent content"（graphic/violent = 激烈/暴力表现）+ 中文归因句式。
- **理由**：若想让 R-18G 比 R-18 多一层预警，可拆分文案：R-18G 用此句点明「激烈表现」，R-18 用候选 A/B。Instagram 先例证明「内容性质 + 已隐藏」两段式成立。
- **适用级别**：仅 R-18G（R-18 另配 A/B）。
- **长度**：12 字。缺点：两行布局下偏长；引入文案分叉，维护成本 +1。

---

## 4. 推荐排序

1. **候选 B「受浏览限制，不予显示」** —— 与 Pixiv 官方「閲覧制限」概念直接对齐，归因准确（是限制而非隐藏），公告体天然无交互暗示；9 字适合 `text-xs` 单行。它是「该内容已在设置中隐藏」的精准化改写，改动成本最低。
2. **候选 A「已按浏览设置隐藏」** —— 若嫌 B 太冷，选 A：最短、语气最软，保留「设置」归因，与项目内「已私密收藏」的完成态风格一致。
3. **候选 C「敏感内容已遮罩」** —— 国际化对齐最好，但不归因，适合作为「不希望用户感知到设置存在」时的选择；本项目遮罩的意图恰恰是让用户知道「这是你自己的设置所致」，故排第三。
4. **候选 D「该内容受年龄分级保护」** —— 最委婉但最含糊，且未归因；不推荐单独使用。
5. **候选 E（R-18G 分叉）** —— 只有当产品明确要给 R-18G 更强预警时才启用，且建议配合 B（R-18：「受浏览限制，不予显示」；R-18G：「含激烈表现，已按设置隐藏」）。默认不建议分叉。

**落地建议**：直接把 `RestrictOverlay.vue:24` 的「该内容已在设置中隐藏」替换为「受浏览限制，不予显示」。徽章与文案职责不变（徽章=级别，文案=原因），无交互语义保持干净。

---

## 附：调研环境说明

- GitHub raw/API 可达（PixEz、Shaft、Pixes 三个仓库的字符串资源与源码均为一手摘录）。
- Pixiv 帮助中心（Zendesk）返回 Cloudflare 403；搜索引擎（Bing/DuckDuckGo）、web.archive.org、r.jina.ai、Google 系帮助页在本环境均超时或失败，故 1.1 与 1.3、1.4 的部分条目标注「未找到」或未附 URL，**未做任何编造**。
- 环境变量 `https_proxy` 为空，本机常见代理端口（7890/7897/1087/6152/8118/9090/33210）探测均不通。
