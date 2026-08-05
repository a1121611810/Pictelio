# ADR-0062：独立包引擎切换 UI 隐藏与 Native 能力暴露

## 背景

三分包（full / webview / lynx 独立 APK，见 issues #113–#119）落地后，webview-only 和 lynx-only 包**不再包含另一引擎的运行时**：

- `webview` 包只有 Capacitor + MainActivityWebview，无 LynxActivity / Lynx SDK；
- `lynx` 包只有 LynxView + LynxActivity，无 Capacitor / MainActivity。

但两份前端（pictelio-app 的 `SettingsClient.tsx`、app-lynx 的 `Me.vue`）仍无条件渲染"切换渲染引擎"入口，写入 `pictelio_client_kind` 开关。在独立包中该开关是**死功能**：切换目标引擎不存在，重启后行为不变，用户产生困惑。

## 决策

### 1. 独立包隐藏切换 UI

- **full 包**：切换入口保持现状（双引擎都有，切换有意义）。
- **webview / lynx 独立包**：前端**不渲染**切换入口（隐藏，非禁用）。

隐藏判定依据：运行时查询当前包支持的 client 列表，仅当列表同时含 `webview` 与 `lynx` 才渲染切换 UI。

### 2. Native 暴露包能力（新增 seam）

构建期按 flavor 注入包能力，前端运行时读取：

- **Gradle**：`build.gradle` 每 flavor 注入 `BuildConfig.CLIENT_KINDS`：
  - `full` → `["webview", "lynx"]`
  - `webview` → `["webview"]`
  - `lynx` → `["lynx"]`
- **webview 前端读取通道**：新建 Capacitor 插件 `ClientInfoPlugin`（`@CapacitorPlugin(name = "ClientInfo")`），暴露 `getClientKinds()` 返回 `BuildConfig.CLIENT_KINDS`。在 full 与 webview 的 MainActivity 中注册。
- **lynx 前端读取通道**：`PictelioAppModule`（Lynx Native Module）新增 `getClientKinds(cb)`，返回同一常量。

前端契约（两侧 JS 共享）：

```ts
type ClientKind = "webview" | "lynx";
getClientKinds(): ClientKind[]; // e.g. ["webview"] | ["webview", "lynx"] | ["lynx"]
```

### 3. Native 强制归一开关残留

用户从 full 包切换过引擎后换装独立包时，`SharedPreferences("CapacitorStorage").pictelio_client_kind` 可能残留另一引擎值（如 `=lynx` 但装的是 webview 包）。

- **webview 包**：MainActivityWebview 无入口路由（不读开关），残留无害；但为一致，`ClientInfoPlugin` 只报告实际能力，前端不据此渲染切换 UI。
- **lynx 包**：`PictelioAppModule.getClientKind` 返回**归一化值**——若存储值不在 `CLIENT_KINDS` 内则返回包默认引擎（lynx 包 → `"lynx"`），避免前端显示"当前 webview"这类虚假状态。
- 残留值本身不清理（无害且包之间切换时 full 包仍需要历史值）。

## Considered Options

- **禁用而非隐藏（否决）**：置灰 + 提示"当前版本仅支持 X"保留上下文，但独立包中"切换到不存在的引擎"本身就是误导性信息，隐藏更干净；full 包用户无此困惑。
- **运行时反射探测类存在性（否决）**：webview 前端尝试 `Class.forName("LynxActivity")` 判断能力——脆弱（ProGuard 混淆、类名变化即破坏），且 lynx 包无 Capacitor bridge 可反射。
- **构建期把开关 key 写入 assets（否决）**：同一份 web bundle 被三 flavor 共享，无法按 flavor 区分写入；必须 Native 侧按 BuildConfig 区分。
- **复用现有插件加方法（否决）**：在 PixivApiPlugin 等中塞 `getClientKinds` 语义混杂；独立 `ClientInfoPlugin` 是单一职责的干净 seam。

## Consequences

- 前端两处（SettingsClient.tsx / Me.vue）新增运行时能力查询，按 `CLIENT_KINDS` 决定渲染。
- Native 新增 `ClientInfoPlugin`（webview 侧）+ `PictelioAppModule.getClientKinds`（lynx 侧），full 包两者都在。
- 独立包的用户看不到引擎切换入口，UI 不再暴露死功能。
- full 包行为完全不变（双引擎切换可用）。
- `BuildConfig.CLIENT_KINDS` 成为"包能力"的单一事实来源，未来新增引擎只需改 Gradle 常量 + 前端渲染条件。
