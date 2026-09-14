import type { PixivIllust, PixivNovel, PixivUserPreview } from "../api/types";
import { showR18, showR18G, aiFilterMode } from "../stores/settingsStore";
import { blockedIds } from "../stores/blockStore";
import { isAiHiddenByMode } from "./aiFilter";

/**
 * 判断内容是否应被过滤（R-18 或 R-18G 开关关闭时隐藏对应内容）。
 * x_restrict: 0=全年龄, 1=R-18, 2=R-18G
 */
function isRestricted(item: { x_restrict: number }): boolean {
  if (!showR18() && item.x_restrict === 1) {
    return true;
  }
  if (!showR18G() && item.x_restrict === 2) {
    return true;
  }
  return false;
}

/** AI 三态过滤：读 account 级 aiFilterMode()，「mask」隐藏 AI 作品、「only」隐藏非 AI（ADR-0155） */
function isAiFiltered(item: {
  illust_ai_type?: number | null;
  novel_ai_type?: number | null;
}): boolean {
  return isAiHiddenByMode(item, aiFilterMode());
}

/**
 * 过滤作品列表：同时应用 R18 / R-18G 开关、屏蔽用户与 AI 三态。
 * 被屏蔽用户的所有作品都会被隐藏。
 *
 * 屏蔽表用整集快照读（#426 HUGE_FAN_IN）：过滤计算运行在 tracked scope，
 * 逐条 `isBlocked(id)` 会把 ~2000 个 signal 源挂到同一计算上（任一变化全量重滤）；
 * `blockedIds()` 一次读成 Set，源数收敛为 1，屏蔽语义不变（屏蔽表任何变化仍整体重滤）。
 */
export function filterFeedIllusts(illusts: PixivIllust[]): PixivIllust[] {
  const blocked = blockedIds();
  return illusts.filter((i) => !isRestricted(i) && !blocked.has(i.user.id) && !isAiFiltered(i));
}

/**
 * 过滤小说列表：同时应用 R18 / R-18G 开关、屏蔽用户与 AI 三态。
 * 被屏蔽用户的所有小说都会被隐藏。（屏蔽表整集快照读，同 filterFeedIllusts）
 */
export function filterNovels(novels: PixivNovel[]): PixivNovel[] {
  const blocked = blockedIds();
  return novels.filter((n) => !isRestricted(n) && !blocked.has(n.user.id) && !isAiFiltered(n));
}

/** 过滤 user_previews：移除被屏蔽用户，并对其示例作品应用 R18 + AI 三态过滤 */
export function filterUserPreviews(previews: PixivUserPreview[]): PixivUserPreview[] {
  const blocked = blockedIds();
  return previews
    .filter((p) => !blocked.has(p.user.id))
    .map((p) =>
      Object.assign({}, p, {
        illusts: p.illusts.filter((i) => !isRestricted(i) && !isAiFiltered(i)),
      }),
    );
}
