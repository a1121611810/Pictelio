# 流式 fflate 渐进播放 原型取证报告（2026-08-31）

> 原型分支（throwaway，oracle 留档）：`prototype/ugoira-stream-frames`
> 验证问题：方案 A「流式 fflate 边下边播」在真实 Pixiv zip 上是否成立？
> 环境：node（仓库 @pictelio/ugoira，fflate 0.8.3）；真实样本 148861562（52 帧，2,532,936 字节）
> 运行：`pnpm --dir packages/ugoira test -- --run tests/streamFramesProto.test.ts`（24/24 通过）

## 一、验证项与结果（不可模糊）

| # | 验证项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 真实 zip 元数据：52 帧、条目序==数值序 | ✅ | parseZipEocd/parseZipCentralDir（共享包同源函数）解析：000000.jpg…000051.jpg |
| 2 | **帧数据就绪水位（ondata final 时刻）** | ✅ 帧0 就绪 @**1.9%**（8KB 分片，49KB/2.5MB） | 分片喂入诊断输出（见下） |
| 3 | 流式产出与 unzipSync（现有全量路径）逐字节一致 | ✅ 52/52 帧 Buffer 相等 | 三方对照：streamFrames byName vs unzipSync map |
| 4 | 乱序 zip（物理序倒置）防御：按名映射+缓冲仍按帧序输出 | ✅ 52/52 帧字节一致 | buildReversedZip 构造倒序 zip 后重跑 |

### 帧就绪时间线（诊断输出原文）

```
chunk=8KB   帧0 就绪@1.9% (49152B)  帧9 就绪@17.5%  帧51 就绪@99.9%
chunk=64KB  帧0 就绪@2.6% (65536B)  帧9 就绪@18.1%  帧51 就绪@100%
chunk=256KB 帧0 就绪@10.3% (262144B) 帧9 就绪@20.7% 帧51 就绪@100%
```

## 二、结论

1. **可行性成立**：fflate `Unzip` 分片喂入时按 wire 序增量触发条目；**帧数据在 ondata(final) 完整交付**（onfile 仅本地头到齐即触发，播放器必须消费 ondata(final)）。
2. **首帧收益确定**：帧 0（~49KB）在下载 2% 时即可播放；帧 0-8 在 18% 前全部就绪。对 2.5MB/52 帧作品，首帧等待从「全量下载完」→「~2% 下载完」；对 12.9MB/406 帧大作品（149104861 级），首帧约 250KB 即出（同比例）。
3. **正确性有保障**：流式字节与现有 unzipSync 全量路径逐字节一致；乱序 zip 下按名映射 + 缓冲仍输出正确（防御设计，与官方 zip_player 按名取帧同构）。
4. **落地面**：共享包新增流式取帧器（内部 Unzip + 按名映射 + 乱序缓冲），app `illust.ts` 用 fetch reader 边读边 push；异常/损坏 zip → 回退现有全量路径（原型 3 已证两路径字节等价，回退无缝）。

## 三、遗留/边界（实现阶段处理）

- 播放器接线：当前 UgoiraViewer/IllustDetail 是「全帧就绪才播」；渐进模式需要「帧就绪即追加」——播放器帧列表改增量增长（spec 实现决策）。
- 进度语义：进度环从「下载字节 %」改为「已就绪帧/总帧」或保留下载字节进度（spec 决策）。
- 非帧条目：实测样本无；streamFrames 按 fileOrder 过滤（防御）。
- 乱序缓冲上限：最坏 = 全帧缓冲（与现状全量等价），无需额外上限。
