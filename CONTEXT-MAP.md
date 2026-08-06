# CONTEXT Map

Pictelio 是多包 monorepo，各包的领域上下文相互分离。本文件将每个上下文映射到各自的 `CONTEXT.md`。

| Context  | 包                  | CONTEXT.md                        | 领域                                     |
| -------- | ------------------- | --------------------------------- | ---------------------------------------- |
| `app`    | `packages/app`      | `packages/app/CONTEXT.md`         | 主应用 SPA：浏览导航、错误处理、阅读     |
| `app-lynx` | `packages/app-lynx` | `packages/app-lynx/CONTEXT.md`    | Lynx 客户端（尚未创建，按需补充）        |
| `ugoira` | `packages/ugoira`   | `packages/ugoira/CONTEXT.md`      | 动图播放共享包（尚未创建，按需补充）     |
| `website`| `packages/website`  | `packages/website/CONTEXT.md`     | 落地页（尚未创建，按需补充）             |

## 使用规则

- 进入某个包的代码前，先读该包的 `CONTEXT.md` 获取术语与领域理解。
- `CONTEXT.md` 不存在时**静默继续**，不要为缺失标记，也不要立即创建 —— `/domain-modeling` 会在术语或决策真正确定时按需创建。
- 系统级决策统一在根目录 `docs/adr/`；上下文级决策放在 `packages/<context>/docs/adr/`。
