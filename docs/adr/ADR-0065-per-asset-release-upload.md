# ADR-0065：Release 资产逐包上传（每包独立 gh 进程 + 上传面板 + 失败隔离）

## 背景

正常发布 step 6（`scripts/release.mjs`）与覆盖发布（`scripts/release-overwrite.mjs`）把三个变体 APK 一次性交给单条 `gh release upload <tag> --repo <repo> --clobber ...`，脚本层只有一个聚合 spinner「上传 APK (第 x 次)」；任一包失败时整批重传（含已成功的包）。实测（v4.4.0，2026-08-06，代理 127.0.0.1:10808）一次成功上传 86MB 耗时 **456s**（出口约 190KB/s）：失败重试的代价是整批 86MB 重来，且界面无法定位是哪个包慢或卡住。

## 决策

1. **逐包上传**：每个变体 APK 独立启动一条 `gh release upload <tag> --repo <repo> --clobber <path>` 子进程；并发数 = 变体数（1–3），不提供配置项。gh 单命令内部虽已并发（Concurrency=5），拆分的目的不是提速首轮，而是逐包可见性与失败隔离。
2. **失败语义**：单包独立重试最多 3 次（1s/2s/4s 退避），互不阻塞；全部结束后任一包失败则整体失败，已成功的资产保留在 Release 上；重跑只补失败包（`--clobber` 幂等）。
3. **上传面板**：TTY 下每包一行（变体 / 状态 / 文件大小 / 已耗时 / 重试次数 / 完成后平均速率），非 TTY 降级为逐事件文本行；不引入 ora，手写最小 ANSI 控制。
4. **统一编排**：step 6 与 `-o` 共用同一上传编排模块（`scripts/lib/release-uploader.mjs`）；`-o` 备份保持单条 `gh release download`，失败恢复只针对失败资产。
5. **预期管理**：首轮墙钟受代理出口吞吐限制，本次不承诺提速首轮；收益集中在失败场景（不再整批重传）与逐包定位。

## Considered Options

- **单命令聚合上传**（gh 已内置并发）：改动最小，但无法逐包展示，失败整批重传——否决。
- **字节级进度**：gh 不提供逐文件字节进度；自行实现上传（token、`--clobber` 删除、重试、上传端点重定向）损害安全与可维护性——否决。
- **并发可配置**（如 `PICTELIO_UPLOAD_CONCURRENCY`）：逐包重试已兜底失败场景，无现实需求——否决。

## Consequences

- 每次上传比单命令多 2 次 `FetchRelease` API 调用与进程启动开销（可忽略）。
- step 6 的 catch 恢复指引改为逐包命令；`docs/release-checklist.md` 同步更新。
- `release-overwrite.mjs` 的 `runGh` 依赖形状随统一模块调整，对应单测同步更新。
- 术语：`packages/app/CONTEXT.md` 新增「变体 APK / 逐包上传 / 上传面板」。

## 关联

- 实测数据：v4.4.0 上传 456s（代理 127.0.0.1:10808）
- 术语：packages/app/CONTEXT.md（发布上传）
