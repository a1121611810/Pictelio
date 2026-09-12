// lynx 组件/工具域（en）——key 集合与源语言完全一致（satisfies 编译期强制）。
import type { ZhMiscKey } from "../zh-CN/misc";

const enMisc = {} as const satisfies Record<ZhMiscKey, string>;

export default enMisc;
