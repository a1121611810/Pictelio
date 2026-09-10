import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * 页面风格移除的静态防线（ADR-0148 / ADR-0097）。
 *
 * `page_style_theme` 设置与 `--pageCard*` 令牌族已整体删除并固定为 `fluent`。
 * 这些标识只存在于 CSS 自定义属性与运行时 class，TypeScript 拦不住回流，
 * 故用静态扫描兜底：任何人重新引入即红灯。
 *
 * 期望值来源：`docs/specs/remove-page-style-setting.md` §6 验收标准
 * 「packages/app/src 与 uno.config.ts 内零 page-card / page_style_theme / pageStyle / --pageCard 引用」。
 */

// ── 路径（相对本测试文件：packages/app/tests/unit/styles/） ──
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SRC_DIR = path.join(appDir, "src");
const EXTRA_FILES = [path.join(appDir, "uno.config.ts"), path.join(appDir, "index.html")];

const FORBIDDEN = [
  "--pageCard",
  "page-card",
  "page_style_theme",
  "pageStyleTheme",
  "PageStyleThemeId",
  "PAGE_STYLE_THEME_IDS",
  "applyPageStyleClass",
];

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

describe("页面风格移除静态防线", () => {
  it("源码与配置中不再出现已删除的页面风格标识", () => {
    const offenders: string[] = [];
    for (const file of [...listFiles(SRC_DIR), ...EXTRA_FILES]) {
      const text = readFileSync(file, "utf8");
      for (const needle of FORBIDDEN) {
        if (text.includes(needle)) {
          offenders.push(`${path.relative(appDir, file)}: ${needle}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
