// ─── refresh_token 持久化（web-core Worker 环境，ADR-0050） ───
// 基于通用 IndexedDB KV 层（utils/idbKV.ts）的薄封装，key = "refresh_token"。
// 原生 LynxView（#41）改用 Native Module 对齐主项目 @aparajita Keystore 存储（见 ADR-0050）。
import { idbSet, idbGet, idbRemove } from "./idbKV"

const KEY = "refresh_token"

/** 保存 refresh_token（登录成功 / 401 刷新轮换后更新） */
export function saveRefreshToken(token: string): Promise<void> {
  return idbSet(KEY, token)
}

/** 读取 refresh_token（启动恢复） */
export function loadRefreshToken(): Promise<string | null> {
  return idbGet(KEY)
}

/** 清除 refresh_token（登出） */
export function clearRefreshToken(): Promise<void> {
  return idbRemove(KEY)
}
