// #850（T02）文档门禁：AGENTS.md 不得同时存在**两套现行设计约束**表述；
// 且 ADR-0205 决策 4 的「有意偏离 MD3」封闭清单必须**留痕在 AGENTS.md**，不能只活在 ADR。
//
// oracle 溯源（期望值指向独立来源，不从 AGENTS.md 自证）：
// - 「Fluent 章是存档」这一事实 = `docs/adr/glossary-md3-alignment.md` 的基线声明行 +
//   `docs/adr/ADR-0205-...md` 决策 2（章首 + 章尾双标注）。本文件不自行判断「存档」是什么语义。
// - 4 条偏离 = **从 ADR-0205 决策 4 的表格里机械抽取**（不手写期望文本）；
//   交叉核对用的关键词也来自 ADR 表格单元，不来自 AGENTS.md。
// - 「MD3 现行口径」的可定位点 = material-web v0.192 单位换算（术语文档 §10）+ ADR-0207 决策 1/3
//   登记的形状消费形态与 dp→vw 换算。
// - 「Fluent 现行约束独有物」= Fluent 2 时代的令牌名（`--color*` / `--borderRadius*` /
//   `--fontSizeBase*`）与已删除客户端的载体（`uno.config.ts` / `main.tsx` /
//   `@fluentui/web-components` / `PageTransition.tsx`）。这些名字的来源是 Fluent 2 规范本身，
//   不是 AGENTS.md —— 用来判「它们只配活在存档章里」。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** 从 cwd 向上找仓库根（对调用位置免疫：pnpm --filter 下 cwd = 包目录） */
function findRepoRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "AGENTS.md")) && existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("repo root not found (AGENTS.md + pnpm-workspace.yaml)");
    dir = parent;
  }
}

const REPO_ROOT = findRepoRoot(process.cwd());
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf8");

const AGENTS_MD = read("AGENTS.md");
const ARCHIVE_CHAPTER = read("docs/adr/glossary-fluent-design-chapter-archive.md");
const ADR_0205 = read("docs/adr/ADR-0205-md3-baseline-and-scope.md");
const GLOSSARY = read("docs/adr/glossary-md3-alignment.md");

// ───────────────────────────── 抽取器（不在此处写 expect：收集期抛错只会给出无关信息）

/**
 * 取某个标题到**下一个同级或更高级标题**之间的正文。
 *
 * 末尾章节（后面没有同级/更高级标题）必须也能取到：Fluent 存档章在归档文档里就是最后一块。
 * 早期实现只认「后继标题」作终止条件，末节一律返回空 ⇒ 全称断言在末节上静默恒假。
 * 故补 **EOF 兜底**：前瞻失败时改为「取到文档末尾」，并保证至少取到标题下一行的内容。
 */
function sectionOf(doc: string, headingRe: RegExp): string | null {
  const start = doc.match(new RegExp(`^${headingRe.source}[^\\n]*$`, "m"));
  if (!start || start.index === undefined) return null;
  const bodyStart = doc.indexOf("\n", start.index) + 1;
  if (bodyStart <= 0) return null;
  const rest = doc.slice(bodyStart);
  const next = rest.match(/^#{1,2} .*$/m);
  return next?.index === undefined ? rest : rest.slice(0, next.index);
}

// 「逐条判定」的载体是**归档文档**（原章全文已从 AGENTS.md 移出，否则占满 32 KiB 指令预算、
// 被运行时截断），AGENTS.md 侧只留存档告示。故两个来源各司其职，**不得互相顶替**：
// - `fluentChapter()`  = 归档文档里的原章全文 → 逐条判定、章首/章尾存档声明、历史条款名
// - `fluentNotice()`   = AGENTS.md 里的存档告示 → 声明「已存档 + 指向归档 + 冲突以 MD3 为准」
const fluentChapter = (): string => sectionOf(ARCHIVE_CHAPTER, /^## Fluent Design 规范/) ?? "";
const fluentNotice = (): string => sectionOf(AGENTS_MD, /^## Fluent Design 规范/) ?? "";
const md3Section = (): string => sectionOf(AGENTS_MD, /^### app-lynx 的 MD3 约定/) ?? "";

/** 表格行 → 单元格（去首尾竖线、trim）。分隔行返回 null。 */
function cells(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith("|")) return null;
  if (/^\|[\s:|-]+\|$/.test(t)) return null; // 分隔行
  return t
    .slice(1, t.endsWith("|") ? -1 : undefined)
    .split("|")
    .map((c) => c.trim());
}

const isSeparator = (line: string | undefined): boolean =>
  line !== undefined && /^\|[\s:|-]+\|$/.test(line.trim());

/**
 * 取 fromIndex 之后**第一张**表（表头行 + 紧跟其后的分隔行，二者缺一不算表）。
 * 判定走**结构**（表头 + 分隔行）而不是表头字样，标题措辞变了也不会失配。
 */
function firstTableAfter(
  doc: string,
  fromIndex: number,
): { header: string[]; rows: string[][] } | null {
  const lines = doc.split("\n");
  for (let i = Math.max(fromIndex, 0); i < lines.length - 1; i++) {
    const head = cells(lines[i]!);
    if (!head || !isSeparator(lines[i + 1])) continue;
    const rows: string[][] = [];
    for (let j = i + 2; j < lines.length; j++) {
      const row = cells(lines[j]!);
      if (!row) break;
      rows.push(row);
    }
    return { header: head, rows };
  }
  return null;
}

/** ADR-0205 决策 4 的「有意偏离」表格行（4 条封闭清单） */
const adrDeviationTable = (): { header: string[]; rows: string[][] } => {
  const i = ADR_0205.indexOf("### 决策 4");
  if (i < 0) throw new Error("ADR-0205 缺少「### 决策 4」小节");
  const t = firstTableAfter(ADR_0205.slice(i), 0); // 字符下标 → 切片后按行号定位
  if (!t) throw new Error("ADR-0205 决策 4 下没有表格");
  return t;
};
const adrDeviationRows = (): string[][] => adrDeviationTable().rows;

/** AGENTS.md「app-lynx 的 MD3 约定」节里那张偏离表 */
const docDeviationTable = (): { header: string[]; rows: string[][] } => {
  const t = firstTableAfter(md3Section(), 0);
  if (!t) throw new Error("MD3 约定节里没有表格");
  return t;
};
const docDeviationRows = (): string[][] => docDeviationTable().rows;

/**
 * 拉美单元格里的「可核对证据词」：拉丁词 / 带单位数值，**长度 ≥ 3**。
 * 长度下界是刻意的：`7`（静态色板数量）会命中 AGENTS.md 满篇，不具判别力。
 */
function evidenceTokens(row: string[]): string[] {
  const text = row.join(" ");
  const latin = text.match(/[A-Za-z][A-Za-z0-9.+-]{2,}/g) ?? [];
  const numeric = text.match(/\b\d+(?:\.\d+)?(?:px|dp|sp)?\b/g) ?? [];
  return [...new Set([...latin, ...numeric].filter((t) => t.length >= 3))];
}

// ───────────────────────────── 判定式（多书写形态容忍）

/** 章首 / 章尾的存档声明：任一信号命中即算「已声明存档」 */
const ARCHIVE_SIGNALS: RegExp[] = [
  /历史存档/,
  /不具约束力/,
  /非现行约束/,
  /ADR-0203/,
  /glossary-webview-client-removal/,
];

const HEAD_WINDOW = 8;

function headOf(chapter: string): string {
  return chapter
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, HEAD_WINDOW)
    .join("\n");
}

function tailOf(chapter: string): string {
  return chapter
    .split("\n")
    .filter((l) => l.trim())
    .slice(-HEAD_WINDOW)
    .join("\n");
}

/** 章首已声明存档？（标题含「存档」与正文横幅算两种书写形态，任一命中即可） */
function archiveDeclaredAtHead(chapter: string): boolean {
  const head = headOf(chapter);
  if (/^##[^\n]*存档/.test(head)) return true;
  return ARCHIVE_SIGNALS.some((re) => re.test(head));
}

/** 章尾已声明存档？（ADR-0205 决策 2 要求双标注） */
function archiveDeclaredAtTail(chapter: string): boolean {
  return ARCHIVE_SIGNALS.some((re) => re.test(tailOf(chapter)));
}

/** 章内每条 `- ` 条款是否都带 MD3 适用性判定（容忍 `**仍成立（部分）**` 这类带括号的写法） */
function clausesWithoutVerdict(chapter: string): string[] {
  return chapter
    .split("\n")
    .filter((l) => /^-\s+\S/.test(l))
    .filter((l) => !/\*\*(仍成立|存档条款|已失效)/.test(l));
}

/** 反事实用：把章首横幅、章尾声明、标题括号全部抽掉，模拟「存档声明被删」 */
function stripArchiveDeclarations(chapter: string): string {
  return chapter
    .replace(/^## Fluent Design 规范[^\n]*$/m, "## Fluent Design 规范")
    .replace(/^(?:> [^\n]*\n)+/gm, "");
}

/**
 * 核心不变式：AGENTS.md 里 **MD3 现行口径只允许出现在「app-lynx 的 MD3 约定」一节**，
 * **Fluent 现行约束的独有物只允许出现在存档章内**。任一侧越界 = 两套现行约束并存。
 */
const MD3_CLAIM_ANCHORS = ["1sp = 2rpx", "0.2667vw", "rounded-[var(--md-shape-*)]"];
const FLUENT_ONLY_NAMES = [
  "`var(--colorXxx)`",
  "`var(--borderRadiusXxx)`",
  "`var(--fontSizeBaseXxx)`",
  "`PageTransition.tsx`",
  "@fluentui/web-components",
  "`uno.config.ts`",
];

// ───────────────────────────── 门禁

describe("抽取器自检（空结果会让后续断言静默恒真）", () => {
  it("Fluent 章非空且有下界（章被改名/删空时这里先红）", () => {
    expect(fluentChapter().length).toBeGreaterThan(2000);
    expect(AGENTS_MD).toContain("## Fluent Design 规范");
  });

  it("Fluent 章内条款数达下界（只剩表头时这里先红）", () => {
    const clauses = fluentChapter()
      .split("\n")
      .filter((l) => /^-\s+\S/.test(l));
    // 实测 14 条（设计令牌 7 + 动画 4 + 交互状态 3），下界留 2 条余量
    expect(clauses.length).toBeGreaterThanOrEqual(12);
  });

  it("MD3 约定节非空且达下界", () => {
    expect(AGENTS_MD).toContain("### app-lynx 的 MD3 约定");
    expect(md3Section().length).toBeGreaterThan(1500);
  });

  it("ADR 决策 4 抽到 4 条偏离（上下界都断言：多写少写都算破）", () => {
    const { header, rows } = adrDeviationTable();
    // 表头措辞容错：命中「偏离」或「理由」任一列名即可，不锁死字面量
    expect(header.join(" ")).toMatch(/偏离|理由/);
    expect(rows.length, "ADR-0205 决策 4 的偏离条数").toBe(4);
    for (const row of rows) expect(row.length).toBeGreaterThanOrEqual(2);
  });

  it("两处偏离表都至少含「偏离内容 / 理由 / 依据」三列（列数不同不算破，同构才怪）", () => {
    const adr = adrDeviationTable();
    const doc = docDeviationTable();
    expect(doc.header.join(" ")).toMatch(/偏离/);
    expect(doc.header.length).toBeGreaterThanOrEqual(3);
    expect(adr.header.length).toBeGreaterThanOrEqual(3);
    for (const row of doc.rows) expect(row.length).toBe(doc.header.length);
  });
});

describe("#850 A：Fluent 章退位（存档声明在章首 + 章尾，正文改历史语气）", () => {
  it("章首已声明存档（多书写形态：标题带「存档」或正文横幅，任一命中即可）", () => {
    expect(archiveDeclaredAtHead(fluentChapter())).toBe(true);
  });

  it("章尾同义声明也在（ADR-0205 决策 2 的双标注）", () => {
    expect(archiveDeclaredAtTail(fluentChapter())).toBe(true);
  });

  it("存档声明真的在**章首**而不是散落全章（横幅须落在前 8 个非空行内）", () => {
    const head = fluentChapter()
      .split("\n")
      .filter((l) => l.trim())
      .slice(0, HEAD_WINDOW)
      .join("\n");
    expect(head).toMatch(/ADR-0203/);
  });

  it("章首存档声明指向 ADR-0203 与其术语文档（不留悬空引用）", () => {
    const head = headOf(fluentChapter());
    expect(head).toContain("ADR-0203");
    expect(head).toContain("glossary-webview-client-removal.md");
  });

  it("现行约束口吻已清除（「本项目强制遵循」「无例外」等原文断言不再出现）", () => {
    const chapter = fluentChapter();
    for (const tone of ["本项目**强制**遵循", "以下规则无例外", "本项目**强制**"]) {
      expect(chapter, `Fluent 章仍带现行约束口吻：${tone}`).not.toContain(tone);
    }
  });

  it("每条条款都带 MD3 适用性判定（漏标即视为「未判定 = 读者要自己猜」）", () => {
    expect(clausesWithoutVerdict(fluentChapter())).toEqual([]);
  });

  it("三种判定标记都真实出现（不是只用了其中一种就宣称做了分类）", () => {
    const chapter = fluentChapter();
    for (const verdict of ["仍成立", "存档条款", "已失效"]) {
      expect(chapter).toContain(verdict);
    }
  });

  it("术语文档的基线声明与 AGENTS.md 存档声明一致（两侧不是各说各话）", () => {
    // 术语文档是独立来源：它已经声明了 AGENTS.md 的 Fluent 章是存档
    expect(GLOSSARY).toMatch(/Fluent Design 规范」章服务的是已删除的 WebView 客户端/);
    expect(GLOSSARY).toMatch(/为历史存档，对 app-lynx 无约束力/);
  });
});

describe("#850 B：MD3 现行口径只有一处", () => {
  it("MD3 关键口径只出现在「app-lynx 的 MD3 约定」一节（越界 = 第二处现行表述）", () => {
    const outside = AGENTS_MD.replace(md3Section(), "");
    for (const anchor of MD3_CLAIM_ANCHORS) {
      expect(md3Section(), `MD3 约定节缺少口径：${anchor}`).toContain(anchor);
      expect(outside, `MD3 现行口径泄漏到约定节之外：${anchor}`).not.toContain(anchor);
    }
  });

  it("Fluent 2 独有的令牌名 / 载体只配活在存档章里", () => {
    // 判据改为「AGENTS.md 指令面里不得出现 Fluent 独有的现行约束表述」。
    // 注意这里**不能**用 `AGENTS_MD.replace(fluentChapter(), "")`：判定内容已移出 AGENTS.md，
    // 字符串替换会什么也没替换掉 ⇒ `outside` 等于 AGENTS_MD 全文，断言退化为「全文不含这些名字」，
    // 而 AGENTS.md 的存档告示**有意**提到其中几个（指出它们已失效）—— 那是正确内容，不是泄漏。
    // 真正的「泄漏」= 这些名字出现在**存档告示之外**的 MD3 现行约束节里。
    for (const name of FLUENT_ONLY_NAMES) {
      expect(fluentChapter(), `存档章缺少历史条款：${name}`).toContain(name);
      expect(md3Section(), `Fluent 约束泄漏进 MD3 现行约定节：${name}`).not.toContain(name);
    }
  });

  it("AGENTS.md 侧留存档告示，且双向链接不悬空", () => {
    // 两个文件靠彼此的链接连起来：告示 → 归档文档（读全文去哪），归档文档 → AGENTS.md（现行口径在哪）。
    // 任一侧断链都会让读者找不到「逐条判定」或找不到「现行约束」，所以断链必须判红。
    expect(fluentNotice()).toContain("glossary-fluent-design-chapter-archive.md");
    expect(ARCHIVE_CHAPTER).toContain("AGENTS.md");
    expect(fluentNotice(), "存档告示丢失 → 读者会以为 Fluent 章仍是现行约束").toMatch(
      /历史存档|已随/,
    );
  });

  it("存档章与 MD3 节都声明了「冲突以 MD3 为准」（不留两套现行约束的解释空间）", () => {
    expect(fluentChapter()).toMatch(/以那一节为准/);
    expect(md3Section()).toMatch(/唯一现行/);
  });
});

describe("#850 C：有意偏离留痕在 AGENTS.md（oracle = ADR-0205 决策 4 表格 + ADR-0207 决策 5）", () => {
  it("AGENTS.md 的偏离表正好 5 行，且每行都指向一个**存在**的 ADR", () => {
    const rows = docDeviationRows();
    // 5 条：ADR-0205 决策 4 拍板的 4 条 + T13 真机实证后新增的 focus/focus-visible（第 5 条，
    // 依据是 ADR-0207 决策 5）。**条数是封闭清单的契约**——多一条少一条都说明有人动了清单。
    expect(rows.length, "AGENTS.md 偏离清单的条数").toBe(5);
    for (const row of rows) {
      // 不再钉「都指向 ADR-0205」：第 5 条的依据是 ADR-0207 决策 5（真机实证），
      // 硬钉 ADR-0205 会逼着人把依据写错。改为「每行必须指向某个真实存在的 ADR 文件」——
      // 既保住「有据可依」的原意，又允许依据随实证演进。
      const cited = row.join(" ").match(/ADR-\d{4}/g) ?? [];
      expect(cited.length, `偏离表行未引用任何 ADR：${row[1]}`).toBeGreaterThan(0);
      for (const id of cited) {
        const hit = readdirSync(join(REPO_ROOT, "docs/adr")).some((f) => f.startsWith(`${id}-`));
        expect(hit, `偏离表引用了不存在的 ADR：${id}`).toBe(true);
      }
    }
  });

  it("逐条命中 ADR 决策 4 的证据词（词从 ADR 表格机械抽取，不是手写期望）", () => {
    const docRows = docDeviationRows();
    const adrRows = adrDeviationRows();
    const unmatched: string[] = [];
    for (const [idx, adrRow] of adrRows.entries()) {
      const tokens = evidenceTokens(adrRow);
      expect(tokens.length, `ADR 行「${adrRow[0]}」未抽到任何证据词`).toBeGreaterThan(0);
      // 判别性：只用「本条独有」的词去核对，避免同一个词给两条同时兜底。
      // ⚠️ 必须按**下标**排除自身：adrRows 每次调用都是新数组，按引用比较会全部失配。
      const allOther = new Set(
        adrRows.filter((_, j) => j !== idx).flatMap((r) => evidenceTokens(r)),
      );
      const distinctive = tokens.filter((t) => !allOther.has(t));
      const hit = docRows.some((dr) => distinctive.some((t) => dr.join(" ").includes(t)));
      if (!hit) unmatched.push(`${adrRow[0]} → ${distinctive.join("/")}`);
    }
    expect(unmatched, `这些 ADR 偏离在 AGENTS.md 里找不到对应留痕：${unmatched.join("；")}`).toEqual(
      [],
    );
  });

  it("清单被显式声明为封闭（不在表内的差距默认按「要修」处理）", () => {
    expect(md3Section()).toMatch(/封闭/);
    expect(md3Section()).toMatch(/默认按「要修」处理/);
  });
});

describe("#850 D：未路由的错误原型页已在文档留痕（「禁硬编码」不覆盖它）", () => {
  it("AGENTS.md 点名该原型页并说明其硬编码为有意保留", () => {
    expect(md3Section()).toContain("errorPrototype/ErrorPagePreview.vue");
    expect(md3Section()).toMatch(/不在 `router\.ts` 中/);
    expect(md3Section()).toMatch(/不覆盖该文件/);
  });

  it("该文件确实不在生产路由里（文档断言的 oracle = router.ts 源文件）", () => {
    const router = read("packages/app-lynx/src/router.ts");
    expect(router).not.toContain("ErrorPagePreview");
    // 正面对照：生产错误页走的是 pages/ErrorPage.vue
    expect(router).toContain("ErrorPage");
  });
});

describe("#850 E：反事实（阳性对照）—— 抽掉存档声明后判定必须翻转", () => {
  it("真实文档：章首 + 章尾均已声明存档", () => {
    expect(archiveDeclaredAtHead(fluentChapter())).toBe(true);
    expect(archiveDeclaredAtTail(fluentChapter())).toBe(true);
  });

  it("抽掉章首横幅 + 章尾声明 + 标题括号后，两处判定都转 false", () => {
    const stripped = stripArchiveDeclarations(fluentChapter());
    expect(stripped).not.toBe(fluentChapter());
    expect(archiveDeclaredAtHead(stripped)).toBe(false);
    expect(archiveDeclaredAtTail(stripped)).toBe(false);
  });

  it("同样地，删掉任一条款的判定标记会进入「未判定」集合（判定式非恒假）", () => {
    const chapter = fluentChapter();
    const firstClauseLine = chapter
      .split("\n")
      .findIndex((l) => /^-\s+\S/.test(l) && /\*\*(仍成立|存档条款|已失效)/.test(l));
    const lines = chapter.split("\n");
    expect(firstClauseLine).toBeGreaterThanOrEqual(0);
    lines[firstClauseLine] = lines[firstClauseLine]!.replace(/\*\*(仍成立|存档条款|已失效)/, "**某某");
    expect(clausesWithoutVerdict(lines.join("\n")).length).toBe(1);
  });

  it("漏标注的条款会破坏「MD3 口径只有一处」的不变式（越界检测非恒绿）", () => {
    const outside = AGENTS_MD.replace(md3Section(), "");
    expect(outside).not.toContain("1sp = 2rpx");
    // 往存档章外塞一条 MD3 现行口径 → 立刻被抓
    const polluted = AGENTS_MD.replace("## 架构", "## 架构\n\n排版按 1sp = 2rpx 换算。\n");
    expect(polluted.replace(md3Section(), "")).toContain("1sp = 2rpx");
  });
});
