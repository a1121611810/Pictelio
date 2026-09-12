// components 域 II（en）——key 集合与源语言完全一致（satisfies 编译期强制）。
import type { ZhComponents2Key } from "../zh-CN/components2";

const enComponents2 = {} as const satisfies Record<ZhComponents2Key, string>;

export default enComponents2;
