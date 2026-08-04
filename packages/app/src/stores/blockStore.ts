import { createPersistedSetSetting } from "./shared/createPersistedSet";

const PREF_KEY_BLOCKED_IDS = "blocked_user_ids";

const { values, add, remove, has, load, reset } = createPersistedSetSetting<number>({
  key: PREF_KEY_BLOCKED_IDS,
  default: [],
  validate: (v): v is number[] => Array.isArray(v) && v.every((n) => typeof n === "number"),
});

export { values as blockedIds };

/** 从存储加载已屏蔽用户 ID */
export const loadBlockedIds = load;
/** 屏蔽用户并持久化。重复屏蔽会被忽略。 */
export const blockUser = add;
/** 取消屏蔽用户并持久化。 */
export const unblockUser = remove;
/** 判断用户是否已被屏蔽 */
export const isBlocked = has;
/** 清空本地屏蔽列表（并持久化空集合） */
export const resetBlockedIds = reset;
