// Vue 模板开标签的结构化扫描器（#1003 提到 tests/helpers/ 共享）。
//
// ── 为什么是共享的，不是某道门禁的私产 ──────────────────────────────────────
// 「结构按配对取，不按行取」这条纪律（#897 在 `routeTransitionGate.test.ts`
// 建立）本仓不止一处要守：`immersiveScrimContrast.test.ts` 的底色块抽取栽在
// **完全同族**的缺陷上（按行/按前缀取标签属性）。两份实现各自漂移，正是本仓
// §13.8.2 反复登记的「同族不同源」病灶 ⇒ 这两个消费方之间**只允许存在一份**。
//
// ⚠️ 「只允许一份」的**边界要诚实**：本文件不声称全仓只有一份实现。
//    · `stripComments` 在全仓另有 **20 处私有副本**，且**语义各异**（有的替换成 `' '` 保行号、
//      有的替换成 `''`；有的剥 HTML 注释、有的不剥）。两条命令都要跑，否则少算一半：
//        grep -rn "function stripComments" --include=*.ts packages/ | wc -l   → 17
//        grep -rn "const stripComments"    --include=*.ts packages/ | wc -l   → 3
//      本轮**刻意不收拢它们**：那些副本属于各自门禁的判据语义，跨门禁统一是一条独立票。
//    · 「按标签整体解析开标签」这条同族逻辑，在 `pressStateLayerTransition.test.ts:210/492`
//      与 `stateLayerOnPrimary.test.ts:542` 里另有既有实现（quote-aware 正则）——
//      本轮**未合并**，同样属独立票。
//    换言之：本文件消除的是**这两个门禁之间**的同族不同源，不是全仓的。
//
// ⚠️ 消费方：`tests/routeTransitionGate.test.ts`（#897 引入）、
//    `tests/immersiveScrimContrast.test.ts`（#1003 引入）。两者都**不保留**私有副本。
//
// ── 为什么不能「按行找」───
// Vue 模板的属性可以任意换行。class 与另一个属性分处两行是完全正常的写法，
// 按行取会命中「只有 A 没有 class」的那一行 ⇒ class 读成空串 ⇒ 判据恒绿放行。
// #897 实测：挂违规类名且跨行，16 个用例全绿。

/** 去注释（约束说明本身会画出反面示例，判据必须落在代码本文上） */
export function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
}

/**
 * 抽出**包含 needle 的那个开标签的完整文本**（含 `<view` 与配对的 `>`）。
 *
 * 与「按行取」相对：**跟引号扫描到配对的 `>`**，因此属性值里含 `>`（如 `:style`
 * 绑定字符串）不会提前截断。
 *
 * 同时支持双引号与单引号；未找到返回 undefined（由调用方断言处理）。
 */
export function extractTagContaining(src: string, needle: string): string | undefined {
  const code = stripComments(src)
  let from = 0
  for (;;) {
    const at = code.indexOf(needle, from)
    if (at < 0) return undefined
    // 从 needle 往前回溯到最近的开标签尖括号（`<view` / `<transition` 等）
    const open = code.lastIndexOf('<', at)
    if (open < 0) return undefined
    // 标签名到第一个空白或 `>` 为止
    const nameEnd = code.slice(open + 1).search(/[\s/>]/)
    const tagName = code.slice(open + 1, open + 1 + (nameEnd < 0 ? Infinity : nameEnd))
    if (!/^[a-zA-Z][\w.-]*$/.test(tagName)) return undefined
    // 从开标签起点扫描到配对的 `>`（开标签内无嵌套，但属性值里可能有 `>`，故跟引号）
    let i = open + 1
    let quote: string | null = null
    for (; i < code.length; i++) {
      const ch = code[i]
      if (quote) {
        if (ch === quote) quote = null
        continue
      }
      if (ch === '"' || ch === "'") {
        quote = ch
        continue
      }
      if (ch === '>') return code.slice(open, i + 1)
    }
    from = at + needle.length
  }
}

/** 从一个开标签文本里取 class 属性值（双引号 / 单引号都认；取不到返回空串） */
export function readClassAttr(tag: string): string {
  return /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(tag)?.slice(1).find(Boolean) ?? ''
}

/**
 * 抽出 `<template>` **块**的正文（无 `<template>` 时返回剥掉 script/style 后的整份源码）。
 *
 * ⚠️ 为什么必须先切块（#1003 实施期自查发现）：`<script setup>` 里常有**字符串字面量**
 *    含尖括号（泛型 `Map<string, number>`、比较运算 `a < b && c > d`、测试夹具里
 *    写着 `<view class="…">` 的反例）。全文件扫标签会把这些**当成真标签**：
 *    实测 `const s = "<view class='bg-inverse-surface/70 rounded-lg'>"` 会被抽成一块
 *    底色块。方向是 **fail-open**（凭空多出底色块、误判红），与本仓反复消灭的
 *    「抽取面比声明的宽」同性质。
 *
 * ⚠️ 为什么是「**先剥 script/style 块**，再找 template」而不是配对扫描（code-review 阻塞项）：
 *    第一版改成「配对扫描 `<template>…</template>`」**仍不够** —— `<script>` 里**也可能有**
 *    `<template>` 字面量（写文档字符串、嵌 HTML 示例时很常见），配对扫描照样会落到它身上：
 *    实测 script 内含 `"<template>片段</template>"` 时，切块起点落在 script 内、
 *    终点是那个字面量的闭合 ⇒ **真 template 块被整块排除**，抽取结果 0（更糟）。
 *    「首个开 + 末个闭」则是起点在 script、终点在真 template ⇒ script 尾部被并进扫描面
 *    （抽出 2 块，1 块是假的）。**两种配对方式都错在「没先把 script 摘出去」。**
 *    ⇒ 先按配对剥掉 `<script>…</script>` 与 `<style>…</style>`，剩下的就只有 template 块。
 *
 * SFC 只有一个根 `<template>` 块，故剩余部分取首个开标签到**末个**闭合之间的正文。
 */
export function templateBlock(src: string): string {
  // ① 先剥注释，再剥 script / style 块（含 `setup` 等属性的开标签）
  let code = stripComments(src)
  code = code
    .replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style(?:\s[^>]*)?>[\s\S]*?<\/style\s*>/gi, ' ')
  const open = /<template(?:\s[^>]*)?>/.exec(code)
  if (!open || open.index === undefined) return code
  const bodyStart = open.index + open[0].length
  const close = code.lastIndexOf('</template>')
  return close > bodyStart ? code.slice(bodyStart, close) : code.slice(bodyStart)
}

/**
 * 抽出**全部开标签**的 `{ name, class }`（按出现顺序，**只扫 `<template>` 块**）。
 *
 * 给「找的是某类元素、而不是某个已知名词」的判据用：这类判据事先不知道目标
 * 写在哪个标签上，`extractTagContaining` 需要 needle 就用不上。
 *
 * ⚠️ 刻意**不看标签名**（`name` 只作为返回值交给调用方判断）：把「哪些标签算」
 * 留给判据自己决定，避免解析器暗含一条「只认 `<view>`」的隐含规则 —— 那正是
 * #1003 实测出的三格失效面之一（`<text class="…">` 抽不到）。
 *
 * 跳过的：注释（已剥）、闭合标签 `</…>`、以及属性值里含 `<` 或 `>` 的误伤
 * —— Vue 模板的动态属性里出现尖括号（`:x="a < b"`）是可能的，故开标签扫描
 * 同样跟引号。
 */
export function extractOpeningTags(src: string): { name: string; class: string }[] {
  const code = stripComments(templateBlock(src))
  const out: { name: string; class: string }[] = []
  let i = 0
  while (i < code.length) {
    const lt = code.indexOf('<', i)
    if (lt < 0) break
    if (code.startsWith('</', lt) || code.startsWith('<!--', lt) || code.startsWith('<!', lt)) {
      i = lt + 1
      continue
    }
    // 标签名到第一个空白、`>`、`/>` 为止
    const nameEnd = code.slice(lt + 1).search(/[\s/>]/)
    if (nameEnd <= 0) {
      i = lt + 1
      continue
    }
    const name = code.slice(lt + 1, lt + 1 + nameEnd)
    if (!/^[a-zA-Z][\w.-]*$/.test(name)) {
      i = lt + 1
      continue
    }
    // 跟引号扫描到配对的 `>`（属性值里可能有 `>`）
    let j = lt + 1
    let quote: string | null = null
    let closed = false
    for (; j < code.length; j++) {
      const ch = code[j]
      if (quote) {
        if (ch === quote) quote = null
        continue
      }
      if (ch === '"' || ch === "'") {
        quote = ch
        continue
      }
      if (ch === '>') {
        closed = true
        break
      }
    }
    if (!closed) break
    out.push({ name, class: readClassAttr(code.slice(lt, j + 1)) })
    i = j + 1
  }
  return out
}