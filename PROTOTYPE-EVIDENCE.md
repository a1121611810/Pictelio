## 验证结果
| 项 | 结果 |
|---|---|
| 构建 | packageFullRelease 成功 |
| dex 证据 | WorkDatabase_Impl Direct methods 含 <init>() ✓ |
| 模拟器 API 28 安装启动 | 进程 ALIVE，无 FATAL ✓ |

结论：方案 A（R8 keep 规则）可修复 v4.22.0 启动闪退。

## 补充验证（API 34 完整渲染）

- 模拟器 pictelio_ui（android-34 arm64）安装启动：进程 ALIVE，首页 Feed 正常渲染（截图证据，无 FATAL）。

## 附带发现（独立缺陷，另案处理）

- Release 构建（含官方 v4.22.0 GitHub APK）未打包 `res/raw/upgrade.html`（debug 包有）：MainActivity 用字符串字面量 `file:///android_res/raw/upgrade.html` 加载，AGP 资源优化对无 R 引用的资源做名字混淆/裁剪 → 旧 WebView（<85）分支在 Release 包上会 ERR_FILE_NOT_FOUND。真实用户 WebView≥85 不受影响；建议后续用资源 ID 引用或 resources-keep 修复。
