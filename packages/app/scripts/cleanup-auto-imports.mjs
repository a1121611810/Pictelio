#!/usr/bin/env node
/**
 * 清理源码中因 unplugin-auto-import 而冗余的显式 import 语句。
 *
 * 对每个 .ts/.tsx 文件，识别 import { X, Y } from "solid-js" 类语句，
 * 从花括号中移除已被 auto-import 覆盖的 API 名字，保留不在白名单中的名字。
 *
 * 运行方式: node scripts/cleanup-auto-imports.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const _root = dirname(fileURLToPath(import.meta.url));

// 递归找所有 .ts/.tsx 文件
function findFiles(dir) {
  const results = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      results.push(...findFiles(fullPath));
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (ext === ".ts" || ext === ".tsx") {
        results.push(fullPath);
      }
    }
  }
  return results;
}

const srcDir = resolve(_root, "../src");
const files = findFiles(srcDir);

// auto-import 已覆盖的 API —— 可以从 import 中安全移除
const AUTO_IMPORTED = new Set([
  // solid-js core (32)
  "createSignal",
  "createEffect",
  "createMemo",
  "createResource",
  "onMount",
  "onCleanup",
  "onError",
  "untrack",
  "batch",
  "on",
  "createRoot",
  "mergeProps",
  "splitProps",
  "useTransition",
  "observable",
  "mapArray",
  "indexArray",
  "createContext",
  "useContext",
  "children",
  "lazy",
  "createDeferred",
  "createRenderEffect",
  "createSelector",
  "For",
  "Show",
  "Switch",
  "Match",
  "Index",
  "ErrorBoundary",
  "Suspense",
  "SuspenseList",
  // solid-js/store (4)
  "createStore",
  "produce",
  "reconcile",
  "createMutable",
  // solid-js/web (8)
  "Dynamic",
  "hydrate",
  "render",
  "renderToString",
  "renderToStringAsync",
  "renderToStream",
  "isServer",
  "Portal",
  // @tanstack/solid-router (8)
  "useNavigate",
  "useRouter",
  "useParams",
  "useSearch",
  "useLocation",
  "Outlet",
  "getRouteApi",
  "RouterProvider",
]);

// 需要处理的包映射
const PACKAGES = new Map([
  ["solid-js", AUTO_IMPORTED],
  ["solid-js/store", AUTO_IMPORTED],
  ["solid-js/web", AUTO_IMPORTED],
  ["@tanstack/solid-router", AUTO_IMPORTED],
]);

let modifiedCount = 0;
let totalRemoved = 0;

for (const absPath of files) {
  let content;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    continue;
  }

  const lines = content.split("\n");
  const newLines = [];
  let changed = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 判断是否为单行 import { ... } from "..."
    const importMatch = trimmed.match(
      /^(import\s+(?:type\s+)?\{\s*)([\s\S]*?)(\}\s+from\s+["']([^"']+)["']);?$/,
    );

    if (importMatch) {
      const [, prefix, bodyRaw, , pkg] = importMatch;
      const allowList = PACKAGES.get(pkg);

      if (allowList) {
        const names = parseImportBody(bodyRaw);
        const kept = names.filter((n) => !allowList.has(n.name));
        const removed = names.filter((n) => allowList.has(n.name));

        if (removed.length > 0) {
          totalRemoved += removed.length;

          if (kept.length === 0) {
            changed = true;
            i++;
            continue;
          }

          const newImport = rebuildImport(kept, pkg);
          newLines.push(newImport);
          changed = true;
          i++;
          continue;
        }
      }
    } else {
      // 多行 import 检测：行以 "import {" 开头，但不包含 "} from"
      const multiStartMatch = trimmed.match(/^(import\s+(?:type\s+)?\{\s*)([\s\S]*)$/);
      if (multiStartMatch && !trimmed.includes("} from")) {
        const [, prefix, firstBody] = multiStartMatch;
        const bodyParts = [firstBody];
        let j = i + 1;
        let foundEnd = false;

        while (j < lines.length) {
          const nextLine = lines[j].trim();
          const endMatch = nextLine.match(/^([\s\S]*?)\}\s+from\s+["']([^"']+)["']\)?;?$/);
          if (endMatch) {
            bodyParts.push(endMatch[1]);
            const [, , pkg] = endMatch;
            const allowList = PACKAGES.get(pkg);

            let handled = false;
            if (allowList) {
              const fullBody = bodyParts.join(" ");
              const names = parseImportBody(fullBody);
              const kept = names.filter((n) => !allowList.has(n.name));
              const removed = names.filter((n) => allowList.has(n.name));

              if (removed.length > 0) {
                totalRemoved += removed.length;
                handled = true;
                changed = true;

                if (kept.length === 0) {
                  // 全部被移除，跳过所有行
                  i = j + 1;
                  foundEnd = true;
                  break;
                }

                const newImport = rebuildImport(kept, pkg);
                newLines.push(newImport);
                i = j + 1;
                foundEnd = true;
                break;
              }
            }

            if (!handled) {
              // 不需要修改，原样保留所有行
              for (let k = i; k <= j; k++) {
                newLines.push(lines[k]);
              }
              i = j + 1;
              foundEnd = true;
              break;
            }
          }
          bodyParts.push(nextLine);
          j++;
        }

        if (!foundEnd) {
          newLines.push(line);
          i++;
        }
        continue;
      }
    }

    newLines.push(line);
    i++;
  }

  if (changed) {
    writeFileSync(absPath, newLines.join("\n"), "utf-8");
    modifiedCount++;
    const displayPath = absPath.startsWith(srcDir) ? "src" + absPath.slice(srcDir.length) : absPath;
    process.stdout.write(`✓ ${displayPath}\n`);
  }
}

process.stdout.write(
  `\n完成: ${modifiedCount} 个文件被修改, 移除了 ${totalRemoved} 个冗余 import\n`,
);

// --- 辅助函数 ---

function parseImportBody(body) {
  const items = [];
  const parts = body.split(",");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const typeMatch = trimmed.match(/^(type\s+)?(.+)$/);
    if (typeMatch) {
      items.push({
        typeModifier: !!typeMatch[1],
        name: typeMatch[2].trim(),
      });
    }
  }
  return items;
}

function rebuildImport(kept, pkg) {
  const allType = kept.length > 0 && kept.every((n) => n.typeModifier);

  if (allType) {
    return `import type { ${kept.map((n) => n.name).join(", ")} } from "${pkg}";`;
  }

  const typeNames = kept.filter((n) => n.typeModifier).map((n) => n.name);
  const valueNames = kept.filter((n) => !n.typeModifier).map((n) => n.name);
  const parts = [];
  for (const n of valueNames) parts.push(n);
  for (const n of typeNames) parts.push(`type ${n}`);
  return `import { ${parts.join(", ")} } from "${pkg}";`;
}
