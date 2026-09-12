// lynx 页面域（en）——key 集合与源语言完全一致（satisfies 编译期强制）。
import type { ZhPagesKey } from "../zh-CN/pages";

const enPages = {} as const satisfies Record<ZhPagesKey, string>;

export default enPages;
