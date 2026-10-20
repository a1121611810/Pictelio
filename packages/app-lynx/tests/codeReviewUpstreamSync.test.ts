/**
 * 钉住 code-review skill 的 upstream-override 标记与记录它们的裁决表之间的关系。
 *
 * 为什么需要这个文件。`.agents/skills/code-review/SKILL.md` 是上游 `mattpocock/skills` 的
 * code-review skill 的**fork**，而这个 fork 现在是**有结构**的：上游自己的标题作骨架
 * （`<!-- upstream-section: ... -->` 锚点），本仓每一处偏离都带一个
 * `<!-- upstream-override: ... -->` 标记，其 ID 指向 `docs/agents/code-review-upstream.md` 裁决表
 * 的一行。收益是「上游原文被静默改写」能被机器发现——**前提是两边始终对得上**。
 *
 * 标记没有裁决行 = 有人改了却没记录理由；裁决行没有标记 = 有个决定没人落地（或落地后被回退、
 * 记录却没改）。两种情况都是**文档声称的东西文件里没有**。
 *
 * 期望值来源是那两个产物本身，且互相独立：标记来自 skill 文件，裁决行来自基线文档。
 * 这里没有任何一条期望值是从被测实现反推的。
 *
 * 同一个三角的**联网那半**（上游正文是否仍与记录的基线一致）在
 * `scripts/check-code-review-upstream.mjs` 里；它不是测试，因为它要联网，而依赖联网的 PR 门禁
 * 就不再是门禁。本文件钉的是**离线也必须成立的那半**。
 *
 * 反事实（联网侧由上游机械闸检查）：
 *   - 从 skill 文件里删掉一个标记        → 「标记无裁决行」转红
 *   - 加一个表里没有的标记              → 「标记无裁决行」转红
 *   - 把某裁决的落点改成 `—`            → 「无落点却带标记」转红
 *   - 从表里删掉一整行裁决              → 「有裁决行却无标记」转红
 *   - 正文里内联引用标记语法            → 「语法只以真标记出现」转红
 *   - 把裁决表整段删空                  → 「裁决表记录了每一次同步的裁决」转红
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// 本文件在 packages/app-lynx/tests/ 下，故仓根在三层之上。
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SKILL_PATH = join(REPO_ROOT, ".agents/skills/code-review/SKILL.md");
const BASELINE_PATH = join(REPO_ROOT, "docs/agents/code-review-upstream.md");

/**
 * 读文件，读不到就大声失败。
 *
 * 文件缺失**不能**读成空字符串：那会让下面每条断言都空过，而「因为输入消失所以通过」的守卫
 * 不是守卫。
 */
function readText(path: string, label: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (cause) {
    throw new Error(`cannot read ${label} (${path}): ${String(cause)}`);
  }
}

/** 取某个标题之后那张 markdown 表格的行（不含表头行）。 */
function tableAfter(doc: string, heading: string): string[][] {
  const start = doc.indexOf(heading);
  if (start === -1) return [];
  const rows: string[][] = [];
  for (const line of doc.slice(start + heading.length).split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      if (rows.length > 0) break;
      continue;
    }
    if (!trimmed.startsWith("|")) {
      if (rows.length > 0) break;
      continue;
    }
    const cells = trimmed
      .slice(1, trimmed.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
    rows.push(cells);
  }
  return rows.slice(1);
}

/** 去掉表格单元格可能带的反引号。 */
function plain(value: string): string {
  return value.replace(/`/g, "").trim();
}

/**
 * 取带指定 upstream-section 锚点的那一块的正文。
 *
 * `String.prototype.split` 带捕获组会得到 [前文, 键1, 正文1, 键2, 正文2, ...]，
 * 键与正文交替出现，按对读取即可。
 */
function blockBody(key: string): string {
  const parts = skill.split(/<!--\s*upstream-section:\s*(.+?)\s*-->/);
  for (let index = 1; index < parts.length; index += 2) {
    if (parts[index] === key) return parts[index + 1] ?? "";
  }
  return "";
}

const skill = readText(SKILL_PATH, "the code-review skill");
const baseline = readText(BASELINE_PATH, "the upstream baseline doc");

const markers = [
  ...skill.matchAll(/<!--\s*upstream-override:\s*([A-Za-z0-9-]+)\s*-->/g),
].map((match) => match[1]);
const anchors = [...skill.matchAll(/<!--\s*upstream-section:\s*(.+?)\s*-->/g)].map((match) => match[1]);

const verdicts = tableAfter(baseline, "## 裁决表").map((row) => {
  const [id = "", position = "", disposition = "", , landing = ""] = row;
  return {
    id: plain(id),
    positions: position.split("｜").map((part) => plain(part)),
    // 处置单元格可能带括号补充；只按关键字比对。
    disposition: plain(disposition).split("（")[0].trim(),
    landing: plain(landing),
  };
});

const files = tableAfter(baseline, "### 上游派生文件清单").map((row) => {
  const [id = "", upstreamPath = "", localPath = "", mode = "", baseCommit = ""] = row;
  return {
    id: plain(id),
    upstreamPath: plain(upstreamPath),
    localPath: plain(localPath),
    mode: plain(mode),
    baseCommit: plain(baseCommit),
  };
});

describe("code-review skill 的 upstream-override 标记", () => {
  it("skill 文件里的每个 override 标记都有对应的裁决行", () => {
    // 防空转守卫：抽取器一旦失配，下面这个循环就什么都没查。
    expect(
      markers.length,
      "no override marker was extracted; the guard would be vacuous",
    ).toBeGreaterThan(0);

    const known = new Set(verdicts.map((verdict) => verdict.id));
    const orphans = markers.filter((marker) => !known.has(marker));
    expect(orphans, "override markers with no verdict row").toEqual([]);
  });

  it("有落点的裁决行必有标记，无落点的裁决行必无标记", () => {
    // 「本仓落点」列是「本仓有对应物」与「上游有而本仓刻意不搬」的分界：落点为 `—` 的行不许带标记，
    // 其余的必须带。
    expect(verdicts.length, "no verdict row was parsed").toBeGreaterThan(0);

    const marked = new Set(markers);
    const missing = verdicts
      .filter((verdict) => verdict.landing !== "—")
      .filter((verdict) => !marked.has(verdict.id))
      .map((verdict) => verdict.id);
    expect(missing, "verdict rows with no marker in the skill file").toEqual([]);

    const stray = verdicts
      .filter((verdict) => verdict.landing === "—")
      .filter((verdict) => marked.has(verdict.id))
      .map((verdict) => verdict.id);
    expect(stray, "verdict rows without a landing that nevertheless carry a marker").toEqual([]);
  });

  it("skill 文件里的每个 upstream-section 锚点都被某条裁决行指名", () => {
    // 没有裁决行指名的锚点 = 那个块的来历没被登记——与「改了却没记录理由」同一种失败，只是高一层。
    expect(anchors.length, "no upstream-section anchor was extracted").toBeGreaterThan(0);

    const named = new Set(verdicts.flatMap((verdict) => verdict.positions));
    const undocumented = anchors.filter((anchor) => !named.has(anchor));
    expect(undocumented, "upstream-section anchors no verdict row names").toEqual([]);
  });

  it("每条 local-only 裁决都指名一个文件里真实存在的锚点", () => {
    // local-only 行指的是「本仓有、上游没有」的块。锚点没了，这行就在描述一个已经不存在的块。
    // `frontmatter` 是唯一不是锚点的键：YAML 放不了标记，所以 frontmatter 的裁决标记放在第一个锚点旁边。
    const localOnly = verdicts.filter((verdict) => verdict.disposition === "local-only");
    expect(localOnly.length, "no local-only verdict was parsed").toBeGreaterThan(0);

    const present = new Set([...anchors, "frontmatter"]);
    const missing = localOnly
      .flatMap((verdict) => verdict.positions)
      .filter((position) => !present.has(position));
    expect(missing, "local-only verdicts naming an anchor the file does not have").toEqual([]);
  });

  it("标记语法只以真标记出现", () => {
    // 闸与本测试都用正则解析文件。正文里内联引用标记语法（哪怕在代码 span 里）会被读成真标记，
    // 还会悄悄改变某条裁决归属哪个块 ⇒ 提及次数必须等于解析出的标记数。
    const overrideMentions = (skill.match(/upstream-override:/g) ?? []).length;
    expect(
      overrideMentions,
      "the override syntax is mentioned somewhere it is not a real marker",
    ).toBe(markers.length);

    const sectionMentions = (skill.match(/upstream-section:/g) ?? []).length;
    expect(
      sectionMentions,
      "the anchor syntax is mentioned somewhere it is not a real anchor",
    ).toBe(anchors.length);
  });

  it("not-ported 裁决不得指名本地仍然存在的块", () => {
    // 否则裁决表可以预登记一条白名单，把「删掉一整段上游块」洗成「我们没搬它」。
    // `frontmatter` 豁免：那类行说的是 frontmatter 的**内容**。
    const notPorted = verdicts.filter((verdict) => verdict.disposition === "not-ported");
    expect(notPorted.length, "no not-ported verdict was parsed").toBeGreaterThan(0);

    const present = new Set(anchors);
    const wrong = notPorted
      .flatMap((verdict) => verdict.positions)
      .filter((position) => position !== "frontmatter")
      .filter((position) => present.has(position));
    expect(wrong, "not-ported verdicts naming a block that is still present").toEqual([]);
  });

  it("每个 local-only 块都有正文", () => {
    // 只留锚点 + 标记而正文被清空 = 空壳：块在纸面上存在，内容没了。
    // local-only 行指明了这些块，所以正文能离线检查。
    const localOnly = verdicts.filter((verdict) => verdict.disposition === "local-only");
    expect(localOnly.length, "no local-only verdict was parsed").toBeGreaterThan(0);

    for (const key of localOnly.flatMap((verdict) => verdict.positions)) {
      if (key === "frontmatter") continue;
      // 判空前先剥掉标记行：标记不是正文，把它算进去会让被清空的块蒙混过关。
      const body = blockBody(key).replace(/<!--\s*upstream-override:[^>]*-->/g, "");
      expect(body, `local-only block "${key}" is not an anchor in the skill file`).not.toBe("");
      expect(body.trim(), `local-only block "${key}" has an empty body`).not.toBe("");
    }
  });
});

describe("上游基线记录", () => {
  it("每个上游派生文件都有十六进制基线 commit 与本仓路径", () => {
    // 闸解析的就是这几个单元格：没有十六进制 sha 的行等于「拿它跟空气比」。
    expect(files.length, "no upstream-derived file was parsed").toBeGreaterThan(0);

    for (const file of files) {
      expect(file.id, "an upstream-derived file row has no id").not.toBe("");
      expect(file.upstreamPath, `${file.id} has no upstream path`).not.toBe("");
      expect(file.localPath, `${file.id} has no local path`).not.toBe("");
      expect(file.mode, `${file.id} has no sync mode`).not.toBe("");
      expect(
        /[0-9a-f]{7,40}/.test(file.baseCommit),
        `${file.id} has no hex baseline commit in "${file.baseCommit}"`,
      ).toBe(true);
    }
  });

  it("基线文档为每一次同步的变更都留了裁决", () => {
    // 断言必须打在**解析出来的裁决行**上，而不是对全文做 `toContain`——「裁决 / adopt / adapt」
    // 这三个子串在裁决表之外的散文里也各出现过，全文匹配会在「整张表被删空」时仍然全绿：
    // 那是一条**恒真断言**（违反本仓「防空转断言」纪律：抽取器必须断言结果非空 / 有下界）。
    expect(verdicts.length, "no verdict row was parsed").toBeGreaterThan(0);

    const dispositions = verdicts.map((verdict) => verdict.disposition);
    expect(dispositions, "no adopt verdict").toContain("adopt");
    expect(dispositions, "no adapt verdict").toContain("adapt");
    expect(dispositions, "no not-ported verdict").toContain("not-ported");
    expect(dispositions, "no local-only verdict").toContain("local-only");
  });

  it("裁决的落点若指向标题，该标题必须真实存在", () => {
    // 落点列是「本仓对应物在哪」的指针。按它去找必须找得到——否则读者扑空，而本仓 skill 自己
    // 的「文档交叉引用」卡点也会判它违规（落点不存在 = 悬空指针）。
    const headings = new Set(
      skill
        .split("\n")
        .filter((line) => /^#{1,6}\s/.test(line))
        .map((line) => line.trim()),
    );
    const dangling = verdicts
      .map((verdict) => verdict.landing)
      .filter((landing) => landing.startsWith("#"))
      .filter((landing) => !headings.has(landing));
    expect(dangling, "verdict landings naming a heading that does not exist").toEqual([]);
  });

  it("闸的「查不了」路径退出码是 2 而不是 0", () => {
    // 「查不了」必须与「没漂移」分开：三态退出码里 exit 2 = 查不了。给它一个没有 gh 的 PATH，
    // 闸应当报「查不了」并以 2 退出，而不是静默当成「上游没动」（那正是假绿）。
    const result = spawnSync(
      process.execPath,
      [join(REPO_ROOT, "scripts/check-code-review-upstream.mjs")],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: "/nonexistent-for-the-upstream-gate" },
      },
    );
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    expect(result.status, `expected exit 2, got ${result.status}: ${output}`).toBe(2);
    expect(output, "the gate did not say it could not check").toContain("could not query GitHub");
  });
});
