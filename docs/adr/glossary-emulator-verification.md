# 模拟器验证环境 — 术语表

macOS 26.5.2 上 Android 模拟器验证环境（ADR-0057）的核心术语。帮助排查"模拟器慢 / 黑屏 / 无法启动"类问题时快速对齐概念。

## 核心术语

| 术语 | 定义 | 避免使用 |
|------|------|---------|
| **HVF** | Apple `Hypervisor.framework`，macOS 上的硬件虚拟化加速框架。模拟器通过它获得接近原生的 CPU 加速。 | 硬件加速（太宽泛）、虚拟化 |
| **TCG** | QEMU 的软件翻译后端（Tiny Code Generator）。当 HVF 不可用时模拟器回退到 TCG，guest 指令逐条翻译执行，boot 需数十分钟。 | 软件模拟、慢速模式 |
| **mprotect failed** | macOS 26 收紧 JIT 可执行内存权限后，QEMU TCG 申请可执行页失败时的报错（`qemu_mprotect__osdep: mprotect failed: Permission denied`）。**非致命**，但伴随 TCG 路径出现，是"模拟器在走软件模拟"的指示信号。 | 内存错误、崩溃 |
| **ATD 镜像** | `google_atd` 系统镜像（Automated Test Device），Google 专为 CI 自动化测试裁剪的镜像。boot 极快（~30 秒），但**无 SystemUI/Launcher**，屏幕纯黑，不可用于人工 UI 验证。 | 测试镜像（与普通 google_apis 混淆）、轻量镜像 |
| **快速启动快照（Quickboot）** | emulator 在首次 boot 完成后保存的系统状态快照（`snapshots/default_boot`）。后续启动直接加载快照而非重新 boot，秒级恢复。禁用方式为启动参数 `-no-snapshot`。 | 缓存、持久化（语义不同） |
| **软件渲染 / GPU 渲染** | 渲染后端选择：软件渲染（swiftshader）由 CPU 完成全部绘制，低分辨率下可接受；GPU 渲染（host）走宿主 GPU。macOS 26.5 上模拟器 HVF 不可用时建议低分辨率（720p）+ 软件渲染换取可用性。 | 图形模式、渲染器（不具体） |

## 关键信号速查

| 症状 | 信号 | 结论 |
|------|------|------|
| boot 极慢（>10 分钟） | 日志含 `hvf is not enabled on this aarch64 host.` + mprotect failed | 走了 TCG 软件模拟；检查 emulator 版本与 macOS 兼容性（见 ADR-0057） |
| 屏幕纯黑但 boot 完成 | 截图仅几 KB，`ps` 无 systemui/launcher 进程 | 使用的是 ATD 镜像，天生无 UI；换 google_apis 镜像 |
| 重启秒开 | 日志 `Successfully loaded snapshot`（~1.9s） | Quickboot 快照生效 |
