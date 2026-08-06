#!/usr/bin/env node
// @ts-check
/**
 * check-props-setter-mapping.mjs
 * 构建期校验脚本：确认 Release 构建产出的 mapping.txt 中，所有形如 X$$PropsSetter
 * 的 Lynx 注解生成类条目都保留了 <init> 构造函数。
 *
 * 背景：Lynx SDK 运行时通过反射 Class.newInstance() 实例化这些 $$PropsSetter 类
 * 来更新 UI 属性；R8 优化会移除静态分析看不到反射调用的无参构造器，导致真机切换
 * 引擎后每帧抛 InstantiationException（error 990200）白屏。keep 规则已写入
 * android/app/proguard-rules.pro，本脚本在构建后兜底校验，防止回归。
 *
 * 用法：
 *   node check-props-setter-mapping.mjs [mapping.txt 路径]
 *   node check-props-setter-mapping.mjs --mapping=<路径>
 *
 * 默认读取 android/app/build/outputs/mapping/fullRelease/mapping.txt（相对本文件
 * 所在 packages/app 根）。CLI 参数可覆盖：绝对路径直接使用，相对路径相对当前
 * 工作目录解析。
 *
 * 退出码：0 = 校验通过；1 = mapping 缺失/读取失败/存在缺 <init> 的类。
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const APP_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_MAPPING = resolve(
  APP_ROOT,
  "android",
  "app",
  "build",
  "outputs",
  "mapping",
  "fullRelease",
  "mapping.txt",
);

const HELP = `check-props-setter-mapping.mjs — 校验 Release mapping.txt 中 $$PropsSetter 类保留 <init>

用法：
  node check-props-setter-mapping.mjs [mapping.txt 路径]
  node check-props-setter-mapping.mjs --mapping=<路径>

默认路径：android/app/build/outputs/mapping/fullRelease/mapping.txt（相对 packages/app）
退出码：0 = 通过；1 = 校验失败（缺失 mapping、读取失败或缺 <init> 的类）`;

// 目标类名后缀：$$PropsSetter / $$PropsHolder（如 UIView$$PropsSetter，keep 规则同覆盖）
const TARGET_SUFFIX_RE = /\$\$(PropsSetter|PropsHolder)$/;
// 构造函数成员行：如 "1:1:void <init>():4:4" 或 "void <init>()"
const INIT_RE = /<init>/;

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    return { help: true };
  }
  const mappingArg = args.find((a) => a.startsWith("--mapping="))?.slice("--mapping=".length);
  const positional = args.find((a) => !a.startsWith("-"));
  const raw = mappingArg ?? positional;
  if (!raw) {
    return { mapping: DEFAULT_MAPPING };
  }
  return { mapping: isAbsolute(raw) ? raw : resolve(process.cwd(), raw) };
}

/**
 * 解析 mapping.txt：类条目头形如 "原类名 -> 混淆名:"（行首无缩进），
 * 其下缩进行的成员行归属该类。返回 Map<类名, { className, members }>。
 */
function parseMapping(text) {
  const classes = new Map();
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "" || line.trim().startsWith("#")) {
      // 跳过空行与 R8 元数据注释行（如非缩进的 # {"id":"sourceFile",...}、
      // 缩进的 # {"id":"com.android.tools.r8.residualsignature",...}），
      // 否则非缩进注释行会错误切断当前类与其成员的归属。
      continue;
    }
    if (/^\s/.test(line)) {
      // 缩进行 = 当前类的成员
      if (current) {
        current.members.push(line.trim());
      }
      continue;
    }
    const m = line.match(/^([^\s].*?) -> [^\s:]+:$/);
    if (m) {
      const className = m[1].trim();
      current = { className, members: [] };
      classes.set(className, current);
      continue;
    }
    // 其它不可识别的非缩进行，切断当前类归属
    current = null;
  }
  return classes;
}

function main() {
  const { help, mapping } = parseArgs(process.argv);
  if (help) {
    console.log(HELP);
    process.exit(0);
  }

  if (!existsSync(mapping)) {
    console.error(`[check-props-setter-mapping] 未找到 mapping.txt：${mapping}`);
    console.error("  请先执行 Release 构建（如 ./gradlew assembleFullRelease）后再运行本脚本，");
    console.error(
      "  或通过 CLI 参数指定其它 mapping 路径（node check-props-setter-mapping.mjs <路径>）。",
    );
    process.exit(1);
  }

  let text;
  try {
    text = readFileSync(mapping, "utf-8");
  } catch (err) {
    console.error(`[check-props-setter-mapping] 读取 mapping.txt 失败：${err.message}`);
    process.exit(1);
  }

  const classes = parseMapping(text);
  const targets = [...classes.values()].filter((c) => TARGET_SUFFIX_RE.test(c.className));
  const missing = targets.filter((c) => !c.members.some((member) => INIT_RE.test(member)));

  if (missing.length > 0) {
    console.error(
      `[check-props-setter-mapping] 校验失败：${missing.length} 个 $$PropsSetter/$$PropsHolder 类缺少 <init> 构造函数：`,
    );
    for (const c of missing) {
      console.error(`  - ${c.className}`);
    }
    console.error(
      "  这些类在 Release 下经反射实例化会抛 InstantiationException（真机白屏 error 990200），",
    );
    console.error(
      "  请检查 android/app/proguard-rules.pro 中 $$PropsSetter / $$PropsHolder 的 keep 规则。",
    );
    process.exit(1);
  }

  console.log(
    `[check-props-setter-mapping] 通过：mapping.txt 中 ${targets.length} 个 $$PropsSetter/$$PropsHolder 类均保留 <init> 构造函数。`,
  );
  console.log(`  mapping: ${mapping}`);
  process.exit(0);
}

void main();
