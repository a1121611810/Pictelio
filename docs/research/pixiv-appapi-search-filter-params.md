# Pixiv AppAPI 搜索筛选参数面精确清单（四端点 × 参数 × 免费限制）

> 对应 GitHub issue #475（wayfinder 地图 #474 research 票）。纯调研文档，不改生产代码。
> 调研日期：2026-09-12。

## 调研方法与证据规则

- **竞品源码逐参数标注出处**：将竞品仓库浅克隆到 `/tmp/pixiv-competitors/` 阅读（不进工作区）。
  各仓库引用时统一使用「仓库名 @ 浅克隆 HEAD」：
  - **Pixiv-Shaft**（Kotlin，`CeuiLiSA/Pixiv-Shaft` @ `ae49fac`）：新版已对齐 **pixiv iOS 官方 app 8.6.5 / 8.6.6 / 8.7.3 抓包行为**（源码注释自述），是本清单「官方 app 实际发什么」的最强证据源。文件：`app/src/main/java/ceui/pixiv/api/API.kt`（Retrofit 端点）、`app/src/main/java/ceui/pixiv/ui/search/v3/SearchFilterV3.kt`（筛选维度定义）、`app/src/main/java/ceui/lisa/repo/SearchIllustRepo.kt` / `SearchNovelRepo.kt`（拼参与会员路由）。
  - **pixez-flutter**（Dart，`Notsfsssf/pixez-flutter` @ `0750c38`）：`lib/network/api_client.dart`。
  - **Mako**（C#，`Pixeval/Mako` @ `40370b1`，Pixeval 的 API 子模块）：`Mako/Engine/Implements/{IllustrationSearchEngine,NovelSearchEngine,SearchArgumentsBase}.cs`、`Mako/Global/Enum/*.cs`。
  - **Pix-EzViewer**（Kotlin，`ultranity/Pix-EzViewer` @ `96a4f4b`，老世代客户端）：`app/src/main/java/com/perol/asdpl/pixivez/services/PixivApiService.kt`。
  - **pixivpy3**（Python，`upbit/pixivpy` @ `4f2e9ea`）：`pixivpy3/aapi.py`。
  - **PixivBiu**（Go+TS，`txperl/PixivBiu` @ `bbdae11`，Go 重写版）：`internal/api/handler_search.go`、`api/openapi.yaml`、`frontend/src/features/search/api.ts`。
  - 另参考（未克隆，按需 raw 拉取）：`asadahimeka/pixiv-viewer`（Vue，AppAPI 直连）、`onlymash/materixiv`（Kotlin）、`Tsuk1ko/pxder`（JS）、`xiaoyvyv/bangumi`（Pixiv **Web** ajax API 对照）。
- **公开文档交叉印证**：pixivpy issue（[upbit/pixivpy#410](https://github.com/upbit/pixivpy/issues/410)，含实测 log）、[PixivWebApi 非官方文档](https://pixivsource.pages.dev/PixivWebApi)、pixiv 官方帮助/公告（WebSearch）。
- **禁止凭记忆断言**：查不到实证的参数一律进入「未证实」清单；两说并存的参数（如 `search_ai_type` 旧注释）显式记录矛盾与裁决依据。
- 免费账号可用性判断主要依据 Pixiv-Shaft 源码注释（第一手抓包/实测结论）+ Mako 的会员分支逻辑 + PixivBiu 代码注释，官方帮助文档佐证。

---

## 1. `/v1/search/illust`（插画/漫画搜索）

### 1.1 基础参数

| 参数 | 取值/格式 | 语义 | 免费账号 | 出处 |
|---|---|---|---|---|
| `word` | string（必填） | 搜索词。可拼 `Xusers入り` 后缀实现免会员收藏量分桶（服务端自动桶标签） | 可用 | pixez `api_client.dart` `getSearchIllust` L438-464；Shaft `SearchFilterV3.kt` L186-204（`KeywordUsersBucket`「非会员也能用」）；Mako `IllustrationSearchEngine.cs` L34 |
| `search_target` | `partial_match_for_tags` / `exact_match_for_tags` / `title_and_caption`（官方 app illust UI 三档）；`keyword`（标签+标题+说明）在 Mako/PixivBiu 枚举中也存在（illust 端可传，官方 UI 不暴露） | 匹配方式。**不传 ≡ partial 且会并入标题命中**（Shaft #906：显式传 partial 反而做严格 tag 匹配并忽略 merge 参数） | 可用 | Shaft `SearchFilterV3.kt` L129-161（`SearchTarget.forIllust()` + `toQueryValue` 注释）；Mako `SearchIllustrationTagMatchOption.cs`（4 值含 `keyword`）；PixivBiu `api/openapi.yaml` `SearchTarget`（4 值）；pixivpy `aapi.py` L492-497 注释 |
| `sort` | `date_desc` / `date_asc` / `popular_desc`；另有 premium 限定 `popular_male_desc` / `popular_female_desc`（仅 illust 端） | 排序。**`popular_desc` 及男/女性向两档为会员限定，非会员直发 → 400** | `date_*` 可用；`popular*` **Premium 限定** | Shaft `SortType.kt`（5 值）+ `SearchIllustRepo.kt` L98-117（「非付费用户不能用人气系列 sort……必然 400」）；Mako `WorkSortOption.cs`（date_desc/date_asc/popular_desc）；PixivBiu `handler_search.go` L26-29 注释「Pixiv's popularity sort is Premium-only」（该库干脆本地采样重排替代）；pixivpy `aapi.py` L494 |
| `filter` | `for_ios` / `for_android`（/ 不传；PixivBiu 后端另用 `none` 关闭 iOS 内容门控） | 客户端姿态（内容过滤策略），不影响筛选逻辑 | 可用 | pixez `api_client.dart` L452（按平台选 for_android/for_ios）；PixivBiu `api/openapi.yaml` `ClientMode` enum `[for_ios, none]` |
| `offset` | int（翻页游标） | 分页偏移；后续页跟 `next_url`（步长 30） | 可用 | pixivpy `aapi.py` L521 `offset`；PixivBiu `handler_search.go` L171-183（`upstreamSearchPageSize = 30`） |
| `start_date` / `end_date` | `YYYY-MM-DD`（日本时区当天为界） | 投稿期间闭区间。约束：两端同传或不传；`end_date` ≤ 今天、`start_date` ≤ 今天（Mako 客户端校验并抛错） | 可用 | Mako `SearchArgumentsBase.cs` L38-45（JapanTime 校验）；Mako `IllustrationSearchEngine.cs` L43-44（`yyyy-MM-dd`）；Shaft `SearchFilterV3.kt` L48-49、L207-231（iOS 8.6.6 起 duration 档当场换算成 start/end_date） |

### 1.2 筛选参数

| 参数 | 取值/格式 | 语义 | 免费账号 | 出处 |
|---|---|---|---|---|
| `duration` | `within_last_day` / `within_last_week` / `within_last_month` / `within_last_half_year` / `within_last_year`（不传 = 不限） | 投稿期间相对预设档。**与 start/end_date 语义重叠**：官方 iOS 8.6.6 起不再发 `duration`，由客户端换算成 start/end_date；老客户端与 pixivpy 仍直发 | 可用 | 枚举五档：pixiv-viewer `SearchRes.vue` L271-278、materixiv `searchbar_illust_search.xml`（duration 菜单含 half_year/year）；pixivpy `aapi.py` L495 注释（只列 3 档）；PixivBiu `api/openapi.yaml` L414-417（3 档）；官方不再直发：Shaft `SearchFilterV3.kt` L206-213「iOS pixiv 8.6.6 抓包确认：不再发 `duration=within_last_*`」 |
| `bookmark_num_min` / `bookmark_num_max` | int，闭区间（含端点）。候选档由服务端 `/v1/search/options` 的 `bookmark_ranges` 下发：`1000+` / `500-999` / `300-499` / `100-299` / `50-99` / `30-49` / `10-29`（`*` = 不限端） | 收藏量区间（官方 iOS「喜欢！数」同语义）。**会员限定：非会员直发时服务端静默忽略（不报错），客户端需自行兜底过滤** | **Premium 限定**（非会员被静默忽略） | Shaft `SearchFilterV3.kt` L163-183（「与官方 iOS『喜欢！数』picker 同语义（闭区间；候选档由 /v1/search/options 的 bookmark_ranges 服务端下发）」）+ `SearchIllustRepo.kt` L109-114「喜欢数筛选（bookmark_num_min/max）同样是会员专属参数——非会员拿自己的号发，服务端静默忽略」；band 值同文件 L172-181（iOS 8.7.3 抓包下发值） |
| `ratio_pattern` | `landscape`（横）/ `portrait`（竖）/ `square`（方）；不传 = 不限 | 长宽比。**注意：AppAPI 现行参数名是 `ratio_pattern`，不是 Web 端的 `ratio`** | 可用 | Shaft `SearchFilterV3.kt` L278-286（「走官方 `ratio_pattern` query 参数」）；Mako `SearchIllustrationRatioPattern.cs`（同名 3 值）；pixiv-viewer `SearchRes.vue` L122、L247 |
| `content_type` | `illust_and_manga_and_ugoira`（默认 = 不传等价）/ `illust_and_ugoira` / `illust` / `ugoira` / `manga` | 作品类别（iOS「作品类别」picker 五档） | 可用 | Shaft `SearchFilterV3.kt` L288-303（「pixiv iOS 8.6.6 抓包确认走官方 `content_type` query 参数」）；Mako `SearchIllustrationContentType.cs`（5 值）；pixiv-viewer `SearchRes.vue` L252-255 |
| `width_min` / `width_max` / `height_min` / `height_max` | int，单位 **px**，双闭区间（Mako 注释「包含该值」）。官方分辨率预设档（每档同时给 width/height 同值）：≥3000、1000-2999、≤999 | 分辨率档位（四参数独立可组合，不强制成对） | 可用 | Shaft `SearchFilterV3.kt` L305-319（`ResolutionBucket`，「边界双闭」）；Mako `SearchArgumentsBase.cs` L56-74（`WidthMin/WidthMax/HeightMin/HeightMax`，「包含该值」）；pixiv-viewer `SearchRes.vue` L294-297（JSON 预设→四参数展开）；Mako `IllustrationSearchEngine.cs` L45-48 |
| `tool` | string（绘画工具名）；候选清单由 `/v1/search/options` 的 `tool.options` 下发 | 绘画工具筛选（仅 illust） | 可用 | Shaft `SearchFilterV3.kt` L17（「tool——绘画工具（仅 illust，从 /v1/search/options 拉）」）、`SearchOptionsResponse.kt` L42-44；Mako `IllustrationSearchEngine.cs` L49、`SearchArgumentsBase.cs` L76-79 |
| `lang` | string（语言码） | 语种筛选 | 可用 | Shaft `API.kt` `searchIllustManga` L427；Mako `NovelSearchEngine.cs` L36（novel 侧） |
| `search_ai_type` | `0` = 全部作品（含 AI）/ `1` = 排除 AI（仅原创）/ `2` = 仅 AI 作品 | AI 作品过滤。**0=全部、1=排除**（pixivpy 老注释「0: 过滤AI, 1: 显示AI」是**错的**，已被 issue #410 实测纠正）；官方 app 只用 0/1，「仅看 AI」走 0 + 客户端按响应字段 `illust_ai_type==2` 二次过滤 | 可用 | 裁决：[upbit/pixivpy#410](https://github.com/upbit/pixivpy/issues/410)（实测：0=全部含AI，1=仅原创，2=仅AI，附 log.json）；官方 app 行为：Shaft `SearchFilterV3.kt` L255-276（`AiMode.searchAiType()`「屏蔽=1，其余=0」）+ `SearchIllustRepo.kt` L540-545；独立印证：PixivBiu `handler_search.go` L205-211（`exclude_ai=true → 1`）；响应字段：`illust_ai_type` 0/1=人绘、2=AI（issue #410 实测 + Shaft `AiMode.accepts` L270-275） |
| `merge_plain_keyword_results` | bool（`true`/`false`） | 纯关键字命中并入结果。注意与 `search_target` 的互作：显式传 `partial_match_for_tags` 时该参数被忽略（Shaft #906 实测） | 可用 | pixez `api_client.dart` L453（恒发 true）；Shaft `API.kt` L421 + `SearchFilterV3.kt` L143-156；Mako `IllustrationSearchEngine.cs` L40 |
| `include_translated_tag_results` | bool | 并入译名标签命中 | 可用 | Shaft `API.kt` L422；pixez `api_client.dart` L579（URL 固定 true）；Mako `IllustrationSearchEngine.cs` L41 |
| `include_potential_violation_works` | bool（默认 false） | 是否包含「疑似违反 Guidelines」自动标记作品。iOS 官方默认 false（会隐藏部分作品）；Pixeval 显式发 false、Shaft 特意不传以免漏结果 | 可用 | Mako `SearchArgumentsBase.cs` L32 + `IllustrationSearchEngine.cs` L42；Shaft `API.kt` L357-360 注释（「iOS 默认 false 会让 pixiv 隐藏……部分关键字会因此搜不到任何结果——#906」）；pixiv-viewer `SearchRes.vue` L124、L250 |

> 备注：老世代客户端（Pix-EzViewer `getSearchIllust` L161-176、pixez）不发 `duration`/`ratio_pattern`/`content_type`/`width_*` 等新参数；新世代（Shaft 新版、Mako、pixiv-viewer）与 iOS 官方 8.6.x 对齐。两代参数在服务端并存可用。

---

## 2. `/v1/search/novel`（小说搜索）

**结论先行：小说端支持的筛选维度显著少于插画端——没有 `ratio_pattern` / `content_type` / `width_*` / `height_*` / `tool`；多了小说专属的正文长度三单位、`genre`、原创/置换开关。**

| 参数 | 取值/格式 | 语义 | 免费账号 | 出处 |
|---|---|---|---|---|
| `word` | string（必填） | 搜索词（同样支持 `Xusers入り` 后缀，但 Shaft 在使用 bookmark 区间参数时不再拼后缀） | 可用 | Shaft `SearchNovelRepo.kt` L81-88 |
| `search_target` | `partial_match_for_tags` / `exact_match_for_tags` / `text`（正文）/ `keyword`（关键词）四档。**与插画不同：不传 = 纯字面 keyword 匹配、标签同义词/译名不展开**（#1038），官方 app 默认档显式传 partial | 匹配方式 | 可用 | Shaft `SearchFilterV3.kt` L140-141（`forNovel()`）+ L152-155（「小说端点不传时退化成纯字面 keyword 匹配、同义词/译名不展开」）+ `SearchNovelRepo.kt` L113-131；Mako `SearchNovelTagMatchOption.cs`（partial/exact/text/keyword）；pixivpy `aapi.py` L541-547 注释 |
| `sort` | `date_desc` / `date_asc` / `popular_desc`。**`popular_male_desc` / `popular_female_desc` 在 novel 端不被识别**（Shaft 归一到 popular_desc） | 排序。`popular_desc` Premium 限定（非会员 → 400） | `date_*` 可用；`popular_desc` **Premium 限定** | Shaft `SearchNovelRepo.kt` L517-525（`SortType.novelSafe`：男/女性向人气归一，「novel 端点不识别」）+ L90-94（「拿自己的非会员 token 打会员专属 sort，必然 400」）；pixivpy `aapi.py` L548 注释 |
| `filter` | `for_ios` / `for_android` | 同插画 | 可用 | Shaft `API.kt` L641（`searchNovelWithAuth` URL 固定 `filter=for_android`）；pixez `api_client.dart` L475 |
| `offset` | int | 分页 | 可用 | pixivpy `aapi.py` L577 |
| `start_date` / `end_date` | `YYYY-MM-DD` | 同插画 | 可用 | pixez `api_client.dart` L479-480；Mako `NovelSearchEngine.cs` L46-47 |
| `duration` | 同插画五档 | 投稿期间相对档。pixivpy 的 `search_novel` 签名无 duration，但 materixiv 小说搜索菜单含 duration 项、老客户端（Pix-EzViewer `getSearchNovel` L195-204）直发 | 可用 | Pix-EzViewer `PixivApiService.kt` L195-204（novel 带 `duration`）；materixiv `searchbar_novel_search.xml`（8 处 `action_duration` 菜单项）；反证：pixivpy `aapi.py` L549-561（无 duration 形参） |
| `bookmark_num_min` / `bookmark_num_max` | int 闭区间，候选档同插画（`/v1/search/options` novel scope 下发） | 收藏量区间。**会员限定，非会员静默忽略**。另：pixez / Pix-EzViewer 在 novel 端发的是**单值** `bookmark_num`（语义同下限），Shaft/Mako 用 min/max 对 | **Premium 限定** | Shaft `SearchNovelRepo.kt` L98-101（「喜欢数筛选同样是会员专属参数」）；`API.kt` `searchNovelWithAuth` L648-649；单值形态：pixez `api_client.dart` L472、L481（`int? bookmark_num`）、Pix-EzViewer `PixivApiService.kt` L200 |
| `search_ai_type` | `0` / `1`（语义同插画；「仅看 AI」客户端按 `novel_ai_type==2` 过滤） | AI 作品过滤 | 可用 | Shaft `SearchNovelRepo.kt` L539-544 + `SearchFilterV3.kt` L256-258（`novel_ai_type`）；[pixivpy#410](https://github.com/upbit/pixivpy/issues/410) |
| `merge_plain_keyword_results` / `include_translated_tag_results` / `include_potential_violation_works` | bool | 同插画（Mako 对 novel 也全量发送） | 可用 | Mako `NovelSearchEngine.cs` L43-45；Shaft `API.kt` L641（URL 固定 include_translated=true&merge_plain=true） |
| `text_length_min` / `text_length_max` | int，单位「字数」 | 正文文字数区间。**非会员只能用四档预设**：≤4999（微型）/ 5000-19999（短篇）/ 20000-79999（中篇）/ ≥80000（长篇）；会员可任意区间 | 非会员**仅限四档预设**；会员无限制 | Mako `SearchNovelContentLengthOption.cs` L12-25（非会员选项 code 注释）+ `SearchArgumentsBase.cs` L107-136（非会员 band 校验）；Shaft `SearchFilterV3.kt` L328-347（iOS 8.6.6「文字数」picker 档位 + 「API 落地：unit=Char → `text_length_min/max`」） |
| `word_count_min` / `word_count_max` | int，单位「单词数」（仅字母类语言；适用语言由 `/v1/search/options` 的 `word_count_supported_languages` 下发） | 单词数区间。非会员档位同文字数四档 | 非会员仅限四档预设 | Mako `SearchNovelContentLengthOption.cs` L27-40；Shaft `SearchFilterV3.kt` L349-355 + `SearchFilterV3BottomSheet.kt` L778（`word_count_supported_languages`）；参数名落点：Shaft `SearchFilterV3.kt` L330（「unit = Word → `word_count_min/max`」，iOS 8.6.6 抓包确认） |
| `reading_time_min` / `reading_time_max` | int，单位「分钟」 | 阅读预计用时区间。非会员四档：≤9 / 10-59 / 60-179 / ≥180 | 非会员仅限四档预设 | Mako `SearchNovelContentLengthOption.cs` L42-55（非会员选项 code）+ `SearchArgumentsBase.cs` L125-135；Shaft `SearchFilterV3.kt` L331、L357-363（`ReadingTimeBucket`） |
| `genre` | int（genre id；候选由 `/v1/search/options` novel scope 的 `genre.options` 下发） | 小说类型（原创题材）。**依赖 `is_original_only=true` 才有意义**（Mako：`GenreId`「需要 IsOriginalOnly 为 true」） | 可用 | Mako `SearchArgumentsBase.cs` L99-102；Shaft `SearchOptionsResponse.kt` L46-53；`SearchNovelRepo.kt` L192 |
| `is_original_only` | bool（**仅显式 true 才发送**，关闭时不带——对齐 iOS） | 仅限原创作品 | 可用 | Shaft `SearchNovelRepo.kt` L546（「null 让 retrofit 跳过 query；只有显式 true 才传，行为对齐 iOS」）；Mako `NovelSearchEngine.cs` L40 |
| `is_replaceable_only` | bool（同上，仅 true 才发） | 仅限支持单词置换（AI 置换警告）的作品 | 可用 | Shaft `SearchNovelRepo.kt` L547；Mako `NovelSearchEngine.cs` L42 |
| `lang` | string（语言码） | 语种筛选（候选由 `/v1/search/options` novel scope `lang.options` 下发） | 可用 | Shaft `SearchNovelRepo.kt` L193；Mako `NovelSearchEngine.cs` L36；`SearchOptionsResponse.kt` L55-63 |

**小说端明确没有的参数**（Shaft V3 筛选维度表 L10-38 + Mako `NovelSearchArguments` 均不含）：`ratio_pattern`、`content_type`、`width_min/max`、`height_min/max`、`tool`。

---

## 3. `/v1/search/popular-preview/illust`（插画热门预览）

**结论先行：接受几乎与 `/v1/search/illust` 相同的筛选参数（Shaft 按 iOS 8.6.5 抓包对齐声明全量筛选参数），但不接受 `sort`、不分页（无 offset/next_url 翻页语义）；其中 `bookmark_num_min/max` 在该端点被服务端忽略。**

| 参数 | 取值/格式 | 语义 | 免费账号 | 出处 |
|---|---|---|---|---|
| `word` | string（必填） | 搜索词 | 可用 | Shaft `API.kt` `popularPreview` L361-382；pixez `api_client.dart` `getPopularPreview` L651-659 |
| `search_target` | 同 illust 三/四档（默认档可不传） | 匹配方式 | 可用 | 同上；Pix-EzViewer `PixivApiService.kt` L178-186 |
| `filter` | `for_ios` / `for_android` | 客户端姿态 | 可用 | Shaft `API.kt` L667（`popularPreviewLegacy` URL 固定 `filter=for_android`）；pixez L651（`filter=for_android`） |
| `include_translated_tag_results` / `merge_plain_keyword_results` | bool | 同 illust | 可用 | Shaft `API.kt` L667（URL 固定 true）；pixez L651 |
| `start_date` / `end_date` | `YYYY-MM-DD` | 投稿期间 | 可用 | Shaft `API.kt` `popularPreviewLegacy` L669-670（`popularPreviewLegacy` 实参传 `effectiveStartDate/effectiveEndDate`）；声明见 `popularPreview` L374-375 |
| `search_ai_type` | 0/1 | AI 过滤（0=全部，1=排除） | 可用 | Shaft `API.kt` L369（`search_ai_type: Int = 0`） |
| `ratio_pattern` / `content_type` / `width_min` / `width_max` / `height_min` / `height_max` / `tool` / `lang` | 同 illust | 筛选维度在 popular-preview 上同样声明（Shaft 注释「对齐 pixiv iOS app 8.6.5 实际调用」） | 可用 | Shaft `API.kt` L361-382（`popularPreview` 全量声明）+ L667-684（`popularPreviewLegacy` 全量传参）；`SearchIllustRepo.kt` L154-174（popularPreviewRequest 传全部筛选） |
| `bookmark_num_min` / `bookmark_num_max` | int | 声明可传，**但 popular-preview 端点服务端忽略这组参数**，客户端需自行兜底过滤 | 传了也没用 | Shaft `SearchIllustRepo.kt` L549「popular-preview 忽略 bookmark 参数，客户端兜底让区间在非会员路径上也成立」+ `SearchFilterV3.kt` L167-168「非会员当前 endpoint（popular-preview）忽略这组参数」 |
| ~~`sort`~~ / ~~`offset`~~ | — | **不接受**：无排序维度（端点本身就是「热度预览」语义）、无分页游标 | — | Shaft `API.kt` `popularPreview`（无 sort 形参——`popularPreviewLegacy` 与 `popularNovelPreview` 均无 sort）；`SearchIllustRepo.kt` L98-99「popular_preview 是 popular-preview endpoint 专属——`/v1/search/illust` 收到会 400」（sort 值不能混用端点） |

旁证：pixez 的 `getPopularPreview` 只传 `word + search_target`（+ 固定 filter/include_translated/merge）——最保守用法；Pix-EzViewer 老代码曾向该端点发 `sort/bookmark_num/duration`（`PixivApiService.kt` L178-186），未见报错处理，但无法证明服务端消费了它们。

## 4. `/v1/search/popular-preview/novel`（小说热门预览）

**结论先行：与 illust 预览端点对称——接受小说端的全量筛选参数（bookmark 区间同样被忽略），不接受 `sort`、不分页。**

| 参数 | 取值/格式 | 语义 | 免费账号 | 出处 |
|---|---|---|---|---|
| `word` | string（必填） | 搜索词 | 可用 | Shaft `API.kt` `popularPreviewNovel` L384-408、`popularNovelPreview` L685-704 |
| `search_target` | 同 novel 四档（默认显式 partial） | 匹配方式 | 可用 | Shaft `SearchNovelRepo.kt` L154-177（withTitleFallback 包裹 preview 调用） |
| `filter` | `for_ios` / `for_android` | 客户端姿态 | 可用 | Shaft `API.kt` L685（URL 固定 `filter=for_android&include_translated_tag_results=true&merge_plain_keyword_results=true`） |
| `start_date` / `end_date` | `YYYY-MM-DD` | 投稿期间 | 可用 | Shaft `API.kt` L697-698（popularPreviewNovel 声明） |
| `search_ai_type` | 0/1 | AI 过滤 | 可用 | Shaft `API.kt` L392 |
| `bookmark_num_min` / `bookmark_num_max` | int | 声明可传；**同 illust 预览，服务端忽略** | 传了也没用 | Shaft `SearchFilterV3.kt` L167-168；`SearchNovelRepo.kt` L162-163（preview 也传 bookmarkMin/Max，配合客户端兜底） |
| `genre` / `lang` | int / string | 小说类型 / 语种 | 可用 | Shaft `API.kt` L395-396 |
| `is_original_only` / `is_replaceable_only` | bool | 原创 / 置换开关 | 可用 | Shaft `API.kt` L399-400 |
| `text_length_min` / `text_length_max` / `word_count_min` / `word_count_max` / `reading_time_min` / `reading_time_max` | int | 正文长度三单位（「正文长度 3 单位（iOS pixiv 8.6.6 抓包确认）」） | 非会员档位限制同 novel 端（Mako 校验在客户端侧，端点无关） | Shaft `API.kt` L401-407 + 注释 |
| ~~`sort`~~ / ~~`offset`~~ | — | **不接受** | — | Shaft `API.kt` `popularPreviewNovel`（无 sort 形参）；`SearchNovelRepo.kt` L90-91（popular_preview 为预览端点专属） |

> 实现建议（供后续「热门排序 × 筛选共存」票参考）：在 popular-preview 上做筛选是**官方支持的路径**（官方 iOS 8.6.5+ 即此做法），但 bookmark 收藏量区间在该端点无效，需客户端过滤或改用 `Xusers入り` 关键字后缀。

## 5. 补充端点（同一参数族的周边接口）

| 端点 | 参数 | 用途 | 出处 |
|---|---|---|---|
| `/v1/search/options` | `word`（必填、非空即可，响应与词无关）、`search_target`、`merge_plain_keyword_results`、`include_translated_tag_results`、`search_ai_type` | 官方新版 iOS 用它动态拉「当前账号可选的筛选选项」：illust/novel 两个 scope 各一份 `bookmark_ranges`（字符串形式 min/max，`*`=不限）、`show_ai_condition`、`tool.options`（仅 illust）、`genre.options`（仅 novel）、`lang.options`、`word_count_supported_languages`（仅 novel） | Shaft `API.kt` `searchOptions` L464-471 + `SearchOptionsResponse.kt`（L6-8「pixiv 官方在新版 iOS app 用来动态拉『当前账号可选的筛选选项』」；L25「`*` 在 pixiv 协议里是『不限』哨兵」；L867「实测响应与 word 无关，但服务端要求该参数非空」） |
| `/v1/search/bookmark-ranges/illust` `/v1/search/bookmark-ranges/novel` | `word`、`search_target` | 老世代收藏量候选档接口（`/v1/search/options` 的前身，pxder 等仍在用） | pxder `src/pixiv-api-client-mod.js` `searchIllustBookmarkRanges` / `searchNovelBookmarkRanges`（L245-280）；pixiv-viewer `pixiv-api.js` L312 |

---

## 6. 「未证实」参数清单

以下参数**未在本次调研的任何 AppAPI 实现源码中观察到实际使用**，或仅有孤证/矛盾证据。不得凭此清单之外的假设给端点加参数。

| 参数（传闻形态） | 调研结论 | 证据状态 |
|---|---|---|
| `merge_multi_keyword_results`（任务假设中提及） | **不存在/未证实**。GitHub 全网代码检索 `merge_multi_keyword_results` 零命中；所有实现（Shaft、pixez、Mako、pixivpy、pxder、pixiv-viewer）实际使用的是 `merge_plain_keyword_results` | `gh search code "merge_multi_keyword_results"` 无结果（2026-09-12）；六家实现均为 `merge_plain_keyword_results` |
| `ratio`（单值参数） | **非 AppAPI 参数**。AppAPI 长宽比参数是 `ratio_pattern`（landscape/portrait/square）。带 `ratio` 的是 **Pixiv Web ajax 搜索 API**（`/ajax/search/...`），取值为区间字符串：`"0.5-"`（横）、`"-0.5"`（竖）、`"0.5-0.5"`（方），同族还有 `wlt/wgt`（宽上下限）、`hlt/hgt`（高上下限） | xiaoyvyv/bangumi `shared/data/src/commonMain/kotlin/com/xiaoyv/bangumi/shared/data/api/pixiv/PixivAjaxApi.kt` L502（`@Query("ratio")`）+ `PixivIllustSearchRatio.kt`（0.5- / -0.5 / 0.5-0.5）；PixivWebApi 非官方文档未收录 ratio（文档自述可能不完整）。任何 AppAPI 客户端均未发 `ratio` |
| `width` / `height`（单值、「下限过滤」语义） | **未证实为 AppAPI 参数**。AppAPI 分辨率参数是四参数 `width_min/width_max/height_min/height_max`（px 双闭区间）。单值 `width`/`height` 仅存在于 Web ajax API（`wlt/wgt/hlt/hgt`） | 所有 AppAPI 实现（Shaft/Mako/pixiv-viewer）均用 `_min/_max` 四参数；无任何实现发单值 `width`/`height` |
| `search_ai_type=2`（仅看 AI） | **有第三方实测（中等偏高可信），但官方 app 不使用**。[pixivpy#410](https://github.com/upbit/pixivpy/issues/410) 实测 0/1/2 三值（附 log.json）；Shaft 则断言「官方只有 0/1 两态，仅看 AI 由客户端按 `illust_ai_type==2` 过滤」（其对齐对象是官方 app 行为，非服务端能力上限） | pixivpy#410（实测）；Shaft `SearchFilterV3.kt` L255-258（官方两态说）；两者不矛盾：服务端可能收 2，官方 app 不发 2。Pictelio 若用 2 属「超官方行为」，需自担兼容风险 |
| `duration` 在 novel 端的五档（`within_last_half_year` / `within_last_year`） | novel 端 `duration` 参数本身有实证（Pix-EzViewer 直发、materixiv novel 菜单含 duration），但五档枚举值主要从 illust 侧 UI 采集，novel 端是否接受 half_year/year 两档**未单独验证** | illust 五档：pixiv-viewer `SearchRes.vue` L271-278 + materixiv illust 菜单；novel：materixiv novel 菜单有 duration 项（具体档位未逐项确认）；pixivpy `search_novel` 无 duration 形参 |
| `bookmark_num`（novel 端单值形态） | pixez / Pix-EzViewer 在 novel 端发单值 `bookmark_num`，与 min/max 对并存。单值是否仍被服务端消费（还是已被 min/max 取代）**未验证** | pixez `api_client.dart` L472/L481；Pix-EzViewer `PixivApiService.kt` L200。新世代（Shaft/Mako）一律 min/max |
| popular-preview 端点接受 `sort` | **不存在**。两个预览端点均无 sort 维度（Shaft 预览方法无 sort 形参；`SearchIllustRepo.kt` L98-99 明确 sort 值混端点会 400） | Shaft `API.kt` L361-408、L667-704 |
| 旧版「机内自带热度排序」自定义 sort 值 | Shaft 记录其存在过但已被服务端下线（原样发会 `400 Invalid value`），现归一到 `popular_desc` | Shaft `SortType.kt` `sanitize`（「TRENDING_BUILTIN → POPULAR_DESC」）+ `SearchNovelRepo.kt` L520-522 注释 |

## 7. 免费（非 Premium）账号受限参数清单

| 参数/功能 | 限制形态 | 证据 |
|---|---|---|
| `sort=popular_desc`（及 `popular_male_desc` / `popular_female_desc`） | **硬限制：非会员直发 `/v1/search/{illust,novel}` → 400**。非会员替代路径：① `/v1/search/popular-preview/*` 端点（热度预览，无 sort、不分页）；② `Xusers入り` 关键字后缀；③ 客户端采样重排（PixivBiu 方案） | Shaft `SearchIllustRepo.kt` L100-103（「非付费用户不能用人气系列 sort……必然 400」）、L115-118（借号方案）；PixivBiu `handler_search.go` L26-29 + `frontend/src/features/search/api.ts` L27-31（「Pixiv's popular_desc is Premium-only」，本地重排替代）；Mako `MakoClient.CheckWorkSortOption`（sort 校验入口） |
| `bookmark_num_min` / `bookmark_num_max` | **会员限定：非会员发 `date` 排序 + bookmark 区间 → 服务端静默忽略**（不报错、不过滤），结果需客户端兜底；popular-preview 端点则完全忽略该组参数。候选档区间本身由 `/v1/search/options` 下发 | Shaft `SearchIllustRepo.kt` L109-114 + `SearchNovelRepo.kt` L98-101；`SearchIllustRepo.kt` L549、`SearchFilterV3.kt` L164-168 |
| novel 正文长度（`text_length` / `word_count` / `reading_time`） | **非会员仅可用四档预设区间**（字数/单词数：≤4999、5000-19999、20000-79999、≥80000；阅读用时：≤9、10-59、60-179、≥180 分钟），任意区间组合为会员功能。Mako 在客户端对非会员强制校验，不合规区间直接置空 | Mako `SearchArgumentsBase.cs` L107-136（`!(makoClient.Me?.IsPremium ?? false)` 分支）+ `SearchNovelContentLengthOption.cs` 各枚举 remarks（非会员选项 code） |
| `genre`（novel） | 非 Premium 限制证据不足，但有前置条件：需搭配 `is_original_only=true`；候选 id 由 `/v1/search/options` 动态下发（可能随账号态变化） | Mako `SearchArgumentsBase.cs` L99-102；Shaft `SearchOptionsResponse.kt` L46-53 |
| 收藏内搜索 / 收藏数检索（官方功能面） | 官方确认「收藏内搜索」为 Premium 限定；社区共识「按收藏数/人气精准筛选」属高级搜索（Premium）能力 | [pixiv 官方公告 info.php?id=13612](https://www.pixiv.net/info.php?id=13612)（收藏内搜索仅对 Premium 开放）；[PixivBiu 官网](https://biu.tls.moe/)（「可**免会员**按收藏数、人气……」反证官方需会员） |

---

## 8. 竞品筛选维度实现对照（速览）

| 维度（query 参数族） | Shaft 新版（iOS 8.6.x 对齐） | Mako/Pixeval | pixez-flutter | pixivpy3 | PixivBiu(Go) | pixiv-viewer |
|---|---|---|---|---|---|---|
| sort / search_target / word / filter / offset | ✅ | ✅ | ✅（offset 走 next_url） | ✅ | ✅（offset 直发） | ✅ |
| duration / start_date / end_date | 只发日期（iOS 行为） | 只发日期 | 只发日期 | ✅ duration | ✅ duration | duration→换算成日期 |
| search_ai_type | ✅ 0/1 | ✅ 0/1 | ✅ 0/1 | ✅ 0/1 | ✅（exclude_ai→1） | ✅ |
| bookmark_num_min/max | ✅（会员路由/借号/客户端兜底） | ❌ 未实现 | ✅（illust min/max；novel 单值） | ❌ | ❌ | ❌ |
| ratio_pattern / content_type / width_* / height_* / tool / lang（illust） | ✅ 全量 | ✅（lang 仅 novel） | ❌ | ❌ | ❌ | ✅ 全量 |
| include_translated_tag_results / merge_plain_keyword_results | ✅ | ✅ | ✅（URL 固定） | ✅（novel） | ❌ | ✅ |
| include_potential_violation_works | ❌（特意不传） | ✅ false | ❌ | ❌ | ❌ | ✅ |
| novel 正文长度三单位 / genre / is_original_only / is_replaceable_only | ✅ 全量 | ✅ 全量（含非会员 band 校验） | ❌ | ❌ | ❌ | ✅ |

## 9. 附录：Pictelio 现状对照（只读调研）

### 9.1 webview 端（`packages/app/src/api/search.ts`）

- `searchIllust` / `searchNovel`：仅传 **`word`、`sort`、`search_target`、`filter: "for_ios"`** 四参（`search.ts` L21-44 / L45-68）。
- `sort === "popular_desc"` 时路由到 `/v1/search/popular-preview/{illust,novel}`，且**只传 `word`、`search_target`、`filter`**（无任何筛选参数）。
- 分页直接跟随 `next_url`（`searchIllustNext`/`searchNovelNext`，带 SSRF 域名断言）。
- 自动补全 `/v1/search/autocomplete` 传 `word` + `merge_dict: "true"`。
- **未使用**：duration、日期、bookmark 区间、ratio_pattern、content_type、width/height、tool、lang、正文长度、genre、原创/置换开关、search_ai_type、include_potential_violation_works。

### 9.2 lynx 端（`packages/app-lynx/src/api/search.ts`）

- 与 webview 版「逐字对齐」（文件头注释，ADR-0132 第 8 条）：同样只传 **`word`、`sort`、`search_target`、`filter: "for_ios"`**（L49-89）。
- 差异：`searchTarget` 默认值按词派生——`word.includes(" ")` → `exact_match_for_tags`，否则 `partial_match_for_tags`（`deriveSearchTarget` L18-20）；popular_desc 路由 popular-preview 同 webview。
- next_url 断言同构（`assertPixivUrl`，失败路径有 `console.warn`）。

### 9.3 差距小结（供后续拍板参考，不在本票实施）

1. **两端搜索当前是「裸四参」**，官方支持的筛选维度（日期/duration、AI 过滤、正文长度等**免费可用**项）一个都没用上。
2. `search_target` 两端语义不一致（webview 恒默认 `partial_match_for_tags` 显式发送 → 丢标题命中；lynx 按空格派生）。按 Shaft #906/#1038 的实测结论：illust 端**不传**优于显式 partial（并标题命中）；novel 端**必须显式 partial**（同义词展开），两端现状恰好各踩一半坑。
3. popular_desc 路由 popular-preview 与官方 app 行为一致（该端点本就是非会员可用路径），但当前未利用其可接受的筛选参数（§3/§4：除 bookmark 区间外全量可用）。
4. 若引入 bookmark 收藏量筛选，必须考虑会员限制（§7）：非会员静默无效，需客户端兜底或 `Xusers入り` 关键字后缀方案。

## 10. 证据强度说明与主要外部来源

- **Tier 1（第一手抓包/实测注释）**：Pixiv-Shaft 新版源码注释（自述对齐 iOS 官方 app 8.6.5/8.6.6/8.7.3 抓包，含 issue 编号 #906/#1038/#909/#575 交叉引用）；[upbit/pixivpy#410](https://github.com/upbit/pixivpy/issues/410)（附实测 log.json）。
- **Tier 2（多实现一致）**：`search_target`/`sort`/`filter`/`search_ai_type`/`merge_plain_keyword_results` 等基础参数族在 6 家独立实现中一致。
- **Tier 3（孤证）**：novel 端 `duration` 五档、novel 端单值 `bookmark_num`、Web 端 `ratio` 区间串——均已在正文标注。
- 外部链接：
  - [upbit/pixivpy#410 — search_ai_type 语义实测](https://github.com/upbit/pixivpy/issues/410)
  - [PixivWebApi 非官方文档](https://pixivsource.pages.dev/PixivWebApi)（Web ajax API 对照；未收录 ratio/wlt 等，文档自述可能不完整）
  - [pixiv 官方公告：收藏内搜索 Premium 限定](https://www.pixiv.net/info.php?id=13612)
  - [pixiv 官方帮助：搜索时过滤 AI 生成作品](https://www.pixiv.help/hc/zh-cn/articles/18685842478361)
