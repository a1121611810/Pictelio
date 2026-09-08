import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Pixiv 网络直连命令面/状态面桥（ticket #391 T6）。
 *
 * 方法挂在既有 `PixivApi` Capacitor 插件上（webview 源集 PixivApiPlugin，#391 指定
 * 不注册新插件）；本模块是薄包装：registerPlugin 以同名 "PixivApi" 建立指向同一
 * 原生插件的类型化代理，仅暴露直连相关的两个方法（先例：ImageCache.ts / AuthPlugin.ts）。
 */

/** 直连开关三态（对齐 Java DirectAccessPolicy.SwitchState；UNSET = 未配置/解析失败兜底） */
export type DirectAccessSwitchState = "ON" | "OFF" | "UNSET";

/** 双通道熔断相位（对齐 Java ChannelCircuitBreaker.Phase） */
export type DirectAccessPhase = "CLOSED" | "OPEN" | "HALF_OPEN";

/** 直连运行时状态快照（字段与 Java PixivApiPlugin.directAccessStatusCore resolve 的 JSObject 一致） */
export interface DirectAccessStatus {
  switchState: DirectAccessSwitchState;
  /** 图片通道（*.pximg.net 边缘）熔断相位 */
  imageChannel: DirectAccessPhase;
  /** API+刷新通道（*.pixiv.net 边缘）熔断相位 */
  apiChannel: DirectAccessPhase;
  /** 三层合并后 IP 表条目数 */
  tableEntries: number;
  /** 参与合并的层级摘要（"manual+remote+builtin" / "builtin"） */
  tableSource: string;
  /** 最近一次成功拉取远端表时刻 ms（0 = 从未成功） */
  lastFetchAtMillis: number;
}

/** 直连命令（reset = 双通道熔断全重置；refresh = 立即拉取远端 IP 表） */
export type DirectAccessAction = "reset" | "refresh";

interface DirectAccessPluginMethods {
  directAccessStatus(): Promise<DirectAccessStatus>;
  directAccessCommand(options: {
    action: DirectAccessAction;
  }): Promise<{ ok: boolean; started?: boolean }>;
}

const DirectAccessPlugin = registerPlugin<DirectAccessPluginMethods>("PixivApi");

/** 非 native 环境的安全默认状态（直连视为未配置、双通道全 closed，先例 ImageCache.ts 的 web 形态） */
export const DIRECT_ACCESS_DEFAULT_STATUS: DirectAccessStatus = {
  switchState: "UNSET",
  imageChannel: "CLOSED",
  apiChannel: "CLOSED",
  tableEntries: 0,
  tableSource: "builtin",
  lastFetchAtMillis: 0,
};

/**
 * 查询直连运行时状态。非 native 环境（web/dev）返回安全默认（不 reject——
 * 状态是只读观测面，web 下"未配置"即真实语义）；native 下委托 Java 快照。
 */
export async function directAccessStatus(): Promise<DirectAccessStatus> {
  if (!Capacitor.isNativePlatform()) {
    return DIRECT_ACCESS_DEFAULT_STATUS;
  }
  return DirectAccessPlugin.directAccessStatus();
}

/**
 * 下发直连命令（reset / refresh）。非 native 环境无命令通道，reject（禁静默降级——
 * 调用方应向用户显式暴露"命令不可用"而非假装成功）。
 */
export async function directAccessCommand(
  action: DirectAccessAction,
): Promise<{ ok: boolean; started?: boolean }> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error(`[DirectAccess] 命令 ${action} 仅在原生环境可用`);
  }
  return DirectAccessPlugin.directAccessCommand({ action });
}
