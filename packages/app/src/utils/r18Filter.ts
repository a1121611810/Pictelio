import type { PixivIllust, PixivNovel, PixivUserPreview } from "../api/types";
import { showR18, showR18G, aiFilterMode } from "../stores/settingsStore";
import { isBlocked } from "../stores/blockStore";
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

/** 判断内容作者是否已被屏蔽 */
function isBlockedUser(item: { user: { id: number } }): boolean {
  return isBlocked(item.user.id);
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
 */
export function filterFeedIllusts(illusts: PixivIllust[]): PixivIllust[] {
  return illusts.filter((i) => !isRestricted(i) && !isBlockedUser(i) && !isAiFiltered(i));
}

/**
 * 过滤小说列表：同时应用 R18 / R-18G 开关、屏蔽用户与 AI 三态。
 * 被屏蔽用户的所有小说都会被隐藏。
 */
export function filterNovels(novels: PixivNovel[]): PixivNovel[] {
  return novels.filter((n) => !isRestricted(n) && !isBlockedUser(n) && !isAiFiltered(n));
}

/** 过滤 user_previews：移除被屏蔽用户，并对其示例作品应用 R18 + AI 三态过滤 */
export function filterUserPreviews(previews: PixivUserPreview[]): PixivUserPreview[] {
  return previews
    .filter((p) => !isBlocked(p.user.id))
    .map((p) =>
      Object.assign({}, p, {
        illusts: p.illusts.filter((i) => !isRestricted(i) && !isAiFiltered(i)),
      }),
    );
}
