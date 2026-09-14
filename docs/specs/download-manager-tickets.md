# Tickets: 下载管理器（spec: docs/specs/download-manager.md）

规则：每个 ticket 声明前置依赖；blocker 未完成不得开工。状态：`todo` / `doing` / `done`。

| # | 标题 | 依赖 | 交付物 | 验收 | 状态 |
|---|------|------|--------|------|------|
| T0 | ADR-0146 下载队列与导出架构 | — | `docs/adr/ADR-0146-download-queue-export.md` | 记录队列所有权 / 原生执行器 / 编码器策略决策 | done |
| T1 | 纯函数队列核心（双端同源） | T0 | `packages/app/src/utils/downloadQueueCore.ts` + `packages/app-lynx/src/utils/downloadQueueCore.ts` + 两侧单测 | 状态机全迁移 / 调度并发上限 / 删除两模式 / 序列化+损坏降级 / `downloading→paused` 恢复；`test:app` `test:app-lynx` 绿 | done |
| T2 | 队列 store + 持久化（双端） | T1 | app `stores/downloadStore.ts`（Preferences 防抖）；lynx `stores/downloadStore.ts`（原生 prefs/idbKV） | 入队/操作/进度/完成/失败接线；跨重启恢复；损坏 warn；单测 | done |
| T3 | 原生执行器 PictelioDownloader（静态图片） | T1 | main `PictelioDownloader.java`（下载+落盘+取消+进度）+ webview `PictelioDownloaderPlugin.java` + lynx `PictelioDownloaderModule.java` + TS 桥 | 单任务下载→落盘→uri；cancel 生效；progress 上报；Java 单测 | done |
| T4 | 下载页 app（SolidJS/Fluent） | T2,T3 | `routes/DownloadManager.tsx` + 路由 + Settings 入口 + 组件单测 | 列表/单多选/开始暂停停止删除/二次确认两分支/分享按钮 | done（UI+交互；真实字节待 T3） |
| T5 | 下载页 app-lynx（Vue/M3） | T2,T3 | `pages/DownloadManager.vue` + 路由 + Me 入口 + 组件单测 | 同 T4 语义；web-core 显式失败 | done（UI+交互；真实字节待 T3） |
| T6 | 系统分享原生模块 | T3 | main `ShareHelper.java`（FileProvider + SEND/SEND_MULTIPLE）+ 两端薄壳 + Manifest/`file_paths.xml` | 单条/多条分享可用；Java 单测；真机冒烟 | done（Java 单测；真机冒烟待设备批次） |
| T7 | 原保存改走队列入队 + 提示 | T2,T4,T5 | 两端 `IllustDetail`/`PagePickerSheet`/`ImageViewer` 改动 | 点击→入队→提示「到下载页查看」+ 跳转；旧路径不再直存 | done（双端静态页） |
| T8 | ugoira 任务获取 ZIP + ZIP/TAR 导出 | T2,T3 | Java 取 ZIP + ZIP/TAR 写入 + 测试 | 6 格式中的 zip/tar 可下载落盘 | done |
| T9 | APNG 编码器 | T8 | APNG chunk 组装 + 测试 | apng 可播放、帧延时正确 | done |
| T10 | GIF 编码器（Java） | T8 | 帧解码+量化+LZW + 测试 | gif 可播放、网格一致 | done |
| T11 | MP4 编码器（MediaCodec+Muxer） | T8 | `Mp4Encoder.java` + 测试 | mp4 可播放、时长正确 | done（纯函数单测；MediaCodec 路径真机冒烟待设备批次） |
| T12 | WebP 编码 spike + 实现 | T8 | spike 报告（libwebp .so vs wasm）+ 选定实现 | 动图 webp 可播放 | done（容器组装单测；Bitmap 压缩路径真机冒烟待设备批次） |
| T13 | 全局设置「ugoira 下载格式」（双端） | T1 | app settingsStore+Settings 分组；lynx settingsStore+Me 分组 | 键 `settings_ugoira_download_format`；默认 zip；任务快照 | done（双端） |
| T14 | E2E + 跨端契约测试 | T4,T5,T6,T7 | agent-browser spec + android-e2e 冒烟 + 契约测试 | 详见 spec §9/§10 | todo |

## 关键路径

`T0 → T1 → T2 → T3 → {T4,T5,T6} → T7`（下载管理器主链）
`T8 → {T9,T10,T11,T12}`（ugoira 导出，可与主链并行于 T2/T3 之后）
`T13` 依赖 T1；`T14` 收口。

## 备注

- T1 无原生依赖，先落地并加锁语义，后续所有 ticket 复用。
- 编码器（T9-T12）为长尾；WebP 风险最高，T12 先 spike 再排期。
- 每 ticket 完成后走 `code-review` → `tdd` 修复闭环（AGENTS.md 工作流硬约束）。
