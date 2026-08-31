# 原生流式解压写盘 原型取证报告（2026-08-31）

> 原型分支（throwaway，oracle 留档）：`prototype/ugoira-native-streaming`（commit `b1a3fd5`）
> 验证问题：lynx 原生模式渐进播放的 Java 侧核心——「流式下载 + ZipInputStream 边读边解压边写盘 + 分批交付」是否可行？
> 环境：JVM（Robolectric，android-28）；数据：构造 store zip（200 帧，733KB）+ 真实样本 148861562（52 帧，2.5MB）
> 运行：`cd packages/app/android && GRADLE_USER_HOME=$(pwd)/.gradle ./gradlew testFullDebugUnitTest --tests "io.pictelio.app.PictelioUgoiraStreamProtoTest"`（2/2 通过）

## 一、验证项与结果（不可模糊）

| # | 验证项 | 结果 | 证据 |
|---|---|---|---|
| 1 | ZipInputStream 流式顺序读：不读完全量即可按序产出条目（不依赖中央目录） | ✅ | 自定义 `CountingInputStream` 统计底层已消费字节：首批条目交付时占比 4.5%（构造）/8.6%（真实） |
| 2 | 分批交付水位（渐进收益） | ✅ 首批 5-10 帧 @**4.5%-8.6%** | 时间线见下 |
| 3 | 流式写盘 vs 全量 map 解压（现有 ugoiraExtractCore scanZip 语义）逐字节一致 | ✅ 200/200 + 52/52 帧 | Arrays.equals 断言 |

### 分批时间线（真实 zip，批=5 帧）

```
[PROTO-REAL] 批0 已读占比 8.6% (218865B)   批1 17.3%   批2 26.1%   批3 35.4%
批4 45.4%   批5 55.5%   批6 65.6%   批7 75.6%   批8 85.7%   批9 95.8%   批10 99.9%
```

（构造 zip 200 帧：首批 10 帧 @4.5%、第 5 批 @29.2%、末批 @98.5%。占比含 ZipInputStream 缓冲预读——真实网络缓冲行为，收益结论不受影响。）

## 二、结论

1. **核心机制可行**：ZipInputStream 天然流式顺序读（local header 驱动，无需中央目录），
   边读边写盘边按批交付成立；字节与全量路径完全一致（回退无缝）。
2. **渐进收益确定**：首批 5-10 帧在下载 4.5-8.6% 时即可交付 → 原生模式首次播放可从
   「全量下载完（~8s/12.9MB）」提前到「~1MB（首批帧）」。
3. **附加收益（内存）**：流式路径消除了现有实现的两次全量驻留——
   `downloadZip` 全量字节 + `scanZip` 全帧 map——zip 流式读完即弃、帧写盘即弃。
4. **契约形态**：Lynx `Callback` 一次性语义下，「多次回调推送」不可依赖 →
   交付采用**拉模式**（start → 轮询 poll → done/cancel），纯同步状态机、可 JVM 单测
   （本原型验证批次序列本身；状态机契约在 ADR-0128 定义、implement 阶段单测覆盖）。

## 三、遗留/边界（实现阶段处理）

- 下载流中断/失败 → 状态机置 error，poll 返回可读错误；已写盘帧保留（下次走缓存命中）。
- 缓存命中与流式并存：start 时帧完整 → 一次 poll 全量交付（复用 ugoiraExtractCached）。
- 并发：同一时刻仅一个活动流（模块实例字段；新 start 取消旧流）。
- 清理策略：沿用 UGOIRA_MAX_COUNT/UGOIRA_MAX_BYTES（写盘路径不变）。
