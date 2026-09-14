// happy-dom `textContent` setter 规范偏差补丁（单测环境基础设施，非产品行为）。
//
// 现象：`el.textContent = 0`（number）在 happy-dom 下结果是**空元素**——DOM 规范要求
// setter 先把值强制转成字符串（`textContent = "0"`）。实测：`el.textContent = 0` →
// `<span></span>`、`firstChild === null`。
//
// 为什么必须在单测里修：Solid 2.0 的 `insertExpression`（@solidjs/web insertExpression）
// 在「父元素无子节点」时用 `parent.textContent = value` 写入动态文本，且**不传字符串**；
// 于是页面里 `<span>{illust().total_bookmarks}</span>` 这类「数值 + 初值 0」的节点被
// 静默写成空元素（真实浏览器会渲染 "0"），随后任何一次更新走 `parent.firstChild.data = value`
// 分支 → `Cannot set properties of null (setting 'data')` → Solid 报 REACTIVITY_HALTED
// 并让整个测试文件以 unhandled error 收尾（CI 退出码非 0）。
//
// 补丁范围最小化：只对 number 值补 String() 强转（规范语义），其余值（含 undefined）
// 原样交给 happy-dom 原 setter，不改变任何其他分支行为。
// node 环境测试（@vitest-environment node）没有 Element：跳过（无 DOM 可补）。
const TEXT_CONTENT =
  typeof Element === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(Element.prototype, "textContent");

if (TEXT_CONTENT?.get && TEXT_CONTENT.set) {
  const { get, set } = TEXT_CONTENT;
  Object.defineProperty(Element.prototype, "textContent", {
    get() {
      return get.call(this);
    },
    set(value: unknown) {
      set.call(this, typeof value === "number" ? String(value) : value);
    },
    configurable: true,
  });
}
