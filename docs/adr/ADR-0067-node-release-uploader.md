# ADR-0067：Release 上传改用 Node 原生上传器（默认直连）+ 代理路径提示

## 背景

研究文档 `docs/research/github-release-upload-acceleration.md`（2026-08-07）确认：

- `uploads.github.com`（CNAME → 新加坡 Azure 20.205.243.161）与 `api.github.com` 同网段；大陆慢的物理根因是**国际链路吞吐/丢包**，非客户端。
- gh CLI 每次 `gh release upload` 都先 `FetchRelease`（走 api.github.com，直连首字节 1.5s+）+ CLI 启动开销；Node/Bun 原生上传器缓存 `upload_url` 复用连接，实测端到端吞吐约为 gh 的 **2.1×**（并发 3×6MB：5.73 vs 2.74 MB/s，附录 C）。
- 直连 vs 代理实测：直连更快（gh 1.48 vs 1.22 MB/s）且无 api.github.com 走代理的间歇 403 风险；Node https 默认不读代理环境变量 = 天然直连。
- 四维评估（可维护/性能/安全/内存）Node 方案全达标：0 第三方依赖、~55 行核心、token 走 gh keyring、流式 O(1) 内存。

## 决策

1. **上传实现默认改为 Node https 原生上传器**（`scripts/lib/upload-release-assets.mjs`），替代 gh 子进程的上传段；保留逐包编排、上传面板、失败隔离（ADR-0065 不变）。
2. **默认直连**：Node https 不读代理环境变量，绕过代理（实测直连更快、无 403 风险）。环境变量 `PICTELIO_UPLOADER=gh` 可回退到 gh 子进程（`scripts/lib/release-uploader.mjs` 的 `resolveUploader` 出口）。
3. **clobber 语义**（对齐 gh `--clobber`）：上传返回 422（同名已存在）→ 查 assets 列表 → DELETE 同名 → 重传一次；列表无同名则标 permanent 立即失败（不无限循环）。
4. **错误语义**：网络错误 / HTTP ≥ 500 → 可重试（沿用 1s/2s/4s × 3）；其他 4xx（401 token 无效、422 处理后的残余冲突）标 `permanent` **立即失败不重试**（`uploadOne` 支持 `e.permanent` break，失败报告记录实际尝试次数）。
5. **token**：`gh auth token`（gh keyring）取，不写入环境变量、不打印日志；失败后下次重试重新获取。
6. **代理路径提示**（`scripts/lib/proxy-probe.mjs`，按 Go httpproxy 语义，含 NO_PROXY 子域匹配）：上传前打印「本次将走直连/代理」；走代理时按上传器给出提示（Node 直连说明 / gh 的 NO_PROXY 固化建议）。
7. release 信息（id / upload_url）按 tag 做 **promise 级缓存**：并发多文件只 GET 一次 `releases/tags/{tag}`，复用连接。

## Considered Options

- **继续 gh CLI**：可维护性最高（0 行自维护），性能 2.1× 短板，且每次调用重新 FetchRelease —— 否决（研究附录 C 判定 Node 方案四维达标）。
- **Bun 上传器**：内存最低（46 vs 76 MB）、代码最少（15 行，fetch 原生代理支持），但引入 Bun 运行时依赖 —— 本仓库为纯 Node 栈，暂不引入；Node 方案性能等价（5.73 vs 5.70 MB/s）。
- **GitHub Actions 云端构建 + 上传**：根治大陆链路，但需把 keystore 密码等搬进 repo secrets、改动最大 —— 记录为后续可选方向（研究推荐动作 5），本次不做。
- **R2 / upload-artifact 中转**：低频 3 包引入新依赖不值 / 本机不可用 —— 否决（研究第 6 条）。

## Consequences

- 正常发布（step 6）与覆盖发布（`-o`）共用 Node 上传器；dry-run 与失败恢复指引仍展示 gh 命令（人工可执行的等效操作）。
- 不再依赖 gh 内部 200ms×3 重试；脚本层 1s/2s/4s 退避成为唯一重试层。
- 上传不再产生 gh 子进程与每次 FetchRelease 开销；`gh auth token` 仍是唯一 gh 依赖（keyring 取 token，一次性）。
- `release-uploader.test.ts` 现有 gh 适配器用例不变（seam 保持）；新增 `proxy-probe.test.ts` 与 `upload-release-assets.test.ts` 覆盖直连/代理判定、token/uploadUrl 缓存、422 clobber、permanent/retryable 错误分类。

## 关联

- 研究：`docs/research/github-release-upload-acceleration.md`（附录 A/B/C）
- 前序决策：ADR-0065（逐包上传编排，保持）
- 术语：`packages/app/CONTEXT.md`（发布上传）
