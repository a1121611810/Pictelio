import type { Accessor } from "solid-js";

/**
 * Tracks container element width via ResizeObserver.
 * Returns the element's clientWidth as a signal.
 */
export function useContainerWidth(): {
  width: Accessor<number>;
  ref: (el: HTMLDivElement) => void;
} {
  // ownedWrite: true：ref callback 在 JSX 渲染阶段被调用，位于 createComponent 的
  // owned scope 内——默认 setter 在 Solid 2.0 dev 会抛 REACTIVE_WRITE_IN_OWNED_SCOPE。
  // 此处 setter 写入时机完全由我们自己控制（初始测量 / ResizeObserver 回调），
  // 不需要「写入绑定到原 owner scope」语义——声明 ownedWrite 显式解除 guard。
  const [width, setWidth] = createSignal(0, { ownedWrite: true });

  // 守卫：非有限/负值不写入（NaN 会穿透 recalc 的 w<=0 守卫导致 visible=0 只显示 +N）
  const setW = (v: number) => {
    if (Number.isFinite(v) && v >= 0) setWidth(v);
  };

  // Solid 2.0：ref 回调 unowned（getOwner() 为 null），其内部 onCleanup 会静默失效
  // （NO_OWNER_CLEANUP 警告）——ResizeObserver 永不 disconnect 是真泄漏。范式与
  // createFeedVirtualizer.ts:165-167 对齐：setup 期 onSettled 注册 cleanup 钩到
  // owner 卸载链；副作用（初始测量 + new ResizeObserver）推迟到 ref 内部。
  let ro: ResizeObserver | undefined;
  onSettled(() => () => ro?.disconnect());

  function ref(el: HTMLDivElement) {
    if (!el) {
      return;
    }
    // 初始值使用 contentRect.width 相同的口径（excludes padding）
    const cs = getComputedStyle(el);
    const paddingH = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    setW(el.clientWidth - paddingH);

    ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setW(entry.contentRect.width);
      }
    });
    ro.observe(el);
  }

  return { width, ref };
}
