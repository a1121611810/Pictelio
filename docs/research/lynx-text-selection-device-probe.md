# lynx 文字选中能力设备实证（wayfinder #559 / 地图 #558）

- **日期**：2026-09-17
- **设备**：模拟器 `pictelio_ui`（Android 34，1080×2160，480dpi）
- **引擎**：Lynx 4.0.1（本仓锁定版本）
- **探针**：`packages/app-lynx/src/pages/TextProbe.vue`（throwaway 分支 `probe/text-selection-559`）
- **取证方式**：真机/模拟器 adb 注入长按（`input swipe x y x y 900`）+ 截图（探针页把 selectionchange payload / getTextBoundingRect / getSelectedText 全部实时上屏，截图即证据）。注意：**JS `console.log` 不进 logcat**，一切证据走屏幕与截图。

## 结论速览（对应票面 7 问）

| # | 问题 | 结论 |
|---|------|------|
| 1 | `<list list-type="single">` 虚拟化里能否段内选中 | ✅ **可用**。每段一个 `list-item` + 单个 `<text>` 的结构下，长按进入选中、手柄正常渲染、`selectionchange` 派发。长按（900ms 按住）与列表滚动不冲突（未触发滚动）。 |
| 2 | `custom-context-menu` 能否替换引擎菜单 + 自绘菜单能否定位 | ✅ **能替换**（但**属性写法有坑**，见下）；✅ 自绘 view 可渲染在选区附近。端到端像素级定位未做（坐标系已明确，见 #4）。 |
| 3 | `bindselectionchange` / `getSelectedText` / `getTextBoundingRect` 在原生 4.0.1 是否可用 | ✅ 三者都可用。⚠️ `getTextBoundingRect` **必须给真实选区 range**：`{start:0,end:9999}` 返回 FAIL `{"code":1,"data":"Can not find text bounding rect."}`。 |
| 4 | `getTextBoundingRect` 的坐标系语义 | rect = **LynxView 内容区 dp 坐标**（与 `boundingClientRect` 同源）。实测 node `#p0`：`l=15 t=349 w=329 h=63` ↔ 屏幕 `45px / 1047px / 987px / 189px`（3 行 × 63px 行高，density=3）；单字选区 `w=15.33dp=46px`（=32rpx 字号）、`h=21dp=63px`（=44rpx 行高）——**数值精确吻合**。vw 换算：本机 1vw = 3.6dp = 10.8px。 |
| 5 | 跨段（`custom-text-selection` + `setTextSelection`）是否可行 | ✅ **程序化驱动可行**：对 p0/p1 逐段 `setTextSelection`（节点相对坐标 0..w/0..h）成功，`res.boxes=3`（3 行盒）、`getSelectedText` 读回整段文本（`start=0 end=61`）。跨段手势层（拖手柄越段）需自研，未验证（属实现工作量）。 |
| 6 | `flatten={false}` 是否必需 / 代价 | ✅ **必需**：静态 `flatten="true"` → 长按 **0 次 selectionchange**（选不中）；`flatten="false"` → 正常选中。帧代价未做严格 ABBA bench（未阻塞决策）。 |
| 7 | 运行时环境（剪贴板） | ⚠️ **Lynx JS 运行时里 `navigator` 不存在**（实测 `nav=undefined clip=undefined wt=undefined`）→ `navigator.clipboard` 彻底不可用（坐实 #568 假成功反馈可达）。`lynx` 全局 API 面（getNativeApp/getApp/getNativeLynx/requireModule/createElement/…）**无剪贴板**。 |

## 实现必读的坑

1. **vue-lynx 动态布尔绑定对 `custom-context-menu` 不生效（P0 级实现坑）**
   - 同页同视频对照：`:custom-context-menu="mode==='custom-menu'"`（动态）→ 引擎自带菜单（复制/全选）**仍然出现**；改成静态字面量 `custom-context-menu="true"` → 引擎菜单**消失**。
   - 同批静态属性 `text-selection="true"` / `flatten="false"` 均生效（见 #6 负控）。
   - 结论：实现**必须用静态字面量属性**（或找到正确的动态绑定形式并单测钉住）；这也是验收检查点——"自绘菜单模式下引擎菜单不得出现"。
   - 附注：`flatten` 的动态绑定是否生效未单独验证（静态已证必需）；推断与 `custom-context-menu` 同类风险。
2. **rect 必须给真实 range**（全量 range 查询失败）。
3. **滚动不派发 `selectionchange`**：滚动后 JS 侧选中态与自绘菜单都保留（菜单不会自动收），视觉上前景选区随内容滚走 → 菜单消失时机需实现里显式处理（挂 #567）。
4. **回收重建后选中是否保留未验证**（需长滚动 + 回滚取证）；本次仅验证"滚动不崩溃、不派发事件"。
5. 探针内 1vw 换算曾用 px 宽（应为 dp 宽）→ 菜单落在屏幕上部；坐标系已明确，像素级对齐交原型票 #563。

## 坑中坑：模拟器上跑的可能不是 Lynx

`adb install -r` 保留应用数据。上一轮引擎矩阵取证留下的 DEBUG 键 `pictelio_debug_force_lynx_unavailable=true` 会让 `EngineRouting` 判 `lynx_unavailable` 并**回退 WebView**（表现为看到 webview 客户端的登录页，而非 lynx 客户端）：

```
I EngineRouting: preferred=lynx effective=webview reason=lynx_unavailable
```

→ 复现前先 `adb shell pm clear io.pictelio.app`（或删该键）。这条同时是"取证键会污染后续会话"的操作手册要点。

## 复现步骤

```bash
git checkout probe/text-selection-559
pnpm build:android          # 会带 PROBE-ONLY 改动：初始路由直投 /text-probe
adb install -r -d packages/app/android/app/build/outputs/apk/full/debug/app-full-debug.apk
adb shell pm clear io.pictelio.app    # 关键：清掉 DEBUG 取证键
adb shell am start -n io.pictelio.app/io.pictelio.app.MainActivity
# 长按正文：adb shell input swipe 300 Y 300 Y 900（探针页有锚点条与网格取证法）
```

## 取证资产（截图，均在 /tmp/probe559/，关键几张随分支提交说明）

| 文件 | 证明 |
|------|------|
| `FF1-native-after.png` | native 模式：选中 + 引擎自带菜单（复制/全选） |
| `FF2-custom-after.png` | 动态绑定 `:custom-context-menu` → 引擎菜单**仍在**（坑 1） |
| `GG-static-after.png` | 静态 `custom-context-menu="true"` → 引擎菜单**消失** + 选中正常 |
| `HH-static-flat`（0 次 selectionchange） | 静态 `flatten="true"` → **选不中**（flatten=false 必需） |
| `EE3-cross.png` | 跨段 `setTextSelection`：`boxes=3`、读回整段文本 |
| `II-env-logs.png` | `nav=undefined` + lynx 全局键列表（无剪贴板） |
| `EE2c-after-scroll.png` | 滚动后选中态与自绘菜单保留、无 selectionchange |

## 对路线决策的输入（供 #565）

- **路线 B（段内自绘菜单）全部条件成立**：选中可用、事件可用、引擎菜单可被静态属性抑制、rect 可用于定位（换算路径明确）。
- 跨段（路线 C）不做，但**程序化 `setTextSelection` 已证可用** → 将来若要做（如"复制本段"类动作）不需要新机制。
- 实现需额外注意：静态属性写法（坑 1）、菜单消失时机（坑 3）、剪贴板新通道（#560 已定案）。


## 追加实证（实现期复验，2026-09-17 下午）

实现完成后，用**挂真实模块的探针页**（`TextSelectionProbe.vue`，本分支）在模拟器上复验，得到四条新的设备事实与两处实现修正：

1. **索引域 = UTF-16 码元（判决实验）**：样本段 `'第三段带 emoji 🌸 与英文混合，用来验证索引切片不劈开代理对。'` —— **units=35 / cp=34**。长按 emoji 右侧的「与」得到载荷 `start=14 end=15`：按码元解释 = 「与」（手指所在字），按码点解释 = 「英」 → **只有码元解释成立**。同批还有：该段末位字符给 `(34,35)`（34 码点域不可能给出 35 的 end）。
2. **range 可能落在代理对中间**：长按 emoji 得到 `(11,12)` = 高代理单元 → 直接 `String.slice` 会复制出半个字符（粘贴显示 ◇?）；**向外吸附到代理对边界**后粘贴出完整 🌸（设备复验通过）。
3. **整段选中必失败**：`getTextBoundingRect` 对全量 range 返回 `code:1`（早前已证）；实现把测量范围收敛到 `[start, units-1)`，整段选中（`start=0 end=20 len=20`）在设备上正常出菜单；仅末位单字符时向左扩一位。
4. **点空白不派发清空事件**：点正文会派发 `start === -1`（选区与手柄消失），点列表空白/页头**什么都不派发** → 菜单不会自己收；宿主需在根 view 转发 `@tap`（tap-away）。另：**长按抬手的 release 会被引擎判为 tap**，会把刚弹出的菜单收掉 → 宿主 `@longpress` 打标 + 模块消费该次 tap 后菜单正常留存。
5. **已知残留**：滚动收起后引擎侧原生高亮可能仍在（清选调用已发出但未见高亮消失）；新选中或点正文会自然清掉。
6. **定时器契约**（代码审查发现、设备复验确认）：反馈 TTL / 宽限窗的默认调度器必须返回**真取消函数**（原实现返回 timer id，`dismiss` 内调用即 TypeError → 菜单卡住）。


## 清选策略实验（2026-09-17 晚；结论：现有实现有效，早前「残留」是测量伪影）

探针改为「先选模式 → 长按选中 → **2.5s 后自动执行策略**」（全程无点击，避免「点一下就清」混淆结论；页脚策略按钮只在无选中态切换模式）。像素统计 = 手柄（饱和蓝）/ 高亮（浅蓝），区间 y 300..1900（排除页脚）。

| 模式 | 调用 | 前（手柄/高亮） | 后 | 结论 |
|---|---|---|---|---|
| S0 | 不调用（对照） | 380 / 273 | 380 / 273 | 对照成立：不清就原样保留 |
| **S1** | **全负坐标 + 不显示手柄（现状）** | 382 / 252 | **0 / 133** | **有效**（133 = 背景 FAB 图标基线）|
| S2 | 零长 range (0,0) | 382 / 252 | 0 / 232 | 清不干净（残留 ~99） |
| S3 | 极小区间 (0..2) 再全负 | 382 / 252 | 0 / 133 | 与 S1 等价（无增益） |
| S4 | 对全部段落节点各发一次 | 382 / 252 | 0 / 133 | 与 S1 等价（无增益） |
| S5 | 整表重建（epoch 换 key） | 380 / 273 | 0 / 0 | 最彻底，但**滚动位置回顶**（不可用于滚动收起） |

**测量坑（本实验最重要的产出）**：列表的竖向滚动指示条是 **#0060FF 的 1px 细线**，会被「饱和蓝 = 手柄」过滤器整条计入（按采样步长 3 计约 150–330 个样本，长度随滚动距离变化）→ 早前「滚动收起后原生高亮残留（手柄像素 324）」实为该细线的伪影，**选区其实已被清掉**。判定选区是否清除请认**成对圆点手柄形状**或直接看截图。
