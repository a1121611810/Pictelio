import { jstToday } from "@pictelio/ranking-core"

/** date=null 或等于今日(JST) → 「今日」态（「后一天」禁用，不请求未来日期） */
export function isTodayDate(date: string | null, today: string = jstToday()): boolean {
  return date === null || date === today
}

/** 「后一天」是否可前进：今日不可（spec §5.3） */
export function canShiftForward(date: string | null, today: string = jstToday()): boolean {
  return !isTodayDate(date, today)
}
