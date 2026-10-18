// ─── i18n 死键门禁（spec #734 code-review F2 引入；防字典污染）───
//
// 背景：F2 review 发现 novelIntro.actionBookmark / novelIntro.actionBookmarked
// 在 zh-CN/en misc.ts 中定义但全仓无任何代码引用——收藏按钮走 BookmarkButton
// 自管 i18n，介绍页没有独立「收藏/已收藏」文案需求。死键堆积会污染字典、
// 误导未来 review（"这里有 key 必然有 caller"反推会出错）。
//
// oracle：字典 vs 源码双向比对——字典中每个 i18n key 必须至少在**生产**源码中
// 作为字符串字面量出现一次（`t('key')` / `tt("key")` / 模板字面量等形式）。
//
// 实现策略：
// 1) TS 编译器 API 从 MISC_FILES（5 个字典 × 2 语言 = 10 个文件）抽「value 为
//    字符串字面量的顶层属性名」；
// 2) 把 src/ 下所有**生产**源码（排除 `i18n/locales/**` 防自指，排除
//    `*.test.ts` / `*.spec.ts` 防「只有测试在用」的死键装活）拼成单 buffer；
// 3) 用 `isReferenced()` 判定：要求键作为**带引号的字面量**出现。
//    ⚠️ 禁止退回裸 `source.includes(key)`——子串匹配会让短键被更长的键续命
//    （实证：死键 `me.title` 曾被 `userHome.titleFallback` 里的同形子串判活，
//    #1043 review 才发现）。自检用例钉住了这一点。
//
// 例外豁免：`INDIRECT_CONSUMPTION_EXEMPTIONS`（当前 7 条 `ranking.mode.*`，
// 字符串住在 `@pictelio/ranking-core` 的 `RANK_MODES[].labelKey`，经
// `Ranking.vue` 的 `t(m.labelKey)` 间接消费）。豁免表另有专用活性用例
// （文件末尾），消费方删了而不删豁免会红。
//
// 解析器/检测逻辑约定：
// - 只抽「顶层 const 字面量中 value 为字符串字面量（含 no-substitution
//   template）的 PropertyAssignment」——天然排除嵌套对象、数字/布尔属性、
//   注释与 import 字符串。
// - 字符串里的花括号（{{name}}）由 TS AST 正确解析，无须手工处理。
// - 源 buffer 含注释（粗扫），注释里提到的 key 会被判活——这是已登记的
//   已知失效面，见 `INDIRECT_CONSUMPTION_EXEMPTIONS` 上方那段。
import { describe, expect, it } from "vitest";
import { RANK_MODES } from "@pictelio/ranking-core";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const pkgRoot = path.resolve(__dirname, "..");
const SRC = path.resolve(pkgRoot, "src");
/**
 * 扫描面 = 全部 locale 字典文件（zh-CN/en × misc/pages/novelTranslate/time/error）。
 *
 * ⚠️ 2026-10-18 扩表（#1042 覆盖缺口 + #1043 死键）：此前只扫 `misc.ts`，而
 * `pages.ts` / `novelTranslate.ts` 里的死键因不在扫描面而一直绿灯——本轮实测
 * `pages.ts` 的 zh+en 共 24 条 `engineFallback.*` 死键（每语言 12 条；渲染方随 ADR-0203
 * 删除）、`novelTranslate.ts` 另有 15 条（每语言），均无人发现。扩表后它们被本门禁打红
 * 并逐条处置。
 *
 * 扩表时必须**先跑一次看红**，再照单删除/补 caller——不能凭猜删键。
 */
/**
 * **已知失效面（抓不到什么）—— 必须显式登记，见 `workflows/review-fix-loop.md` §门禁纪律**
 *
 * 1. **间接消费盲区（本门禁最硬的限制）**：本门禁用 `isReferenced` 判定，只能看见
 *    「key 作为带引号字面量出现在**生产**源码里」。若 key 由**非字面量**参数传入 `t()`，
 *    且字符串本身住在**另一个包**里，字面量永远不会出现在 `src/` buffer 中 → **必然误报**。
 *    实证：`ranking.mode.*` 7 键的字符串住在 `packages/ranking-core/src/modes.ts`
 *    的 `RANK_MODES[].labelKey`，由 `Ranking.vue:217/226` 的 `t(m.labelKey)` 消费。
 *    首次扩表（2026-10-18）时本门禁把这 7 键×2 语言共 14 条全部报成死键 —— **误报**。
 *    ⇒ 下表是**显式豁免**，不是放行；删表中任一项前必须先查跨包消费。
 *    豁免表本身也有活性断言（见文件末尾「豁免表不腐化」用例）：消费方删了而不删豁免，
 *    门禁会红——否则豁免就是永久免死金牌。
 * 2. **注释里的「引用」已剥离**（2026-10-18 修复）：`dumpProductionSource` 对每个文件先
 *    `stripComments`（`//` / 块注释 / `<!-- -->`）。此前注释里的 `t('key')` 会把死键判活，
 *    实证：`illustList.title` / `novels.title` 只被 `IllustList.vue` / `NovelList.vue`
 *    的 HTML 注释引用（「原 <PageTopBar :title="t('…')" /> 整条移除」）。
 *    **剩余局限**：模板字面量 `${…}` 内的注释不剥、正则字面量里的 `//` 可能误当行注释
 *    （当前均无实例；若出现「活键被判死」，先查这两条）。
 * 3. **动态拼接的 key**（模板字符串拼出来的 i18n key）一律看不见。
 *
 * 豁免登记格式：**键 + 消费方坐标 + 理由**。缺任一项即视为登记无效。
 */
const INDIRECT_CONSUMPTION_EXEMPTIONS = new Map<string, string>([
  ["ranking.mode.daily", "`@pictelio/ranking-core` RANK_MODES[].labelKey → Ranking.vue:217,226 `t(m.labelKey)`"],
  ["ranking.mode.weekly", "同上"],
  ["ranking.mode.monthly", "同上"],
  ["ranking.mode.newcomer", "同上"],
  ["ranking.mode.original", "同上"],
  ["ranking.mode.r18", "同上"],
  ["ranking.mode.r18g", "同上"],
]);

const MISC_FILES = [
  "misc.ts",
  "pages.ts",
  "novelTranslate.ts",
  "time.ts",
  "error.ts",
].flatMap((name) => [
  path.join(SRC, "i18n/locales/zh-CN", name),
  path.join(SRC, "i18n/locales/en", name),
]);

/** 剥 as / satisfies / type-assertion / 括号包装，还原到最内层表达式 */
function unwrapExpression(node: ts.Expression): ts.Expression {
  let cur = node;
  while (true) {
    if (ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isTypeAssertionExpression(cur)) {
      cur = cur.expression;
    } else {
      return cur;
    }
  }
}

/** 从 misc.ts 源里抽「顶层 const 字面量中 value 为字符串字面量的属性名」 */
function extractStringKeysFromSource(source: string): string[] {
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const keys: string[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!decl.initializer) continue;
      const obj = unwrapExpression(decl.initializer);
      if (!ts.isObjectLiteralExpression(obj)) continue;
      for (const prop of obj.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        if (!ts.isStringLiteral(prop.name)) continue;
        // value 必须是字符串字面量或 no-substitution 模板字面量
        if (!ts.isStringLiteralLike(prop.initializer)) continue;
        keys.push(prop.name.text);
      }
    }
  }
  return keys;
}

/** 从 misc.ts 文件抽 i18n key 列表（顶层字符串属性） */
function extractStringKeys(filePath: string): string[] {
  return extractStringKeysFromSource(fs.readFileSync(filePath, "utf-8"));
}

/**
 * 「键被消费」的判据：必须作为**引号配对**的字面量出现（`'k'` / `"k"` / 反引号）。
 *
 * ⚠️ 早期实现用裸 `source.includes(key)`，那是**子串**匹配 ⇒ 短键会被更长的键续命。
 * 实证（#1043 review）：死键 `me.title`（全仓无 `t('me.title')`）一直被
 * `userHome.titleFallback` 里的 `me.title` 子串判成「活着」。
 *
 * 用三个 `includes` 而不是一条「引号字符类」正则：字符类 `['"]` 会接受**不配对**的
 * 引号（`'me.title"` 也算命中），留下残留误活面；配对形态既更严，又不必转义键里的
 * 正则元字符（`.` 等）。**禁止退回裸 includes**，文件末尾有用例钉住。
 */
function isReferenced(source: string, key: string): boolean {
  return (
    source.includes(`'${key}'`) ||
    source.includes(`"${key}"`) ||
    source.includes(`\`${key}\``)
  );
}

/**
 * 剥注释后的源码文本。
 *
 * 为什么必须有：门禁的「注释未剥离」盲区会制造**误活**，且已有实际后果——实证
 * `illustList.title` / `novels.title` 只被 `IllustList.vue` / `NovelList.vue` 的
 * **HTML 注释**里的 `t('...')` 引用（原文是「原 <PageTopBar …> 整条移除」），
 * 门禁因此一直判活（#1043 review 第三轮）。
 *
 * 覆盖三种注释：`//` 行注释、块注释、`<!-- -->` HTML 注释（Vue 模板）。
 * 字符串内不剥——状态机先吃引号串，保证 `'https://…'` 里的 `//` 不被误伤。
 *
 * **剩余局限（已登记）**：① 模板字面量 `${…}` 内部的注释不剥（`${` 后按串内容处理）；
 * ② 正则字面量里的 `//` 可能被误当成行注释。两者在本仓当前均无实例；若出现
 * 「活键被判死」，先查这两条。
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === "<" && src.startsWith("<!--", i)) {
      i += 4;
      while (i < n && !src.startsWith("-->", i)) i++;
      i += 3;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * 拼 src/ 下所有**生产**源码为单 buffer：
 * - 排除 `i18n/locales/**`（防自指：字典本身不能算自己的消费方）
 * - 排除 `*.test.ts` / `*.spec.ts` —— 测试不是生产消费方。不排除的话「只有测试在用」
 *   的死键会被判活，正是本批审计反复实证的失败模式「有测试护着 ≠ 活」。
 * - 每个文件先 `stripComments`，避免注释里的 `t('...')` 把死键续命。
 */
function dumpProductionSource(): string {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      const rel = path.relative(SRC, p).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (rel === "i18n/locales" || rel.startsWith("i18n/locales/")) continue;
        walk(p);
      } else if (/\.(ts|vue|tsx)$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name)) {
        parts.push(stripComments(fs.readFileSync(p, "utf-8")));
      }
    }
  };
  walk(SRC);
  return parts.join("\n");
}

describe("i18n 死键门禁（全部 locale 字典 vs 生产源码双向比对）", () => {
  // ── 解析器自检 4 case ──

  it("空字典 → 0 dead keys（解析器自检）", () => {
    const stub = "const x = {} as const;\nexport default x;\n";
    expect(extractStringKeysFromSource(stub)).toEqual([]);
  });

  it("全部引用 → 0 dead keys（解析器自检）", () => {
    const stub = [
      "const x = {",
      '  "foo.bar": "baz",',
      '  "qux.quux": "corge",',
      "} as const;",
      "",
    ].join("\n");
    const source = "t('foo.bar'); tt(\"qux.quux\");";
    const dead = extractStringKeysFromSource(stub).filter((k) => !isReferenced(source, k));
    expect(dead).toEqual([]);
  });

  it("部分死键 → 列出 dead key（解析器自检）", () => {
    const stub = [
      "const x = {",
      '  "alive.key": "x",',
      '  "dead.key": "y",',
      "} as const;",
      "",
    ].join("\n");
    const source = "t('alive.key');";
    const dead = extractStringKeysFromSource(stub).filter((k) => !isReferenced(source, k));
    expect(dead).toContain("dead.key");
    expect(dead).not.toContain("alive.key");
  });

  it("子串不得续命：短键不被更长键里的同形片段判活（#1043 实测假阴性）", () => {
    // 实证现场：死键 `me.title` 一直靠 `userHome.titleFallback` 里的 `me.title` 子串逃逸。
    const source = "t('userHome.titleFallback');";
    expect(source.includes("me.title")).toBe(true); // 裸 includes 会误判（反事实：旧实现在此失败）
    expect(isReferenced(source, "me.title")).toBe(false);
    // 反方向也必须成立：键真的被引用时判活
    expect(isReferenced("t('me.title');", "me.title")).toBe(true);
    expect(isReferenced('t("me.title");', "me.title")).toBe(true);
    // 正则元字符要转义（键里有点号，不能被当通配）
    expect(isReferenced("t('meXtitle');", "me.title")).toBe(false);
  });

  it("字段值非字符串忽略（嵌套对象/数字/布尔 → 不计入 i18n key）", () => {
    const stub = [
      "const x = {",
      '  "string.key": "value",',
      '  nested: { "obj.inner": "should skip" },',
      "  count: 42,",
      "  flag: true,",
      "} as const;",
      "",
    ].join("\n");
    const keys = extractStringKeysFromSource(stub);
    expect(keys).toContain("string.key");
    // 嵌套对象的 inner key（PropertyAssignment 在 ObjectLiteralExpression 内部）
    expect(keys).not.toContain("obj.inner");
    // 非字符串字面量属性（数字/布尔）
    expect(keys).not.toContain("count");
    expect(keys).not.toContain("flag");
  });

  // ── 集成测试：真实 misc.ts vs 真实源码 ──

  it("全部 locale 字典文件中所有 i18n key 至少在 src 内被引用一次", () => {
    const source = dumpProductionSource();
    const dead: string[] = [];
    const exempted: string[] = [];
    for (const file of MISC_FILES) {
      const localeTag = `${path.basename(path.dirname(file))}/${path.basename(file)}`;
      for (const k of extractStringKeys(file)) {
        if (isReferenced(source, k)) continue;
        const reason = INDIRECT_CONSUMPTION_EXEMPTIONS.get(k);
        if (reason) {
          exempted.push(`${localeTag}: ${k} — ${reason}`);
          continue;
        }
        dead.push(`${localeTag}: ${k}`);
      }
    }
    // 豁免项只计入失败信息；豁免表腐化由下方专用用例判红（此处不再声称能"一眼看出"）
    expect(
      dead,
      `以下 i18n key 在 locale 字典中定义但 src/ 内无任何代码引用（删除或补 caller）：\n${dead.join("\n")}` +
        (exempted.length ? `\n\n（另有 ${exempted.length} 条走「间接消费」显式豁免，不计入）` : ""),
    ).toEqual([]);
  });

  /**
   * 豁免表活性：每条豁免必须仍被 `RANK_MODES` 真实声明。
   *
   * 为什么必须单独一条：上面那条用例只在「别的键死掉」时才打印 exempted，
   * 豁免表**单独腐化**时门禁仍然全绿 ⇒ 豁免变成永久免死金牌。
   *
   * ⚠️ 必须 import `RANK_MODES` 断言**运行时数组**，不能用 `toContain` 扫
   * `modes.ts` 源码：该文件里 `RankModeLabelKey` 的**类型联合**含同样的引号字符串，
   * 删掉数组条目后文本仍命中 ⇒ 断言恒绿（#1043 review 轮 2 实测）。断言数组则
   * 删条目必红，这是本用例唯一有效的判据。
   */
  it("间接消费豁免表不腐化：每条豁免键仍被 RANK_MODES 真实声明", () => {
    const declared = new Set<string>(RANK_MODES.map((m) => m.labelKey));
    for (const k of INDIRECT_CONSUMPTION_EXEMPTIONS.keys()) {
      expect(
        declared.has(k),
        `豁免键 ${k} 已不在 RANK_MODES 中 ⇒ 消费方已删，应从 INDIRECT_CONSUMPTION_EXEMPTIONS ` +
          `移除（否则该键即使死了也永远绿灯）`,
      ).toBe(true);
    }
    // 反向：RANK_MODES 新增 mode 时必须同步豁免表，否则新键会被判死却看不出是「间接消费」
    for (const k of declared) {
      expect(
        INDIRECT_CONSUMPTION_EXEMPTIONS.has(k),
        `${k} 是 RANK_MODES 的 labelKey 但未登记豁免 ⇒ 若它确属跨包间接消费，补登记；` +
          `否则说明它已是普通字面量消费，删掉对应豁免条目`,
      ).toBe(true);
    }
  });
});
