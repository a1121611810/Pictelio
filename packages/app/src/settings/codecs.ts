/**
 * 内置 Codec —— 序列化策略。
 *
 * 兼容旧数据格式：项目历史存储全部是 string（String(bool)、String(number)、裸字符串）。
 * boolCodec / numCodec 同时接受旧字符串形态与 JSON 形态。
 */

import type { Codec } from "./types";

export const stringCodec: Codec<string> = {
  encode: (v) => v,
  decode: (raw) => raw,
};

/** 兼容 "true" / true 两种形态（旧数据是 String(true)） */
export const boolCodec: Codec<boolean> = {
  encode: (v) => String(v),
  decode: (raw) => {
    if (raw === "true" || raw === "false") return raw === "true";
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "boolean") return parsed;
    throw new Error(`invalid boolean: ${raw}`);
  },
};

/** 兼容 "300" / 300 两种形态（旧数据是 String(number)） */
export const numCodec: Codec<number> = {
  encode: (v) => String(v),
  decode: (raw) => {
    const n = Number(raw);
    if (Number.isNaN(n)) throw new Error(`invalid number: ${raw}`);
    return n;
  },
};

export const jsonCodec: Codec<unknown> = {
  encode: (v) => JSON.stringify(v),
  decode: (raw) => JSON.parse(raw),
};

/** 按 default 的运行时类型推断 codec */
export function inferCodec<T>(defaultValue: T): Codec<T> {
  if (typeof defaultValue === "boolean") return boolCodec as Codec<T>;
  if (typeof defaultValue === "number") return numCodec as Codec<T>;
  if (typeof defaultValue === "string") return stringCodec as Codec<T>;
  return jsonCodec as Codec<T>;
}
