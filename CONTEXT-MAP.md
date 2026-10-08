# CONTEXT Map

Pictelio 是多包 monorepo，各包的领域上下文相互分离。本文件将每个上下文映射到各自的 `CONTEXT.md`。

| Context | 包 | CONTEXT.md | 领域 |
| -------- | ------------------- | --------------------------------- | ---------------------------------------- |
| `app-lynx` | `packages/app-lynx` | **已创建**（活跃维护） | Lynx 客户端 —— 唯一运行时形态（列表浏览、受限内容、分页、小说导航、领域词汇） |
| `android-host` | `packages/android-host` | **已创建**（活跃维护） | 构建宿主：Gradle 链、Lynx 原生模块、发布脚本、E2E 与 JVM 单测（不是客户端） |
| `ugoira` | `packages/ugoira` | **未创建** | 动图（Ugoira）zip 帧处理纯函数（fflate 解压 / Range 切片） |
| `update-check` | `packages/update-check` | **→** [ADR-0089](docs/adr/ADR-0089-update-check-architecture.md) | 更新检查纯逻辑（版本比较 / version.json 拉取 / 超时兜底） |
| `novel-export` | `packages/novel-export` | **→** [spec: novel-export](docs/specs/novel-export.md) | 小说导出纯逻辑（提取 / 块解析 / payload / 格式表） |
| `search-core` | `packages/search-core` | **→** [spec: search-advanced-filters](docs/specs/search-advanced-filters.md) | 搜索纯逻辑（筛选状态 → 请求参数 / URL 编解码 / 缓存键） |
| `ranking-core` | `packages/ranking-core` | **→** [spec: ranking](docs/specs/ranking.md) | 排行榜纯逻辑（维度目录 / 请求构建 / 缓存键 / 日期函数） |
| `net-diagnostics` | `packages/net-diagnostics` | **→** [spec: network-self-check](docs/specs/network-self-check.md) | 网络自检纯逻辑（检查项 / 判定 / 文案 / 报告） |
| `website` | `packages/website` | **未创建** | Astro 落地页（GitHub Pages 部署） |

> `packages/app-nuxt` 为未跟踪的空壳目录（仅 node_modules 残留），不是 workspace 包，不计入。
> 第三列指向该包**词汇层入口**（CONTEXT.md / spec / ADR），单一事实源——不为一包维护两份词汇文档。
> 「未创建」= 词汇即代码本身、无独立文档（ugoira / website），是如实标注的真实缺口，由实际工作触发 `/domain-modeling` 按需补齐。

## 使用规则

- 进入某个包的代码前，先读该包的 `CONTEXT.md` 获取术语与领域理解。
- `CONTEXT.md` 不存在时**静默继续**，不要为缺失标记，也不要立即创建 —— `/domain-modeling` 会在术语或决策真正确定时按需创建。
- 系统级决策统一在根目录 `docs/adr/`；上下文级决策放在 `packages/<context>/docs/adr/`。
- ADR 总索引（按编号分组 + 被引统计）见 [docs/adr/README.md](docs/adr/README.md)，由 `scripts/generate-adr-index.mjs` 生成，勿手改。
