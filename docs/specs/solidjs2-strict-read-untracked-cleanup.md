# Spec: SolidJS 2 STRICT_READ_UNTRACKED 清零（图床读点洪水 + 两个单发 + E2E 零警告防线）

- 状态：spec（Grill 已拍板 3 问；待 to-tickets）
- 日期：2026-09-10
- 关联：`docs/specs/solidjs2-strict-warnings-cleanup.md`（第一轮，D1-D3 已随 405581df/4235a086/370ce058 落地）；ADR-0144（SolidJS 2 迁移）；本轮不新增 ADR（纯 dev 诊断标注，无架构取舍）

## 1. 背景与目标

第一轮警告治理落地后，2026-09-10 刷新 web 端首页抓取的控制台日志（8800 行）经过去重统计，剩余警告盘点如下：

| 警告 | 次数 | 根因（栈实证） |
|---|---|---|
| `STRICT_READ_UNTRACKED` imageHostStore.ts:329 | 285 | `loadImageInner`（imageLoader.ts:299）在 effect **apply 段**（Solid 2 双函数效应的非追踪半区）同步读 `isImageHostEnabled()`；调用方为 `FeedList.tsx:95` 预取 apply 与 `createProgressiveImage.ts:134` 卡片预载 apply，每张图一次 |
| `STRICT_READ_UNTRACKED` imageHostService.ts:175 | 285 | 同上链路，`fetchWeb`（imageLoader.ts:484）→ `getRaceCandidateUrls`（imageHostService.ts:159）→ `isImageHostActive()` 读 `imageHostState()` |
| `STRICT_READ_UNTRACKED` uiStore.ts:58 | 1 | **第一轮 D1 漏网**：370ce058 加了反向同步 effect 修正行为，但 `SideNavShell.tsx:134` 的 `createSignal(initialHomeTab())` 初始化器读仍是非追踪读，警告照发（已核对当前源码逐字确认） |
| `STRICT_READ_UNTRACKED` recommendedStore.ts:48 | 1 | `useFeedActivation` apply 段（HomePage.tsx:235）→ `ensureLoaded`（createTQFeedStore.ts:443）→ `keysForTab` → `getSubTab` 读 `recommendSubTabState()` |
| `HUGE_FAN_OUT` AdaptiveTags.tsx:126 | 1 | 性能病理，本轮**不治**（见 §2 与 backlog issue） |
| `HUGE_FAN_IN` r18Filter.ts:21 | 1 | 性能病理，本轮**不治**（见 §2 与 backlog issue） |
| `[ota]` 非原生环境跳过 | 3 | web/dev 预期日志，任何方案不动 |

官方处方（`node_modules/solid-js/skills/reactivity-diagnostics/SKILL.md`，日志中 HUGE_FAN 类警告自带的修复指南）：*有意的一次性快照，用 `untrack()` 包裹读取以显式声明*。上述 4 个 STRICT_READ_UNTRACKED 点的语义全部是「命令式/瞬时快照」——图片加载决策、信号初始值、命令式 ensure 动作——**不希望**上游状态变化触发重跑，故全部走 untrack 标注而非改造为真订阅。

本 spec 目标：**刷新首页控制台 `STRICT_READ_UNTRACKED` 归零 + 建立通用 E2E 回归防线**，零运行时行为变化、零接口变更、零 bundle 体积变化。

## 2. 非目标（Out of Scope）

- `HUGE_FAN_OUT`（AdaptiveTags.tsx:126，2000 订阅）：**根因已实证为 solid-refresh HMR 包装器**——`$$component` 为每个组件类型建一个 signal，每个实例建一个 memo 订阅它（`solid_js_refresh.js:26,66`）；~2000 个 SearchableTag 实例（AdaptiveTags 测量层×可见层×feed 卡片数）订阅同一 per-type signal。dev-only，生产构建无此结构。**已排除 useNavigate 嫌疑**（@solidjs/router `navigatorFactory` 只读 context，不产生订阅）。
- `HUGE_FAN_IN`（r18Filter.ts:21，单计算 2000 源）：feed `items` 派生对每个 item 调 `isBlocked(id)`，per-key store 读挂在同一计算上。真实结构问题但实际代价低（屏蔽操作用户手动触发、极罕见）。
- 以上两条性能病理登记 GitHub backlog issue（见 §7），另开 effort 处理，不进本轮。
- app-lynx（Vue 技术栈，不涉及 Solid 诊断）。
- 性能类警告的 CI 阈值（`expectRerunBudget` 等）——随 backlog effort 另行评估。

## 3. 设计（D1-D3 修复 + D4 防线；D1-D3 相互独立，D4 依赖前三者）

### D1 — imageLoader 三个图床快照读点 untrack 标注（消除 570 条洪水）

**入口**：`packages/app/src/utils/imageLoader.ts:299`（`loadImageInner` web 分支）、`:423`（`loadImageWithProgress`）、`:484`（`fetchWeb`）

**改动**（3 处同构）：

```ts
// :299 与 :423（同款判定行）
const targetUrl = untrack(() =>
  isImageHostEnabled() ? getEffectiveImageUrl(originalUrl) : originalUrl,
);

// :484
const urls = untrack(() => getRaceCandidateUrls(targetUrl));
```

在模块 import 中增补 `untrack`（来自 `solid-js`）。

**为什么标注点放在 imageLoader 而不是 accessor 体内**：`isImageHostEnabled` / `imageHostState` 存在合法的**响应式消费点**——`FeedList.tsx:86`、`VirtualFeed.tsx:125` 的预取门控在 compute 段（追踪区）读它们，设置页 UI 直读 `imageHostState`。若在 accessor 函数体内 untrack，会把这些真订阅一并杀死（图床总开关切换后门控不再响应）= 静默行为变化。untrack 只标在「加载管道」这个快照消费域的入口，响应式消费点不受影响。`loadImageWithProgress:423` 本次日志未触发（用户未开图床且未走详情页进度加载路径），但属同一快照语义，一并标注防换路径复发。

**4 维度核对**：
| 维度 | 说明 |
|------|------|
| 可维护性 | 官方指南处方（`untrack()` 显式快照）；标注点集中在加载管道入口，注释说明「快照语义：图床配置变更不触发在途/新加载重评估」 |
| 性能 | `untrack` 为零开销包装（仅切换追踪标志）；570 条警告 × 每条的 stack 分配 + console 输出在 dev 下消失 |
| 安全 | 零行为变化：这些读点本就运行在非追踪上下文（apply 段/异步回调），untrack 只是显式化既有语义 |
| 内存 | 无新增对象 |

### D2 — SideNavShell 初始化器 untrack 标注（第一轮 D1 收尾）

**入口**：`packages/app/src/components/home/SideNavShell.tsx:134`

**改动**：

```ts
// 初始值为一次性快照（显式 untrack，Solid 2 strict 处方）；
// 运行时同步由下方 createEffect 反向同步承担（370ce058 已落地）
const [tab, setTab] = createSignal<HomeTab>(untrack(initialHomeTab));
```

**4 维度核对**：
| 维度 | 说明 |
|------|------|
| 可维护性 | 与注释互证：初始快照 + effect 反向同步的职责划分显式化 |
| 性能 | 零开销 |
| 安全 | 零行为变化：反向同步 effect（追踪 `currentTab`）已保证后续更新；初始读本就只取一次 |
| 内存 | 无变化 |

### D3 — createTQFeedStore `ensureLoaded` 快照标注（factory 级，覆盖 11 个 store 实例）

**入口**：`packages/app/src/stores/shared/createTQFeedStore.ts:443`

**改动**：

```ts
const ensureLoaded = async (_signal?: AbortSignal): Promise<void> => {
  // activeKeys 为命令式 ensure 动作的瞬时快照（显式 untrack）；
  // ensureLoaded 由 effect apply 段/事件调用，不承担响应式重跑
  const keys = untrack(activeKeys);
  // ... 其余不变
};
```

**为什么放在 factory**：`ensureLoaded` 被 11 个 feed store（recommended/follow/bookmark/…）共享，调用方（如 `useFeedActivation` apply 段）是同一模式；factory 内一处标注全局生效。`activeKeys` 的其他消费点（`nextUrl`/`loading` 等派生 accessor）在 JSX/tracked 上下文使用，不受影响。

**4 维度核对**：
| 维度 | 说明 |
|------|------|
| 可维护性 | 单点修复覆盖全部 feed store；注释声明 ensure 语义为快照 |
| 性能 | 零开销 |
| 安全 | 零行为变化：`ensureLoaded` 本就是「当前时刻确保加载」的命令式动作，keys 在调用瞬间取定 |
| 内存 | 无变化 |

### D3.5 — SettingsTranslate 初始化器 untrack 标注（D4 绿跑暴露的第 6 点）

**入口**：`packages/app/src/components/settings/SettingsTranslate.tsx:28`

**发现经过**：日志盘点时用户会话未访问 /settings，此点不在 573 条样本内；D4 防线的 SPA 往返（`/settings` → `/home`）在绿跑时捕获——`createSignal(dsApiKey() ?? "")` 初始化器在组件 setup 域（非追踪）读 `dsApiKey()`，警告归因 `<SettingsTranslate>`。这正是 D4「通用匹配、不枚举来源」设计的目的：未知来源直接红，不留漏网。

**改动**（与 D2 同构：初始快照 + 显式再同步）：

```ts
const [inputKey, setInputKey] = createSignal(untrack(() => dsApiKey() ?? ""));
```

零行为变化：`onSettled` 中 `loadDsApiKey().then(...)` 本就显式 `setInputKey(dsApiKey() ?? "")` 再同步（既有代码），初值快照不改变任何可见行为。

### D4 — E2E 通用零警告防线（防第三轮回归）

**入口**：`packages/app/tests/agent-browser/specs/adaptive-tags-240.test.ts`

**设计决策**：挂在既有 240 spec 而非新建 spec——该 spec 已支付登录 + 首页渲染成本（~75s），且其 setup 含一次 `location.reload()`（播种 R18 键），hook 在 reload 完成后注入即可自然覆盖「登录 → 首次首页挂载 → feed 图片加载」全链路。

**改动**（时序敏感，按序）：

1. **hook 注入**：在现有 reload + `waitForJs(登录||推荐)` 之后、登录之前，用 `driver.evaluate` 注入单行脚本（E2E 注入约束：单行、无正则字面量）：
   `window.__strictWarns=[];['warn','error'].forEach(m=>{const o=console[m].bind(console);console[m]=(...a)=>{window.__strictWarns.push(a.map(String).join(' '));o(...a)}});'ok'`
2. **确定性重触发**（防「登录态直进首页导致挂载警告先于 hook」竞态）：在现有 chip 断言通过后，SPA 往返 `navigateSpa('/settings')` → `navigateSpa('/home')`（重挂载 SideNavShell → D2 点重触发；重跑 `useFeedActivation` → D3 点重触发），再 `scroll('down')` ×3 触发分页——**分页新 URL 不在 L1 缓存**（`loadedKeys` 命中会短路 `loadImageInner` 前置读点，单纯往返无法重触发洪水路径，必须靠分页新图）。
3. **阳性对照**（防假阳性通过）：滚动前 `performance.clearResourceTimings()` 清表，滚动分页后断言 `/pixiv-img/` resource 条目数 > 0（证明此前产警告的图片加载管道真实执行过）；chip 断言（既有）证明 feed 渲染过。**修正记录**：初版用滚动前后 delta 计数，实测假红——dev 模式 Vite 模块请求（`/@fs/`）填满 resource timing 默认 250 条缓冲上限，`/pixiv-img/` 条目被丢弃（红跑实证 resN 恰好=250）；定稿 = hook 注入时 `performance.setResourceTimingBufferSize(10000)` 扩容 + 清表后直接计数。
4. **hook 存活校验**：断言前检查 `Array.isArray(window.__strictWarns)`——页面若意外 reload 导致 hook 丢失，测试红而非静默假绿（测试硬约束 #3 防静默降级）。
5. **主断言**：`__strictWarns.filter(s=>s.includes('STRICT_READ_UNTRACKED')).length === 0`——通用匹配，不枚举文件名，未来任何新来源直接红（Q2 拍板）。

**4 维度核对**：
| 维度 | 说明 |
|------|------|
| 可维护性 | 复用既有 spec 与 driver 公开方法（evaluate/navigateSpa/scroll），无新 seam；断言通用化 |
| 性能 | 增加 ~15s E2E 时长（SPA 往返 + 3 次滚动），不新增 spec 的登录成本 |
| 安全 | 测试只读 console/performance 客观证据；阳性对照 + 存活校验双重防假绿 |
| 内存 | 不涉及 |

## 4. 影响范围

```
packages/app/src/utils/imageLoader.ts                          ← D1（3 处 untrack）
packages/app/src/components/home/SideNavShell.tsx              ← D2（1 处 untrack）
packages/app/src/stores/shared/createTQFeedStore.ts            ← D3（1 处 untrack）
packages/app/src/components/settings/SettingsTranslate.tsx     ← D3.5（1 处 untrack，D4 绿跑暴露）
packages/app/tests/agent-browser/specs/adaptive-tags-240.test.ts ← D4（hook + 重触发 + 断言）
```

无新文件、无新依赖、无接口变更、无原生路径改动（untrack 为 Solid 核心 API，生产构建同为零行为变化，Android 无需专项回归）。

## 5. 测试策略（硬约束映射）

**Seam**：唯一 seam = agent-browser driver `evaluate`（既有，最高层——真实浏览器跑真实 app）。D1-D3 是「标注」而非「逻辑」，无可单测的行为单元，不新增 vitest 用例。

| 层 | 用例 | oracle（出处可追溯） |
|----|------|--------|
| E2E | 首页刷新全链路零 `STRICT_READ_UNTRACKED` | 期望值来源 = Solid 官方 `reactivity-diagnostics/SKILL.md` 处方（untrack 显式快照即修复）+ 2026-09-10 日志实证（4 个读点逐一对应） |
| E2E | 阳性对照：`/pixiv-img/` resource entries delta > 0 | 期望值来源 = `fetchWeb`/`toWebProxyUrl` 实现的 URL 形态（源码字面量） |
| E2E | hook 存活校验（`Array.isArray(__strictWarns)`） | 测试自证而非断言外部行为 |

**为何不需要「响应性未被误杀」的回归测试**：untrack 标注点全部位于本就非追踪的上下文（apply 段/初始化器/命令式动作），未触碰任何 tracked 消费点（`FeedList.tsx:86` 门控、设置页 UI 均不经过被标注的调用点）——无双面风险，既有 `imageHostStore.test.ts` / `createTQFeedStore.*.test.ts` / `SideNavShell.test.tsx` 全绿即行为不变证据。

## 6. 验收清单

- [ ] `pnpm check` 绿
- [ ] `pnpm test:app` 全绿（既有用例零回归即「行为不变」证据）
- [ ] `pnpm lint` / `pnpm fmt:check` 绿（CI 同命令复验后再推）
- [ ] agent-browser `adaptive-tags-240` spec 绿（含新零警告断言 + 阳性对照 + 存活校验）
- [ ] 手动 `pnpm dev:app` 刷新首页：console 零 `STRICT_READ_UNTRACKED`（仅剩 ota 3 条预期日志）
- [ ] 性能类 backlog GitHub issue 已建并在本 spec §7 回填编号

## 7. 假设记录（Grill 已锁定，可推翻）

| # | 假设 | 备选 |
|---|------|------|
| A1 | 治理策略 = 快照语义 untrack 标注（官方处方），不改真订阅 | 移入 tracking scope（语义错误：图床开关切换将触发全量图片重载门控重评估） |
| A2 | E2E 防线挂既有 adaptive-tags-240 spec | 新建独立 spec（职责更干净，但重复支付 ~75s 登录渲染成本） |
| A3 | 阳性对照用 performance resource entries | img 元素计数 delta（间接证据） |
| A4 | 性能类两条登记 GitHub backlog issue（Q3 拍板） | 仅 spec 附录记录 |

**性能类 backlog 内容摘要**（issue 详述）：
- `HUGE_FAN_OUT` AdaptiveTags.tsx:126：根因 = solid-refresh HMR per-type signal × ~2000 SearchableTag 实例（dev-only，生产无此结构）；方向 = 接受为 dev 噪音 / 减少实例数（测量层去重）/ diagnostics 白名单，**非** createSelector。
- `HUGE_FAN_IN` r18Filter.ts:21：根因 = feed `items` 单计算 × per-item `isBlocked(id)` per-key 读；方向 = 过滤前整集快照读取（1 个源替代 2000 个源）。

Backlog issue：[#426](https://github.com/a1121611810/Pictelio/issues/426)

---

# Tickets（已发布）

```
T1 (#428) [D1+D2+D3+D3.5] 六个 untrack 标注点（imageLoader ×3、SideNavShell ×1、createTQFeedStore ×1、SettingsTranslate ×1）— 无依赖
T2 (#429) [D4] E2E 零警告防线（adaptive-tags-240 扩展）— blocked by #428（防线先于修复落地必红）
```

T1 单 commit 级别（6 处同构标注）；T2 独立 commit。串行执行。
