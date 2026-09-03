// globalFab store 单测（ADR-0140 决策 6）：Pinia 化后的 store 单例 + 视图派生 + 命令通道。
// 期望值溯源（oracle）：
//   - view.mode 三态 → ADR-0132 决策 2 + createGlobalFab.ts:75 NON_CONTENT_ROUTE_NAMES
//   - view.inner 装配（搜索 + 刷新 + 回顶 + extras）→ createGlobalFab.ts:130-167
//   - 跨 store 闭包（openSearch / hasOpenModal）→ ADR-0140 决策 1（factory body 箭头）
//   - view.visible 兼容别名（mode !== 'hidden'）→ ADR-0120 布尔门
// 测试 seam（与 searchSheetStore.test.ts / settingsStore.test.ts 同模式）：
//   - setActivePinia(createPinia()) per beforeEach 隔离
//   - vi.mock('../router') 注入假 routeState ref + navigate spy（holder 模式：hoisted 内不调 ref）
//   - vi.mock('./searchSheetStore') + vi.mock('./modalStack') 注入跨 store spy
//   - 真实 createGlobalFab primitive 不动（已有 primitives/createGlobalFab.test.ts 覆盖 200+ 行）
// 关键陷阱：
//   - vi.hoisted 内不能 import / 不能调 ref（vitest transform 把 vi.mock 提到 import 之前，
//     回调运行时 ref 还在 TDZ → Cannot access '__vi_import_0__' before initialization）
//   - holder 模式：hoisted 返回 mutable holder，vi.mock factory 用 getter 读 holder 字段，
//     beforeEach 内创建 ref 注入 holder；Pinia factory 在 useGlobalFabStore() 时拿到的就是
//     注入好的 ref
//   - hasOpenModal 必须是 ref（不是普通 let）——createGlobalFab.ts:173 deps.hasOpenModal?.()
//     内读 ref.value 才会被 computed 跟踪
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { ref, nextTick, type Ref } from "vue"
import { setActivePinia, createPinia } from "pinia"
import { useGlobalFabStore } from "./globalFab"

type RouteStateLike = { name: string; path: string; params: Record<string, string> }

// ─── hoisted holder：纯 mutable 容器（不调 ref，避开 TDZ）───
const holder = vi.hoisted(() => ({
  routeState: null as Ref<RouteStateLike> | null,
  hasOpenModalRef: null as Ref<boolean> | null,
  openSearch: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock("../router", () => ({
  get routeState() { return holder.routeState },
  get navigate() { return holder.navigate },
}))
vi.mock("./searchSheetStore", () => ({
  useSearchSheetStore: () => ({ openSearch: holder.openSearch }),
}))
vi.mock("./modalStack", () => ({
  useModalStack: () => ({ hasOpenModal: () => holder.hasOpenModalRef?.value ?? false }),
}))

// 模块层（非 hoisted）创建 ref —— hasOpenModal 闭包需要读 ref.value 才能被 computed 跟踪
const hasOpenModalRef = ref(false)
holder.hasOpenModalRef = hasOpenModalRef

let store: ReturnType<typeof useGlobalFabStore>

beforeEach(async () => {
  setActivePinia(createPinia())
  // 注入新 ref（新 pinia 实例 + 新 routeState，避免前用例残留）
  holder.routeState = ref<RouteStateLike>({
    name: "recommended",
    path: "/recommended",
    params: {},
  })
  hasOpenModalRef.value = false
  holder.openSearch.mockClear()
  holder.navigate.mockClear()
  store = useGlobalFabStore()
  // setActivePinia(createPinia()) 重建 pinia → 触发 defineStore factory 体 → 新 createGlobalFab
  // 实例，menu 初始 open=false，无需兜底 close
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("globalFab — store 单例（Pinia setup store）", () => {
  it("useGlobalFabStore() returns a store instance", () => {
    expect(store).toBeDefined()
    expect(store).not.toBeNull()
    expect(typeof store.usePage).toBe("function")
    expect(typeof store.dispatch).toBe("function")
    // view 派生存在（ref 解包后为对象）
    expect(store.view).toBeDefined()
    expect(typeof store.view.mode).toBe("string")
  })

  it("useGlobalFabStore() is a singleton (same store proxy)", () => {
    const s2 = useGlobalFabStore()
    expect(s2).toBe(store) // Pinia 同 id 返回同一 proxy
  })
})

describe("globalFab — view.mode 三态派生（ADR-0132 决策 2）", () => {
  it("view.visible === false on login route (NON_CONTENT_ROUTE_NAMES)", async () => {
    holder.routeState!.value = { name: "login", path: "/login", params: {} }
    await nextTick()
    expect(store.view.mode).toBe("hidden")
    expect(store.view.visible).toBe(false)
  })

  it("view.visible === false on update / error routes", async () => {
    for (const name of ["update", "error"]) {
      holder.routeState!.value = { name, path: `/${name}`, params: {} }
      await nextTick()
      expect(store.view.mode).toBe("hidden")
      expect(store.view.visible).toBe(false)
    }
  })

  it("view.mode === 'menu' on 4 top-level tab routes", async () => {
    for (const name of ["recommended", "illusts", "novels", "me"]) {
      holder.routeState!.value = { name, path: `/${name}`, params: {} }
      await nextTick()
      expect(store.view.mode).toBe("menu")
      expect(store.view.visible).toBe(true)
      expect(store.view.active).toBe(name)
    }
  })

  it("view.mode === 'search' on all content routes (illust/novel/user/bookmarks/watchlist)", async () => {
    // 对称 test 5（4 tab 全集）/ test 3-4（3 non-content 全集）：遍历全部 8 个 content route
    const contentRoutes = [
      "illust-detail",
      "novel-detail",
      "user-home",
      "user-following",
      "user-followers",
      "following",
      "bookmarks",
      "watchlist",
    ]
    for (const name of contentRoutes) {
      holder.routeState!.value = { name, path: `/${name}`, params: {} }
      await nextTick()
      expect(store.view.mode).toBe("search")
      expect(store.view.visible).toBe(true)
      expect(store.view.active).toBeNull()
    }
  })
})

describe("globalFab — usePage 注册/注销", () => {
  it("usePage registers inner items; unregister clears them", () => {
    // 初始 inner 至少含全局搜索项（kind='search'，固定首位）
    const initialInner = store.view.inner.length
    expect(store.view.inner.some((i) => i.kind === "search")).toBe(true)
    const unregister = store.usePage("recommended", {
      refresh: vi.fn(),
      backToTop: vi.fn(),
    })
    // 注册后 inner 多出 refresh + back-to-top 两项
    expect(store.view.inner.length).toBe(initialInner + 2)
    expect(store.view.inner.some((i) => i.kind === "refresh")).toBe(true)
    expect(store.view.inner.some((i) => i.kind === "back-to-top")).toBe(true)
    // 注销
    unregister()
    expect(store.view.inner.length).toBe(initialInner)
    expect(store.view.inner.some((i) => i.kind === "refresh")).toBe(false)
    expect(store.view.inner.some((i) => i.kind === "back-to-top")).toBe(false)
  })
})

describe("globalFab — dispatch 命令", () => {
  it("dispatch({ type: 'toggle' }) toggles view.isOpen", async () => {
    expect(store.view.isOpen).toBe(false)
    await store.dispatch({ type: "toggle" })
    expect(store.view.isOpen).toBe(true)
    await store.dispatch({ type: "toggle" })
    expect(store.view.isOpen).toBe(false)
  })

  it("dispatch({ type: 'search' }) triggers openSearch closure", async () => {
    await store.dispatch({ type: "search" })
    expect(holder.openSearch).toHaveBeenCalledTimes(1)
  })
})

describe("globalFab — 跨 store hasOpenModal 闭包", () => {
  it("hasOpenModal closure returns true → view.mode === 'hidden'", async () => {
    // 初始在 'recommended' tab，mode='menu'，visible=true
    expect(store.view.mode).toBe("menu")
    expect(store.view.visible).toBe(true)
    // 模拟弹层打开
    hasOpenModalRef.value = true
    await nextTick()
    expect(store.view.mode).toBe("hidden")
    expect(store.view.visible).toBe(false)
  })
})
