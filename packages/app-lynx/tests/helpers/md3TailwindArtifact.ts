// ─── Tailwind 构建产物接缝（issue #849 / T01）───
//
// 为什么不用现有的文本接缝：`tests/unit.test.ts` 的「tailwind.config 契约」用
// `split('fontSize: {')[1].split('\n  }')[0]` 切源码，文件里自己写着「重构时若调整
// 键序/缩进需同步此解析，否则会静默误测」。本轮要改的正是被切的那一段 ⇒ 文本接缝
// 会与被测改动同生共死：改坏了它也一起坏，改好了它也一起好，判别力归零。
//
// 本接缝改为对**构建产物**断言：加载项目真实的 `tailwind.config.ts`（TS 模块直接
// import，拿的是求值后的对象，不是源码字符串），走 Tailwind 自己的 postcss 插件
// 生成 CSS，再从 **postcss AST**（不是正则）取声明。配置文件怎么改键序、怎么换写法、
// 拆成几个文件都不影响这条接缝。
//
// 为什么不 spawn `tailwindcss` CLI：CLI 每次起进程 + 重新做 TS 配置加载，秒级预算
// 紧张且拿不到 AST；JS API 走的是同一条编译管线（同 preset、同插件、同 content
// 扫描器），只是省掉了进程与 stdout 解析。用 JS API 的附带好处：产物里出现
// `@media` / `:hover` 等变体规则时可以直接按选择器取，不必做文本切割。
//
// Oracle 纪律：期望值要么取自项目令牌 / ADR 的结构承诺，要么写成「结构必须存在」，
// **不得**把「当前值」抄成期望 —— T05~T09 会合法地改对这些值，写死当前值会让接缝
// 变成阻塞而不是护栏。
import { createRequire } from 'node:module'
import tailwindcss from 'tailwindcss'
import type { Config } from 'tailwindcss'

import projectConfig from '../../tailwind.config'

/**
 * postcss 不在本包依赖里（只作为 tailwindcss 的传递依赖存在于 pnpm store），
 * 而 `postcss` 的类型同样解析不到 —— 故此处按「用到的最小结构面」本地声明，
 * 不向仓库引入新的依赖或 `@types` 缺口。
 */
interface DeclarationLike {
  prop: string
  value: string
}
interface RuleLike {
  selector: string
  nodes: DeclarationLike[]
}
interface RootLike {
  walkRules: (visit: (rule: RuleLike) => void) => void
}
interface ProcessResultLike {
  css: string
  root: RootLike
}
interface PostcssLike {
  (plugins: unknown[]): {
    process: (css: string, opts?: { from?: string }) => Promise<ProcessResultLike>
  }
}

/**
 * 从 tailwindcss 已解析的入口反查它自己的 postcss 副本。
 * 锚在 tailwind 的目录上（而不是本包的 node_modules），才能在 pnpm 严格布局下
 * 解析到与 tailwind 同一份 postcss 实例。
 */
function loadPostcss(): PostcssLike {
  const nodeRequire = createRequire(import.meta.url)
  const tailwindRequire = createRequire(nodeRequire.resolve('tailwindcss'))
  return tailwindRequire('postcss') as PostcssLike
}

/** 一条选择器上的声明；值为空串表示该选择器不存在 */
export type DeclarationBlock = Record<string, string>

export interface TailwindArtifact {
  /** 完整 CSS 产物（调试/反事实取证用） */
  readonly css: string
  /** 选择器 → 声明块。同一选择器多次出现时后者覆盖前者（与 CSS 层叠顺序一致） */
  readonly rules: ReadonlyMap<string, DeclarationBlock>
  /** 产物里的规则总数（选择器去重后），用于「抽取器自身有效」的数量下界 */
  readonly ruleCount: number
  /** 本次实际送进 content 扫描器的 class 名（测试自证扫的不是空气） */
  readonly probedClasses: readonly string[]
}

/** Tailwind 的类名转义规则：仅 `[A-Za-z0-9_-]` 免转义，其余前加反斜杠 */
function escapeClassName(name: string): string {
  return name.replace(/([^A-Za-z0-9_-])/g, '\\$1')
}

/** 裸类名（无变体）→ CSS 选择器。含 `:` 的名字请改用 `ruleForSelector` 显式给选择器 */
export function classSelector(className: string): string {
  return `.${escapeClassName(className)}`
}

/**
 * 取真实配置对象（磁盘上的 tailwind.config.ts 的求值结果，非源码文本）。
 * 供调用方做**局部覆盖**用（反事实自检：换掉 fontSize 映射看产物怎么变），
 * 全程不写磁盘 —— 配置的改动权归 T05~T09，本接缝只读。
 */
export function projectTailwindConfig(): Config {
  return projectConfig
}

/**
 * content 来源。
 *   `synthetic`（默认）= 把 `classNames` 包成一份合成 raw，**不扫 src/**：秒级、产物只含
 *     探针类名，判定确定。适合「这个档位在配置里登记了吗」。
 *   `project` = 沿用 `tailwind.config.ts` 的真实 content 扫描器，**打真实 `src/`**：
 *     适合「这个类名在真实组件里被写出来后，产物真的有规则吗」—— 死类名类缺陷
 *     （代码里写了 utility、配置里没登记 ⇒ 产物零规则且静默）只有这条路径能证伪。
 *     `classNames` 此时的唯一作用是错误信息里回显「本用例关注哪些类名」。
 */
export type ArtifactContentSource = 'synthetic' | 'project'

/**
 * 用真实配置生成 utilities 产物。
 * @param classNames 要探针的 class 名（`content: 'synthetic'` 时会被包成合成 content）
 * @param overrides 配置覆盖口（默认只换 content），供后续票在同一条接缝上换档位/换内容
 * @param contentSource 打合成 content（默认）还是打真实 `src/`
 */
export async function buildTailwindArtifact(
  classNames: readonly string[],
  overrides: Partial<Config> = {},
  contentSource: ArtifactContentSource = 'synthetic',
): Promise<TailwindArtifact> {
  const postcss = loadPostcss()
  // content 换成合成 raw：① 秒级（不扫 100+ .vue）② 产物只含探针类名，判定确定
  // `contentSource: 'project'` 时**不换**，让真实 content 扫描器生效（死类名类缺陷的证伪路径）
  const config: Config = {
    ...projectConfig,
    ...overrides,
    content:
      contentSource === 'project'
        ? projectConfig.content
        : [{ raw: `<div class="${classNames.join(' ')}"></div>`, extension: 'html' }],
  }
  const result = await postcss([tailwindcss(config)]).process('@tailwind utilities;\n', {
    from: undefined,
  })

  const rules = new Map<string, DeclarationBlock>()
  // postcss 自己的 AST：选择器列表（Tailwind 会把声明相同的 utility 合并成逗号并列）
  // 必须拆开，否则 `.a, .b { }` 只会挂在第一个名字上
  result.root.walkRules((rule) => {
    for (const selector of rule.selector.split(',').map((s) => s.trim())) {
      if (!selector) continue
      const declarations: DeclarationBlock = { ...rules.get(selector) }
      for (const node of rule.nodes) declarations[node.prop] = node.value
      rules.set(selector, declarations)
    }
  })

  return {
    css: result.css,
    rules,
    ruleCount: rules.size,
    probedClasses: classNames,
  }
}

/**
 * 按 class 名取声明块。**找不到就抛**（返回 `{}` 会让下游 `toBeUndefined` / `in` 类断言
 * 静默恒真 —— 本仓抽取器纪律的核心就是不让空集合冒充通过）。
 */
export function declarationsForClass(
  artifact: TailwindArtifact,
  className: string,
): DeclarationBlock {
  const selector = classSelector(className)
  const found = artifact.rules.get(selector)
  if (!found) {
    throw new Error(
      `产物里没有 ${selector} 的规则（探针类名：${artifact.probedClasses.join(' ') || '（空）'}）`,
    )
  }
  return found
}

/** 按 class 名取声明，取不到返回 undefined（用于否定断言：「某档位不存在」） */
export function tryDeclarationsForClass(
  artifact: TailwindArtifact,
  className: string,
): DeclarationBlock | undefined {
  return artifact.rules.get(classSelector(className))
}

/** 按完整选择器取声明块（如 `.hover\\:rounded-lg:hover`）；取不到返回 undefined */
export function ruleForSelector(
  artifact: TailwindArtifact,
  selector: string,
): DeclarationBlock | undefined {
  return artifact.rules.get(selector)
}

/** 产物的声明总条数（用于「抽取器自身有效」的数量下界） */
export function totalDeclarationCount(artifact: TailwindArtifact): number {
  let total = 0
  for (const declarations of artifact.rules.values()) total += Object.keys(declarations).length
  return total
}

/**
 * 取 CSS 值里所有「数字 + 单位」对上的单位（`1.5rem` → `['rem']`、`4.267vw` → `['vw']`）。
 *
 * 刻意**不用** `/\brem\b/` 这类子串/词界匹配：`1.5rem` 的 `r` 前面是 `5`（词字符），
 * 词界根本不成立 ⇒ 那条正则永远匹配不到、断言恒绿。
 * 这正是差距分析 §8.5 记的教训（「正则只匹配了一种形态就下了全称结论」）。
 */
const NUMBER_WITH_UNIT = /\d*\.?\d+([a-z%]+)/gi

export function unitsOf(value: string): string[] {
  return [...value.matchAll(NUMBER_WITH_UNIT)].map((m) => m[1]!.toLowerCase())
}
