# app-lynx 翻译面板 UI 形态原型

> **wayfinder #624** throwaway prototype · 分支 `prototype/app-lynx-translate-ui`

## 目的

把 spec §6 UX 形态（`docs/specs/app-lynx-novel-translation.md`）的 5 类交互：
1. **设置页 LLM endpoint 表单**
2. **详情页翻译按钮位置**
3. **整段切换控件（原文/译文）**
4. **失败提示（endpoint 不兼容）**
5. **缓存命中标识（已缓存 ✓）**

做成可视化的静态原型，供 implement 阶段（to-tickets 之后）选型定型。

**这份原型本身不进入实现**。所有决策只是 spec 已有收敛的视觉验证；如有新发现，回头修订 spec。

---

## 怎么打开

所有 HTML 文件依赖同一份 CSS：

```
prototype/app-lynx-translate-ui/
├── _shared.css            ← M3 tokens + phone-frame + 通用原语
├── index.html             ← hub 页（5 个原型入口卡片）
├── endpoint-form.html     ← 原型 #1
├── translate-button-positions.html  ← 原型 #2
├── switch-control.html    ← 原型 #3
├── failure-prompt.html    ← 原型 #4
├── cached-badge.html      ← 原型 #5
├── screenshots/           ← 空目录（截图由 reviewer 自行截图）
└── README.md              ← 本文件
```

**三种打开方式**：

1. **直接双击 `index.html`** — 桌面浏览器打开，无服务端依赖。
2. **本地启服务（推荐）**：
   ```bash
   cd prototype/app-lynx-translate-ui
   python3 -m http.server 8080
   # 浏览器访问 http://localhost:8080
   ```
3. **VS Code Live Server** — 右键 `index.html` → "Open with Live Server"。

**视口建议**：浏览器窗口 ≥ 1200px 宽时三栏并排；< 1200px 自动堆叠为单列。

---

## 5 个原型 × 关键设计选择

### #1 设置页 LLM endpoint 表单（`endpoint-form.html`）

| 状态 | 设计要点 |
|------|---------|
| **未配置** | 列表分组仅一行红字「未配置」；点开后才展开指引横幅 + 「去配置 →」CTA（避免首屏认知负担） |
| **已配置** | 完整表单 + inline probe chip（M3 tonal，紧贴 base URL 下方）+ 底部 Snackbar 保存反馈 |
| **校验失败** | base URL 红边 2px + ⚠ chip + 错误描述 + 「保存」按钮 disabled；不弹 modal |

**核心选择**：inline probe chip 而非 modal 探测反馈——保持用户修正路径最短。

### #2 详情页翻译按钮位置（`translate-button-positions.html`）

| 位置 | 决策 |
|------|------|
| **顶部 banner** | ✅ CHOSEN（spec §6.2） |
| 章节标题旁 | ❌ 标题区拥挤 + 双控件分散 |
| FAB | ❌ 与现有 GlobalFab 重叠 + 多 FAB 违反 single-FAB 原则 |

**核心选择**：banner 一行可塞 2 个控件（翻译按钮 + 显示模式切换），FAB 形态无法兼顾。

### #3 整段切换控件（`switch-control.html`）

| 形态 | 决策 |
|------|------|
| **M3 Segmented button** | ✅ CHOSEN（spec §6.3） |
| 顶部 tab（bottom indicator） | ❌ 与 app-lynx 主导航 tab 同形，易被误读为页面级导航 |
| Icon toggle（あ/中） | ❌ 首屏辨识度低，需学习 icon 语义 |

**核心选择**：segmented button 双控件 + 「✓ 已缓存」chip 同行布局。

### #4 失败提示（`failure-prompt.html`）

| 容器 | 决策 |
|------|------|
| **Inline retry bar** | ✅ CHOSEN（spec §6.4） |
| Snackbar | ❌ 自动消失丢失阻塞态上下文 |
| Sheet（modal） | ❌ 首次失败即弹 modal 干扰阅读 |

**核心选择**：错误是阻塞态，用户必须主动 retry / 更换 endpoint；auto-dismiss 不适用。

### #5 缓存命中标识（`cached-badge.html`）

| 位置 | 决策 |
|------|------|
| **Segmented 右侧** | ✅ CHOSEN（spec §6.3+6.5） |
| 独立一行 | ❌ 多占首屏空间 + 与 segmented 割裂 |
| 浮层 chip（top-right） | ❌ 与 segmented 形成双焦点 |

**核心选择**：长按 segmented 区域触发「重译」（避免误触）。

---

## 截图清单

`screenshots/` 目录留空，由 reviewer 在 desktop Chrome 打开各 HTML 后手动截图：

| 原型 | 文件 | 建议截图尺寸 | 命名建议 |
|------|------|------------|---------|
| Hub 页 | `index.html` | 1280 × 800 | `hub.png` |
| 表单三态 | `endpoint-form.html` | 1280 × 900 | `endpoint-form-{empty,configured,error}.png` |
| 按钮位置 | `translate-button-positions.html` | 1280 × 800 | `button-positions-{banner,title,fab}.png` |
| 切换控件 | `switch-control.html` | 1280 × 900 | `switch-{tab,segmented,icon}.png` |
| 失败提示 | `failure-prompt.html` | 1280 × 900 | `failure-{inline,snackbar,sheet}.png` |
| 缓存标识 | `cached-badge.html` | 1280 × 800 | `cached-badge-{right,separate,floating}.png` |

**截图工具建议**：Chrome DevTools → Toggle Device Toolbar → iPhone 12 Pro（390×844）；或直接用浏览器全屏截图工具（Cmd+Shift+4 macOS / Win+Shift+S Windows）。

---

## M3 token 来源

所有 CSS variable 摘录自 `packages/app-lynx/src/styles/tokens.css`（Sky 主题）：

- **核心色**：`--md-primary` / `--md-on-primary` / `--md-primary-container` 等 12 个
- **表面**：`--md-surface-container-lowest/low/container/high/highest` 5 档
- **形状**：`--md-shape-{extra-small,small,medium,large,extra-large,full}` 6 档
- **elevation**：`--md-elevation-{1,2,3}` 3 档
- **动效**：`--duration-fast/normal/gentle` + `--motion-standard`

**简化**：原型用 rem 而非 vw/rpx（phone-frame 固定 360px 宽）；具体换算口径见 `_shared.css` 头部注释。

**未引入**：Fluent 2 token（spec 明确「不引入 Fluent 2」）；主题切换（spec 仅取 Sky 默认色块）。

---

## 与 spec 的边界

| 边界 | 决策 | 备注 |
|------|------|------|
| 设计语言 | M3 Sky（与 app-lynx 一致） | spec §1.4 |
| viewport 基准 | 360 × 720 px | 略小于 spec 的 375 屏宽，便于桌面浏览器 3 栏并排 |
| 控件态 | 静态快照，不模拟交互 | 这是「视觉定型」原型，非可交互原型 |
| i18n | zh-CN 单语（spec §2.7 留 implement 阶段） | — |
| API key 显示 | 字段渲染为 password 类型 + 「显示/清空」按钮 | 与 spec §6.1 「5s 自动隐藏」一致 |
| 数据流 | 不模拟流式 chunk 渲染（spec §5） | 流式视觉留 implement 阶段处理 |
| R18 / R18G 闸门 | 不演示 | spec §9 由 Q22 处理，UI 留后续 ticket |

---

## 提交说明

- **分支**：`prototype/app-lynx-translate-ui`（throwaway，不合并回 main）
- **commit message**：`prototype: app-lynx 翻译面板 UI 形态原型 (wayfinder #624)`
- **不 push** — reviewer 自行 `git checkout prototype/app-lynx-translate-ui` 后查看
- **不进项目构建** — `packages/app-lynx/` 之外，`tsconfig`/`tailwind.config.ts`/`vite.config.ts` 不引用 `prototype/`

---

## 下一步

原型交付后，parent session 评审：
1. 视觉决策与 spec §6 收敛是否一致
2. 是否有新的形态需要纳入 spec 修订
3. 决定是否对任一原型出 inkd-style high-fi 重做

评审通过后，to-tickets 阶段按 spec + ADR-0169/0170/0171 拆 implement tickets。