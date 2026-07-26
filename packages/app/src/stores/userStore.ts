import { getUserDetail } from "../api/user";
import { type PixivProfile, type PixivUser } from "../api/types";
import { user } from "./authStore";


const [profile, setProfile] = createSignal<PixivProfile | null>(null);
const [viewedUser, setViewedUser] = createSignal<PixivUser | null>(null);

// 缓存已加载的用户数据，避免返回时重复请求
const profileCache = new Map<number, { profile: PixivProfile; user: PixivUser }>();

export { profile, viewedUser };

export async function loadProfile(userId?: number, forceRefresh?: boolean) {
  const id = userId ?? user()?.id;
  if (!id) {
    return;
  }
  // 非强制刷新时走缓存
  if (!forceRefresh) {
    const cached = profileCache.get(Number(id));
    if (cached) {
      setProfile(cached.profile);
      setViewedUser(cached.user);
      return;
    }
  }
  const [err, data] = await tryAsync(getUserDetail(id));
  if (err) {
    console.warn("[userStore] Failed to load profile", err);
  } else {
    setProfile(data!.profile);
    setViewedUser(data!.user);
    profileCache.set(Number(id), { profile: data!.profile, user: data!.user });
  }
}
