// 英文字典聚合器。分域 satisfies（en/<域>.ts 对 zh/<域>.ts 的 Key）保证键完备；
// 新增域文件时在本文件与 zh-CN/index.ts 同步注册。
import error_ from "./error";
import type { Dict } from "../zh-CN";

const en = { ...error_ } as const satisfies Dict;

export default en;
