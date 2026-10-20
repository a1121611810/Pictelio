/**
 * 本仓「从上游派生文件」的机械闸。
 *
 * 为什么需要它。上游自己的纪律（`docs/engineering/code-review.md`）只说了一句：
 * *"Keep a note of the commit you forked from so you can re-sync by hand."*
 * 只记 SHA 让「**发现**上游动了」变容易；要让「**发现不了**」变不可能，得靠机械闸——这就是本脚本。
 *
 * 两项检查，都要过：
 *
 *   1. **漂移**。对 `docs/agents/code-review-upstream.md` 的「上游派生文件清单」里每一个文件，
 *      问 GitHub：自记录的基线 commit 起，上游那条路径还被哪些提交动过？有 ⇒ 列出来并判红：
 *      每一次都需要一条裁决 + 一次基线上移。
 *   2. **三方一致性**（仅 `structured` 形态的文件）。上游正文、本仓文件、裁决表是同一个三角的三条边：
 *        - 裁决表每一行都要有对应的 `<!-- upstream-override: ... -->` 标记（「本仓落点」为 `—` 的行除外——
 *          那些行说的是「上游有而本仓刻意不搬的东西」，本仓没有落点，**也不允许有标记**）；
 *        - 文件里每个标记都要有裁决行——有人改了却没记录理由；
 *        - 上游有、本仓没有的块 ⇒ 必须有 `not-ported` 裁决指名它；
 *        - 本仓新增的块 ⇒ 必须有 `local-only` 裁决指名它；
 *        - 与上游内容不同的块 ⇒ 块内至少有一个标记——**这就是「上游原文被静默改写」能被机器发现的那一条**。
 *
 * 文件清单从基线文档里解析，**不在代码里硬编码路径**：把同一份清单抄进代码，就是这套机制要消灭的
 * 那种「同一事实两个副本」。
 *
 * 为什么它不进默认门禁。它要联网，而 PR 门禁必须离线（联网门禁会因为与 diff 无关的原因变红）。
 * 与 `pnpm run compat:pi` 同一个取舍：发版前手动跑，不进 CI。
 *
 * 退出码三态可分：
 *   0  上游没动，且每个文件都与自己的裁决一致
 *   1  上游动了，或三方一致性检查没过            -> 需要重同步 / 补裁决
 *   2  **查不了**（缺工具 / 联网失败 / 基线悬空 / 文档解析失败） -> 不等于「没漂移」
 *
 * 退出码 2 之所以单列：「我查不了」与「没什么可查」是两种状态，把它们合并正是门禁静默失效的典型路径。
 * 所以「查不了」永远是抛 `GateFailure`，绝不是安静地 `return`。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const UPSTREAM_REPO = "mattpocock/skills";
const BASELINE_DOC = new URL("../docs/agents/code-review-upstream.md", import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** 「查不了」的结果。与「上游动了」刻意分开。 */
class GateFailure extends Error {
  constructor(message, code) {
    super(message);
    this.name = "GateFailure";
    this.code = code;
  }
}

/** 报错并停止。永远抛异常，调用方才能放心地 `return fail(...)`。 */
function fail(message, code = 2) {
  throw new GateFailure(message, code);
}

/**
 * 读基线文档。
 *
 * `@returns` 注解是承重的，不是装饰：`tsconfig.json` 只含 `src` 与 `tests`，本文件不被 `tsc` 检查；
 * 真正检查它的是 oxlint 的类型感知模式，而它把 `readFileSync(<URL>, "utf8")` 推断成 `any`——一个 `any`
 * 会污染从该文件派生的每个值，`restrict-template-expressions` 随后就会拒绝它们。注解把类型钉在
 * 真正被检查的地方。
 *
 * @returns {string}
 */
function readBaselineDoc() {
  try {
    return readFileSync(BASELINE_DOC, "utf8");
  } catch (cause) {
    return fail(`cannot read docs/agents/code-review-upstream.md: ${String(cause)}`);
  }
}

/**
 * 把一张 markdown 表格拆成去掉首尾空白的单元格数组。
 *
 * 分隔行（`| --- |`）与空行被丢掉。表不存在时返回空表——由调用方决定这是否算致命。
 *
 * @param {string} doc
 * @param {string} heading
 * @returns {string[][]}
 */
function tableAfter(doc, heading) {
  const start = doc.indexOf(heading);
  if (start === -1) return [];
  const rows = [];
  for (const line of doc.slice(start + heading.length).split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      if (rows.length > 0) break; // 表格到此结束
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
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue; // 分隔行
    rows.push(cells);
  }
  return rows.slice(1); // 去掉表头行
}

/**
 * 去掉表格单元格里可能带的反引号。
 *
 * @param {string} value
 * @returns {string}
 */
function plain(value) {
  return value.replace(/`/g, "").trim();
}

/**
 * 解析「上游派生文件清单」表。
 *
 * @param {string} doc
 * @returns {{ id: string, upstreamPath: string, localPath: string, mode: string, baseCommit: string }[]}
 */
function parseFileTable(doc) {
  const rows = tableAfter(doc, "### 上游派生文件清单");
  if (rows.length === 0) {
    return fail("docs/agents/code-review-upstream.md has no '上游派生文件清单' table");
  }
  const files = [];
  for (const row of rows) {
    const [id = "", upstreamPath = "", localPath = "", mode = "", baseCommit = ""] = row;
    const sha = /([0-9a-f]{7,40})/.exec(baseCommit)?.[1];
    if (!id || !upstreamPath || !localPath || !mode) {
      return fail(`upstream-derived file row is incomplete: ${row.join(" | ")}`);
    }
    if (!sha) {
      return fail(
        `upstream-derived file ${id} has no hex baseline commit in "${baseCommit}" -- the gate ` +
          "would compare against nothing",
      );
    }
    files.push({
      id: plain(id),
      upstreamPath: plain(upstreamPath),
      localPath: plain(localPath),
      mode: plain(mode),
      baseCommit: sha,
    });
  }
  return files;
}

/**
 * 解析「裁决表」。
 *
 * @param {string} doc
 * @returns {{ id: string, positions: string[], disposition: string, landing: string }[]}
 */
function parseVerdicts(doc) {
  const rows = tableAfter(doc, "## 裁决表");
  if (rows.length === 0) {
    return fail("docs/agents/code-review-upstream.md has no '## 裁决表' table");
  }
  const verdicts = [];
  for (const row of rows) {
    const [id = "", position = "", disposition = "", , landing = ""] = row;
    if (!id || !position || !disposition) {
      return fail(`verdict row is incomplete: ${row.join(" | ")}`);
    }
    verdicts.push({
      id: plain(id),
      positions: position.split("｜").map((part) => plain(part)),
      // 处置单元格可能带括号补充（如 `adopt（上游 5c89081d）`）。只按关键字比对——
      // 否则一句补充就会让规则悄悄失配（`not-ported（因为…）` 不等于 `not-ported`）。
      disposition: plain(disposition).split("（")[0].trim(),
      landing: plain(landing),
    });
  }
  return verdicts;
}

/**
 * 解析「块级关系表」：每个块与上游是什么关系。
 *
 * 这张表与「裁决表」分工：裁决表记「我们改了什么」，关系表记「这个块整体跟上游是什么关系」。
 * `逐字照抄` 的块一旦内容与上游不同，「我们照抄了上游」这个事实就不成立 ⇒ 必须红；
 * `整块改写` 的块本来就是本仓的版本，块内改写不影响与上游的关系 ⇒ 豁免（**这不是放水**——
 * 对整块重写做逐处登记没有信息量，那块的内容归本仓自己的 review 流程管）。
 *
 * @param {string} doc
 * @returns {{ key: string, relation: string, verdicts: string }[]}
 */
function parseRelations(doc) {
  const rows = tableAfter(doc, "### 块级关系表");
  if (rows.length === 0) {
    return fail("docs/agents/code-review-upstream.md has no '### 块级关系表' table");
  }
  const relations = [];
  for (const row of rows) {
    const [key = "", relation = "", , verdicts = ""] = row;
    if (!key || !relation) {
      return fail(`relation row is incomplete: ${row.join(" | ")}`);
    }
    relations.push({ key: plain(key), relation: plain(relation), verdicts: plain(verdicts) });
  }
  return relations;
}

/**
 * 从 GitHub 取某个 ref 下的文件正文。
 *
 * @param {string} path
 * @param {string} ref
 * @returns {string}
 */
function fetchUpstreamFile(path, ref) {
  let stdout;
  try {
    stdout = execFileSync(
      "gh",
      ["api", `repos/${UPSTREAM_REPO}/contents/${path}?ref=${ref}`, "--jq", ".content"],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
  } catch (cause) {
    return fail(
      `could not read ${UPSTREAM_REPO}/${path}@${ref} via \`gh\`. Install/authenticate gh, or set ` +
        `GITHUB_TOKEN, then re-run. Underlying error: ${String(cause)}`,
    );
  }
  const body = stdout.replace(/\s+/g, "");
  if (body === "") {
    return fail(`GitHub returned an empty body for ${UPSTREAM_REPO}/${path}@${ref}`);
  }
  return Buffer.from(body, "base64").toString("utf8");
}

/**
 * 列出动过某条路径的上游提交，最新的在前。
 *
 * 用 `gh` 是因为本仓的 issue tracker 已经依赖它（`docs/agents/issue-tracker.md`），且它自带鉴权。
 * `gh` 缺失或失败一律是退出码 2，绝不静默放行。
 *
 * @param {string} path
 * @returns {{ sha: string, date: string, message: string }[]}
 */
function listUpstreamCommits(path) {
  let stdout;
  try {
    stdout = execFileSync(
      "gh",
      [
        "api",
        `repos/${UPSTREAM_REPO}/commits?path=${path}&per_page=100`,
        "--jq",
        // 用 **committer** 日期而非 author 日期：GitHub 的提交列表按 commit date 排序，
        // 而 author date 可能早很多（上游 d80fa0f4 作者日期 08-15、实际提交 09-17）。
        // 显示 author 日期会让列表看起来「乱序」，而基线判定是按列表位置来的。
        '.[] | "\\(.sha) \\(.commit.committer.date) \\(.commit.message | split("\\n")[0])"',
      ],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
  } catch (cause) {
    return fail(
      "could not query GitHub via `gh`. Install/authenticate gh, or set GITHUB_TOKEN, then re-run. " +
        `Underlying error: ${String(cause)}`,
    );
  }

  const commits = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha = "", date = "", ...rest] = line.split(" ");
      return { sha, date, message: rest.join(" ") };
    });

  if (commits.length === 0) {
    return fail(
      `the GitHub query for ${UPSTREAM_REPO} ${path} returned no commits -- either the path moved ` +
        "upstream or the API shape changed. Treat as unknown, not as up to date.",
    );
  }
  return commits;
}

/**
 * 把上游文件按标题切成块。
 *
 * 块键就是标题原文（`## Process`、`### 1. Pin the fixed point` …），另加两个合成的：
 * `frontmatter`（YAML 头）与 `intro`（第一个标题之前的正文）。本仓文件用同一套键，两边才可比。
 *
 * @param {string} text
 * @returns {Map<string, string>}
 */
function parseUpstreamBlocks(text) {
  /** @type {Map<string, string>} */
  const blocks = new Map();
  const lines = text.split("\n");
  let index = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.indexOf("---", 1);
    if (end === -1) return fail("the upstream file has an unterminated frontmatter block");
    blocks.set("frontmatter", lines.slice(0, end + 1).join("\n"));
    index = end + 1;
  }
  let currentKey = "intro";
  let buffer = [];
  const flush = () => {
    blocks.set(currentKey, buffer.join("\n"));
  };
  for (const line of lines.slice(index)) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      currentKey = line.trim();
      buffer = [line];
      continue;
    }
    buffer.push(line);
  }
  flush();
  return blocks;
}

/**
 * 把本仓文件按 `upstream-section` 锚点切成块。
 *
 * 第一个锚点之前的那块是 frontmatter；YAML 里放不了 HTML 注释，所以 frontmatter 的裁决标记
 * 放在第一个锚点旁边。
 *
 * @param {string} text
 * @returns {Map<string, { content: string, markers: string[] }>}
 */
function parseLocalBlocks(text) {
  /** @type {Map<string, { content: string, markers: string[] }>} */
  const blocks = new Map();
  const anchor = /<!--\s*upstream-section:\s*(.+?)\s*-->/g;
  const parts = [];
  let last = 0;
  let match;
  while ((match = anchor.exec(text)) !== null) {
    parts.push({ key: null, text: text.slice(last, match.index) });
    parts.push({ key: match[1], text: "" });
    last = match.index + match[0].length;
  }
  parts.push({ key: null, text: text.slice(last) });

  let currentKey = "frontmatter";
  let content = "";
  for (const part of parts) {
    if (part.key !== null) {
      blocks.set(currentKey, { content, markers: [] });
      currentKey = part.key;
      content = "";
      continue;
    }
    content += part.text;
  }
  blocks.set(currentKey, { content, markers: [] });

  // 标记就写在块正文里，按块收集。
  const markerPattern = /<!--\s*upstream-override:\s*([A-Za-z0-9-]+)\s*-->/g;
  for (const [key, block] of blocks) {
    const found = [...block.content.matchAll(markerPattern)].map((m) => m[1]);
    blocks.set(key, { content: block.content, markers: found });
  }
  return blocks;
}

/**
 * 比对前把块归一化：去掉 override 标记、空行与行尾空白。
 *
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return text
    .replace(/<!--\s*upstream-override:[^>]*-->/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "")
    .join("\n");
}

/**
 * 校验一个 `structured` 文件的三方一致性。
 *
 * @param {string} localText
 * @param {string} upstreamText
 * @param {{ id: string, positions: string[], disposition: string, landing: string }[]} verdicts
 * @returns {string[]} 发现的问题
 */
function checkConsistency(localText, upstreamText, verdicts, relations) {
  const problems = [];
  const local = parseLocalBlocks(localText);
  const upstream = parseUpstreamBlocks(upstreamText);
  const verdictById = new Map(verdicts.map((verdict) => [verdict.id, verdict]));

  // 规则 2：文件里每个标记都要有裁决行。
  const fileMarkers = [
    ...localText.matchAll(/<!--\s*upstream-override:\s*([A-Za-z0-9-]+)\s*-->/g),
  ].map((match) => match[1]);
  for (const marker of fileMarkers) {
    if (!verdictById.has(marker)) {
      problems.push(
        `the file carries override marker ${marker}, which has no row in the verdict table`,
      );
    }
  }

  // 规则 1：每个裁决行都要有标记；「本仓落点」为 `—` 的行除外——那些行说的是「上游有而本仓刻意
  // 不搬的东西」，本仓没有落点，带标记反而是错的。
  for (const verdict of verdicts) {
    const hasMarker = fileMarkers.includes(verdict.id);
    if (verdict.landing === "—") {
      if (hasMarker) {
        problems.push(`verdict ${verdict.id} has no landing in this repo but carries a marker`);
      }
      continue;
    }
    if (!hasMarker) {
      problems.push(`verdict ${verdict.id} has no override marker in the file`);
    }
  }

  // 规则 3：上游有、本仓没有的块，必须有 `not-ported` 裁决指名它。
  for (const key of upstream.keys()) {
    if (local.has(key)) continue;
    const covering = verdicts.filter(
      (verdict) => verdict.disposition === "not-ported" && verdict.positions.includes(key),
    );
    if (covering.length === 0) {
      problems.push(`upstream block "${key}" is missing here and no not-ported verdict names it`);
    }
  }

  // 规则 4：本仓新增的块，必须有 `local-only` 裁决指名它。
  for (const key of local.keys()) {
    if (upstream.has(key)) continue;
    const covering = verdicts.filter(
      (verdict) => verdict.disposition === "local-only" && verdict.positions.includes(key),
    );
    if (covering.length === 0) {
      problems.push(`block "${key}" exists only in this repo and no local-only verdict names it`);
    }
  }

  // 规则 5：与上游内容不同的块，块内至少要有一个标记。
  for (const [key, upstreamBlock] of upstream) {
    if (key === "frontmatter") continue; // YAML 放不了标记，见文档里的规则说明
    const localBlock = local.get(key);
    if (!localBlock) continue;
    if (normalize(localBlock.content) === normalize(upstreamBlock)) continue;
    if (localBlock.markers.length === 0) {
      problems.push(`block "${key}" differs from upstream but carries no override marker`);
    }
  }

  // 规则 6：`not-ported` 裁决指名的块，在本地必须真的不存在。否则裁决表可以预登记一条白名单，
  // 把「删掉一整段上游块」洗成「我们没搬它」。`frontmatter` 豁免：那类行说的是 frontmatter 的
  // **内容**（英文描述），不是块本身在不在。
  for (const verdict of verdicts) {
    if (verdict.disposition !== "not-ported") continue;
    for (const key of verdict.positions) {
      if (key === "frontmatter") continue;
      if (local.has(key)) {
        problems.push(
          `verdict ${verdict.id} is not-ported but block "${key}" is still present here`,
        );
      }
    }
  }

  // 规则 7：本仓独占块必须有正文。只留锚点 + 标记而正文被清空 = 空壳——块在纸面上存在，内容没了。
  // 判空前先剥掉标记：标记行不是正文，把它算进去会让被清空的块蒙混过关。
  for (const [key, block] of local) {
    if (upstream.has(key)) continue;
    const body = block.content.replace(/<!--\s*upstream-override:[^>]*-->/g, "");
    if (!body.split("\n").some((line) => line.trim() !== "")) {
      problems.push(`block "${key}" exists only in this repo but its body is empty`);
    }
  }

  // 规则 8/9：块级关系表。
  // 规则 8：声明「逐字照抄」的块，内容必须与上游逐字一致（去掉标记后）——「我们照抄了上游」这个
  // 事实一旦不成立，机器必须看见。
  // 规则 9：声明「本仓新增」的块，上游不得有同名块——上游追上了，关系声明就该更新。
  const relationByKey = new Map(relations.map((relation) => [relation.key, relation]));
  for (const relation of relations) {
    const upstreamBlock = upstream.get(relation.key);
    const localBlock = local.get(relation.key);
    if (relation.relation === "逐字照抄") {
      if (!upstreamBlock) {
        problems.push(
          `block "${relation.key}" is declared verbatim but upstream has no such block`,
        );
        continue;
      }
      if (!localBlock) {
        problems.push(`block "${relation.key}" is declared verbatim but is missing here`);
        continue;
      }
      if (normalize(localBlock.content) !== normalize(upstreamBlock)) {
        problems.push(
          `block "${relation.key}" is declared verbatim but its content differs from upstream`,
        );
      }
    } else if (relation.relation === "本仓新增") {
      if (upstreamBlock) {
        problems.push(
          `block "${relation.key}" is declared local-only but upstream now has a block with that key`,
        );
      }
    } else if (relation.relation === "整块改写") {
      // 「整块改写」的前提是**上游有这个块**；没有的话它就该声明成「本仓新增」。
      if (!upstreamBlock) {
        problems.push(
          `block "${relation.key}" is declared as a rewrite of upstream but upstream has no such block`,
        );
      }
    }
  }

  // 规则 10：每个块都必须声明关系——没声明关系的块 = 关系不明（本地块与上游块都要覆盖）。
  for (const key of local.keys()) {
    if (!relationByKey.has(key)) {
      problems.push(`block "${key}" has no declared relation to upstream`);
    }
  }
  for (const key of upstream.keys()) {
    if (!relationByKey.has(key)) {
      problems.push(`upstream block "${key}" has no declared relation`);
    }
  }
  for (const relation of relations) {
    if (!["逐字照抄", "整块改写", "本仓新增"].includes(relation.relation)) {
      problems.push(`block "${relation.key}" has an unknown relation "${relation.relation}"`);
    }
  }

  return problems;
}

function main() {
  const doc = readBaselineDoc();
  const files = parseFileTable(doc);
  const verdicts = parseVerdicts(doc);
  const relations = parseRelations(doc);
  const problems = [];

  for (const file of files) {
    const commits = listUpstreamCommits(file.upstreamPath);
    const baseIndex = commits.findIndex((commit) => commit.sha.startsWith(file.baseCommit));
    if (baseIndex === -1) {
      return fail(
        `base-commit ${file.baseCommit} for ${file.id} is not among the ${commits.length} commits that ` +
          `touched ${file.upstreamPath} upstream. The recorded baseline is dangling (upstream history ` +
          "was rewritten, or the path was renamed). Re-establish the baseline by hand.",
      );
    }
    const newer = commits.slice(0, baseIndex);
    if (newer.length > 0) {
      problems.push(
        `${file.id}: upstream moved in ${newer.length} commit(s) since ${file.baseCommit}:\n` +
          newer
            .map(
              (commit) =>
                `        ${commit.sha.slice(0, 8)}  ${commit.date.slice(0, 10)}  ${commit.message}`,
            )
            .join("\n"),
      );
    }
  }

  const structured = files.find((file) => file.mode.startsWith("structured"));
  if (structured) {
    const localPath = join(REPO_ROOT, structured.localPath);
    let localText;
    try {
      localText = readFileSync(localPath, "utf8");
    } catch (cause) {
      return fail(`cannot read ${structured.localPath}: ${String(cause)}`);
    }
    const upstreamText = fetchUpstreamFile(structured.upstreamPath, structured.baseCommit);
    problems.push(...checkConsistency(localText, upstreamText, verdicts, relations));
  }

  if (problems.length > 0) {
    process.stderr.write(`check:code-review-upstream: ${problems.length} problem(s):\n`);
    for (const problem of problems) {
      process.stderr.write(`  - ${problem}\n`);
    }
    process.stderr.write(
      "\nEach upstream move needs a verdict (adopt / adapt / reject) recorded in " +
        "docs/agents/code-review-upstream.md, then a bump of that file's baseline commit.\n" +
        "See the '上游原文取数' section of that doc for the commands.\n",
    );
    process.exit(1);
  }

  process.stdout.write(
    `check:code-review-upstream: ${files.length} upstream-derived file(s) checked; upstream has not ` +
      "moved and the verdict table matches the skill file.\n",
  );
  process.exit(0);
}

try {
  main();
} catch (error) {
  if (error instanceof GateFailure) {
    process.stderr.write(`check:code-review-upstream: ${error.message}\n`);
    process.exit(error.code);
  }
  throw error;
}
