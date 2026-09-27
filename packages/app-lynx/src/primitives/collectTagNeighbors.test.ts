// ─── 标签近邻编排内核单测（spec §Testing Decisions 的 12 条断言）───
// oracle：packages/app-lynx/docs/specs/tag-neighbors.md §Testing Decisions 表
//        + docs/adr/ADR-0197-app-lynx-tag-neighbors.md D2~D10
//
// 取证纪律（AGENTS.md 测试硬约束 #2「契约测试必须使用真实样例」）：
//   - 凡涉及接口响应形状的 fixture，均标注一手抓取来源，**不手写自洽字段**；
//     抓取脚本 `docs/research/verify-tag-neighbors-api.sh` 可复跑对照。
//   - 凡涉及数学期望的 fixture，oracle 写 Jaccard 的集合定义，不从实现反推。
//
// 断言只针对**外部可观察行为**：产出什么、依赖被调用几次、传了什么参数。
// 不测私有函数、不测内部变量命名形状（spec §什么算好测试）。
import { describe, it, expect } from "vitest"
import {
  collectTagNeighbors,
  jaccardTagSimilarity,
  PHASE1_CANDIDATE_CAP,
  PHASE1_MAX_RESULTS,
  PHASE1_MIN_SCORE,
  PHASE1_MAX_REQUESTS,
  PHASE2_ENOUGH,
  SEARCH_PAGE_SIZE,
  type NeighborIllustLike,
  type NeighborPage,
  type TagNeighborDeps,
} from "./collectTagNeighbors"

type T = NeighborIllustLike & { title?: string }

function mk(id: number, tags: string[], opts: { date?: string; x?: number } = {}): T {
  return {
    id,
    tags: tags.map((name) => ({ name })),
    create_date: opts.date ?? "2026-01-01T00:00:00",
    x_restrict: opts.x ?? 0,
  }
}

/** 记录调用轨迹的假 deps：作者页按脚本喂，全站检索按层脚本喂 */
function makeDeps(over: {
  authorPages?: NeighborPage<T>[]
  searchPages?: (layer: string[]) => NeighborPage<T>
  isRestricted?: (i: T) => boolean
} = {}) {
  const authorCalls: (string | null)[] = []
  const searchCalls: string[][] = []
  const deps: TagNeighborDeps<T> = {
    fetchUserIllustsPage: async (cursor) => {
      authorCalls.push(cursor)
      const pages = over.authorPages ?? []
      const idx = cursor === null ? 0 : Number(cursor.replace("cur:", ""))
      return pages[idx] ?? { illusts: [], next_url: null }
    },
    searchIllustByTags: async (tags) => {
      searchCalls.push([...tags])
      return over.searchPages ? over.searchPages(tags) : { illusts: [], next_url: null }
    },
    isRestricted: over.isRestricted ?? (() => false),
  }
  return { deps, authorCalls, searchCalls }
}

/** 源作品标签序列 = 一手抓取的真实原序（作者 120290822 的首条作品，2026-09-27） */
const REAL_TAG_ORDER = [
  "GenshinImpact",
  "原神",
  "コロンビーナ(原神)",
  "Columbina",
  "サンドローネ(原神)",
]

describe("1 · Jaccard 正确性且对集合规模不敏感", () => {
  it("完全相同 = 1、无交集 = 0、部分重叠 = |共同|/|并集|", () => {
    // oracle：Jaccard(A,B) = |A∩B| / |A∪B|（集合定义，ADR-0197 D4）
    expect(jaccardTagSimilarity(["a", "b", "c"], ["a", "b", "c"]).score).toBe(1)
    expect(jaccardTagSimilarity(["a", "b"], ["c", "d"]).score).toBe(0)
    // 交集 {a,b}=2，并集 {a,b,c,d}=4 → 2/4
    expect(jaccardTagSimilarity(["a", "b", "c"], ["a", "b", "d"]).score).toBe(0.5)
  })

  it("共同标签数相同的两个候选，Jaccard 让更紧凑的那个胜出（规模不敏感）", () => {
    const source = ["t1", "t2", "t3", "t4"]
    // 两个候选的共同标签数**同为 1**——「共同标签数」口径无法区分，Jaccard 可以
    const tight = ["t1"]
    const bloated = ["t1", "x1", "x2", "x3", "x4", "x5", "x6", "x7"]
    const a = jaccardTagSimilarity(source, tight)
    const b = jaccardTagSimilarity(source, bloated)
    expect(a.common).toBe(b.common) // 前置：共同数确实相同
    expect(a.score).toBeGreaterThan(b.score) // 1/4 > 1/11
  })

  it("空输入不产出 NaN（NaN 会让所有比较为 false，是最坏的失败形态）", () => {
    expect(jaccardTagSimilarity([], []).score).toBe(0)
    expect(jaccardTagSimilarity(["a"], []).score).toBe(0)
  })
})

describe("2 · 阶段 1 候选上限 300", () => {
  const pageOf = (n: number, startId: number, next: string | null): NeighborPage<T> => ({
    illusts: Array.from({ length: n }, (_, i) => mk(startId + i, ["t1", "t2", "t3"])),
    next_url: next,
  })

  it("超过 300 时不多拉", async () => {
    // 页大小取真实值 30（实测 /v1/user/illusts 固定 30/页）
    const pages = Array.from({ length: 20 }, (_, i) => pageOf(30, i * 30 + 1000, `cur:${i + 1}`))
    const { deps, authorCalls } = makeDeps({ authorPages: pages })
    await collectTagNeighbors({
      source: mk(1, ["t1", "t2"]),
      authorId: 9,
      deps,
    })
    // 10 页 × 30 = 300 即止，不得再发第 11 次
    expect(authorCalls).toHaveLength(PHASE1_CANDIDATE_CAP / 30)
    expect(PHASE1_CANDIDATE_CAP).toBe(300)
  })

  it("恰好 300 时不多拉（next_url 仍存在也不继续）", async () => {
    const pages = Array.from({ length: 20 }, (_, i) => pageOf(30, i * 30 + 1000, `cur:${i + 1}`))
    const { deps, authorCalls } = makeDeps({ authorPages: pages })
    const r = await collectTagNeighbors({ source: mk(1, ["t1", "t2"]), authorId: 9, deps })
    expect(authorCalls).toHaveLength(10)
    // 池恰好 300，且 300 条里只有 20 条进结果（D5 上限）
    expect(r.entries.length).toBe(PHASE1_MAX_RESULTS)
  })

  it("不足时拉完（next_url 为 null 即止）", async () => {
    const pages = [pageOf(30, 1000, "cur:1"), pageOf(30, 1030, "cur:2"), pageOf(20, 1060, null)]
    const { deps, authorCalls } = makeDeps({ authorPages: pages })
    await collectTagNeighbors({ source: mk(1, ["t1", "t2"]), authorId: 9, deps })
    expect(authorCalls).toEqual([null, "cur:1", "cur:2"])
  })
})

describe("3 · 阶段 1 足量时阶段 2 一次都不触发", () => {
  it("产出 ≥5 条 → searchIllustByTags 从未被调用", async () => {
    const illusts = Array.from({ length: 6 }, (_, i) => mk(2000 + i, ["t1", "t2"]))
    const { deps, searchCalls } = makeDeps({
      authorPages: [{ illusts, next_url: null }],
      searchPages: () => {
        throw new Error("不应被调用")
      },
    })
    const r = await collectTagNeighbors({ source: mk(1, ["t1", "t2"]), authorId: 9, deps })
    expect(searchCalls).toHaveLength(0)
    expect(r.entries.length).toBe(6)
    expect(r.phase2Ran).toBe(false)
  })
})

describe("4 · 阶段 2 逐层放宽", () => {
  it("调用序列断言为 n → n-1 → …，每层只用一组标签", async () => {
    const { deps, searchCalls } = makeDeps({
      authorPages: [{ illusts: [], next_url: null }],
      searchPages: () => ({ illusts: [], next_url: null }), // 恒空 → 永不满足「够数」→ 跑满
    })
    await collectTagNeighbors({ source: mk(1, REAL_TAG_ORDER), authorId: 9, deps })
    expect(searchCalls).toEqual([
      REAL_TAG_ORDER,
      REAL_TAG_ORDER.slice(0, 4),
      REAL_TAG_ORDER.slice(0, 3),
      REAL_TAG_ORDER.slice(0, 2),
      REAL_TAG_ORDER.slice(0, 1),
    ])
  })
})

describe("5 · 终止条件的前提（ADR-0197 §更正记录 1）", () => {
  it("不变式：页大小 > 阈值（D6 判据成立的前提）", () => {
    // 判据 enough = len(illusts) >= 5 只在「满页恒 30 且不足一页即到底」时可靠
    expect(SEARCH_PAGE_SIZE).toBe(30)
    expect(SEARCH_PAGE_SIZE).toBeGreaterThan(PHASE2_ENOUGH)
  })

  it("一手真实样本：不足一页时 next_url 为 null，故本页即全量 → 仍继续放宽", async () => {
    // fixture 形状来自 2026-09-27 一手抓取：word=ホビィ → 本页 4 条、next_url=null
    // （而 word=原神 → 30 条满页、next_url=SET）。见 verify-tag-neighbors-api.sh
    const realShape: NeighborPage<T> = {
      illusts: Array.from({ length: 4 }, (_, i) => mk(3000 + i, ["ホビィ"])),
      next_url: null,
    }
    const { deps, searchCalls } = makeDeps({
      authorPages: [{ illusts: [], next_url: null }],
      searchPages: (layer) => (searchCalls.length === 0 ? realShape : { illusts: [], next_url: null }),
    })
    await collectTagNeighbors({ source: mk(1, ["a", "b", "c"]), authorId: 9, deps })
    // 第 1 层只有 4 条（<5）→ 必须继续放宽到第 2 层
    expect(searchCalls).toHaveLength(3)
    expect(searchCalls[0]).toEqual(["a", "b", "c"])
  })

  it("满页（30 条）必然 ≥5 → 立即停", async () => {
    const { deps, searchCalls } = makeDeps({
      authorPages: [{ illusts: [], next_url: null }],
      searchPages: () => ({
        illusts: Array.from({ length: SEARCH_PAGE_SIZE }, (_, i) => mk(4000 + i, ["a"])),
        next_url: "https://next",
      }),
    })
    await collectTagNeighbors({ source: mk(1, ["a", "b", "c"]), authorId: 9, deps })
    expect(searchCalls).toHaveLength(1)
  })
})

describe("6 · 够数即停", () => {
  it("某层达到阈值即停，不多发下一次请求", async () => {
    const { deps, searchCalls } = makeDeps({
      authorPages: [{ illusts: [], next_url: null }],
      searchPages: () => ({ illusts: Array.from({ length: 5 }, (_, i) => mk(5000 + i, ["a"])), next_url: null }),
    })
    const r = await collectTagNeighbors({ source: mk(1, ["a", "b", "c"]), authorId: 9, deps })
    expect(searchCalls).toHaveLength(1)
    expect(r.phase2Ran).toBe(true)
    expect(r.phase2LastLayer).toEqual(["a", "b", "c"])
  })
})

describe("7 · 标签序列保持接口原序", () => {
  it("放宽时收掉的是原始顺序的尾部（不重排）", async () => {
    const { deps, searchCalls } = makeDeps({
      authorPages: [{ illusts: [], next_url: null }],
      searchPages: () => ({ illusts: [], next_url: null }),
    })
    await collectTagNeighbors({ source: mk(1, REAL_TAG_ORDER), authorId: 9, deps })
    // 第 2 层 = 去掉**原序尾部**的关联度最低项，而不是按字典序/长度重排后的任何序列
    expect(searchCalls[1]).toEqual(REAL_TAG_ORDER.slice(0, 4))
    expect(searchCalls[1][searchCalls[1].length - 1]).toBe(REAL_TAG_ORDER[3])
  })
})

describe("8 · 跨阶段去重 + 排除自身", () => {
  it("同一 id 被两阶段命中只出现一次，源作品自身不出现", async () => {
    const dup = mk(6000, ["t1", "t2"])
    const { deps } = makeDeps({
      // 阶段 1 池含自身 + dup
      authorPages: [{ illusts: [mk(1, ["t1", "t2"]), dup], next_url: null }],
      // 阶段 2 又命中 dup（不同来源应只保留首次出现的条目）
      searchPages: () => ({ illusts: [dup, mk(6001, ["t1", "t2"])], next_url: null }),
    })
    const r = await collectTagNeighbors({ source: mk(1, ["t1", "t2"]), authorId: 9, deps })
    const ids = r.entries.map((e) => e.illust.id)
    expect(ids).not.toContain(1) // 排除自身
    expect(ids.filter((id) => id === 6000)).toHaveLength(1) // 跨阶段去重
    expect(new Set(ids).size).toBe(ids.length) // 全局无重复
  })
})

describe("9 · 相似度门槛 30% 与条数上限 20", () => {
  it("0.3 边界含在内、低分排除、超 20 条截断", async () => {
    const source10 = Array.from({ length: 10 }, (_, i) => `s${i}`)
    // 3/10 交集 → Jaccard 恰为 0.3（边界应含在内）
    const at30 = Array.from({ length: 25 }, (_, i) => mk(7000 + i, source10.slice(0, 3)))
    // 2/10 交集 → 0.2（低于门槛）
    const below = Array.from({ length: 25 }, (_, i) => mk(8000 + i, source10.slice(0, 2)))
    const { deps, searchCalls } = makeDeps({
      authorPages: [{ illusts: [...at30, ...below], next_url: null }],
    })
    const r = await collectTagNeighbors({ source: mk(1, source10), authorId: 9, deps })
    expect(PHASE1_MIN_SCORE).toBe(0.3)
    expect(r.entries).toHaveLength(PHASE1_MAX_RESULTS) // 20
    expect(r.entries.every((e) => e.score >= 0.3)).toBe(true)
    expect(r.entries.some((e) => e.illust.id >= 8000)).toBe(false) // 低分一条都不进
    expect(searchCalls).toHaveLength(0) // 20 ≥5 → 阶段 2 不触发
  })
})

describe("10 · 标签数 <2 跳过阶段 1 并产出原因", () => {
  it("只 1 个标签 → 不拉作者作品，产出 tooFewTags，且阶段 2 照跑", async () => {
    const { deps, authorCalls, searchCalls } = makeDeps({
      searchPages: () => ({ illusts: Array.from({ length: 5 }, (_, i) => mk(9000 + i, ["solo"])), next_url: null }),
    })
    const r = await collectTagNeighbors({ source: mk(1, ["solo"]), authorId: 9, deps })
    expect(authorCalls).toHaveLength(0) // 阶段 1 整个没跑
    expect(r.phase1SkippedReason).toBe("tooFewTags") // 不静默
    expect(r.phase2Ran).toBe(true)
    expect(searchCalls).toEqual([["solo"]])
  })
})

describe("11 · R18/R18G 门控经注入判定", () => {
  it("受限条目被拦下且不进入结果", async () => {
    const ok = mk(10000, ["t1", "t2"])
    const restricted = { ...mk(10001, ["t1", "t2"]), x_restrict: 1 }
    const seen: number[] = []
    const { deps } = makeDeps({
      authorPages: [{ illusts: [ok, restricted], next_url: null }],
      // 门控语义照 settingsStore.isRestricted：x_restrict===1 且用户未开 R18 即受限
      isRestricted: (i) => {
        seen.push(i.x_restrict)
        return i.x_restrict === 1
      },
    })
    const r = await collectTagNeighbors({ source: mk(1, ["t1", "t2"]), authorId: 9, deps })
    expect(seen).toContain(1) // 门控确实被调用过
    expect(r.entries.map((e) => e.illust.id)).toEqual([10000])
  })
})

describe("12 · 排序", () => {
  it("Jaccard 降序；同分按发布时间新→旧", async () => {
    const source10 = Array.from({ length: 10 }, (_, i) => `s${i}`)
    // 交集 5/10 = 0.5（更新）、5/10 = 0.5（较旧）、3/10 = 0.3（最低）
    const half_new = mk(11000, source10.slice(0, 5))
    half_new.create_date = "2026-05-01T00:00:00"
    const half_old = mk(11001, source10.slice(0, 5))
    half_old.create_date = "2026-01-01T00:00:00"
    const low = mk(11002, source10.slice(0, 3))
    const { deps } = makeDeps({
      authorPages: [{ illusts: [low, half_old, half_new], next_url: null }],
    })
    const r = await collectTagNeighbors({ source: mk(1, source10), authorId: 9, deps })
    // 0.5 新 → 0.5 旧 → 0.3
    expect(r.entries.map((e) => e.illust.id)).toEqual([11000, 11001, 11002])
  })
})

describe("降级与竞态", () => {
  it("阶段 1 失败不静默：进 failures，且仍继续阶段 2", async () => {
    const { deps } = makeDeps({
      authorPages: [],
      searchPages: () => ({ illusts: Array.from({ length: 5 }, (_, i) => mk(12000 + i, ["a"])), next_url: null }),
    })
    const broken: TagNeighborDeps<T> = {
      ...deps,
      fetchUserIllustsPage: async () => {
        throw new Error("network down")
      },
    }
    const r = await collectTagNeighbors({ source: mk(1, ["a", "b"]), authorId: 9, deps: broken })
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0].phase).toBe(1)
    expect(r.entries.length).toBe(5) // 阶段 2 仍然交付结果
  })

  it("signal 中止时向上抛（由调用方 generation-gate 吞掉陈旧响应）", async () => {
    const ac = new AbortController()
    const { deps } = makeDeps({ authorPages: [{ illusts: [], next_url: null }] })
    const aborting: TagNeighborDeps<T> = {
      ...deps,
      fetchUserIllustsPage: async () => {
        ac.abort()
        const err = new Error("aborted")
        err.name = "AbortError"
        throw err
      },
    }
    await expect(
      collectTagNeighbors({ source: mk(1, ["a", "b"]), authorId: 9, deps: aborting, signal: ac.signal }),
    ).rejects.toThrow("aborted")
  })
})

// ─── T4 / #769：阶段 2 启动回调（spec user story 14 的「正在放宽标签范围…」需要它）───
// oracle：spec user story 14 要求用户看到进行中的提示，但编排是单次 await 完成的两阶段
// 过程，宿主在结果落定前看不到任何中间态 → 内核提供 onPhase2Start 同步回调（可选注入点，
// 不提供时全部既有断言照旧）。
describe("阶段 2 启动回调（spec user story 14 / T4 #769）", () => {
  it("阶段 2 真的触发时回调恰好一次，且在首个检索请求之前到达", async () => {
    const seq: string[] = []
    const { deps, searchCalls } = makeDeps({
      authorPages: [{ illusts: [], next_url: null }],
      searchPages: () => ({ illusts: [], next_url: null }),
    })
    const withHook: TagNeighborDeps<T> = {
      ...deps,
      onPhase2Start: () => {
        seq.push("phase2Start")
        seq.push(`searchCallsSoFar=${searchCalls.length}`)
      },
    }
    await collectTagNeighbors({ source: mk(1, ["a", "b", "c"]), authorId: 9, deps: withHook })
    expect(seq).toEqual(["phase2Start", "searchCallsSoFar=0"])
  })

  it("阶段 1 足量（阶段 2 不触发）时回调一次都不该被调用", async () => {
    const illusts = Array.from({ length: 6 }, (_, i) => mk(2000 + i, ["t1", "t2"]))
    let calls = 0
    const { deps } = makeDeps({
      authorPages: [{ illusts, next_url: null }],
      searchPages: () => ({ illusts: [], next_url: null }),
    })
    const withHook: TagNeighborDeps<T> = { ...deps, onPhase2Start: () => { calls++ } }
    await collectTagNeighbors({ source: mk(1, ["t1", "t2"]), authorId: 9, deps: withHook })
    expect(calls).toBe(0)
  })

  it("不提供回调（可选注入点）时行为不变", async () => {
    const { deps, searchCalls } = makeDeps({
      authorPages: [{ illusts: [], next_url: null }],
      searchPages: () => ({ illusts: [], next_url: null }),
    })
    const r = await collectTagNeighbors({ source: mk(1, ["a", "b"]), authorId: 9, deps })
    expect(r.phase2Ran).toBe(true)
    expect(searchCalls.length).toBeGreaterThan(0)
  })
})

// ─── code-review B2 / S2 / S4 / S8 的内核级断言 ───
describe("门控计数与池内去重（code-review B2 / S2 / ADR-0197 D16）", () => {
  it("gatedCount 统计被门控拦下的条目，两阶段都计（过滤必须可见，不静默）", async () => {
    // 阶段 1：池 4 条，其中 1 条受限 → 门控后剩 3 条 < PHASE2_ENOUGH(5)，
    // 故阶段 2 也会跑（两阶段的门控都必须计数，否则本页断言无从验证阶段 2 侧）
    const pool = Array.from({ length: 3 }, (_, i) => mk(2000 + i, ["t1", "t2"]))
    pool.push({ ...mk(2999, ["t1", "t2"]), x_restrict: 1 })
    const { deps } = makeDeps({
      authorPages: [{ illusts: pool, next_url: null }],
      // 阶段 2：5 条里 2 条受限
      searchPages: () => ({
        illusts: [
          ...Array.from({ length: 3 }, (_, i) => mk(3000 + i, ["t1"])),
          { ...mk(3999, ["t1"]), x_restrict: 1 },
          { ...mk(3998, ["t1"]), x_restrict: 1 },
        ],
        next_url: null,
      }),
      isRestricted: (i) => i.x_restrict === 1,
    })
    const r = await collectTagNeighbors({ source: mk(1, ["t1", "t2"]), authorId: 9, deps })
    // 阶段 1 只入列 5 条 <5 → 阶段 2 也跑了，故两阶段门控都要计
    expect(r.gatedCount).toBe(3)
    expect(r.entries.map((e) => e.illust.id)).not.toContain(2999)
    expect(r.entries.map((e) => e.illust.id)).not.toContain(3999)
  })

  it("池内去重：同一 id 在两页重复出现只产出一条（游标翻页期间新投稿会致重复）", async () => {
    const dup = mk(4000, ["t1", "t2"])
    const { deps } = makeDeps({
      authorPages: [
        { illusts: [mk(4001, ["t1", "t2"]), dup], next_url: "cur:1" },
        { illusts: [dup, mk(4002, ["t1", "t2"])], next_url: null },
      ],
    })
    const r = await collectTagNeighbors({ source: mk(1, ["t1", "t2"]), authorId: 9, deps })
    const ids = r.entries.map((e) => e.illust.id)
    expect(ids.filter((id) => id === 4000)).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("阶段 1 翻页请求数硬闸（code-review S4：导出并钉死，不依赖其当前数值）", () => {
  it("翻页请求数不超过 PHASE1_MAX_REQUESTS（30/页下不生效，是页大小变更时的兜底）", async () => {
    expect(PHASE1_MAX_REQUESTS).toBeGreaterThan(0)
    // 造一个「每页都满且永不到底」的池：只看请求次数是否被硬闸截断
    const pages = Array.from({ length: 200 }, (_, i) => ({
      illusts: Array.from({ length: 30 }, (_, k) => mk(i * 30 + k + 1, ["t1", "t2"])),
      next_url: `cur:${i + 1}`,
    }))
    const { deps, authorCalls } = makeDeps({ authorPages: pages })
    await collectTagNeighbors({ source: mk(1, ["t1", "t2"]), authorId: 9, deps })
    expect(authorCalls.length).toBeLessThanOrEqual(PHASE1_MAX_REQUESTS)
  })
})

describe("失败层不推进 lastLayer（code-review S8：否则全层失败时谎报「已放宽到 N」）", () => {
  it("所有层都失败时 phase2LastLayer 仍为 null，而 phase2Ran / phase2Layers 如实记录", async () => {
    const { deps } = makeDeps({
      authorPages: [{ illusts: [], next_url: null }],
      searchPages: () => {
        throw new Error("network down")
      },
    })
    const r = await collectTagNeighbors({ source: mk(1, ["a", "b", "c"]), authorId: 9, deps })
    expect(r.phase2Ran).toBe(true)
    expect(r.phase2LastLayer).toBeNull()
    expect(r.phase2Layers).toHaveLength(3)
    expect(r.failures).toHaveLength(3)
    expect(r.failures.every((f) => f.phase === 2)).toBe(true)
  })
})

// ─── 终审 #1：跨相邻层的门控去重必须有测试防线 ───
// 上一条 gatedCount 用例的阶段 2 页恰为 5 条 → 命中阈值即 break，**跨层路径从未执行**，
// 于是「阶段 2 被门控条目也入 seen」这行修法删掉后 CI 仍全绿（终审 /tmp 实验实证）。
// 本用例构造**真正跨层**的场景：一条阶段 1 从未见过的受限作品，在阶段 2 的**每一层**都出现。
describe("门控计数跨相邻层去重（code-review 终审 #1）", () => {
  it("同一条受限作品在阶段 2 相邻两层各出现一次，只计一次", async () => {
    const restrictedPhase1 = { ...mk(8000, ["a", "b"]), x_restrict: 1 }
    // 关键：这条受限作品**不在阶段 1 池里**，故阶段 1 的 seen 去重管不到它，
    // 只有阶段 2 侧「门控拦下也入 seen」才能阻止跨层重复计数。
    const restrictedPhase2 = { ...mk(8200, ["a", "b"]), x_restrict: 1 }
    const { deps } = makeDeps({
      authorPages: [
        {
          illusts: [
            mk(7001, ["a", "b"]),
            mk(7002, ["a", "b"]),
            mk(7003, ["a", "b"]),
            restrictedPhase1,
          ],
          next_url: null,
        },
      ],
      // 源作品 2 个标签 → 阶段 2 恰好跑 2 层（size 2 与 size 1）；
      // 每层都返回「同一条受限作品 + 1 条正常」= 2 条 < 5，不满足终止条件，层会继续
      searchPages: (layer) => ({
        illusts: [restrictedPhase2, mk(8300 + layer.length, layer)],
        next_url: null,
      }),
      isRestricted: (i) => i.x_restrict === 1,
    })
    const r = await collectTagNeighbors({ source: mk(1, ["a", "b"]), authorId: 9, deps })
    // 前置：阶段 2 确实跑了 2 层（否则本用例区分不出修前/修后）
    expect(r.phase2Layers).toEqual([["a", "b"], ["a"]])
    // 阶段 1 计 1 次 + 阶段 2 首次命中计 1 次 = 2；若阶段 2 未跨层去重则第 2 层会再计一次 = 3
    expect(r.gatedCount).toBe(2)
    expect(r.entries.map((e) => e.illust.id)).not.toContain(8200)
  })
})
