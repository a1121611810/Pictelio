/**
 * 自适应标签行核心算法（纯函数，无 JSX/无 DOM 依赖，单测覆盖）。
 *
 * 输入：各 chip 的实测宽度数组 + 「+N」徽标的实测宽度 + 容器可用宽度。
 *
 * 布局语义（用户确认）：
 * 1. 不满一行（全部 chip 总宽 ≤ 容器）→ 全部完整显示，无「+N」；
 * 2. 溢出时右侧固定预留「+N」宽度，左侧从 0 开始完整贪心放 chip；
 * 3. 放完完整 chip 后若还有剩余宽度（≥ minPartialWidth），再塞一个「截断 chip」：
 *    宽度 = 剩余宽度，文字超出用省略号「…」（用户：第二个宽度 = 400 − 第一个宽度，超出点点点）；
 * 4. 剩余标签折叠为「+N」。
 */

/** 间距：gap-[var(--spacingHorizontalXXS)] = 4px */
const CHIP_GAP = 4;
/** 截断 chip 的最小可读宽度（低于则不显示截断 chip，直接折叠 +N） */
const MIN_PARTIAL_WIDTH = 16;

interface VisibleTags {
  visible: number;
  remaining: number;
  /** 截断 chip 的宽度（px）；null = 不显示截断 chip */
  partialWidth: number | null;
}

export function computeVisibleTags(
  chipWidths: number[],
  plusWidth: number,
  width: number,
  minPartialWidth = MIN_PARTIAL_WIDTH,
): VisibleTags {
  const total = chipWidths.length;
  if (!(width > 0) || total === 0) return { visible: 0, remaining: total, partialWidth: null };

  const allWidth = chipWidths.reduce((sum, w, i) => sum + w + (i > 0 ? CHIP_GAP : 0), 0);
  // 不满一行：全部完整显示，无「+N」
  if (allWidth <= width) return { visible: total, remaining: 0, partialWidth: null };

  // 溢出：右侧预留「+N」，左侧完整贪心放满
  let visible = 0;
  let used = 0;
  for (const w of chipWidths) {
    const gap = visible > 0 ? CHIP_GAP : 0;
    if (used + gap + w + plusWidth <= width) {
      used += w + gap;
      visible++;
    } else {
      break;
    }
  }

  const remaining = total - visible;
  // 剩余宽度再塞一个截断 chip（占满剩余，内容省略号）
  const availForPartial =
    width - used - (visible > 0 ? CHIP_GAP : 0) - (remaining > 0 ? CHIP_GAP + plusWidth : 0);
  if (remaining > 0 && availForPartial >= minPartialWidth) {
    return { visible, remaining: remaining - 1, partialWidth: availForPartial };
  }
  return { visible, remaining, partialWidth: null };
}
