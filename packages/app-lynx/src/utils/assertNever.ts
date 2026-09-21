/**
 * 编译期穷尽性检查工具（Exhaustiveness Checking Helper）
 *
 * 用途：在 switch 语句的 `default` 分支里调用本工具，把"已经被收窄到 never"的
 * 变量传入。当可辨识联合类型（discriminated union）增加新成员但 switch 没有
 * 同步处理时，`value` 不再是 `never` —— TypeScript 会在调用点报错，编译期
 * 即拦截"忘记处理新成员"的事故。
 *
 * 运行期：本工具理论上永远不会被执行（switch 全部 case 已穷尽）；抛出仅在
 * 编译器被绕过（例如非 TS 边界、`as` 断言绕过）时作为最终安全网。
 *
 * @example
 * type Status = "pending" | "done";
 * function label(s: Status): string {
 *   switch (s) {
 *     case "pending": return "审核中";
 *     case "done": return "完成";
 *     default: return assertNever(s);  // ← s 在此处被收窄到 never
 *   }
 * }
 *
 * @see docs/adr/ADR-0181-assertnever-exhaustive-checking.md
 * @see docs/specs/assertnever-exhaustive-checking.md
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled discriminated union member: ${JSON.stringify(value)}`);
}
