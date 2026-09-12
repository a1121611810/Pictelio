// routes 域（en）——key 集合与源语言完全一致（satisfies 编译期强制）。
import type { ZhRoutesKey } from "../zh-CN/routes";

const enRoutes = {} as const satisfies Record<ZhRoutesKey, string>;

export default enRoutes;
