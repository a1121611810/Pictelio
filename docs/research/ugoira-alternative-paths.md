# Ugoira 播放替代方案调研（第二弹）：Android WebView 端除降级外还有什么路

> 记录日期：2026-08-31（本文件为会话内一手实验 + 联网检索合稿；后台调研代理同主题产出并入 §附）
> 触发背景：用户追问「range 是官方方案为何失效——那**还有别的方案**吗？联网深入找找」。
> 前置文档：`docs/research/ugoira-range-official-scheme-research.md`（官方 zip_player vs 我们拦截层）、
> `docs/research/ugoira-playback-flicker-range-proto.md`（CDP 实测）、ADR-0126（已采纳降级方案）。

## 0. 已被实验排除的路径（不复述细节，引用证据）

| 路径 | 排除依据 |
|---|---|
| 直连 CDN 绕过拦截器（fetch 绝对 URL） | i.pximg.net 防盗链严格：无 Referer→403、`Referer: https://localhost/`→403、`Referer: https://app-api.pixiv.net/`→206（host curl 实测 2026-08-31）；且 fetch 规范中 Referer 是 forbidden header name，JS 无法伪造 → **不可行** |
| 拦截器实现 Range/206 | CDP 实测：start>0 拦截 206 截断为 1B / `net::ERR_FAILED`（原型报告 §2.2） |
| 原生端隐藏 range 设置 | 妥协方案，用户否决（取消诉求） |

## 1. 方案 A：流式 fflate 渐进播放（「边下边播」，不依赖 Range）——**推荐第一优先**

### 1.1 一手证据：fflate `Unzip` 是真正的流式 ZIP 解压器

仓库依赖 fflate 0.8.3（`node_modules/.pnpm/fflate@0.8.3`，本文件直接读其类型与 README）：

- `lib/index.d.ts` L1489-1522：`class Unzip { constructor(cb?: UnzipFileHandler); push(chunk: Uint8Array, final?: boolean): void; register(decoder): void; onfile: UnzipFileHandler }` —— **逐块喂入 + 逐条目回调**。
- README L338-350：`new fflate.Unzip()` → `unzipper.onfile = file => {...}` —— 流式用法即「push 一段、出一个条目」，**不需要中央目录**（本地头解析），store 条目无需注册 decoder（Pixiv ugoira zip 全 store，原型与研究文档已证）。
- README 对比原生 CompressionStream（L536）：fflate 对大字节流性能无劣势。

### 1.2 决定性实验：Pixiv zip 条目顺序 == 帧顺序（渐进播放的前提）

真实作品 148861562（52 帧）zip 中央目录实测（host Range 抓尾部 30KB → EOCD → 中央目录解析）：

```
entries(per EOCD): 52  cdSize 2912  cdOffset 2530002
first 6: 000000.jpg ... 000005.jpg   last 4: 000048.jpg ... 000051.jpg
zip 条目顺序 == 数值序: True  非帧条目: []   （共 52 帧条目）
```

→ 帧文件按序打包、无杂条目；`meta.frames[i].file` 也是同一序。
**推论**：用 `fetch` 现有全量 200 通道（拦截器正常路径，已验证可用）读 body，
边读边 `Unzip.push(chunk)`，`onfile` 按帧序触发——**第 N 帧到达即可播第 N 帧**，无需等全量。

### 1.3 收益与成本

| 维度 | 现状（降级 fflate 全量） | 方案 A（流式渐进） |
|---|---|---|
| 首帧延迟 | 全量下载完（~8s @12.9MB） | 前几帧到达即播（帧均几十 KB，预计 **1-3s**，依赖网速） |
| 内存峰值 | 全量 zip 驻留 JS + 全帧 blob | zip 已读部分 fflate 不保留；已播帧 blob 可逐帧 revoke（峰值更低） |
| 传输 | 全量 200（不变） | 全量 200（**不变**，不碰拦截层） |
| 代码面 | — | `illust.ts`：fetch reader → `Unzip.push` 循环 + `onfile` 接播放器；防御：首条目名 ≠ fileOrder[0] → 回退现有 unzipSync 全量路径（zip 异常自愈） |
| 可测试性 | — | `Unzip` 是纯函数库；可用构造 zip 字节流分片 push 单测（增量帧回调断言） |

### 1.4 风险与边界

- 顺序假设基于实测样本（2 个作品：148861562 52 帧、149104861 406 帧 metadata 同为 000000.jpg 序）；
  用「首条目名比对」防御，不成立即回退——无正确性风险，只有收益损失。
- 进度语义：现有进度环（0-100%）改为「已出帧数/总帧数」或保留下载字节进度均可。
- 该方案**不解决**「只取需要的帧省流量」（那需要 Range，被拦截层否决）——它解决「更快出图、更低峰值内存」。

## 2. 方案 B：Capacitor 原生桥批量 Range（绕开拦截层的真 Range）——备选

- 原理：新增 Java 方法（PixivApiPlugin 系）批量 Range（OkHttp 206 已验证 + Referer/UA 注入现成）→ 回调 base64/字节 → JS 解析。字节经桥进入 JS 堆——app webview 端 fflate 现状本就全量进 JS 堆，ADR-0037「零进 JS 堆」仅约束 lynx 原生管线，不新增架构违规。
- 代价：新原生方法 + JS 契约 + 测试；base64 膨胀 33%；逐帧 2 次 Range × 帧数的 RTT 累积需批量（每回调 N 帧或整批偏移表）。
- 结论：流量节省场景（大 zip 只看前几秒）才有意义；在方案 A 已覆盖「快出图 + 低内存」后，B 的边际价值低——**仅在 A 验证后仍不满足需求时再上**。

## 3. 方案 C：Pixiv「视频直链」（覆盖面存疑，不投入）

- 社区证据：ugora 转 mp4 全是**社区客户端转码**（如 memotut 教程「Convert pixiv to mp4…用 pixivpy」），非官方直链；2026-08-31 实测新作品（caption 含 "2:32 min Video [動画]"）API 仍 `type: "ugoira"`、`ugoira_metadata` 只有 `zip_urls+frames`，无 video 字段。
- 若未来 pixiv 为视频化作品提供直链（`pixiv-app-api` npm 类型中暂未见 `video_urls` 证据），`<video>` 元素加载同样走 shouldInterceptRequest（200 全量可播、Chromium 原生渐进缓冲）——但仅覆盖少数作品，且需另起专项核验 API。
- 结论：**依据不足，不做主路径**。

## 4. 方案 D：WebView 版本演进（无证据，不可依赖）

- 模拟器 WebView 113.0.5672.136（com.google.android.webview）。
- 两轮检索（"shouldInterceptRequest 206"、"WebResourceResponse partial content"、crbug 等）**无公开 issue/修复记录**表明拦截 206 行为已修；生态旁证仍只有 Capacitor #1343（对 Range 回 200 全量）、flutter_inappwebview #1893（Content-Length 算错）。
- 即使新版修复，用户设备 WebView 更新不可控（minSdk 28 老设备尤甚）→ 不能作为产品依赖。

## 5. 方案 E：服务端转码 / 其他（排除）

- 本项目无服务器（GitHub Pages 静态 + 纯客户端）；ffmpeg.wasm 32MB+（研究文档 §7.4 实测）——维持排除。

## 6. 方案矩阵与推荐

| 方案 | 可行性 | 首帧/性能收益 | 成本 | 备注 |
|---|---|---|---|---|
| **A 流式 fflate 渐进** | ✅ 可行（依赖已存在，顺序已实测） | 首帧 8s→1-3s（估），峰值内存下降 | 低（illust.ts + 播放器接线 + 回退防御） | **优先原型** |
| B 桥批量 Range | ⚠️ 需原型 | 流量按需（省流量）但出图不一定更快 | 中高（新原生面+批量契约） | A 不足时再上 |
| C 视频直链 | ❌ 依据不足 | — | — | pixiv 无公开直链证据 |
| D WebView 版本 | ❌ 无修复证据 | — | — | 设备更新不可控 |
| E 服务端转码 | ❌ 无服务器 | — | — | 维持排除 |

**推荐试验顺序**：A 先做原型（Web dev 即可验证逻辑与增量出帧；设备端验证首帧收益）→
A 落地后若仍有「省流量」硬需求再评估 B。

## 附：后台调研代理同主题产出（若与本文件合并时保留此节）

- （占位）后台代理 `调研 ugoira 替代方案矩阵` 的独立成稿将并入本文件或单独留存；
  本文件 §1-§6 结论以会话内一手证据为准。

## 关键来源

1. fflate 0.8.3 类型与 README（仓库 node_modules，一手）：`Unzip.push/onfile/register`
2. 真实 Pixiv zip 中央目录实测（本会话 host Range 抓取 + 解析）：148861562，52 帧条目按序
3. i.pximg.net 防盗链实测（本会话 curl）：无/错误 Referer→403，app-api Referer→206
4. https://github.com/ionic-team/capacitor/issues/1343 （同路径生态旁证）
5. https://github.com/pichillilorenzo/flutter_inappwebview/issues/1893 （Content-Length 计算错误旁证）
6. https://memotut.com/en/efe6eda433b09ec34203/ （社区 ugoira→mp4 转码证据：无官方直链）
