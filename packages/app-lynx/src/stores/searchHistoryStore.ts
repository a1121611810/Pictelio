// ─── 搜索历史（app-lynx 全局搜索，spec D3 / issue #293 T3） ───
// 设备级持久化：只用 utils/idbKV.ts（web-core Worker 环境唯一持久化入口，
// 与 tokenStorage / settingsStore 的 ugoiraMode 等非账号级键同源）。
// 搜索历史属敏感数据（HIG，glossary「搜索历史」）——默认不跨引擎同步，
// 因此**不经 SharedPreferences / ADR-0103 账号级契约键**（show_r18_${uid}
// 等账号级键仅用于账号级开关，历史无账号语义）。
// 写入时机 = 搜索提交点（回车确认 / 点历史词条 / 点结果行，见 glossary
// 「搜索提交点」）；输入中间态不写——由 SearchSheet 组件在提交点调用本 store，
// store 不做监听。
// Pinia 化（ADR-0139 / spec #337）：setup store——state/actions 移入 defineStore
// 闭包，逻辑逐字不变（纯重构约束）；resetSearchHistoryForTest 由
// setActivePinia(createPinia()) 每用例隔离替代，删除。
import { ref } from "vue"
import { defineStore } from "pinia"
import { idbGet, idbSet } from "../utils/idbKV"

/** idbKV 键（设备级，非账号级；spec D3 定名 search_history） */
const HISTORY_KEY = "search_history"
/** 历史上限（spec D3 / issue #293：slice(0, 10)，最新在前） */
const HISTORY_LIMIT = 10

export const useSearchHistoryStore = defineStore("searchHistory", () => {
  const _history = ref<string[]>([])

  /**
   * 持久化（先更内存、后落盘）。写失败 warn 可见、**不回滚内存态**——
   * 禁止静默降级约定：错误必须暴露，用户当前会话不受存储故障影响。
   */
  function persist(next: string[]): void {
    void idbSet(HISTORY_KEY, JSON.stringify(next)).catch((err) => {
      console.warn("[searchHistoryStore] 写入搜索历史失败（内存态保留）", err)
    })
  }

  /**
   * 首拉持久化历史（SearchSheet 打开时调用；供历史 chips 展示）。
   * - 键缺失（首次使用，idbGet 永不 reject、缺失返回 null）→ 空处理，不 warn 不重置
   * - 内存已有数据但读不到（存储故障，idbKV 内部吞错表现为 null）→ 维持内存态 + warn
   * - 解析失败 / 数据非法 → 空数组 + warn（数据损坏属真异常，必须可见）
   */
  async function loadHistory(): Promise<void> {
    const raw = await idbGet(HISTORY_KEY)
    if (raw === null) {
      // idbGet 契约（utils/idbKV.ts）：任何读取错误被内部吞掉并返回 null——「读不到」
      // 与「键缺失」在 API 层面不可区分；内存已有数据时按存储故障处理（维持内存态），
      // 内存为空时才真是首次使用。禁止在此重置——spec D3「读失败维持内存态」。
      if (_history.value.length === 0) return
      console.warn("[searchHistoryStore] 搜索历史读取结果缺失（维持内存态，不重置）")
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      console.warn("[searchHistoryStore] 搜索历史 JSON 解析失败（按空处理）", err)
      _history.value = []
      return
    }
    if (!Array.isArray(parsed)) {
      console.warn("[searchHistoryStore] 搜索历史数据非法（非数组，按空处理）")
      _history.value = []
      return
    }
    const items = parsed.filter((item): item is string => typeof item === "string")
    if (items.length !== parsed.length) {
      console.warn("[searchHistoryStore] 搜索历史含非字符串条目，已跳过")
    }
    _history.value = items.slice(0, HISTORY_LIMIT)
  }

  /**
   * 提交点写入：trim 后去重（精确匹配）、插头部、slice(0, 10)。空词忽略。
   * 先更内存后持久化（写失败 warn、不回滚）。
   */
  function addHistory(word: string): void {
    const trimmed = word.trim()
    if (trimmed === "") return
    const next = [trimmed, ..._history.value.filter((item) => item !== trimmed)].slice(0, HISTORY_LIMIT)
    _history.value = next
    persist(next)
  }

  /** 单条删除（词不存在则 no-op，不写盘） */
  function removeHistory(word: string): void {
    const trimmed = word.trim()
    const next = _history.value.filter((item) => item !== trimmed)
    if (next.length === _history.value.length) return
    _history.value = next
    persist(next)
  }

  /** 全清（内存 + 持久化空数组；已空则 no-op） */
  function clearHistory(): void {
    if (_history.value.length === 0) return
    _history.value = []
    persist([])
  }

  return { history: _history, loadHistory, addHistory, removeHistory, clearHistory }
})
