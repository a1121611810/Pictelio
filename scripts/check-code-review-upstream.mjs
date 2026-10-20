/**
 * Mechanical gate for every file this repo derives from the upstream skill set.
 *
 * Why it exists at all. The upstream discipline (upstream's own `docs/engineering/code-review.md`)
 * says: *"Keep a note of the commit you forked from so you can re-sync by hand."* Keeping the note
 * only makes **discovering** the drift easy -- it does not make **failing to discover it** impossible.
 * This script is the second half.
 *
 * Two checks, and both must pass:
 *
 *   1. **Drift.** For every upstream-derived file listed in `docs/agents/code-review-upstream.md`,
 *      ask GitHub which commits have touched the upstream path since the recorded baseline. If there
 *      are any, list them and fail: each one needs a verdict and a baseline bump.
 *
 *   2. **Three-way consistency** (structured files only). The upstream text, this repo's file and
 *      the verdict table are three sides of one triangle. The script checks that:
 *        - every verdict row has a matching `<!-- upstream-override: ... -->` marker in the file
 *          (and rows whose landing is `—` must NOT carry one -- they describe upstream content this
 *          repo deliberately does not have);
 *        - every marker in the file has a verdict row -- an edit nobody recorded a reason for;
 *        - an upstream block missing here has a `not-ported` verdict naming it;
 *        - a block that exists only here has a `local-only` verdict naming it;
 *        - a block whose content differs from upstream carries at least one marker -- **this is what
 *          makes "upstream text was silently rewritten" a machine-detectable event rather than a
 *          thing that depends on someone reading the diff.**
 *
 * The file list is parsed out of the baseline doc rather than hard-coded here: a second copy of the
 * same list is exactly the drift this mechanism exists to catch.
 *
 * Why it is NOT part of the default gate. It needs the network, and a pull-request gate that
 * depends on the network stops being a gate (it fails for reasons that have nothing to do with the
 * diff). The offline half of the same invariant is pinned by
 * `packages/app-lynx/tests/codeReviewUpstreamSync.test.ts`, which runs in CI.
 *
 * Exit codes, all distinct so a caller can tell them apart:
 *   0  upstream has not moved and every file is consistent with its verdicts
 *   1  upstream moved, or the three-way consistency check failed        -> re-sync / adjudicate
 *   2  the check could not run (missing tool, network failure, unparsable doc)  -> NOT a pass
 *
 * Exit code 2 exists because "I could not check" and "there is nothing to check" are different
 * states, and collapsing them is how a gate silently stops gating. The "could not run" path is
 * therefore a thrown `GateFailure`, never a quiet `return`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const UPSTREAM_REPO = "mattpocock/skills";
const BASELINE_DOC = new URL("../docs/agents/code-review-upstream.md", import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** A "the check could not run" outcome. Distinct from "upstream moved" on purpose. */
class GateFailure extends Error {
  constructor(message, code) {
    super(message);
    this.name = "GateFailure";
    this.code = code;
  }
}

/** Report a failure and stop. Always throws, so callers can `return fail(...)` safely. */
function fail(message, code = 2) {
  throw new GateFailure(message, code);
}

/**
 * Read the baseline doc.
 *
 * The `@returns` annotation is load-bearing, not decoration: without it the inferred type of
 * `readFileSync(<URL>, "utf8")` would be `any`, and every value derived from the file would inherit
 * that. The annotation pins the type where the file is actually checked.
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
 * Split a markdown table into trimmed cell arrays.
 *
 * Rows that are separators (`| --- |`) and empty lines are dropped. A table that does not exist is
 * an empty list -- the caller decides whether that is fatal.
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
      if (rows.length > 0) break; // end of the table
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
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue; // separator row
    rows.push(cells);
  }
  return rows.slice(1); // drop the header row
}

/**
 * Strip the backticks a table cell may carry.
 *
 * @param {string} value
 * @returns {string}
 */
function plain(value) {
  return value.replace(/`/g, "").trim();
}

/**
 * Parse the table of upstream-derived files.
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
 * Parse the verdict table.
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
      disposition: plain(disposition),
      landing: plain(landing),
    });
  }
  return verdicts;
}

/**
 * Pull a file's body out of GitHub at a given ref.
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
 * List the upstream commits that touched a path, newest first.
 *
 * Uses `gh` because the repo already depends on it for the issue tracker
 * (`docs/agents/issue-tracker.md`) and it handles auth. A missing or failing `gh` is exit code 2,
 * never a silent pass.
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
        '.[] | "\\(.sha) \\(.commit.author.date) \\(.commit.message | split("\\n")[0])"',
      ],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1028 },
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
 * Split an upstream file into blocks keyed by heading.
 *
 * The keys are the heading lines verbatim (`## Process`, `### 1. Pin the fixed point`, ...) plus two
 * synthetic ones: `frontmatter` for the YAML header and `intro` for the prose before the first
 * heading. The local file uses the same keys, which is what makes the two comparable.
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
 * Split the local file into blocks keyed by the `upstream-section` anchor they carry.
 *
 * The block that precedes the first anchor is the frontmatter; YAML cannot carry an HTML comment,
 * so the frontmatter verdict is marked next to the first anchor instead.
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

  // Markers live inside a block's content; collect them per block.
  const markerPattern = /<!--\s*upstream-override:\s*([A-Za-z0-9-]+)\s*-->/g;
  for (const [key, block] of blocks) {
    const found = [...block.content.matchAll(markerPattern)].map((m) => m[1]);
    blocks.set(key, { content: block.content, markers: found });
  }
  return blocks;
}

/**
 * Normalize a block for comparison: drop the override markers, blank lines and trailing space.
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
 * Check the three-way consistency of one structured file.
 *
 * @param {string} localText
 * @param {string} upstreamText
 * @param {{ id: string, positions: string[], disposition: string, landing: string }[]} verdicts
 * @returns {string[]} problems found
 */
function checkConsistency(localText, upstreamText, verdicts) {
  const problems = [];
  const local = parseLocalBlocks(localText);
  const upstream = parseUpstreamBlocks(upstreamText);
  const verdictById = new Map(verdicts.map((verdict) => [verdict.id, verdict]));

  // The marker syntax may only appear as a real marker: an inline mention in prose would be parsed
  // as one. Compare the number of occurrences with the number of parsed markers.
  const sectionOccurrences = (localText.match(/upstream-section:/g) ?? []).length;
  const overrideOccurrences = (localText.match(/upstream-override:/g) ?? []).length;
  const fileMarkers = [
    ...localText.matchAll(/<!--\s*upstream-override:\s*([A-Za-z0-9-]+)\s*-->/g),
  ].map((match) => match[1]);
  const fileAnchors = [...localText.matchAll(/<!--\s*upstream-section:\s*(.+?)\s*-->/g)].map(
    (match) => match[1],
  );
  if (sectionOccurrences !== fileAnchors.length) {
    problems.push(
      `the file mentions the anchor syntax ${sectionOccurrences} time(s) but only ` +
        `${fileAnchors.length} are real anchors -- the marker syntax may only appear as a marker`,
    );
  }
  if (overrideOccurrences !== fileMarkers.length) {
    problems.push(
      `the file mentions the override syntax ${overrideOccurrences} time(s) but only ` +
        `${fileMarkers.length} are real markers -- the marker syntax may only appear as a marker`,
    );
  }

  // Rule 2: every marker in the file has a verdict row.
  for (const marker of fileMarkers) {
    if (!verdictById.has(marker)) {
      problems.push(
        `the file carries override marker ${marker}, which has no row in the verdict table`,
      );
    }
  }

  // Rule 1: every verdict row has a marker, unless its landing is `—` (upstream content this repo
  // deliberately does not have -- in that case a marker would be wrong).
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

  // Rule 3: an upstream block missing here needs a `not-ported` verdict naming it.
  for (const key of upstream.keys()) {
    if (local.has(key)) continue;
    const covering = verdicts.filter(
      (verdict) => verdict.disposition === "not-ported" && verdict.positions.includes(key),
    );
    if (covering.length === 0) {
      problems.push(`upstream block "${key}" is missing here and no not-ported verdict names it`);
    }
  }

  // Rule 4: a block that exists only here needs a `local-only` verdict naming it.
  for (const key of local.keys()) {
    if (upstream.has(key)) continue;
    const covering = verdicts.filter(
      (verdict) => verdict.disposition === "local-only" && verdict.positions.includes(key),
    );
    if (covering.length === 0) {
      problems.push(`block "${key}" exists only in this repo and no local-only verdict names it`);
    }
  }

  // Rule 5: a block that differs from upstream carries at least one marker.
  for (const [key, upstreamBlock] of upstream) {
    if (key === "frontmatter") continue; // YAML cannot carry a marker; see the doc's rules
    const localBlock = local.get(key);
    if (!localBlock) continue;
    if (normalize(localBlock.content) === normalize(upstreamBlock)) continue;
    if (localBlock.markers.length === 0) {
      problems.push(`block "${key}" differs from upstream but carries no override marker`);
    }
  }

  // Rule 6: a `not-ported` verdict must name a block that really is absent here.
  // Otherwise the table can pre-register a whitelist entry for a block that is still present --
  // which is exactly how "delete an upstream block" gets laundered into "we did not port it".
  // `frontmatter` is exempt: a not-ported row about the frontmatter talks about its *content*
  // (the English description), not about the block's existence.
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

  // Rule 7: a local-only block must carry its body. An anchor plus a marker over an empty body is
  // a shell -- the block exists on paper and its content is gone. The markers are stripped first:
  // a marker line is not content, and counting it would let an emptied block pass.
  for (const [key, block] of local) {
    if (upstream.has(key)) continue;
    const body = block.content.replace(/<!--\s*upstream-override:[^>]*-->/g, "");
    if (!body.split("\n").some((line) => line.trim() !== "")) {
      problems.push(`block "${key}" exists only in this repo but its body is empty`);
    }
  }

  return problems;
}

function main() {
  const doc = readBaselineDoc();
  const files = parseFileTable(doc);
  const verdicts = parseVerdicts(doc);
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
    problems.push(...checkConsistency(localText, upstreamText, verdicts));
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
