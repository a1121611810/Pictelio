# 收藏/保存时打标签或归类的交互模式调研

- **日期**：2026-09-14
- **性质**：外部 UX 调研（非同类产品参照），纯资料调研，不含代码改动
- **调研方法**：WebSearch + WebFetch 查证各产品官方帮助中心 / 官方博客 / 官方支持文档，逐条标注出处 URL；查证不到的事实明确标注「未查证到」，不做推测性编造
- **调研目的**：为 Pictelio 双端（webview SolidJS / Lynx）「收藏时加标签」功能选型提供交互模式参照

> Pictelio 代码现状由 CodeGraph（`codegraph_explore`）核实，见第三节。

---

## 结论速览

| 产品 | 保存分档 | 归类方式 | 归类入口 | 可见性 | 出处等级 |
| --- | --- | --- | --- | --- | --- |
| Pinterest | 单击快存 / 长按图片选板 | Board（单选） | 保存时下拉选板、长按图片 | Secret board | 官方 |
| Instagram | 单击快存 / 长按收藏键 | Collection（单选） | 长按收藏键、保存后进 Saved 整理 | 仅自己可见 | 官方 |
| X/Twitter | 单击快存 | Bookmark 文件夹（Premium） | 未查证到官方专文 | 私密（官方确认） | 官方+缺口 |
| Instapaper | 保存时/保存后均可带 tag | Tag（多选）+ Folder（单选） | 多选批量、IFTTT 自动 | 无公开/私密之分 | 官方博客 |
| Pocket | 快存 + 保存后 tag 图标 | Tag（多选） | 保存成功屏的 tag 图标 | 无 | 已关停，官方文档下线 |
| Raindrop.io | 保存窗内完成归类 | Collection（单选）+ Tag（多选） | 保存/编辑窗口、批量、AI 建议 | 部分集合可设私密 | 官方 |
| YouTube | 点 Save 快存到「上次播放列表」 | Playlist（单选） | 底部弹出确认条上的「更改」 | 播放列表私密/不公开/公开 | 官方 |
| Goodreads | 点按钮加入书架 | Shelf（多选，含互斥 shelf） | 书封下下拉菜单 → Add Shelf | 有私密书架选项 | 官方 |
| Notion Clipper | 剪藏弹窗选目的地 | 页面/数据库（单选） | 剪藏弹窗；tag 只能剪后补 | 继承 Notion 权限 | 官方 |
| 小红书 | 单击收藏 / 收藏后建专辑 | 收藏夹/专辑 | 我 → 收藏 → 创建新专辑 | 收藏整体公开/私密开关 | 仅第三方 |

---

## 一、逐产品调研

### 1.1 Pinterest（保存到 Board）

1. **保存动作分档**：两档。快存路径：点 Pin 图进入详情，「tap the Pin image, select a board (click the drop-down if you want to save to or create a different board)」，即保存时一定落在某个板上，下拉可换板/新建板；慢速路径：移动端「another way to save a Pin to your board is to press and hold the Pin image」→ 选 Pin 图标 → 选板 → Save。**未查证到**官方帮助中「点 Save 直存到最近板 + Snackbar」的文字描述（该行为在产品中广为存在，但官方帮助中心未明确记载）。
2. **板选择器设计**：官方文档只确认「drop-down 换板 + 新建板（填 Board name → Create）」。板选择器内「最近使用置顶 / 板名搜索」**未查证到**官方文字。
3. **可见性/私密**：Pinterest 支持 Secret board（私密板），本次抓取的页面未覆盖其设置入口（官方有独立文档，属于已知功能；入口细节未在本次来源中验证）。
4. **保存后修改路径**：进入对应 board 可移动/删除 Pin；官方 organize 文档描述「Press and hold the Pin or section you want to move… Drag and drop to reorder」（help.pinterest.com/en/article/organize-pins-and-sections）。
5. **移动端约束**：长按图片即保存的替代路径降低了对小按钮的精度要求；保存动作与选板动作合并为一次流程，避免保存后二次跳转。

**出处**：
- <https://create.pinterest.com/en-ae/product-features/how-to-create-boards/>（官方）
- <https://help.pinterest.com/en/article/organize-pins-and-sections>（官方）
- <https://help.pinterest.com/en-gb/article/save-pins-with-the-pinterest-browser-button>（官方，扩展保存；未覆盖选板流程）

### 1.2 Instagram（收藏到 Collection）

1. **保存动作分档**：两档。快存：官方原文「tap save icon」；带选择保存：官方原文「tap and hold to add to a collection」——**长按收藏键直接进入合集选择**。
2. **选择器设计**：官方确认可「create new collection」内联新建。合集列表是否最近置顶/搜索：**未查证到**官方文字。
3. **可见性/私密**：官方原文「only you can see saved posts」——收藏与合集天然私密，无开关。
4. **保存后修改路径**：进个人页菜单 → Saved，可查看合集、移动内容（具体整理手势官方页未展开）。
5. **移动端约束**：长按目标就是快存按钮本身（位置固定于信息流卡片右下），单手可达；快存与归类共用同一控件、以按压时长区分，不增加新按钮。

**出处**：<https://help.instagram.com/305813406376135>（官方帮助中心）

### 1.3 X / Twitter（书签 + 书签文件夹）

1. **保存动作分档**：一档。移动端「tap to open an individual post → Tap the Bookmark icon」，保存后出现确认反馈；也可经分享菜单「Add post to Bookmarks」。官方文档未描述保存时选文件夹的路径。
2. **选择器设计**：**未查证到**。书签文件夹（Bookmark Folders）为 Premium 付费功能，官方帮助中心主文章（help.x.com/using-x/bookmarks）**完全未提及文件夹**（本次已抓取全文核实），也**未查证到**描述文件夹创建/共享的官方专文 URL。第三方普遍描述为：保存时可加入文件夹/新建文件夹，文件夹可设公开并分享链接——此部分**未查证到官方佐证，采信需谨慎**。
3. **可见性/私密**：官方原文「Bookmarks are private and are only viewable to you within your X account」。
4. **保存后修改路径**：Bookmarks 页删除单个/全部官方有描述；移动到文件夹的官方路径**未查证到**。
5. **移动端约束**：保存反馈为轻量确认，不打断时间线浏览。

**出处**：<https://help.x.com/using-x/bookmarks>（官方；文件夹部分缺口已如上标注）

### 1.4 Instapaper（Tags，2024 年新增）

1. **保存动作分档**：保存时即可带标签，官方原文「On all platforms, Instapaper supports saving articles with tags」；也有保存后多选补标：「Multi-select tagging is supported on iOS and web」（Android 当时标注 coming soon）。
2. **选择器设计**：标签完全免费；Premium 提供「search your articles by tags using the # symbol」（如 #science，可组合 #science #physics）——即标签是检索宇宙的一部分。输入时自动补全：**未查证到**官方文字。
3. **可见性/私密**：无公开/私密收藏概念（个人服务）。
4. **保存后修改路径**：官方提供迁移工具「navigate to the folder, select Edit, and click Convert to Tag」；文章可批量改 tag；归档文章保留 tag；支持 RSS/PDF/ePub 导出带标签文章。
5. **移动端约束**：多选批量打标覆盖了「当时没空打标」的补整理场景；IFTTT「save an article with multiple tags」提供了零交互自动打标通道。

**出处**：<https://blog.instapaper.com/post/765771980408569856/tags>（官方博客）、<https://www.instapaper.com/docs/organize/overview>（官方文档，页面为 JS 渲染未能抓取正文，仅确认存在 Tags/Multiselect 章节）

### 1.5 Pocket（历史参照，服务已关停）

- **关停事实（官方确认）**：getpocket.com 现公示「we've made the difficult decision to phase out Pocket」，Web/Android/iOS/macOS 应用与浏览器扩展全部停用。官方 tagging 帮助文档（原 help.getpocket.com/article/883）已随服务下线（重定向到 Mozilla 支持页但正文无法加载）。
- **历史行为（第三方来源，仅供参考）**：保存成功屏（「Saved!」）上有 tag 图标可立即打标；侧边栏按 tag 浏览。**官方原文未查证到（文档已下线）**。

**出处**：<https://getpocket.com/>（官方关停公告）；第三方历史描述：Lifehacker「Easily Tag Articles In Pocket From The iOS Share Menu」等。**结论：Pocket 只能作为「保存后轻量入口打标」的历史先例引用，不可作为现行规范。**

### 1.6 Raindrop.io（收藏打标标杆产品）

1. **保存动作分档**：保存与归类在同窗完成——保存/编辑书签时「Type tags separated by commas in the Tags field」；书签必属一个 collection，另可叠加多标签。
2. **选择器设计**：标签字段以逗号分隔输入；官方文档提及「✦ AI suggested tags based on the page content」可直接挑选；输入时对已有标签的自动补全**未查证到**官方文字（产品实际具备 type-ahead，属公认行为）。
3. **可见性/私密**：集合可设私密（本次抓取的 tags 页未展开，独立文档存在）。
4. **保存后修改路径**：多入口编辑——Web/桌面右键 → Edit，iOS 长按 → Edit，Android ⋯ 图标 → Edit；批量：Web 勾选多选框、iOS Select 模式、Android 长按进批量 → Add tags / Remove tags；标签本体可全局改名/删除（「the change applies to every bookmark that uses it」）；还有「Without tags」过滤器专门找漏标内容。
5. **移动端约束**：编辑入口按平台惯例分布（长按/溢出菜单），批量模式提供了低频整理的专用形态。

**出处**：<https://help.raindrop.io/tags>（官方帮助）

### 1.7 Eagle（设计素材管理，简述）

Eagle 为桌面端设计素材库（非移动端），以「文件夹（单选）+ 标签（多选）+ 智能文件夹」组织，保存（拖入/剪藏/浏览器扩展）时可同时选文件夹与标签。**本次未查证到官方在线帮助文档页面**，此处仅作产品类型参照，不作为移动端依据。

### 1.8 YouTube（稍后观看 / 播放列表）

1. **保存动作分档**：官方 Android 文档原文「Below the video, tap More Save to automatically save it to the **last playlist you've saved to**, or to your Watch Later playlist」——**单击 Save 直存到上次使用的播放列表**，零决策。
2. **确认与更改（关键交互）**：「A message will pop up at the bottom of your screen confirming which playlist the video was added to」+「To change where your video is saved, **tap Change on the pop-up**」——保存后底部弹出确认条，其上带「更改」按钮进入播放列表选择器；选择器内「Tap New playlist → Enter a name」内联新建。
3. **可见性/私密**：新建播放列表时「Use the box to select your playlist's privacy setting. If it's private, only you can view the playlist」——私密选项放在**新建播放列表表单**内（创建时一次性决定），而非每次保存时。
4. **保存后修改路径**：Library → Playlists 中管理；从播放列表移除视频官方有独立说明（answer/56101）。
5. **移动端约束**：确认条出现在屏幕底部（拇指区），「更改」是保存失败兜底而非必经步骤——保存零摩擦，纠错有出口。

**出处**：<https://support.google.com/youtube/answer/57792?hl=en&co=GENIE.Platform%3DAndroid>（官方）、<https://support.google.com/youtube/answer/56101>（官方，Watch Later）

### 1.9 Goodreads（书架）

1. **保存动作分档**：点 Want to Read 即入默认互斥书架；官方博客描述加自定义书架路径「click on the drop-down arrow right underneath the book cover image. Then scroll down until you see "Add Shelf"」。
2. **选择器设计**：书架可自建（「From My Books, click Add shelf under Bookshelves. Type your shelf or tag name and click add」，官方帮助 000001085）；一本书可挂多本书架（非互斥），但内置三书架（Want to Read / Currently Reading / Read）与用户勾选 exclusive 的书架互斥——**互斥性是归类语义的显式建模**。
3. **可见性/私密**：官方帮助中心有独立文章描述书架可见性控制（本次未抓取到该专文正文，入口细节未验证）。
4. **保存后修改路径**：My Books 内随时增删书架；支持多书架联选查看。
5. **移动端约束**：下拉菜单藏于书封下方，属于低频深度操作；高频动作（Want to Read）永远是一键。

**出处**：<https://help.goodreads.com/s/article/000001085>（官方）、<https://www.goodreads.com/blog/show/1399-goodreads-hack-how-to-create-custom-bookshelves>（官方博客）

### 1.10 Notion Web Clipper

1. **保存动作分档**：一档，但保存必须先做目的地决策——弹窗「asking which workspace and Notion page (or database) you want to add the web page into」，可搜索现有页面或新建，可改标题，然后「Press Save page」。移动端走系统分享面板 → Notion → 选工作区/页面 → Save。
2. **选择器设计**：目的地搜索 + 内联新建；**保存时不支持打标签**，官方 FAQ 原文「you'll need to open the clipped page in a Notion database to add and edit any tags or other database properties」——标签是保存后的二段式。
3. **可见性/私密**：继承 Notion 工作区权限，剪藏器内无独立开关。
4. **保存后修改路径**：打开剪藏页，补 tags/properties/comments。
5. **移动端约束**：移动端依赖分享面板标准入口，自绘 UI 最小化。

**出处**：<https://www.notion.com/help/web-clipper>（官方）

### 1.11 小红书（收藏夹，中文产品参照）

- **官方公开帮助文档：未查证到**（站内帮助需 App 内访问，无公开 URL）。以下为第三方来源，采信需谨慎：
  - 收藏整体可见性：设置 → 隐私设置 → 「我的收藏」→「公开我的收藏」开关（默认公开可切私密）。
  - 创建归类：我 → 收藏 → 「创建新专辑/合集」；支持公开专辑与私密专辑，后期还出现「共享收藏夹」（多人共建）。
  - 整理路径：收藏夹 → 管理 → 添加/移动笔记。
- **对设计有参考价值的点**：小红书把「收藏夹」做成创作型对象（有名字、封面、公开/私密属性、可分享），归类是**内容运营**而非个人整理——与 Pixiv 类内容社区的心智接近。

**出处**（第三方，非官方）：
- <http://mobile.sosol.com.cn/mobile/2023/0627/70243.html>
- <https://jingyan.baidu.com/article/375c8e196b4cf265f2a2299e.html>
- <https://www.woshipm.com/pd/5889824.html>（共享收藏夹分析）

---

## 二、模式提炼

从上述产品中提炼出 5 种可迁移模式：

### P1 快存 + 底部确认条上的「更改/编辑」（Save-first, fix-later）

- **形态**：单击即完成保存（零决策），随后在屏幕底部弹出轻量确认条，确认条上附「更改/加标签」按钮，数秒后自动消失。代表：YouTube（"tap Change on the pop-up"）、Instagram/Pocket 的保存反馈。
- **适用场景**：高频、心流型浏览（Feed 滚动）中的收藏。保存成功率优先，归类率次之。
- **代价**：打标率天然偏低（多数用户不会点更改）；确认条存在期间可能与后续滑动/操作产生层级冲突；需要处理确认条的自动消失与误触。
- **关键实现细节**：确认条必须在底部（拇指区）、存续期 3-5 秒、出现时不得打断滚动。

### P2 长按 = 慢速/带选择保存（Deliberate path on long-press）

- **形态**：快存与深度保存共用同一控件，以按压时长分档。代表：Instagram（「tap and hold to add to a collection」）、Pinterest（移动端长按 Pin 图选板保存）。
- **适用场景**：屏幕空间紧张、不希望为低频深度操作增加常驻按钮的场景；与「一键快存」并存构成双档语义。
- **代价**：长按不可发现（需教学/首次引导）；与列表长按手势（上下文菜单）可能冲突；误触发长按需要触觉反馈确认。
- **注意**：若长按已有既定语义（如 Pictelio 现在的「长按 = 私密收藏」），变更语义需迁移评估（见第三节）。

### P3 保存即弹目的地选择器（Picker on save）

- **形态**：保存动作必然伴随一次选择——Pinterest 点 Save 后经下拉/弹层选板，Raindrop 保存窗内完成 collection + tags，Notion 剪藏先选页面。保存与归类合并为单次流程。
- **适用场景**：归类是保存的核心价值（素材库、研究收藏）；或目标对象必须显式指定（无默认目的地）时。
- **代价**：每次保存多一步交互，高频场景下显著增加摩擦；弹层与 Feed 滚动的心流冲突。**非高频浏览型产品的首选。**

### P4 标签宇宙自动补全 + 最近使用优先（Tag universe & recency）

- **形态**：标签输入源来自用户已有标签集合（Raindrop 的 Tags 字段、Instapaper 的 #tag 检索宇宙、Goodreads 的既有书架名），辅以最近使用置顶，允许内联新建。Raindrop 另提供 AI 建议 tag 作为输入冷启动。
- **适用场景**：多对多的自由标签体系（tag 而非 folder）。标签宇宙控制了词汇漂移（避免「插画/illust/插画收藏」三写法），最近使用覆盖了「此刻在批量收某主题」的高频意图。
- **代价**：需要维护「用户已有标签宇宙」的索引（Pixiv 侧可从已收藏作品的 bookmark tags 聚合）；排序策略（频次 vs 最近）需调优；冷启动（新用户无宇宙）时需要内容建议兜底（Pixiv 作品自带标签可作为种子）。

### P5 批量补标 + 未标记过滤（Bulk tagging & untagged filter）

- **形态**：在收藏列表内多选 → 批量加/删标签（Raindrop、Instapaper multiselect），并提供「Without tags」过滤器定位漏标内容。
- **适用场景**：承认「保存时打标率低」的现实，把整理变成独立的低频深度任务，而不是强行前置到保存瞬间。
- **代价**：需要独立的管理界面投入；属于兜底而非主路径，优先级可后置。

---

## 三、对 Pictelio 的适配建议

### 3.0 现状盘点（CodeGraph 核实，2026-09-14）

- **webview 端（pictelio-app）**：
  - Feed 卡片：`ImageCard`（被 `LazyImageCard`/`SearchResults`/`VirtualFeed` 复用）经 `useCardInteractions` 调 `toggleBookmark`，心形按钮带 `HeartBurstEffect` 爱心爆发动效（`HeartBurstEffect.tsx` 已尊重 `prefers-reduced-motion`）；`GridCard`/`NovelCard`/`NovelTextListCard` 同样内嵌爆发动效。Feed 卡片上**无**长按归类手势（本次核实范围内未见）。
  - 详情页：`IllustDetail.tsx:271` 的 `toggleBookmark(privateBookmark)` —— **单击 = 公开收藏，长按 500ms = 私密收藏**（`onBookmarkPointerDown/Up` 实现定时器）。
  - API 层：`packages/app/src/api/illust.ts:336` `addBookmark(illustId, restrict)` 仅传 `illust_id` + `restrict`，**未传 tags**；`novel.ts:166` 的小说 `addBookmark` 同样无 tags。
- **Lynx 端（pictelio-app-lynx）**：`packages/app-lynx/src/api/illust.ts:75` `addBookmark(illustId)` 硬编码 `restrict: "public"`，**连私密收藏都尚未支持**。
- **Pixiv API 侧**：Pixiv App API 的 `/v2/illust/bookmark/add` 端点支持随收藏提交 tags（空格分隔，上限约 10 个）与 `restrict`（public/private）——这是业界公知的 App API 行为，具体参数名接入时应以实测为准（本报告未查证到 Pixiv 官方文档，该 API 无官方公开文档）。

### 3.1 约束条件

1. **双端一致**：交互模型必须在 webview（SolidJS，Fluent 2 规范）与 Lynx（Material 3 语义色板）同时可实现；Lynx 端当前能力落后（无 restrict），需先补齐。
2. **单手移动场景**：所有新增触控目标 ≥ 40×40px；面板/确认条落底部拇指区。
3. **保留心形爆发动效**：这是现有收藏路径的情感化资产，不能因加标签而变成「每次收藏都被面板打断」。
4. **架构硬约束**：先渲染后加载（面板打开即渲染骨架，标签宇宙异步注入）；竞态防护（面板内保存请求带 generation-gate）。

### 3.2 推荐交互组合

**主推组合：「快存 + Toast 编辑」（P1）为主路径，「长按 = 收藏面板」（P2）为深度路径**

```
单击心形（不变）──→ 收藏成功 + 爆发动效（不变）
                     └→ 底部 Toast：「已收藏到「未分类」  [＋标签]」（3.5s 自动消失）
长按心形（语义升级）─→ 底部抽屉「收藏面板」：
                        · 公开/私密切换（SegControl，默认公开）
                        · 标签区：最近使用 chips（横滑，点选即选）
                        · 输入框：自动补全（来自我的标签宇宙 + 该作品自身 tags 种子）
                        · 内联新建（输入回车即建）
                        · 主按钮「收藏」（再次单击已收藏的心形 = 取消，不变）
```

**理由**：

1. **与被验证的产品先例一一对应**：单击零决策快存 + 底部确认条「更改」是 YouTube 已上线的官方模式（P1）；长按同控件进入归类是 Instagram 官方模式（P2）。两者都不引入新常驻按钮，Feed 卡片视觉零改动。
2. **保护现有心智与动效资产**：单击路径完全不变，爱心爆发照常触发；标签变成「想加的人才加」，不打断心流。避免 Pinterest 式「保存必选板」（P3）——对高频刷 Feed 的插画浏览场景摩擦过高（P3 的代价一节）。
3. **长按语义的迁移处理**：详情页现有「长按 = 私密收藏」是已发布行为。升级后「长按 = 面板（含公开/私密切换）」覆盖并扩展了原意图——原长按意图（私密收藏）在新面板里是「切到私密 + 点收藏」两步，存在退化。**两个缓解选项**：(a) 面板记住上次公开/私密选择，连续私密收藏时默认私密，等于一步；(b) 过渡期在长按面板首次弹出时给一次性引导文案。不建议保留两处长按入口（同一控件不能有两种长按语义）。
4. **标签宇宙的种子来源现成**：Pixiv 作品自带标签（`PixivIllustTag`）可作为新用户冷启动的建议标签；用户历史收藏的 bookmark tags 聚合为个人宇宙（P4），最近使用置顶。标签上限跟随 Pixiv 侧约束（≤10）并在 UI 上提示。
5. **双端实现成本可控**：底部抽屉 + chips + 单输入框是两端组件库都有对应物的形态（webview 端遵循 Fluent tokens 的底部面板，类似现有 `ReportSheet`/`SeriesSheet` 的浮层模式；Lynx 端用 M3 bottom sheet）。分两期：**第一期**只做 Toast「＋标签」入口 + 面板 MVP（公开/私密 + 最近标签）；**第二期**补自动补全排序、Lynx restrict 对齐、批量补标（P5，对应收藏列表页）。

**备选组合（供对照，不主推）**：「长按维持私密直存（现状不动）+ Feed 卡片新增独立的标签按钮/详情页加标签」——优点是零语义迁移风险；缺点是 Feed 上多一个常驻控件（违反「不增加新按钮」的简洁性），且标签入口离保存动作太远，打标率不会高于 Toast 模式。仅当用户调研表明「长按改语义」阻力显著时采用。

### 3.3 移动端细节清单（两个组合通用）

- Toast 与面板都放屏幕底部 1/3（拇指区）；触控目标 ≥ 40×40。
- Toast「＋标签」点击后立即升级为面板（Toast 消失，面板接管），避免两层 UI 叠加。
- 误触恢复：收藏成功 Toast 内提供「撤销」（等价于 `deleteBookmark`），对齐「保存零摩擦必须有纠错出口」的 YouTube 模式。
- 面板打开 = 先渲染骨架（标签 chips 区骨架屏），标签宇宙异步加载，遵守「先渲染后加载」硬约束。
- 动效遵循 Fluent 曲线/时长 token（面板 300ms gentle）；`prefers-reduced-motion` 下爆发动效已被 `HeartBurstEffect` 正确跳过，新增面板动效需同样处理。
- 双端契约（标签宇宙数据结构、面板配置）若跨端共享，测试 mock 须来自真实 Pixiv 响应样例（遵循仓库测试硬约束第 2 条）。

---

## 四、出处清单

**官方来源**：

1. Pinterest 创建板与保存流程：<https://create.pinterest.com/en-ae/product-features/how-to-create-boards/>
2. Pinterest 移动 Pin：<https://help.pinterest.com/en/article/organize-pins-and-sections>
3. Pinterest 浏览器按钮：<https://help.pinterest.com/en-gb/article/save-pins-with-the-pinterest-browser-button>
4. Instagram 收藏与合集：<https://help.instagram.com/305813406376135>
5. X 书签（私密性、保存流程）：<https://help.x.com/using-x/bookmarks>
6. Instapaper Tags 发布公告：<https://blog.instapaper.com/post/765771980408569856/tags>
7. Instapaper 整理文档（目录页）：<https://www.instapaper.com/docs/organize/overview>
8. Raindrop.io 标签文档：<https://help.raindrop.io/tags>
9. YouTube 播放列表（Android）：<https://support.google.com/youtube/answer/57792?hl=en&co=GENIE.Platform%3DAndroid>
10. YouTube 稍后观看：<https://support.google.com/youtube/answer/56101>
11. Goodreads 书架管理：<https://help.goodreads.com/s/article/000001085>
12. Goodreads 自建书架博客：<https://www.goodreads.com/blog/show/1399-goodreads-hack-how-to-create-custom-bookshelves>
13. Notion Web Clipper：<https://www.notion.com/help/web-clipper>
14. Pocket 关停公告：<https://getpocket.com/>

**第三方来源（已标注，采信需谨慎）**：

15. 小红书收藏可见性（手搜网）：<http://mobile.sosol.com.cn/mobile/2023/0627/70243.html>
16. 小红书创建专辑（百度经验）：<https://jingyan.baidu.com/article/375c8e196b4cf265f2a2299e.html>
17. 小红书共享收藏夹分析（人人都是产品经理）：<https://www.woshipm.com/pd/5889824.html>
18. Pocket 历史打标行为（Lifehacker）：<https://lifehacker.com/easily-tag-articles-in-pocket-from-the-ios-share-menu-1655490885>

**查证不到、报告中已明确标注「未查证到」的项**：

- Pinterest 板选择器「最近使用置顶 / 板内搜索」的官方文字描述
- X 书签文件夹的官方帮助专文（Premium 功能，主帮助文章未覆盖）
- Pocket 官方 tagging 文档（随服务关停已下线）
- Raindrop.io 标签输入自动补全的官方文字描述
- 小红书官方公开帮助文档
- Eagle 官方在线帮助文档
- Pixiv App API bookmark/add 的 tags 参数官方文档（该 API 无官方公开文档，接入时需实测验证）
