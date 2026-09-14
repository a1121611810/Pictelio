# 调研：同类第三方 Pixiv 客户端「收藏插画时加标签」实现方式

> 调研日期：2026-09-14
> 调研方式：直接拉取各项目 GitHub 源码（raw.githubusercontent.com / 浅克隆）逐行核验，官方行为经 pixiv.help 帮助中心与官方公告交叉查证。所有结论均标注可核验出处；查不到的明确标注「未查证到」。
> 关联文档：`docs/research/bookmark-tags-ux-patterns.md`（UX 交互向调研）；本报告侧重交互形态 + App API 契约核验，为后续实现直接供料。

---

## 0. 一览表

| 项目 | 平台/技术 | 单击心形 | 带标签收藏入口 | 已收藏可改标签 | 标签来源 | 数量上限 | restrict 与标签同选 | add 端点 | tags 序列化 |
|---|---|---|---|---|---|---|---|---|---|
| **Pixez** | Android/Flutter ★12.8k | 快速收藏（可配置默认私密 + 自动附加作品标签） | **长按心形** → 底部弹层（TagForIllustPage） | 是（长按重开面板，直接重发 add） | `bookmark/detail` 返回的作品标签（含 `is_registered` 勾选态）+ 手动新建 | 前端未限制 | 是（Switch 开关，从 detail 恢复） | `POST /v2/illust/bookmark/add` | 空格 join → 单字段 `tags[]` |
| **Pixeval** | Win/Avalonia C# ★3.1k | 快速收藏/取消（public，无标签） | 心形**右键（上下文菜单）** → TagSelector Flyout | 是（重开 Flyout，预勾选已注册标签） | 未收藏：`user/bookmark-tags/illust`（public+private 两份合并）；已收藏：`bookmark/detail` 预勾选 + 新建项 | **硬编码 10 个**（超出自动移除最早勾选） | 是（IsPrivate 开关，已收藏时从 detail 恢复） | `POST /v2/illust/bookmark/add` | `string.Join(' ', tags)` → 单字段 `tags[]` |
| **pixiv-viewer** | Web/Vue（journey-ad） | —（无收藏功能） | — | — | — | — | — | — | —（只读，走 HibiAPI 代理仅 GET） |
| **pixiv-app-api** | Node.js（akameco） | —（API 库无 UI） | — | — | — | — | —（透传参数） | `POST /v2/illust/bookmark/add` | 不处理，由调用方构造 |
| **PixivBiu** | 桌面/Go ★1.4k | —（API 层） | — | — | — | — | — | `POST /v2/illust/bookmark/add` | SDK 中空格 join → 单字段 `tags[]`（handler 未实现 tags 透传） |
| **pixivswift** | iOS/macOS Swift 库 | —（API 库无 UI） | — | — | — | — | — | `POST /v2/illust/bookmark/add` | 空格 join → 单字段 `tags`（无 `[]`，同样有效） |
| **官方 App（基准）** | iOS/Android | 快速收藏（默认公开） | **长按心形** → 编辑面板（标签 + 非公开开关 + 「♡すき！する」确认） | 是（再长按 → 「♡を編集」） | 用户书签标签库 + 作品标签推荐 + 新建 | 官方上限 10 个 | 是 | App API（`/v2/illust/bookmark/add` 系） | 官方抓包未直接核验（见 §6.1） |

---

## 1. Pixez（Notsfsssf/pixez-flutter，Flutter）

仓库：https://github.com/Notsfsssf/pixez-flutter （原 Notsfsssf/Pixez 已改名，★12837，最近更新 2026-09，活跃）

### 1.1 交互形态

- **单击心形 = 快速收藏**。`lib/component/illust_card.dart` 的 `onTap` 直接调用 `store.star(...)`，其中：
  - `restrict` 来自设置项 `defaultPrivateLike`（true → `"private"`，否则 `"public"`）；
  - `tags` 来自设置项 `autoTagWhenStar`：开启时**自动附加作品自带的全部标签**（正则过滤 `Nusers入り`），否则 `null`（不带标签）。
  - 收藏成功后还可联动 `followAfterStar`（顺手关注作者）、`saveAfterStar`（顺手保存图片）。
- **长按心形 = 带标签收藏**。`onLongPress`（重型触感反馈）→ `showModalBottomSheet`（高度 61.8%）→ `TagForIllustPage` 标签勾选面板 → 返回 `{restrict, tags}` → `store.star(restrict, tags, force: true)`。
- **已收藏作品可改标签**：再次长按打开同一面板；确认后 `force: true` **直接重发 add 覆盖**（不走 delete+re-add）。
- 另有取消收藏：单击已收藏作品的心形 → `postUnLikeIllust`。
  - 出处：`lib/component/illust_card.dart`（onTap/onLongPress）、`lib/page/picture/illust_store.dart` 的 `star()` 与 `_autoTagsWhenStar()`。

### 1.2 标签面板（TagForIllustPage）

- 数据层 `lib/page/picture/tag_for_illust_store.dart`：
  - 打开时 `fetch()` → `GET /v2/illust/bookmark/detail?illust_id=`，取 `bookmark_detail.tags`（**作品自带标签，每个带 `is_registered` 标志表示已被用户勾选**）、`bookmark_detail.restrict`（恢复公开/私密状态）、`is_bookmarked`；
  - `insert()` 支持输入框**新建标签**（置顶且默认勾选）；`checkAll()` 全选/全不选；`setRestrict()` 切换 public/private。
- UI 层 `lib/page/picture/tag_for_illust_page.dart`：AppBar 含全选 Checkbox + 公开/私密 Switch + 确认按钮；输入框 + 「+」新建标签；列表逐项 Checkbox。`confirm()` 收集全部勾选标签 pop 返回。**前端未做 10 个上限校验**。
- 注意：Pixez 封装了 `getUserBookmarkTagsIllust`（用户书签标签库）但该面板未使用——标签候选完全来自 `bookmark/detail`。

### 1.3 API 证据（lib/network/api_client.dart）

```dart
// postLikeIllust（L240-265）：tags 空格 join 后放入单字段 "tags[]"
String tagString = tags.first;
for (var i = 1; i < tags.length; i++) { tagString = tagString + ' ' + tags[i].trim(); }
httpClient.post("/v2/illust/bookmark/add",
  data: notNullMap({"illust_id": illust_id, "restrict": restrict, "tags[]": tagString}),
  options: Options(contentType: Headers.formUrlEncodedContentType));

// postUnLikeIllust（L267-273）
httpClient.post("/v1/illust/bookmark/delete",
  data: {"illust_id": illust_id},
  options: Options(contentType: Headers.formUrlEncodedContentType));

// getIllustBookmarkDetail（L513-517）：GET /v2/illust/bookmark/detail?illust_id=
// getUserBookmarkTagsIllust（L633-642）：GET /v1/user/bookmark-tags/illust?user_id=&restrict=
```

---

## 2. Pixeval（Pixeval/Pixeval，C#/Avalonia）+ Pixeval/Mako（其 App API 库）

仓库：https://github.com/Pixeval/Pixeval （★3136，活跃）；API 层独立仓库 https://github.com/Pixeval/Mako

### 2.1 交互形态（双轨命令）

`src/Pixeval/ViewModels/Work/WorkEntryViewModel.Commands.cs`：

- `BookmarkCommand`（**单击心形**）→ `SetBookmarkAsync(!IsFavorite)`：纯快速收藏/取消，**不带标签**（privately=false, tags=null，即 public）。
- `AddToBookmarkCommand`（带标签收藏）→ `SetBookmarkAsync(true, IsPrivate, Tags)`：参数 `(Tags, IsPrivate, Control)` 来自标签选择浮层。
- **已收藏作品可改标签**：`AddToBookmarkAsync` 固定 `favorite=true` 重发 add 覆盖（非 delete+add）。
- 防抖/竞态：`WorkEntryViewModel.Debounce.cs` 将 Bookmark 与 RemoveBookmark 封装为带依赖关系的 Debounce 任务，连续快速点击不会交叉竞态。

### 2.2 标签选择浮层（TagSelector）

`src/Pixeval/Views/Work/TagSelector.axaml.cs` + `BookmarkTagSelectorFlyoutHelper.cs`：

- 入口：大图查看器信息面板的心形按钮**右键 / 上下文菜单**（`ContextRequested`，`src/Pixeval/Views/Viewers/IllustrationViewerInfoPane.axaml.cs` L57）；`WorkContainer.axaml.cs`、`NovelViewerPage.axaml.cs` 同模式。Flyout 内容宽 340。
- 标签来源分两路（`ResetSourceAsync`）：
  - **未收藏作品**（无 WorkId）：并行拉 `GET /v1/user/bookmark-tags/illust` 的 **public + private 两份**合并为候选，末尾追加 `AddNewBookmarkTag`（输入**新建标签**）；
  - **已收藏作品**：`GET /v2/illust/bookmark/detail` → 恢复 `Restrict`（私密态）+ 作品标签列表（`BookmarkDetailBookmarkTag.Create`，含 IsRegistered）→ **预勾选已注册标签**。
- **数量上限硬编码 10**：`OnListBoxSelectionChanged` 中 `if (SelectedItems.Count > 10) items.RemoveAt(0)`（源码注释「最多10个，递归删除」）。
- 确认 → `TagsSelected(IsPrivate, tags)` → `AddToBookmarkCommand`。

### 2.3 API 证据（Mako）

`/tmp 对应源码：Mako/Net/Requests/AddIllustrationBookmarkRequest.cs`：

```csharp
public record AddIllustrationBookmarkRequest(
    [property: JsonPropertyName("restrict")] PrivacyPolicy Restrict,
    [property: JsonPropertyName("illust_id")] long Id,
    [property: JsonPropertyName("tags[]"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Tags);
// endpoint（Mako/Net/EndPoints/IAppApiEndPoint.cs L21-36）:
//   [HttpPost("/v2/illust/bookmark/add")]      AddIllustrationBookmarkAsync([FormContent] request)
//   [HttpPost("/v1/illust/bookmark/delete")]   RemoveIllustrationBookmarkAsync
//   [HttpGet ("/v2/illust/bookmark/detail")]   GetIllustrationBookmarkDetailAsync
//   [HttpPost("/v2/novel/bookmark/add")] / [HttpPost("/v1/novel/bookmark/delete")] / [HttpGet("/v2/novel/bookmark/detail")]
```

序列化在 `Mako/MakoClient.Extensions.cs` `PostWorkBookmarkAsync`：

```csharp
var urlTags = tags is { Count: > 0 } ? string.Join(' ', tags) : null;   // 空格 join → 单字段 tags[]
```

用户书签标签库：`Pixeval/src/Pixeval/Utilities/MakoHelper.cs` `GetBookmarkTagsAsync(uid, type, policy)` → `MakoClient.WorkBookmarkTags(...)`（`/v1/user/bookmark-tags/illust`），并在头部插入「全部」「未分类」两个哨兵项。

---

## 3. pixiv-viewer（journey-ad/pixiv-viewer，Vue）

仓库：https://github.com/journey-ad/pixiv-viewer

- **定性：只读客户端，无收藏功能**。`src/api/http.js` 虽封装了 `post`，但业务层（`src/api/index.js` 及全部 views/components）无任何 `illust/bookmark` 调用；API 全部走第三方 HibiAPI 代理（`https://hibiapi.getloli.com/api/`）且业务代码只用 `get`。
- 结论：不构成「带标签收藏」的参考实现（全文检索 `bookmark/add`、`illust/bookmark` 均无命中）。

---

## 4. pixiv-app-api（akameco，Node.js App API 封装）

仓库：https://github.com/akameco/pixiv-app-api （`src/index.ts`）

```ts
illustBookmarkAdd(id: number, params?: PixivParams): Promise<unknown> {
  params = { illustId: id, restrict: 'public', ...params }
  return this.fetch('/v2/illust/bookmark/add', { data: params })   // 参数透传
}
illustBookmarkDelete(id)      // → POST /v1/illust/bookmark/delete
illustBookmarkDetail(id)      // → GET  /v2/illust/bookmark/detail
userBookmarkTagsIllust(params) // → GET /v1/user/bookmark-tags/illust（默认 restrict: 'public'）
```

- 端点契约与上文完全一致；tags 的具体序列化交由注入的 fetch 层/调用方决定（不内置 join 逻辑），故只作端点参照。

---

## 5. PixivBiu（txperl/PixivBiu，Go）+ txperl/pixivgo（其 SDK）

仓库：https://github.com/txperl/PixivBiu （★1452，活跃）、https://github.com/txperl/pixivgo

- PixivBiu 的收藏 handler（`internal/api/handler_illusts.go` L141）只透传 `IllustBookmarkAddParams{IllustID, Restrict}`，**尚未实现 tags 透传**（功能缺口与 Pictelio 现状类似）。
- 但其 SDK 是干净的契约参照（`pixivgo/api_bookmark.go`）：

```go
// IllustBookmarkAdd
data := url.Values{"illust_id": {strconv.Itoa(params.IllustID)}, "restrict": {restrict}}
if len(params.Tags) > 0 {
    data.Set("tags[]", strings.Join(params.Tags, " "))   // 空格 join → 单字段 tags[]
}
c.doPost(ctx, "/v2/illust/bookmark/add", data, ...)
// IllustBookmarkDelete → POST /v1/illust/bookmark/delete（仅 illust_id）
// IllustBookmarkDetail → GET  /v2/illust/bookmark/detail
```

---

## 6. 官方 App 与官方 Web（基准）

### 6.1 官方 App 交互（双轨）

- **单击心形 = 快速收藏**（默认公开，无面板）。
- **长按心形 = 弹出书签编辑面板**：标签添加/编辑 + 「非公开」开关 + 底部「♡すき！する」确认按钮。
- **已收藏作品可再长按（「♡を編集」）修改标签与公开性**。
- 出处：
  - pixiv 帮助中心「ブックマークとは？」（♡长按 → 非公开开关 → すき！する 流程）：https://www.pixiv.help/hc/ja/articles/235646967
  - 用户侧图解（长按 → ♡を編集 → 非公开）：https://www.pixiv.net/novel/show.php?id=12040723 、https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q12245079667
  - 官方开发博客「ブックマーク追加・編集画面を変更」（编辑面板 UI 演进、收藏中作品的标签显示）：http://blog.livedoor.jp/dev_pixiv/archives/660026.html

### 6.2 官方数量上限

- **每个作品的书签标签最多 10 个**（官方帮助中心 + 官方公告双源）：
  - https://www.pixiv.help/hc/ja/articles/235585488 （「ブックマークしたイラストにブックマークタグを10個まで付けることができます」）
  - https://www.pixiv.net/info.php?id=96 （「最大10個まで登録できますが、一括でタグを追加したときに10個を超えた場合、ブックマークタグは追加されません」——整批超限会被服务端拒绝）
- **单标签字符数上限：官方明文未查证到**。第三方（Yahoo 知恵袋用户回答）称 20 文字以内（https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q11313456616），非官方来源，可靠性一般。建议实现时以真机实测/服务端 4xx 为准，客户端先按宽松长度校验。

### 6.3 官方 Web ajax 端点（与 App API 不同族，仅作参考）

- `POST https://www.pixiv.net/ajax/illusts/bookmark/add`，body 为 **JSON**：`{"illust_id", "restrict": <int>, "comment", "tags": [<字符串数组>]}` —— web 族用 JSON + 数组，App 族用 form + 空格 join。
  - 出处：YAPC 项目 `pyxiv.py` L419-423（https://github.com/VermiIIi0n/YAPC）。

---

## 7. App API 契约核验结论（供实现直接使用）

### 7.1 收藏（含标签）：`POST /v2/illust/bookmark/add`

- Content-Type：`application/x-www-form-urlencoded`。
- 字段：
  - `illust_id`：作品 ID（字符串形式）；
  - `restrict`：**`"public"` | `"private"`**（pixivpy 类型定义为 `Literal["public", "private", ""]`）；
  - `tags`（可选）：**多个标签用单个空格拼接成一个字符串值，作为单个 form 字段发送**。字段名写 `tags[]`（pixivpy v3.7.5/master、Pixez、Mako、pixivgo 均如此）或裸 `tags`（pixivswift）——服务端两种均接受；**未发现任何主流第三方实现使用重复键数组（`tags=a&tags=b`）形态**。
- **五个独立实现的序列化证据矩阵**（结论一致，互为差分验证）：

| 实现 | 代码位置 | 序列化 |
|---|---|---|
| pixivpy v3.7.5（Python） | `pixivpy3/aapi.py` L572-590 | `tags = " ".join(...)` → `data["tags[]"]` |
| pixivpy master（同上，2025-02 lint 重构后） | `pixivpy3/aapi.py` L610-628 | 同上 |
| Pixez（Dart） | `lib/network/api_client.dart` L240-265 | 手动循环空格拼接 → `"tags[]": tagString` |
| Pixeval/Mako（C#） | `MakoClient.Extensions.cs` `PostWorkBookmarkAsync` + `AddIllustrationBookmarkRequest.cs` | `string.Join(' ', tags)` → `[FormContent]` 单字段 `tags[]` |
| pixivgo（Go） | `api_bookmark.go` `IllustBookmarkAdd` | `data.Set("tags[]", strings.Join(params.Tags, " "))` |
| pixivswift（Swift） | `Sources/pixivswift/aapi.swift` L627-645 | `tags.joined(separator: " ")` → 单字段 `tags`（无 `[]`） |

- 官方 App 真实抓包的原始字段形态：**未查证到**公开可核验的抓包记录（上表均为第三方客户端实现；由于六实现长期可用，空格 join 单字段形态可视为稳定契约）。
- pixivpy 自 v3.5.10（早于 2022）起即使用 `/v2/...` 端点；现役端点为 **v2**（v1 旧端点曾存在于早期逆向文档，现役客户端无一使用 v1 add）。

### 7.2 取消收藏：`POST /v1/illust/bookmark/delete`

- form-urlencoded，仅 `illust_id`；响应通常为空体/无内容。注意 delete 是 **v1** 而 add/detail 是 **v2**（官方端点族不一致，各实现均如此）。Pixez 额外保留了 GET 变体（`GET /v1/illust/bookmark/delete?illust_id=`，非主流用法）。

### 7.3 书签详情（判断已收藏 + 已有标签）：`GET /v2/illust/bookmark/detail?illust_id=`

- 返回 `bookmark_detail`：`is_bookmarked`（bool）、`restrict`（当前 public/private）、`tags[]`（**作品自带标签 + 每项 `is_registered` 标志**，标记用户书签标签库中已有该标签）。已收藏时还含 `bookmark_id` 等字段。
- 消费方：Pixez TagForIllustStore、Pixeval TagSelector（预勾选 + 恢复 restrict）、pixivpy `illust_bookmark_detail`、pixivgo `IllustBookmarkDetail`、akameco `illustBookmarkDetail`（均 v2）。

### 7.4 用户书签标签库：`GET /v1/user/bookmark-tags/illust`

- 参数：`user_id`、`restrict`（public/private——**标签库按公开性分库**，Pixeval 因此并行拉两份合并）、`offset`（分页）。
- 返回 `bookmark_tags[]: {name, count}`。
- 消费方：pixivpy `user_bookmark_tags_illust`（L672-687）、Pixez `getUserBookmarkTagsIllust`（L633-642）、Pixeval `WorkBookmarkTags`、akameco `userBookmarkTagsIllust`。
- 小说版对应：`/v1/user/bookmark-tags/novel`。

### 7.5 修改已收藏书签的标签

- **无专用 edit 端点**。主流做法（Pixez `star(force: true)`、Pixeval `AddToBookmarkAsync`）都是**对已收藏作品直接重发 `POST /v2/illust/bookmark/add`（带完整新标签集 + restrict）覆盖**；不需要 delete+re-add（delete+add 会丢失 bookmark_id/收藏时间，且多一次往返）。
- 响应行为：add 会整体覆盖该书签的 tags 与 restrict（由上述两客户端的「重开面板→预勾选→确认→重发 add」闭环行为反证）。

### 7.6 小说变体（Pixeval/Mako 端点清单可直接复用）

- `POST /v2/novel/bookmark/add`（同 form 形态，`novel_id` + `restrict` + `tags[]` 空格 join）
- `POST /v1/novel/bookmark/delete`；`GET /v2/novel/bookmark/detail`

### 7.7 限制汇总

| 项 | 结论 | 出处强度 |
|---|---|---|
| 标签数量 | 每作品最多 **10** 个；批量追加超 10 整批不加 | 官方双源（帮助中心 + 公告），强 |
| App API 端数量上限 | 官方未明文；Pixeval 客户端硬编码 10，Pixez 未限制 | 推断 + 客户端证据 |
| 单标签长度 | 官方明文**未查证到**（第三方称 20 文字，未证实） | 弱，需实测 |
| restrict 取值 | `public` / `private`（form 字符串） | 多实现一致，强 |
| tags 序列化 | 空格 join 单字段（`tags[]` 或 `tags`） | 六实现差分一致，强 |

---

## 8. 对 Pictelio 双端（webview SolidJS + lynx）的适配启示

现状盘点（codegraph + 源码核验）：

- webview 端 `packages/app/src/api/illust.ts:336`：`addBookmark(illustId, restrict)` → `POST /v2/illust/bookmark/add`，**不支持 tags**；`deleteBookmark` → `POST /v1/illust/bookmark/delete`。
- lynx 端 `packages/app-lynx/src/api/illust.ts:75` + `composables/useBookmarkMutation.ts`：`POST /v2/illust/bookmark/add` **仅传 `illust_id`（连 restrict 都未传）**，乐观更新 + 失败回滚已就绪。

建议（按优先级）：

1. **API 层**：`addBookmark` 增加 `tags?: string[]`，按「空格 join → 单字段 `tags[]`」序列化（可兼容裸 `tags` 字段名，二者服务端等价；推荐 `tags[]` 与主流实现对齐）。注意两点：
   - Native 模式下请求经 `PixivApiPlugin`（Java OkHttp）转发，form 字段的 `tags[]` 键名需在 JS → bridge → Java 全链路原样透传（含 `[]`，无 URL 编码歧义）；
   - Web 模式走 Vite 代理 + fetch `URLSearchParams`/`FormData`，`tags[]` 作为普通键名无需特殊处理（不是 query 的重复键语义，是单个键 + 空格分隔值）。
2. **交互双轨对齐官方**：单击心形 = 快速收藏（ restrict 读取「默认私密收藏」设置项）；长按/详情页二级入口 = 带标签编辑面板（webview 端 Fluent Dialog/底部面板，lynx 端 M3 bottom sheet）。这与官方 App（长按 ♡）及 Pixez（长按心形 → 61.8% 底部弹层）完全同构，用户零学习成本。
3. **面板数据源策略**（两客户端两种策略可组合）：
   - 已收藏：先 `GET /v2/illust/bookmark/detail` → 预勾选 `is_registered` 标签 + 恢复 restrict（Pixeval/Pixez 一致做法）；
   - 未收藏：拉 `GET /v1/user/bookmark-tags/illust` 历史标签库做候选（Pixeval 模式，注意 public/private 分库需合并或跟随当前 restrict），或像 Pixez 一样直接用作品标签做候选 + 设置项「收藏时自动附加作品标签」（`autoTagWhenStar`，过滤 `Nusers入り`）。
   - 支持输入新建标签（插入候选列表头部并勾选）。
4. **客户端校验**：数量上限 10（超限时阻止提交并提示，比 Pixeval 的静默移除更明确；批量超限服务端会整批拒绝——官方公告 id=96）；单标签长度官方无明文，先宽松校验并以服务端报错为最终防线（禁止静默降级，需 `console.warn` 或显式错误态）。
5. **修改已收藏书签**：直接重发 `POST /v2/illust/bookmark/add` 覆盖（完整标签集 + restrict），**不要 delete + re-add**。
6. **竞态防护**：参考 Pixeval 的 Debounce 依赖任务（Bookmark/RemoveBookmark 互为依赖）；lynx 端现有 `useBookmarkMutation` 乐观更新可扩展 mutation variables 为 `{target, tags?, restrict?}`，保持现有失败回滚语义。
7. **测试硬约束映射**：
   - `addBookmark` 序列化属 IO 边界：成功 + 失败路径单测；
   - tags join 契约测试的期望值来源用独立实现差分（pixivpy `aapi.py` L610-628 作为 oracle：`" ".join` → `tags[]`），禁止从被测实现反推；
   - `bookmark/detail` 响应解析用真实响应快照做契约测试（`is_bookmarked`/`restrict`/`tags[].is_registered` 字段名来自真实端点）；
   - E2E：长按心形 → 面板 → 勾选 → 确认的用户路径可用 `driver.mockFetch()` 构造（依赖登录态与远端数据的路径）。
8. **小说侧预留**：novel 变体端点族（`/v2/novel/bookmark/add` 等）已在 Mako/Pixez 验证，小说收藏带标签可按同构方案扩展。

---

## 附：源码核验索引（本报告引用的全部代码位置）

| 项目 | 文件 | 关键行 |
|---|---|---|
| pixivpy v3.7.5 | `pixivpy3/aapi.py` | L572-590（add）、L592-600（detail）、L602-612（delete）、L642-657（bookmark-tags） |
| pixivpy master | `pixivpy3/aapi.py` | L599-639、L672-687；`_RESTRICT = Literal["public","private",""]`（L29） |
| Pixez | `lib/network/api_client.dart` | L240-265（postLikeIllust）、L267-277（delete）、L513-517（detail）、L633-642（bookmark-tags） |
| Pixez | `lib/page/picture/illust_store.dart` | `star()`、`_autoTagsWhenStar()`（L130-165） |
| Pixez | `lib/page/picture/tag_for_illust_store.dart` / `tag_for_illust_page.dart` | 全文（面板数据层 + UI） |
| Pixez | `lib/component/illust_card.dart` | L389-443（onTap/onLongPress 双轨） |
| Pixeval | `src/Pixeval/ViewModels/Work/WorkEntryViewModel.Commands.cs` | `BookmarkAsync` / `AddToBookmarkAsync` |
| Pixeval | `src/Pixeval/Views/Work/TagSelector.axaml.cs` | `ResetSourceAsync`、10 上限、`GetTagsAsync` |
| Pixeval | `src/Pixeval/Views/Work/BookmarkTagSelectorFlyoutHelper.cs`、`Views/Viewers/IllustrationViewerInfoPane.axaml.cs` | 右键入口 |
| Pixeval | `src/Pixeval/Utilities/MakoHelper.cs` | `GetBookmarkTagsAsync`、`SetWorkBookmarkAsync` |
| Mako | `Mako/Net/Requests/AddIllustrationBookmarkRequest.cs`、`Mako/Net/EndPoints/IAppApiEndPoint.cs`、`Mako/MakoClient.Extensions.cs` | `tags[]` record、端点清单、`string.Join(' ')` |
| pixivgo | `api_bookmark.go` | `IllustBookmarkAdd/Delete/Detail` |
| PixivBiu | `internal/api/handler_illusts.go` | L130-155（收藏 handler，未透传 tags） |
| pixivswift | `Sources/pixivswift/aapi.swift` | L627-663 |
| akameco/pixiv-app-api | `src/index.ts` | L531-581 |
| YAPC（web ajax） | `pyxiv.py` | L419-423 |
