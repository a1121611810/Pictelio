// ─── 内容设置（R18/R18G 开关，ADR-0051 + 动图播放方案 T6） ───
// 对齐主项目 settingsStore：showR18 / showR18G 默认 false（默认隐藏 R18/R18G），
// 持久化到 IndexedDB KV（web-core Worker 环境唯一持久化手段）。
// x_restrict: 0=全年龄, 1=R-18, 2=R-18G
import { ref } from "vue"
import { idbGet, idbSet } from "../utils/idbKV"
import type { UgoiraExtractMode } from "../api/ugoira"

const SHOW_R18_KEY = "settings_show_r18"
const SHOW_R18G_KEY = "settings_show_r18g"
const UGOIRA_MODE_KEY = "settings_ugoira_mode"

const _showR18 = ref(false)
const _showR18G = ref(false)
const _ugoiraMode = ref<UgoiraExtractMode>("fflate")

export const showR18 = _showR18
export const showR18G = _showR18G
export const ugoiraMode = _ugoiraMode

/** 启动时从 IndexedDB 恢复设置 */
export async function loadSettings(): Promise<void> {
  const [r18, r18g, ugoira] = await Promise.all([
    idbGet(SHOW_R18_KEY),
    idbGet(SHOW_R18G_KEY),
    idbGet(UGOIRA_MODE_KEY),
  ])
  _showR18.value = r18 === "true"
  _showR18G.value = r18g === "true"
  if (ugoira === "fflate" || ugoira === "range") {
    _ugoiraMode.value = ugoira
  }
}

export function setShowR18(enabled: boolean): void {
  _showR18.value = enabled
  void idbSet(SHOW_R18_KEY, String(enabled)).catch(() => {
    /* IndexedDB 不可用则维持内存态 */
  })
}

export function setShowR18G(enabled: boolean): void {
  _showR18G.value = enabled
  void idbSet(SHOW_R18G_KEY, String(enabled)).catch(() => {
    /* IndexedDB 不可用则维持内存态 */
  })
}

export function setUgoiraMode(mode: UgoiraExtractMode): void {
  _ugoiraMode.value = mode
  void idbSet(UGOIRA_MODE_KEY, mode).catch(() => {
    /* IndexedDB 不可用则维持内存态 */
  })
}

/** 过滤列表：应用 R18/R18G 开关（对齐主项目 r18Filter.isRestricted） */
export function filterByRestrict<T extends { x_restrict: number }>(items: T[]): T[] {
  return items.filter((item) => {
    if (!_showR18.value && item.x_restrict === 1) return false
    if (!_showR18G.value && item.x_restrict === 2) return false
    return true
  })
}
