# Spec: SolidJS 2 严格模式警告清理（SideNavShell + useContainerWidth + Capacitor web 噪音）

- 状态：implemented（D1–D3 全部落地：`405581df` useContainerWidth 泄漏 / `4235a086` Capacitor web IPC 守卫 / `370ce058` SideNavShell 双向同步；父 issue #422、tickets #423–#425 已关闭。剩余 4 个读点由第二轮 `docs/specs/solidjs2-strict-read-untracked-cleanup.md`（#427）收口）
- 日期：2026-09-10
- 关联：ADR-0144（SolidJS 2 迁移，happy-dom 切换）；不在本次新增 ADR，纯迁移遗留修复

## 1. 背景与目标

刷新 web 端页面，控制台稳定输出 3 类警告（已抓 stack 实证）：

1. **`STRICT_READ_UNTRACKED`**：`SideNavShell.tsx:58` 在 `createSignal` 初始化器里调用 `initialHomeTab()` → `currentTab()`（`uiStore.ts:58`）。SolidJS 2 strict 模式下要求 reactive 值必须在 tracking scope（JSX / memo / effect）内读，否则该值变更后不会更新订阅者。当前 SideNavShell 内部 `tab` signal 失去对全局 `currentTab` 的响应能力——虽然现有产品路径（切到 /home 时 SideNavShell 重挂载）掩盖了功能性 bug，但语义不严谨。
2. **`NO_OWNER_CLEANUP`**：`useContainerWidth.ts:33` 在 `ref` callback 内部调用 `onCleanup(() => ro.disconnect())`。SolidJS 2 strict 模式下 ref callback **不在 reactive context**，`onCleanup` 永不触发 → ResizeObserver 真泄漏（每次 AdaptiveTags 挂载都泄漏一个 ResizeObserver + 一组 DOM 节点引用）。
3. **Capacitor plugin web 端缺失警告**（×3 条 stack）：`splashBridge.markContentReady()`（`hideSplash`）+ `secureStorage.syncNativeToken()` ×2（`syncToken`，分别在 `restoreRefreshToken` 与 `performRefresh` 401 重试路径）。根因：**web 环境下根本没装原生插件，发 IPC 必然失败**——这不是「日志噪音」，是「无效 IPC 调用 + 每次抛 CapacitorException + stack 分配」。

本 spec 目标：**三类警告归零 / IPC 真因消除**，且不引入功能回归、不破坏公开接口、不增加 bundle 体积。

## 2. 非目标（Out of Scope）

- SolidJS 2 其它 strict 警告（如 `createEffect` 双函数要求）——独立 PR。
- `splashBridge.markContentReady` / `secureStorage.syncNativeToken` 在原生环境的逻辑路径——保持不变。
- `useContainerWidth` 公开接口 `{ width: Accessor<number>; ref: (el) => void }`——保持不变（唯一调用点 `AdaptiveTags.tsx:38` 不改动）。
- Capacitor 版本升级 / 新增插件 / 跨平台差异。

## 3. 设计（3 个独立子任务，零相互依赖，可串行/并行提交）

### D1 — `SideNavShell` 双向同步（消除 `STRICT_READ_UNTRACKED`）

**入口**：`packages/app/src/components/home/SideNavShell.tsx:122-126`

**改动**：

```ts
const SideNavShell: Component<SideNavShellProps> = (props) => {
  const navigate = useNavigate();
  // 局部 Tab 状态：初始值桥接全局 currentTab，运行时反向同步——
  // 全局 currentTab 变化（如 NavBar / PersonalCenter 入口改写）→ 局部 tab 跟随。
  const [tab, setTab] = createSignal<HomeTab>(initialHomeTab());

  // 反向同步：全局 currentTab → 局部 tab
  createEffect(
    () => {
      const next = currentTab();
      if (next === tab()) return undefined; // 同值守卫：短路多余 setTab 调用
      return isValidHomeTab(next) ? next : undefined; // 非法 HomeTab 跳过
    },
    (next) => {
      if (next !== undefined) setTab(next);
    },
  );

  // ... 既有 selectTab / JSX 不动
};

/**
 * 判定 uiStore.Tab 是否为 SideNavShell 可消费的合法 HomeTab。
 * 提取为顶层纯函数以便单测与复用（SideNavShell 初始化 + 反向同步 effect
 * 共享同一白名单，避免漂移）。
 */
export function isValidHomeTab(tab: string): tab is HomeTab {
  return tab === "recommended" || tab === "follow" || tab === "bookmarks" || tab === "history";
}
```

**4 维度核对**：
| 维度 | 说明 |
|------|------|
| 可维护性 | createEffect 与既有 `NavBar.tsx:42-50` 模式同族；非法值白名单抽成顶层 `isValidHomeTab` 纯函数（与 `initialHomeTab` 共享），消除内联重复 + 可单测 |
| 性能 | `createEffect` 批执行；同值守卫短路大部分 setter 调用 |
| 安全 | 同值守卫短路多余 setTab 调用（SolidJS createSignal setter 同值 no-op 已防死循环，守卫只是显式化）；非法 HomeTab 跳过（`setCurrentTab("me")` 等全局 tab 不会污染局部 tab 类型不变量） |
| 内存 | 新增 1 个 ReactiveNode + 1 个顶层纯函数（无闭包），组件卸载时 Solid 自动回收 |

### D2 — `useContainerWidth` 重构（消除 `NO_OWNER_CLEANUP` + 修复 ResizeObserver 泄漏）

**入口**：`packages/app/src/primitives/useContainerWidth.ts`

**改动**：

```ts
import type { Accessor } from "solid-js";
import { createSignal, onSettled } from "solid-js";

/**
 * Tracks container element width via ResizeObserver.
 * Returns the element's clientWidth as a signal.
 */
export function useContainerWidth(): {
  width: Accessor<number>;
  ref: (el: HTMLDivElement) => void;
} {
  const [width, setWidth] = createSignal(0);

  // 守卫：非有限/负值不写入（NaN 会穿透 recalc 的 w<=0 守卫导致 visible=0 只显示 +N）
  const setW = (v: number) => {
    if (Number.isFinite(v) && v >= 0) setWidth(v);
  };

  // ref 只持有元素引用；副作用（ResizeObserver / 初始测量）推迟到 onSettled（DOM 已挂载），
  // cleanup 经由返回值注册到 owner——Solid 2 不允许 onCleanup 出现在 ref callback 内，
  // 原写法导致 ResizeObserver 永不 disconnect（NO_OWNER_CLEANUP + 真泄漏）。
  // 范式与 AdaptiveTags.tsx:93-100 既有的 onSettled + return cleanup 一致。
  let el: HTMLDivElement | null = null;
  function ref(next: HTMLDivElement) {
    el = next;
  }

  onSettled(() => {
    if (!el) return;
    const cs = getComputedStyle(el);
    const paddingH = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    setW(el.clientWidth - paddingH);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setW(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  return { width, ref };
}
```

**4 维度核对**：
| 维度 | 说明 |
|------|------|
| 可维护性 | 接口 `{ width, ref }` 零改动；唯一调用点 `AdaptiveTags.tsx:38` 无需调整；范式与项目内 `AdaptiveTags.tsx:93-100` 既有写法一致 |
| 性能 | 副作用推迟到 `onSettled`（与 `createEffect` 相比无 microtask 延迟），DOM 已挂载后首次测量，避免 ref callback 阶段的二次重排；ResizeObserver 数量与改造前一致 |
| 安全 | `onSettled` 返回 cleanup 绑到 owner 卸载链 → `ro.disconnect()` 必触发（消除 NO_OWNER_CLEANUP 警告）；`el` 空守卫防 ref 时机异常 |
| 内存 | 1 个 ResizeObserver、1 个 `el` 闭包变量、0 个新增 DOM 节点 |

### D3 — Capacitor web 环境 IPC 守卫（消除 3 条 stack 噪音 + 真因消除）

**入口**：
- `packages/app/src/native/splashBridge.ts:23-31`
- `packages/app/src/utils/secureStorage.ts:46-51`

**改动**：

```ts
// splashBridge.ts
import { Capacitor } from "@capacitor/core";
import { AuthPlugin } from "./AuthPlugin";

let contentReady = false;

export function markContentReady(): void {
  if (contentReady) return;
  contentReady = true;

  // Web 环境无原生 AuthPlugin，根本不发 IPC 调用——消除 CapacitorException 噪音 + 节省 IPC
  if (!Capacitor.isNativePlatform()) return;

  AuthPlugin.hideSplash().catch((err) => {
    console.warn("[splashBridge] hideSplash failed:", err);
  });
}
```

```ts
// secureStorage.ts
import { Capacitor } from "@capacitor/core';

async function syncNativeToken(token: string | null): Promise<void> {
  // Web/DEV 环境无 PixivApi 插件，根本不发 IPC——消除 CapacitorException 噪音
  if (!Capacitor.isNativePlatform()) return;

  const [err] = await tryAsync(PixivApi.syncToken({ token }));
  if (err) {
    console.warn("[secureStorage] syncToken 失败（Web 环境可忽略）", err);
  }
}
```

**4 维度核对**：
| 维度 | 说明 |
|------|------|
| 可维护性 | 入口早返回，意图清晰；`Capacitor.isNativePlatform()` 是 Capacitor 官方 API（[capacitorjs.com/docs/core-apis/web](https://capacitorjs.com/docs/core-apis/web)）；catch 兜底保留作为 native 端 hot reload / 安装损坏的最终防线 |
| 性能 | web 端少 3 次 IPC + 3 次 CapacitorException 对象分配 + 2 次 microtask 调度（刷新页面实证）；生产 Android 构建零回归 |
| 安全 | 入口守卫早返回，不依赖 catch 后兜底；幂等标志 `contentReady` 保留 web 端行为；`syncNativeToken` 跳过不影响持久化主流程（持久化由 `SecureStorage.setItem` 独立完成） |
| 内存 | 无新增对象 / 常量 / 模块；`Capacitor` 对象由 `@capacitor/core` 启动时已存在 |

## 4. 影响范围

```
packages/app/src/components/home/SideNavShell.tsx  ← D1（+5 行 effect）
packages/app/src/primitives/useContainerWidth.ts  ← D2（重写副作用时机）
packages/app/src/native/splashBridge.ts          ← D3（+1 行守卫）
packages/app/src/utils/secureStorage.ts           ← D3（+1 行守卫）
```

无新文件、无新依赖、无接口变更（仅内部实现调整）。

## 5. 测试策略（硬约束映射）

| 层 | 用例 | oracle |
|----|------|--------|
| TS 纯函数 | D1 非法 HomeTab 跳过逻辑（可抽成 `isValidHomeTab` 纯函数 + 单测） | spec §3.D1 字面白名单 |
| TS 桥 | D3 守卫顺序：先 `isNativePlatform` 短路，再 `tryAsync(PixivApi.syncToken)` 仅在原生执行 | spec §3.D3 + capacitorjs 官方 API 文档 |
| 组件 | D2 `useContainerWidth` 单测：模拟 ref → onSettled 触发 → ResizeObserver 创建 → 卸载 → disconnect 调用 | spec §3.D2 |
| E2E | agent-browser adaptive-tags 240 spec：刷新首页 → 控制台无 STRICT_READ_UNTRACKED / NO_OWNER_CLEANUP / PixivApi-not-implemented / AuthPlugin-not-implemented 四条警告 | 警告归零（grep console messages） |

**为何 D1 不引入专门单测**：双向同步是 effect 行为，纯函数化它（抽 `isValidHomeTab`）即可单测；effect 本身的循环防护靠 SolidJS 编译器+同值守卫的代码静态保证。

**为何 D2 要补单测**：当前 `useContainerWidth` 无覆盖测试（已 codegraph blast radius 确认 ⚠️ no covering tests）。ResizeObserver 真泄漏是本次的核心修复点，必须用单测锚定「卸载时 disconnect 必被调用」。

**为何 D3 单测覆盖**：web 环境 `isNativePlatform === false` 守卫后，`PixivApi.syncToken` **不应被调用**——用 `vi.spyOn(PixivApi, 'syncToken')` 断言 0 次调用；原生环境（jsdom 通过 `Object.defineProperty(Capacitor, 'isNativePlatform', { value: true })` mock）保留调用路径。

## 6. 验收清单

- [ ] `pnpm check` 绿
- [ ] `pnpm test:app` 全绿（包含新增 `useContainerWidth` / `secureStorage` / `isValidHomeTab` 单测）
- [ ] `pnpm lint` 绿
- [ ] `pnpm fmt:check` 绿
- [ ] agent-browser adaptive-tags 240 spec：刷新首页控制台无上述 4 条警告
- [ ] 实测刷新 web 端页面：`pnpm dev:app` → 打开浏览器 devtools console → 仅能看到 otaService 那条预期 `web/dev 预期` warn，其余 4 条归零
- [ ] Android 真机（或模拟器 `pnpm build:android`）回归：splash 关闭 + token 持久化 + 401 刷新行为不变

## 7. 假设记录（Grill 第二轮已锁定，可推翻）

| #   | 假设                                                                                          | 备选                                  |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------- |
| A1  | `isValidHomeTab` 不抽为独立导出函数，内联在 effect 内（避免 uiStore 表面扩张）                 | 抽 `isValidHomeTab` 导出 + 单测       |
| A2  | Capacitor 守卫用 `isNativePlatform()` 单层，不叠加 `isPluginAvailable()` 双层校验              | 双层校验（多一次 plugin 注册表查询） |
| A3  | `useContainerWidth` 单测用 happy-dom + jsdom mock ResizeObserver（项目已 happy-dom）          | 真 DOM + 真 ResizeObserver            |

---

# Tickets（拆分建议）

3 个 ticket 完全独立，按依赖图：

```
T1 [D2] useContainerWidth 重构 + ResizeObserver 泄漏修复 + 单测覆盖
T2 [D3] Capacitor web 环境 IPC 守卫（splashBridge + secureStorage）
T3 [D1] SideNavShell 双向同步 + 非法 HomeTab 跳过
```

可并行提交，无相互 blocker。