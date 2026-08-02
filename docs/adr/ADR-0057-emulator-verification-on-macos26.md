# ADR 0057: macOS 26.5.2 上 Android 模拟器验证环境选型

## 状态

已采纳

## 分类

技术决策 / 开发环境

## 日期

2026-08-02

## 背景

在 macOS 26.5.2（Apple Silicon M4）上为 Pictelio 搭建 Android 模拟器验证环境时，发现 Android Emulator 37.1.11（2026-07-30 发布的最新 stable）**无法启用 HVF 硬件加速**：

- 日志打印 `hvf is not enabled on this aarch64 host.`，QEMU 回退到 TCG（软件翻译），系统 boot 耗时 **45 分钟**。
- 深度排查（C 程序直调 `hv_vm_create` + 反汇编 emulator 的 `handleCpuAcceleration`）确认：**HVF 本身可用**（带 `com.apple.security.hypervisor` entitlement 后 `hv_vm_create` 返回成功），是 emulator 37.1.11 在 macOS 26.5 上的检测逻辑 bug——它误判 HVF 不可用，最终 QEMU 命令行缺少 `accel=hvf`。
- macOS 26.5 上 QEMU TCG 的 `mprotect failed: Permission denied`（macOS 26 收紧 JIT 内存权限）进一步拖慢软件模拟路径。

**约束**：Pictelio 要求 WebView ≥ 85、minSdkVersion 28（生产 targetSdk 36）；该环境仅用于开发期人工验证，不承担 CI。

## 决策

采用 **`system-images;android-34;google_apis;arm64-v8a` 镜像 + 720p 低分辨率 + 3GB 内存 + Quickboot 快照** 作为 macOS 26.5.2 上的模拟器验证环境（AVD 名 `pictelio_ui`）。

- **首启**：TCG 软件模拟下约 1–2 分钟完成 boot（对比 android-36.1 的 45 分钟）。
- **日常重启**：加载 Quickboot 快照约 1.9s，系统 **~9 秒**完全可用。
- **WebView 113**（≥ 85 硬约束满足），Android 14 / API 34。

## 考虑过的替代方案

1. **android-36.1 + HVF（pictelio_dev）**：HVF 在 macOS 26.5.2 上被 emulator 37.1.11 误判不可用，boot 45 分钟，不可用。已删除。
2. **`google_atd` 测试镜像（pictelio_atd）**：boot 极快（~30 秒），但 **ATD 镜像天生无 SystemUI/Launcher**（Automated Test Device，专为 CI 设计），屏幕纯黑，无法人工验证 UI。已删除。
3. **等 Google 发布适配 macOS 26.5 的 emulator 版本再升级**：无时间表；当前 `pictelio_ui` 方案已满足开发验证需求，未来可平滑升级。

## 后果

- **正向**：开发期模拟器验证从"45 分钟不可用"变为"9 秒可用"，满足日常人工验证。
- **权衡**：镜像固定为 android-34（API 34 低于生产 targetSdk 36），部分 API 36 特性无法在模拟器验证；ATD 高速方案不可用于人工 UI 验证。
- **技术债**：依赖 Google 后续修复 macOS 26.5 的 HVF bug；修复后可将 `pictelio_ui` 升级回 android-36.1 + HVF（保留快照机制即可）。
