// components 域 I（en）——key 集合与源语言完全一致（satisfies 编译期强制）。
import type { ZhComponents1Key } from "../zh-CN/components1";

const enComponents1 = {} as const satisfies Record<ZhComponents1Key, string>;

export default enComponents1;
