import type { Accessor } from "solid-js";
import { createSignal, onSettled } from "solid-js";

/**
 * 延迟到宿主首次提交后再挂载重量级子树（true 表示可以挂载）。
 *
 * 背景（实机二分，2026-09-13）：Solid 2.0 的路由导航在 transition 中进行，而在过渡期间
 * 构造/读取 @tanstack/solid-query v6 适配层的查询投影（createProjection / createEffect），
 * 会让该过渡**永不提交**——表现为登录成功后 `navigate('/home')` 不生效（URL 停在 /login）、
 * 或 app 困在根部 <Show> 的 fallback（白屏「加载中」）。本原语把这类子树挪到过渡提交之后
 * 的普通更新里再挂载，从结构上避免牵连路由过渡。
 *
 * 用法：`const ready = createDeferredMount(); return <Show when={ready()}>…</Show>`
 */
export function createDeferredMount(): Accessor<boolean> {
  const [ready, setReady] = createSignal(false);
  // 注意：Solid 2.0 的 onSettled 回调返回值被当作 cleanup 校验，setter 会返回新值 →
  // 必须写成块语句（返回 undefined），否则抛 "invalid cleanup value" 并 halt 整个响应式系统。
  onSettled(() => {
    setReady(true);
  });
  return ready;
}
