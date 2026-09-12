// 核心层域（en）——key 集合与源语言完全一致（satisfies 编译期强制）。
import type { ZhCoreKey } from "../zh-CN/core";

const enCore = {} as const satisfies Record<ZhCoreKey, string>;

export default enCore;
