import { Capacitor } from "@capacitor/core";

/**
 * 运行环境平台判定（native = Android/iOS 原生容器；web = 浏览器/开发服务器）。
 *
 * 独立小模块的意义：可被 vi.mock 精确替换（不连带 mock 整个 @capacitor/core），
 * 供「平台相关校验/迁移」类纯函数注入默认值（先例：图床 http:// 校验，spec #382）。
 */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}
