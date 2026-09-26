# 术语表：标签静音（Tag Mute）

> 状态：Accepted ｜ 日期：2026-09-26 ｜ 关联：ADR-0187、`docs/specs/tag-mute.md`
> 来源调研：竞品对标（pixez `mute_store` 四类 BanTag、Shaft 按标签静音 + 单作模糊、Pixeval `BlockedTags`、PBD 按用户屏蔽标签、pixiv-viewer 标签黑名单）；本仓先例（ADR-0092 `createPersistedSet`、ADR-0103 账号级内容设置、ADR-0155 AI 三态、ADR-0160 收藏加标签）。

## 核心术语

| 术语 | 定义 | Avoid（避免混用） |
| --- | --- | --- |
| **静音标签（muted tag）** | 被用户加入本地静音集合的**原始标签名**（`tag.name`，trim 后逐字存储） | 「屏蔽标签」（屏蔽在本仓已被 blockStore＝屏蔽**用户**占用） |
| **静音集合（mute set）** | 全部静音标签的字符串集合，账号级持久化键 `mute_tags_${uid}` | 「黑名单」（pixiv 官方 mute 是账号级服务端能力，本功能是本地能力，勿混称） |
| **标签静音（tag mute）** | 对含任一静音标签的作品做**数据层移除**（非遮罩）的行为 | 「过滤」（R18/AI 过滤是既有谓词链，标签静音是链上新谓词，单说「过滤」有歧义） |
| **匹配（match）** | 作品 `tags[].name` 经 `trim()` 后与静音集合做**精确相等**判定 | 「模糊匹配」「翻译名匹配」（v1 不做大小写折叠/全半角归一/translated_name 匹配） |
| **静音管理页（mute list UI）** | 查看/移除静音标签的界面：webview 为底部 Sheet（`MuteTagSheet`，复刻 BlocklistSheet 形态）；lynx 为独立路由页 `/mute-tags` | 「BlocklistSheet」（那是屏蔽用户管理，只作形态模板） |
| **盲区（blind spot）** | 不过滤静音标签的表面。v1 与 R18/屏蔽口径对齐：webview 搜索结果与浏览历史**维持现状不过滤** | — |

## 与既有概念的边界

- **vs 屏蔽用户（blockStore `blocked_user_ids`）**：屏蔽按**作者**维度、设备级集合；标签静音按**标签**维度、账号级集合。两者同处 `filterFeedIllusts` 谓词链，互不替代。
- **vs R18/R18G 分级、AI 三态**：分级与 AI 是**内容属性**判定（开关/模式驱动）；标签静音是**用户词表**判定（集合成员驱动）。注入层级相同（同一过滤函数内并排）。
- **vs pixiv 官方静音（mute）**：官方静音是账号级服务端能力（`is_muted` 字段下发）；本功能是纯本地词表，不调用任何服务端端点、不与服务端状态同步（`api/types.ts:248` 的 `is_muted` 字段消费仍是独立挂账项）。
- **vs 搜索关键词**：搜索入口以原始 `tag.name` 发起（webview `SearchableTag.tsx`、lynx `IllustDetail.vue` 标签行）；静音集合同样以原始 name 为锚，两者语义同源。

## 歧义记录

1. 「静音」与「屏蔽」在中文语境常互换——本文档与 ADR-0187 一律：**屏蔽＝用户维度**、**静音＝标签维度**。
2. lynx 端 R18/AI 走遮罩（渲染层盖卡）而标签静音走移除（数据层过滤）——两者并存是有意差异（ADR-0187 D4），评审时勿以「不一致」退回。
