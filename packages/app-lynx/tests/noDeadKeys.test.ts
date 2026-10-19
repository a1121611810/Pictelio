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
// - 源 buffer 先经 `stripComments` 剥注释再拼（见下方「已知失效面」#2）：普通注释与
//   模板字面量 ${…} 表达式内的注释都剥；字符串 / 模板原文内容不剥。
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
 *    - **模板字面量 `${…}` 表达式内的注释：2026-10-19 收口**（原登记盲区）。`stripComments`
 *      现为显式状态机：`${` 进入表达式后沿用普通代码的注释剥离与字符串处理，嵌套大括号 /
 *      表达式内嵌套 template / 表达式内字符串里的 `}` 均正确回退；文件末尾有常驻正反例
 *      自检。⚠️ 方向：该盲区成真是「注释里的 `t('key')` 把死键**判活**」（误活），
 *      本次修的是这一类误活，不是误死。
 *    **剩余局限（仍未建模；当前无实例，若出错先查这里）**：
 *    ① **正则字面量**：状态机不识别正则字面量。`/\//` 这类正则里的 `//` 会被误当行注释、
 *       吞掉该行后续真实引用 ⇒ 可能把**活键判死**；`${…}` 表达式内正则里的 `{` / `}`
 *       也会打乱大括号配对（同上）。识别正则需上下文区分除法与正则，本门禁刻意不把
 *       词法器做全；出现实例时按「显式登记 + 正反例」扩展。
 *    ② **动态拼接的 key** 仍看不见 —— 见下方第 3 条。
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
 * `stripComments` 的显式状态机状态。
 *
 * `${…}` 表达式不单独设状态：压入一层大括号深度后复用 `normal` 行为，
 * 由 `exprBraceDepths` 非空标记「当前在表达式内」。
 */
type StripState =
  | "normal"
  | "line-comment"
  | "block-comment"
  | "html-comment"
  | "single-quote"
  | "double-quote"
  | "template";

/**
 * 剥注释后的源码文本。
 *
 * 为什么必须有：门禁的「注释未剥离」盲区会制造**误活**，且已有实际后果——实证
 * `illustList.title` / `novels.title` 只被 `IllustList.vue` / `NovelList.vue` 的
 * **HTML 注释**里的 `t('...')` 引用（原文是「原 <PageTopBar …> 整条移除」），
 * 门禁因此一直判活（#1043 review 第三轮）。
 *
 * 状态机（门禁纪律：失效面必须登记，见文件头「已知失效面」#2）：
 * - `normal`：普通代码。`//`、`/*` 起头的块注释、`<!-- -->` 进入注释状态被剥；
 *   引号 / 反引号进入对应字符串状态。字符串内 `//` 与 `<!--` 不误伤。
 * - `single-quote` / `double-quote`：字符串原文，只认 \ 转义与闭合引号。
 * - `template`：反引号模板的**原文内容**，只认 \ 转义、闭合反引号、`${`；
 *   原文里的 `//` / `<!--`（如 URL）是普通字符，不剥。
 * - `line-comment` / `block-comment` / `html-comment`：三类注释，整段丢弃。
 * - `${`：压入一层表达式大括号深度后回到 `normal` 行为（注释照剥、字符串与嵌套
 *   template 照常处理）；`{` 深度 +1、`}` 深度 −1，深度 0 的 `}` 结束表达式、回到
 *   `template`。⇒ 表达式内真实代码（`t('alive.key')`）保留，其注释被剥。
 *
 * **剩余局限（已登记，见文件头 #2）**：不识别正则字面量——`/\//` 里的 `//` 可能被
 * 误当行注释；`${…}` 表达式内正则里的 `{` / `}` 会打乱大括号配对。当前无实例。
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  let state: StripState = "normal";
  /** 每层 `${…}` 表达式的未闭合 `{` 数；非空即「当前处于表达式内」 */
  const exprBraceDepths: number[] = [];

  while (i < n) {
    const c = src[i];
    switch (state) {
      case "normal": {
        if (c === "/" && src[i + 1] === "/") {
          state = "line-comment";
          i += 2;
          continue;
        }
        if (c === "/" && src[i + 1] === "*") {
          state = "block-comment";
          i += 2;
          continue;
        }
        if (c === "<" && src.startsWith("<!--", i)) {
          state = "html-comment";
          i += 4;
          continue;
        }
        if (c === "'") {
          state = "single-quote";
          out += c;
          i++;
          continue;
        }
        if (c === '"') {
          state = "double-quote";
          out += c;
          i++;
          continue;
        }
        if (c === "`") {
          state = "template";
          out += c;
          i++;
          continue;
        }
        const top = exprBraceDepths.length - 1;
        if (top >= 0) {
          if (c === "{") {
            exprBraceDepths[top]++;
            out += c;
            i++;
            continue;
          }
          if (c === "}") {
            if (exprBraceDepths[top] === 0) {
              exprBraceDepths.pop();
              out += c;
              i++;
              state = "template"; // 表达式结束，回到外层模板原文
              continue;
            }
            exprBraceDepths[top]--;
            out += c;
            i++;
            continue;
          }
        }
        out += c;
        i++;
        continue;
      }
      case "line-comment": {
        i++;
        if (c === "\n") {
          state = "normal"; // 换行保留（旧实现只吞注释字符，不吞换行）
          out += c;
        }
        continue;
      }
      case "block-comment": {
        if (c === "*" && src[i + 1] === "/") {
          i += 2;
          state = "normal";
          continue;
        }
        i++;
        continue;
      }
      case "html-comment": {
        if (c === "-" && src.startsWith("-->", i)) {
          i += 3;
          state = "normal";
          continue;
        }
        i++;
        continue;
      }
      case "single-quote":
      case "double-quote": {
        if (c === "\\") {
          out += c + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += c;
        i++;
        if ((state === "single-quote" && c === "'") || (state === "double-quote" && c === '"')) {
          state = "normal";
        }
        continue;
      }
      case "template": {
        if (c === "\\") {
          out += c + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (c === "`") {
          out += c;
          i++;
          state = "normal";
          continue;
        }
        if (c === "$" && src[i + 1] === "{") {
          out += "${";
          i += 2;
          exprBraceDepths.push(0);
          state = "normal"; // 表达式内沿用 normal 的注释剥离与字符串处理
          continue;
        }
        out += c;
        i++;
        continue;
      }
    }
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

/**
 * `stripComments` 状态机自检（常驻）。
 *
 * 门禁纪律要求「反事实 + 抽取器自身有效 + 阳性对照」，且每条门禁登记「抓不到什么」
 * （`workflows/review-fix-loop.md` §门禁纪律）。本组用例钉的是文件头「已知失效面」#2 的
 * 模板字面量 `${…}` 表达式分支：
 * - 反事实（多种换皮形态）：`${…}` 内的块注释 / 行注释若不被剥，注释里的 `t('key')`
 *   会把死键判活——旧单层状态机（把 `${…}` 当串内容）正是在此失败；
 * - 阳性对照：`${…}` 表达式内**真实代码**里的引用必须保留，否则活键被判死；
 * - 抽取器有效：先断言输入里确有注释、剥完文本确实变短，排除「no-op 也能过」。
 *
 * 期望值来源 = 状态机规格（注释剥离 / 字符串与模板原文保留 / 表达式回退），不是实现
 * 输出的复述；用例名即行为。
 *
 * 对照实测（2026-10-19，一次性证据、不常驻）：旧单层实现下本组模板用例转红（反事实）；
 * 旧 / 新实现对 `dumpProductionSource` 扫描面 242 个生产文件输出逐字节一致 ⇒ 当前确为
 * 零实例、本次重构对既有行为无扰动。
 */
describe("stripComments 状态机自检（模板 ${} 表达式 / 字符串反例 / 异常输入）", () => {
  /** 与集成测试同一条判定链：stripComments → isReferenced */
  const aliveAfterStrip = (src: string, key: string): boolean => isReferenced(stripComments(src), key);

  it("${} 内的块注释 / 行注释被剥：注释里的 t('dead.key') 不判活", () => {
    // 两种「换皮」形态：块注释 / 行注释各一，都混在模板表达式里
    const block = "const a = `head ${ /* t('dead.block') */ real } tail`;";
    const line = "const b = `head ${ real // t('dead.line')\n } tail`;";
    for (const [src, key] of [
      [block, "dead.block"],
      [line, "dead.line"],
    ] as const) {
      // 反事实前提：注释确实在源里；旧实现不剥它 ⇒ 门禁误活
      expect(src).toContain(`t('${key}')`);
      expect(isReferenced(src, key), "未剥注释时必然判活（旧实现的实际行为）").toBe(true);
      // 核心语义断言：注释剥掉后不得再判活（旧单层实现在此会红）
      expect(aliveAfterStrip(src, key), `${key} 只在模板表达式注释里，不得判活`).toBe(false);
      // 抽取器有效性下界：确实剥掉了内容（不是 no-op 也能过）
      expect(stripComments(src).length).toBeLessThan(src.length);
    }
    // 阳性对照：表达式内真实代码保留
    expect(stripComments(block)).toContain("real");
    expect(stripComments(line)).toContain("real");
  });

  it("${} 表达式内真实代码引用必须保留：误剥会把活键判死", () => {
    const src = [
      "const a = `${ t('alive.plain') }`;",
      "const b = `${ fn({ deep: t('alive.brace') }) }`;",
      'const c = `${ { x: { y: tt("alive.double") } } }`;',
      "const d = `${ t('alive.brace-in-string') + \"}\" } tail`;",
    ].join("\n");
    const stripped = stripComments(src);
    for (const key of ["alive.plain", "alive.brace", "alive.double", "alive.brace-in-string"]) {
      expect(isReferenced(stripped, key), `${key} 在模板表达式真实代码里，必须保留`).toBe(true);
    }
    // 表达式内字符串里的 } 不得提前结束表达式（否则尾部模板原文丢失）
    expect(stripped).toContain("tail");
    // 反事实：把 `${…}` 整体当注释吞掉的实现会丢掉这处真实引用
    expect(stripped).toContain("fn({ deep: t('alive.brace') })");
  });

  it("嵌套 template：${ `nested ${ /* comment */ }` } 正确回退", () => {
    const src = "const s = `outer ${ `inner ${ /* t('dead.nested') */ live }` } end`;";
    const stripped = stripComments(src);
    expect(isReferenced(src, "dead.nested"), "反事实前提：注释引用确实在源里").toBe(true);
    expect(stripped.length).toBeLessThan(src.length); // 抽取器确实剥了注释
    expect(aliveAfterStrip(src, "dead.nested")).toBe(false);
    // 外层 / 内层模板原文与表达式内真实代码都保留（回退正确性）
    for (const keep of ["outer", "inner", "live", "end"]) {
      expect(stripped, `嵌套 template 回退后应保留 ${keep}`).toContain(keep);
    }
  });

  it("${} 闭合后回到 template 原文：其中的 // 与 <!-- 不是注释", () => {
    const src = "const s = `${ 1 + 1 } // 模板原文 https://a.b <!-- x -->`;";
    const stripped = stripComments(src);
    // 若闭合后仍停在 normal，模板原文会被当注释吞掉 ⇒ 活键可能误死
    expect(stripped).toContain("// 模板原文");
    expect(stripped).toContain("https://a.b");
    expect(stripped).toContain("<!-- x -->");
  });

  it("字符串字面量内的 //、<!--、${ 不被误剥（既有反例）", () => {
    const cases = [
      ["const u = 'https://example.com/single';", "https://example.com/single"],
      ['const u = "https://example.com/double";', "https://example.com/double"],
      ["const h = '<!-- 不是注释 -->';", "<!-- 不是注释 -->"],
      ['const h = "<!-- 不是注释 -->";', "<!-- 不是注释 -->"],
      ['const d = "字面量 ${ 不是插值 }";', "${ 不是插值 }"],
      ["const e = 'it\\'s https://escaped';", "https://escaped"],
    ] as const;
    for (const [src, keep] of cases) {
      expect(stripComments(src), `字符串内 ${keep} 必须原样保留`).toContain(keep);
    }
  });

  it("阳性对照：普通行 / 块 / HTML 注释照旧剥除，代码保留", () => {
    const src = [
      "// t('dead.line.normal')",
      "const a = 1;",
      "/* t('dead.block.normal') */",
      "<!-- t('dead.html.normal') -->",
      "const b = call('live.arg');",
    ].join("\n");
    const stripped = stripComments(src);
    for (const dead of ["dead.line.normal", "dead.block.normal", "dead.html.normal"]) {
      expect(isReferenced(src, dead), "反事实前提：源里确实有该注释引用").toBe(true);
      expect(isReferenced(stripped, dead), `${dead} 在普通注释里，剥后不得判活`).toBe(false);
    }
    expect(isReferenced(stripped, "live.arg")).toBe(true);
    expect(stripped).toContain("const a = 1;");
  });

  it("未闭合模板 / 注释 / 字符串等异常输入不抛错（保持既有容错）", () => {
    const inputs = [
      "const s = `unterminated",
      "const s = `unterminated ${ /* t('x') */",
      "const s = `unterminated ${ { a: 1 }",
      "const s = `${",
      "const a = 1; /* unterminated block",
      "<div><!-- unterminated html",
      "const s = 'unterminated single",
      'const s = "unterminated double',
      "const s = `escape at eof \\",
      "`${`",
    ];
    for (const src of inputs) {
      expect(() => stripComments(src), `不能抛错：${JSON.stringify(src)}`).not.toThrow();
      expect(typeof stripComments(src), "异常输入应返回截断文本").toBe("string");
    }
    // 表达式定界不影响普通代码里的孤立大括号
    expect(stripComments("if (x) { y(); }")).toBe("if (x) { y(); }");
  });
});
