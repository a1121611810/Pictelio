// 源语言字典聚合器（简中）。分域文件支撑并行抽取互不冲突；
// key 规范 <域>.<区块>.<语义>；新增域文件必须同步 en/<域>.ts（per-domain satisfies 编译期强制）。
import error_ from "./error";
import time_ from "./time";
import pages_ from "./pages";
import misc_ from "./misc";

const zhCN = { ...error_, ...time_, ...pages_, ...misc_ } as const;

export default zhCN;
export type I18nKey = keyof typeof zhCN;
export type Dict = Record<I18nKey, string>;
