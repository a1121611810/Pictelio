/**
 * Pins the relationship between the code-review skill's upstream-override markers and the verdict
 * table that documents them.
 *
 * Why this exists. `.agents/skills/code-review/SKILL.md` is a **fork** of the upstream
 * `mattpocock/skills` code-review skill, and the fork is now *structured*: the upstream's own
 * headings are the skeleton (`<!-- upstream-section: ... -->` anchors), and every place this repo
 * deviates carries an `<!-- upstream-override: ... -->` marker whose id names a row in
 * `docs/agents/code-review-upstream.md`. The payoff is that "the upstream text was silently
 * rewritten" becomes a machine-detectable event — but only if the two sides stay in step.
 *
 * A marker with no verdict row is an edit nobody recorded a reason for. A verdict row with no
 * marker is a decision nobody landed (or one that was reverted without the record changing).
 * Either way the document claims something the file does not do.
 *
 * Expected-value sources are the two artifacts themselves, and they are independent of each other:
 * the markers come from the skill file, the rows from the baseline doc. Nothing here infers an
 * expectation from the implementation it checks.
 *
 * The network half of the same triangle (does the upstream text still match the recorded baseline?)
 * lives in `scripts/check-code-review-upstream.mjs`; it is not a test because it needs the network,
 * and a pull-request gate that depends on the network stops being a gate. What this file pins is
 * the half that must hold offline.
 *
 * Counterfactuals (the upstream gate checks the network side of the same triangle):
 *   - delete a marker from the skill file        -> "no verdict row" test goes red
 *   - add a marker whose id is not in the table  -> "no verdict row" test goes red
 *   - change a verdict's landing to `—`          -> "landing without a marker" test goes red
 *   - remove a verdict row from the table        -> "row without a marker" test goes red
 *   - inline the marker syntax into prose       -> "syntax only as a marker" test goes red
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// This file lives in packages/app-lynx/tests/, so the repo root is three levels up.
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SKILL_PATH = join(REPO_ROOT, ".agents/skills/code-review/SKILL.md");
const BASELINE_PATH = join(REPO_ROOT, "docs/agents/code-review-upstream.md");

/**
 * Read a file or fail loudly.
 *
 * A missing file must not read as an empty string: every assertion below would then pass
 * vacuously, and a guard that passes because its input vanished is not a guard.
 */
function readText(path: string, label: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (cause) {
    throw new Error(`cannot read ${label} (${path}): ${String(cause)}`);
  }
}

/** Rows of the markdown table that follows a heading, header row excluded. */
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

/** Strip the backticks a table cell may carry. */
function plain(value: string): string {
  return value.replace(/`/g, "").trim();
}

/**
 * The body of the block that carries the given upstream-section anchor.
 *
 * `String.prototype.split` with a capturing group yields [before, key1, body1, key2, body2, ...],
 * so the keys and bodies alternate and can be read off in pairs.
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
    disposition: plain(disposition),
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

describe("the code-review skill's upstream-override markers", () => {
  test("every override marker in the skill file has a verdict row", () => {
    // Vacuity guard: an extractor that stopped matching would make this loop check nothing.
    expect(
      markers.length,
      "no override marker was extracted; the guard would be vacuous",
    ).toBeGreaterThan(0);

    const known = new Set(verdicts.map((verdict) => verdict.id));
    const orphans = markers.filter((marker) => !known.has(marker));
    expect(orphans, "override markers with no verdict row").toEqual([]);
  });

  test("every verdict row with a landing has a marker, and a row without a landing has none", () => {
    // The landing column is what separates "this repo has an override for it" from "upstream has
    // something this repo deliberately does not have". A `—` landing must not carry a marker;
    // anything else must.
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

  test("every upstream-section anchor in the skill file is named by a verdict row", () => {
    // An anchor that no verdict row mentions is a block whose provenance is undocumented -- the
    // same failure mode as an unrecorded edit, one level up.
    expect(anchors.length, "no upstream-section anchor was extracted").toBeGreaterThan(0);

    const named = new Set(verdicts.flatMap((verdict) => verdict.positions));
    const undocumented = anchors.filter((anchor) => !named.has(anchor));
    expect(undocumented, "upstream-section anchors no verdict row names").toEqual([]);
  });

  test("every local-only verdict names an anchor that exists in the skill file", () => {
    // A local-only row points at a block that exists here and not upstream. If the anchor is gone,
    // the row describes a block that no longer exists. `frontmatter` is the one key that is not an
    // anchor: YAML cannot carry a marker, so the frontmatter verdict sits next to the first anchor.
    const localOnly = verdicts.filter((verdict) => verdict.disposition === "local-only");
    expect(localOnly.length, "no local-only verdict was parsed").toBeGreaterThan(0);

    const present = new Set([...anchors, "frontmatter"]);
    const missing = localOnly
      .flatMap((verdict) => verdict.positions)
      .filter((position) => !present.has(position));
    expect(missing, "local-only verdicts naming an anchor the file does not have").toEqual([]);
  });

  test("the marker syntax appears only as a real marker", () => {
    // The gate and this test both parse the file by regex. An inline mention of the syntax in
    // prose (even inside a code span) would be read as a real marker -- and would silently change
    // which block a verdict belongs to. So the count of mentions must equal the count of markers.
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

  test("a not-ported verdict does not name a block that is present here", () => {
    // Otherwise the table can pre-register a whitelist entry for a block that is still right
    // there -- which is how "an upstream block was deleted" gets laundered into "we did not
    // port it". `frontmatter` is exempt: such a row is about the frontmatter's *content*.
    const notPorted = verdicts.filter((verdict) => verdict.disposition === "not-ported");
    expect(notPorted.length, "no not-ported verdict was parsed").toBeGreaterThan(0);

    const present = new Set(anchors);
    const wrong = notPorted
      .flatMap((verdict) => verdict.positions)
      .filter((position) => position !== "frontmatter")
      .filter((position) => present.has(position));
    expect(wrong, "not-ported verdicts naming a block that is still present").toEqual([]);
  });

  test("every local-only block has a body", () => {
    // An anchor plus a marker over an empty body is a shell: the block exists on paper and its
    // content is gone. The local-only rows name the blocks, so the body can be checked offline.
    const localOnly = verdicts.filter((verdict) => verdict.disposition === "local-only");
    expect(localOnly.length, "no local-only verdict was parsed").toBeGreaterThan(0);

    for (const key of localOnly.flatMap((verdict) => verdict.positions)) {
      if (key === "frontmatter") continue;
      // The marker lines are stripped before the emptiness check: a marker is not content, and
      // counting it would let an emptied block pass.
      const body = blockBody(key).replace(/<!--\s*upstream-override:[^>]*-->/g, "");
      expect(body, `local-only block "${key}" is not an anchor in the skill file`).not.toBe("");
      expect(body.trim(), `local-only block "${key}" has an empty body`).not.toBe("");
    }
  });
});

describe("the upstream baseline record", () => {
  test("every upstream-derived file has a hex baseline commit and a local path", () => {
    // The gate parses exactly these cells: a row without a hex sha would compare against nothing.
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

  test("the baseline doc records a verdict for every upstream change it synced", () => {
    // A baseline SHA with no verdict table means "we synced" and "we decided" have been
    // conflated. The table's verdict column is the record of the decision.
    expect(baseline).toContain("裁决");
    expect(baseline).toContain("adopt");
    expect(baseline).toContain("adapt");
  });
});
