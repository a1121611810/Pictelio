// ─── 引擎降级通知 store（ADR-0153）───
// App.vue onMounted 调 check()：首帧经 consumeEngineFallbackNotice 读一次性键
// （原生 PictelioPrefs / dev IndexedDB）并消费删除。
// dismiss() 仅关 UI——键已在 consume 时删除；下次降级入口会重新写入。
// Pinia setup store（ADR-0139）。
import { ref } from "vue"
import { defineStore } from "pinia"
import { consumeEngineFallbackNotice } from "../utils/engineFallbackNotice"

export const useEngineFallbackStore = defineStore("engineFallback", () => {
  /** 是否展示引擎降级说明（true = 本次由降级进入 Lynx） */
  const notice = ref(false)

  async function check(): Promise<void> {
    notice.value = await consumeEngineFallbackNotice()
  }

  function dismiss(): void {
    notice.value = false
  }

  return { notice, check, dismiss }
})
