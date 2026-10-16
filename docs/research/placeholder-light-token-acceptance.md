# #1015 亮色 placeholder 像素验收（3 帧抽样）—— 落档

> 票：https://github.com/a1121611810/Pictelio/issues/1015
> spec：`docs/specs/lynx-placeholder-light-token-fidelity.md` §4.6（抽样协议）/ §4.4（升档边界条件）
> 仪器：`docs/research/placeholder-contrast-probe.py`（每帧测量前均跑过自带自检：端点 + 4 张合成图，通过）
> 日期：2026-10-16

## 环境

- AVD `pictelio_ui` / `emulator-5554` / API 34，物理分辨率 1080×2160
- `app-debug.apk`（含 `3e008dcd` 亮色表的新 bundle；`pm clear` 后 dev hook 登录）
- 系统亮暗：`cmd uimode night` = **no**；应用外观模式 = 跟随系统（缺省，resolvedDark 亮色分支）
- 采样对象：搜索面板（SearchSheet）输入框 placeholder「输入标签 / 关键词」，空态直出（spec §4.4 可见性表）
- 采样窗（三帧同一窗口，物理坐标）：`(95, 585, 470, 660)`

## 结果

| 帧 | 主题 | 期望（亮色表） | 实测 fg | 实测 bg | 实测对比度 | 理论值 | 偏差 | 判定 |
|---|---|---|---|---|---|---|---|---|
| `placeholder-light-acceptance-data/t2_sky_search.png` | sky（基线对照） | `#41474e`（不变） | `#41474e` | `#e1e3e9` | **7.32** | 7.32 | 0.00 | ✅ PASS |
| `placeholder-light-acceptance-data/t2_teal_search.png` | teal（变化档代表） | `#3f4949` | `#3f4949` | `#dde4e3` | **7.20** | 7.20 | 0.00 | ✅ PASS |
| `placeholder-light-acceptance-data/t2_bili_search.png` | bili（clamp 必验） | `#5a5f66` | `#5a5f66` | `#d6d9dc` | **4.54** | 4.54 | 0.00 | ✅ PASS（≥4.5） |

**三帧全部 PASS，与理论值偏差均为 0.00。** bili 实测 4.54 ≥ 4.5，**未触发** spec §4.4 升档预案（<4.5 才升 `#53585f`）。

## 观测记录

- 主题切换（设置页圆点）即时反映到已挂载输入框的 placeholder 色，无 remount——第三次复验 #693 §7 spike 结论（动态绑定有效）。
- teal 帧是本票行为变更的直接证据：修复前该档恒为 `#41474e`（理论 7.28），现取该档令牌值 `#3f4949`（7.20）——语义对齐落地。
- 搜索输入框背景实测 `#dde4e3` / `#d6d9dc` ≡ tokens.css 亮段 `--md-surface-container-highest`，与 spec §4.2 表的取值底一致。

## 未覆盖声明（如实登记）

- **抽样协议既定未覆盖**：violet / pink / green / orange 四档亮色未采帧——值正确性由守值测试锁死（亮色表逐项 ≡ tokens.css 亮段抽取产物），全主题像素覆盖归 **#1014 T2 矩阵**（六主题 × 亮暗）。
- **BookmarkPanel** 与 SearchSheet 同代码路径（同一个 `placeholderColor` computed，接线守卫已覆盖两者），本票采 SearchSheet 一帧为代表；BookmarkPanel 单独采帧同样留 #1014 T2 走查。
- WebDAV 六字段「聚焦 + 空」采样纪律本次未动用（采样对象选了空态直出的搜索框），该坑的纪律继续适用于 #1014 T2。
