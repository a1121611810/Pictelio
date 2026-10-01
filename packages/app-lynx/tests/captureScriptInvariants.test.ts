/**
 *
 * ## ⛔ 本文件已**冻结**（第二十二轮；依据 AGENTS.md「门禁冻结线」）
 *
 * 它一度长到被测脚本的 **46%**，而连续二十三轮只产出 **1 个真实产品缺陷**、
 * 门禁自身缺陷 **20+ 个**。按新的规模线（30%）应停止加码。
 *
 * **保留**（确实挡住过东西）：`fnBody` 花括号深度扫描（防静默截断）、措辞一致性门禁、
 * `ensure_session` 逐块核对。
 *
 * **已知失效面**（第二十轮双轴复核 14 条中的 5 条未闭；**不假装已覆盖**）：
 *  - `pick()` 认的是夹具打的标签，被测块自己 `echo` 同形标签**可能**顶替。
 *    已加 NONCE 缓解，但该缓解**未经有效变异验证**（两次尝试的变异都作废）。
 *  - `blocks[0].indexOf('fi')` 是**子串匹配**，良性措辞编辑会误伤。
 *  - 措辞门禁只覆盖 `ensure_session` 的**第一块**。
 *  - 行为断言的 `low`（12.91 / 200）从不与阈值比对，「低读数」是**装饰名**。
 *  - `awk -v` 会解释转义而 `grep -F` 不会，两者**可证发散**（方向假红，当前无命中）。
 *
 * 续做前先读 `AGENTS.md`「门禁冻结线」与 `docs/research/md3-visual-regression-2026-09.md` §8.8。
 * 不要在没有**外部复核**的情况下往里加检测器。
 *
 * `capture-md3-matrix.sh` 的**静态契约门禁**（S-6）。
 *
 * ## 为什么这个脚本需要一道门禁，而它又为什么只能「静态」
 *
 * 它是整个矩阵的**唯一编排者**：导航、切色板、切明暗、续采、退出码全在它里面。
 * 本轮 7 项整改大半落在它身上，而 B-1（`dbg_lazy` 假惰性）就是这么漏出去的 ——
 * 注释写着「已惰性」，代码里 `$(…)` 仍在调用点展开，**真机跑一遍是绿的**。
 *
 * 另外四支门禁（findUiBand / findWideSolid / findPaletteSwatches / scriptExitCodes）
 * 都在测 **python 探针的判据**，对 bash 编排层**零覆盖**。真跑这个脚本要真机 +
 * 十几分钟，CI 里没有。所以这里退一步：不测它的**行为**，测它的**不变量** ——
 * 凡是「写错了当场看不出来、且真机上只是变慢或变哑」的不变量，都钉死。
 *
 * 每条不变量都对应本轮**真实发生过**的缺陷或已知静默失效面，不是凭空挑的：
 *
 * | # | 不变量 | 对应的真实事故 |
 * |---|---|---|
 * | 1 | `dbg_lazy` 的**调用点**不得含 `$(…)` / 反引号 | B-1：实测零节省，调试开关等于摆设 |
 * | 2 | `shot()` 必须在 `screencap` **之后**调 `on_app_page` | §8.5：登录页冒充 Feed 存盘并计数 |
 * | 3 | `resume_reason()` 也必须验身份 | 只验「有内容」会把上一轮的空白页当成功 |
 * | 4 | 内容页明暗判据量 `MODE_BAND`（**顶栏中段**），不是整屏、更不是底部 | 整屏被作品图主导 ⇒ 9 条假警报；底部 7% 是**系统导航栏** ⇒ D-5 |
 * | 5 | 阈值 + 区域在**三处副本**间不得分叉 | 改一处不改另一处，静默分叉 |
 * | 6 | `scrub_login_probe` 挂在 EXIT/INT/TERM 三个 trap 上 | refresh_token 明文留盘 |
 * | 7 | 登录探针**排他**：只被赋成 `.login.png`，绝不 `.nav.png` | 探针与诊断截图共用 ⇒ token 留盘 |
 * | 8 | `probe_mode` 维持**整幅**口径（与 4 相反，是有意的） | 见下「两个明暗消费点」 |
 *
 * ## 判别力自证（反事实）
 *
 * 静态断言最容易变成「对着文件念一遍」的同义反复。本文件对每条检测器都做了变异：
 * 把**真实脚本**改坏 → 跑本文件 → 确认对应用例转红 → 还原（sha256 前后一致）。
 * 下表 12 个变异全部被抓住：
 *
 * | 变异 | 手法 | 转红用例 |
 * |---|---|---|
 * | M1 | 调用点改回 B-1 的 `dbg_lazy "…$(cmd)"` | ①调用点 |
 * | M2 | `shot()` 里 `if ! on_app_page` → `if false` | ②后置 |
 * | M3 | `MODE_BAND` 改成整屏 `0,0,1,1` | ③区域 |
 * | M3b | `MODE_BAND` 改回底部 7% `0,0.93,1,1`（D-5 的原值） | ③区域 |
 * | M4 | `DARK_MAX=70` → `65` | ④跨文件契约 |
 * | M5 | 删掉 `trap … TERM` | ⑤trap |
 * | M6 | `resume_reason()` 里 `if ! on_app_page` → `if false` | ②续采 |
 * | M7 | 注释里塞 `DARK_MAX=70` 遮蔽 + 真赋值改 65 | ④跨文件契约 |
 * | M7b | `GATE_PRESET` 的 mean 区域退回 `full` | ④区域 |
 * | M7c | 清单脚本 `MODE_REGION` 退回 `None` | ④第三份副本 |
 * | M8 | `probe_mode` 的 `luma` 改成 `band_luma` | ③口径分工 |
 * | MA | 登录探针改回 `.nav.png`（**两个赋值点各测一次**） | ⑤排他 |
 * | MC | 保留 `band_luma` 调用、紧接着用整屏 `luma` 覆写 `l` | ③值流 |
 *
 * ⚠️ 检测器本身在变异台上翻过四次车，全部是同一类错，记在这里省得下一个人重踩：
 * 1. 注释行里**故意**写着那个错误写法当反例，不过滤就误报（M1 的检测器）。
 * 2. `DARK_MAX=70; LIGHT_MIN=100` 写在同一行，锚 `^NAME=` 匹配不到 ⇒ NaN 比较恒绿。
 * 3. 取常量若不跳过注释，注释里的 `DARK_MAX=70` 会遮蔽真赋值 ⇒ 改了对也不报（M7）。
 * 4. 断言「文件里出现过某串」是**同义反复**（⑤ 的第一、二版都栽在这）：脚本别处的
 *    注释里也有那个串。第二版改成只筛 `LOGIN_PROBE=` 行**仍漏**，因为 `do_login`
 *    的路径写在**局部** `probe=` 上 ⇒ 判「排他」必须覆盖**两个消费函数 + 两种变量**。
 *
 * 一句话：**文本检测器必须分清「注释」与「代码」，且「出现过」永远不等于「只有这里有」。**
 *
 * ### 源级守卫的例外（本包 CONTEXT.md 约定「剥注释」，此处刻意不剥）
 *
 * `packages/app-lynx/CONTEXT.md` 的源级守卫约定是「读源文件、剥注释、对代码本文做
 * 正/负向匹配」。**剥注释仍是默认口径**；本文件取那条**例外**，因为被测脚本的注释里
 * **故意包含反例字面量**（`dbg_lazy "…$(慢命令)"`）——整体剥离恰好会让「记录缺陷的注释」
 * 与「残留的缺陷」分不开。
 *
 * ⚠️ 例外的准确口径是「**逐行排除行首 `#` / `//` 的整行**（不做块级剥离）」，
 *    **不是**「保留注释行」——那两句原本自相矛盾（保留与整行排除不能同真），
 *    第九轮 Standards R-5 查出时 CONTEXT.md 早已改过、这里却还留着旧说法。
 *    实现见 `codeOf`；`fnBody` 默认就返回它过滤后的文本，所以调用点不必自觉。
 *
 * 这是**约定补全**，不是豁免：判据写在 CONTEXT.md 里，且由本文件的门禁强制
 * （被治理文件头须显式引用该例外）。
 *
 * ## 期望值出处（oracle）—— 这里更正过一个**方向性错误**
 *
 * ⚠️ 第一版把 `png-luma.py` 的 `GATE_PRESET` 称作「独立事实源」，理由是它写着
 * 「与 capture-md3-matrix.sh 同源」。**这个推理是反的**（Standards 轴 F1）：
 * 「同源」恰恰说明它就是从被测文件**抄过去**的副本 —— 把 A 抄成 B 再断言 A==B，
 * 是同义反复，不是独立互证。
 *
 * ④ 实际锁的是**三方相等**，其中只有一方是独立的：
 *
 * | 方 | 角色 |
 *|---|---|
 * | 本文件的 `documented` 字面量（70 与 100、20 与 20） | **唯一独立 oracle** —— 来自 37 张真图实测余量 |
 * | `capture-md3-matrix.sh` 的常量 | 副本，采集时真正在用的那份 |
 * | `png-luma.py` 的 `GATE_PRESET` | 副本，自称「同源」 |
 * | `md3-matrix-inventory.py` 的常量（本轮补入） | 第三份副本，零程序化调用方，最易漂移 |
 *
 * 断言它们相等，防的是**「改一处不改另一处」的漂移**，不是「互相证明正确」。
 * 出处（**第三十二轮按 37 张真图重标定**）：区域从「底部 7%」改成「**顶栏中段**」。
 *   底部 7%（y 0.93~1.00）在 Android 上整片是**系统导航栏**，不透明、跟**系统主题**走而不跟
 *   app 主题 ⇒ app 暗 + 系统亮时实测 **227.66 / 228.01 被判成「亮」**（D-5，静默不报错）。
 *   顶栏则是 app 自己的表面色，逐像素实测**不随系统主题变**。
 *   ⚠️ 它**不是纯色**（含状态栏图标，32 张实测 sd 3.86~18.25），「纯表面色」只对**均值**成立。
 *   代价：FAB 展开态的 scrim 是**全窗口均匀 50% 黑**，app 窗口内无豁免 ⇒ 亮色最低
 *   **124.76**。故空档 **[20.74, 124.76]**，**LIGHT_MIN 必须 140 → 100**（余量 24.76）。
 *   DARK_MAX 保持 70 不动（余量 49.26）。
 *   ⚠️ **区域与阈值是同一个决定的两半，只改一处必然错**（2×2 反证，37 张真实样本）：
 *       顶带+140 → 错 2（scrim 那两张）   顶带+100 → 错 0 ✅
 *       底带+140 → 错 1（D-5）          底带+100 → 错 1（阈值救不了它）
 *   20 的依据见脚本阈值注释与文档 §4（正样本下沿 20.88、负样本 12.91）。
 *
 * 第 1/2/3/7/8 条断言的是**语义不变量**（惰性、先后顺序、排他性、区域口径、
 * trap 覆盖面），期望值由 bash 语义推导，不抄任何当前输出。
 *
 * ## 两个明暗消费点：**故意不一样**
 *
 * 同一对 `DARK_MAX/LIGHT_MIN` 有两个消费方，输入的**页面类型不同**：
 * · `resume_reason()`（+ 清单脚本）判的是**内容页**截图 —— 会被作品图主导，
 *   整幅口径实测误判 9/31 ⇒ 必须用 `MODE_BAND` 顶栏中段。
 * · `probe_mode()` 判的是**「我的」页**截图（⚠️ 早先写「外观设置页」是**错的**：`set_mode`
 *   里那记 `back` **不离开页面**，只弹「再按一次退出应用」toast）—— 那里没有作品图，
 *   实测整幅四格 34.86 / 49.48（暗）与 229.19 / 237.47（亮），**现阈值够用**。
 *   ⚠️ 保留整幅是刻意的；且 D-5（底带=系统导航栏）**不波及它**，所以本轮没改它。
 *   ⚠️ 拿内容页的 9/31 去论证它会假失败同样是**错的**。
 *   未在真机复验暗色设置页（emulator 离线）⇒ 已登记在文档 §8.8。
 *
 * 复现命令：`cd packages/app-lynx && pnpm vitest run tests/captureScriptInvariants.test.ts`
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const rootDir = resolve(__dirname, '..')
const SH_PATH = resolve(rootDir, 'scripts/capture-md3-matrix.sh')
const SH = readFileSync(SH_PATH, 'utf8')
const FIX = resolve(rootDir, 'tests/fixtures/md3-split-batch.sh')
const PL = readFileSync(resolve(rootDir, 'scripts/png-luma.py'), 'utf8')
/** 判据的**第三份副本**：它零程序化调用方、零测试，改它没人拦 ⇒ 必须由 ④ 钉住。 */
const INV = readFileSync(resolve(rootDir, 'scripts/md3-matrix-inventory.py'), 'utf8')

/**
 * 「恒假壳」检测：条件行**紧邻的上一行**若是死代码构造，则整个分支不可达。
 *
 * ⚠️⚠️ 提到模块级的原因（二轮复核 F3）：它原先是 ③ 块内的局部常量，于是**同一失效类
 *    在同一文件里一处防了一处没防** —— ⑦ 那条 `set_mode` 终局分流的加固只做了文本/变量
 *    断言，把整段包进 `if false; then … fi` 仍然全绿。
 *    纯文本断言在**原理上**看不出可达性（文件头已写明），能看出的只有「上面有没有壳」。
 */
const DEAD =
  /^(if|while|until)\b[^#]*\bfalse\b|^(if|while|until)\s+\[\s*(-n|-z|-e|-f)?[^\]]*\]|^(if|while|until)\s+\(|^(exit|return)\b|^\(\s*(#.*)?$/

/**
 * 条件行在其所在函数体里的行下标（逐个出现处由调用方处理）。
 * ⚠️ 必须同时认 `if` 与 `elif`：同一个分流的两支在 bash 里通常写成 `if` / `elif`，
 *    只认 `if` 会让「第二支的壳」查不到 —— 而第二支恰恰也是能套 `if false` 的。
 */
function condLineIdx(body: string, cond: string): number[] {
  const core = cond.replace(/^(if|elif)\s+/, '')
  return body
    .split('\n')
    .map((l, i) => [l.trim(), i] as const)
    .filter(([l]) => l === cond || l === 'elif ' + core || l === 'if ' + core)
    .map(([, i]) => i)
}

/** 取出 bash 函数的函数体（从 `name() {` 到**行首**的 `}`）。 */
function fnBody(src: string, name: string): string {
  const start = src.search(new RegExp(`^${name}\\(\\)\\s*\\{`, 'm'))
  if (start < 0) throw new Error(`脚本里找不到函数 ${name}()`)
  // ⚠️⚠️ 终点必须**按花括号深度前向扫描**，不能找「第一个行首 }」（第九轮 Standards R-1）。
  //    旧写法 indexOf('\n}\n') 会在函数体内任何**顶格 }** 处提前截断且**不抛错** ——
  //    而「函数体里有个顶格 }」是**合法 bash**（例如一个收尾花括号组）。
  //    后果：守卫此后只检查**前缀**。抓不抓得到被丢掉的后半段，取决于它恰好有没有锚点
  //    —— **是运气不是结构**。一次无害重构就能静默致盲（含守卫⑤ refresh_token 明文留盘）。
  //
  //    口径：跳过注释行与引号内的字符，只数**代码**里的 { }；深度回到 0 即函数结束。
  //    数错了宁可**抛错**（fail loud），也不返回一段被截断的文本（fail silent）。
  const lines = src.split('\n')
  const startLine = lines.findIndex((l) => new RegExp(`^${name}\\(\\)\\s*\\{`).test(l))
  let depth = 0
  let started = false
  let endLine = -1
  for (let i = startLine; i < lines.length; i++) {
    const raw = lines[i]
    if (/^\s*#/.test(raw)) continue // 注释行里的花括号不参与配平
    // ⚠️ 顺序要紧：**先剥引号、再剥注释**。反过来的话，注释里出现的 `'` 会把后面的
    //    真正代码当成字符串。剥完引号再从 `#` 截到行尾，连**行尾注释**里的花括号也不计。
    const line = raw
      .replace(/'[^']*'/g, "''")
      .replace(/"[^"]*"/g, '""')
      .replace(/#.*$/, '')
    for (const ch of line) {
      if (ch === '{') {
        depth++
        started = true
      } else if (ch === '}') {
        depth--
        if (depth < 0) throw new Error(`函数 ${name}() 在第 ${i + 1} 行花括号就不平衡了`)
        if (started && depth === 0) {
          endLine = i
          break
        }
      }
    }
    if (endLine >= 0) break
  }
  if (endLine < 0) throw new Error(`函数 ${name}() 没有配平的收尾 }`)
  return codeOf(lines.slice(startLine, endLine + 1).join('\n'))
}

/** 逐行排除**行首** # 的整行，返回剩下的代码部分。
 *
 * ⚠️ 这就是 CONTEXT.md「源级守卫」条目里写的那个**例外**的实现口径：默认剥注释，
 *    但本脚本的注释里**故意**写着错误写法当反例，所以不能整体剥离，改成逐行排除。
 *
 * ⚠️⚠️ **守卫不能直接对原始函数体 indexOf**（第七轮 B-1，本轮自己踩的）：
 *    shot() 里那段讲「为什么这样分流」的注释里含有 on_app_page 字面量。
 *    于是把**代码里那个调用**变异掉之后，indexOf 仍会命中注释、位置照旧在
 *    screencap 之后 ⇒ 断言恒真 ⇒ 门禁**假绿**。
 *    守卫 ① 早就逐行过滤注释了，② 却一直用裸 indexOf —— 两处口径不一致，
 *    正好让本轮的**纯文案改动**把上一轮的门禁打瞎。
 */
function codeOf(body: string): string {
  return body
    .split('\n')
    // 行首 `#`（bash）或 `//`（TS）都算注释 —— CONTEXT.md 源级守卫条目承诺的是**两者**，
    // 原来只实现 `#`，那条词条治的却是 `*.template.test.ts`（标记是 `//`）⇒
    // **规范宽于示范**，下一个照规范写 TS 守卫的人会被误导（第八轮 Standards F-3）。
    // ⚠️ 只看**行首**：行尾注释（`a=1 # b=2`）所在行必须保留，代码不能被丢。
    .filter((l) => !/^\s*(#|\/\/)/.test(l))
    .join('\n')
}

/** 该字面量是否**出现在代码里**（注释不算）。守卫一律用它，不要用裸 indexOf。 */
function codeIndexOf(body: string, needle: string): number {
  return codeOf(body).indexOf(needle)
}

describe('① dbg_lazy 必须是真惰性（B-1 回归防线）', () => {
  it('fnBody 按**花括号深度**收尾，不被顶格 } 截断（第九轮 R-1 回归防线）', () => {
    // 第九轮 Standards R-1：旧写法 indexOf 找「第一个行首 }」，会在函数体内任何**顶格 }**
    // 处提前截断且**不抛错**。而「函数体里有个顶格 }」是**合法 bash**（收尾花括号组）。
    // 后果：守卫只检查**前缀**；抓不抓得到被丢掉的后半段**取决于它恰好有没有锚点** ——
    // **是运气不是结构**。一次无害重构就能静默致盲（含守卫⑤ refresh_token 明文留盘）。
    //
    // 直接测 helper 本身（不必改脚本）：哨兵放在顶格 } **之后**，
    // 旧口径必然取不到它，新口径必须取得到。
    const NL = String.fromCharCode(10)
    const src = [
      'probe() {',
      '  local a=1',
      '  { : # 收尾花括号组，} 顶格',
      '    echo inner',
      '}',
      '  local b=2',
      '  echo SENTINEL_TAIL_ANCHOR',
      '}',
    ].join(NL)
    const body = fnBody(src, 'probe')
    expect(body, 'fnBody 必须取到顶格 } 之后的哨兵（旧口径会在这里截断）').toContain('SENTINEL_TAIL_ANCHOR')
    expect(body, '也必须取到花括号组本身').toContain('echo inner')
    // 平衡性：取多了也不行 —— 下一个函数不该被吞进来
    const two = src + NL + 'other() {' + NL + '  echo NEXT_FN' + NL + '}'
    expect(fnBody(two, 'probe'), '不得越界吞掉下一个函数').not.toContain('NEXT_FN')
    // 找不到函数 ⇒ 抛错（fail loud）
    expect(() => fnBody('nope() {', 'nope'), '找不到函数应抛错').toThrow()
  })
  it('被治理文件**显式引用** CONTEXT.md 的剥注释例外（第八轮 Standards F-2）', () => {
    // CONTEXT.md 写了「被治理文件的文件头须显式引用本例外，否则等于没有约定」——
    // 但 exemplar（capture-md3-matrix.sh 的文件头）当时并没有引用，也没有测试强制。
    // 写了却没人查的「门禁」比不写更容易误导：下一个人会以为这条已经生效。
    const head = SH.split('\n').slice(0, 45).join('\n')
    expect(head, '文件头必须显式引用 CONTEXT.md 的剥注释例外').toMatch(/CONTEXT\.md/)
    expect(head, '引用要说清是剥注释这条例外').toMatch(/剥注释|源级守卫/)
    expect(head, '还要点明本文件注释含反例、故不能整体剥离').toMatch(/反例/)
  })

  it('FAB 区区域在**代码里只有一处**（副本收敛，Spec 轴 F2）', () => {
    // 旧状态：shell 内 3 份（fab_sat + ensure_session 两处内联），零等式 ⇒
    // 改 fab_sat 的区域，ensure_session 静默沿用旧区域，身份门禁与登录检测
    // 对「我在不在 app 页」给出互相矛盾的答案，且无任何测试响。
    // 处置：ensure_session 两处改调 fab_sat，副本收敛到 1；这里钉住不再长回来。
    // 必须数**代码**行：文件头注释里合法地复述过这个区域。
    const code = codeOf(SH)
    const hits = code.match(/0\.80,0\.84,0\.96,0\.94/g) ?? []
    expect(hits.length, 'FAB 区区域在代码里应恰好 1 份，现状 ' + hits.length).toBe(1)
    expect(code, '那一处必须在 fab_sat() 里').toMatch(/fab_sat\(\) \{[^}]*0\.80,0\.84,0\.96,0\.94/)
    expect(
      fnBody(SH, 'ensure_session'),
      'ensure_session 不得再内联探针（应改调 fab_sat）',
    ).not.toMatch(/--region=0\.80/)
  })

  it('ensure_session 也把「探针无输出」与「会话失效」**分开说**（Spec 轴 F1）', () => {
    // 第五处同形状：旧的 sat 兜底只缓解了显示，没缓解归因——
    // 原句断言「会话失效」/「token 可能已失效，需人工处理」，指挥人查错方向。
    const es = fnBody(SH, 'ensure_session')
    // ⚠️ 必须**逐块**核对，不能用一条函数级正则：ensure_session 里有**两个**同形状的
    //    `-z "$sat"` 分流块（首次判会话 / 重登后复判），函数级 `…[\s\S]*?…` 只会锚到
    //    **第一个** —— 删第二个块的 else 全绿（第九轮 Standards R-2 实测）。
    //    两块没互相顶替只是因为措辞**恰好**差个 `**`，那是**偶然的健壮**。
    const blocks = es.split(/if \[ -z "\$sat" \]; then/).slice(1)
    expect(blocks.length, 'ensure_session 应有两处分流（首次判 + 重登后复判）').toBe(2)
    // ⚠️ 每块的 else 必须含**它自己那一句**真判据。只断言「有个 echo」太弱 ——
    //    把那句话改掉、echo 仍在，照样绿（这正是第一次尝试漏掉的地方）。
    const REAL: Array<[string, RegExp]> = [
      ['首次判会话', /else[\s\S]*?会话失效/],
      ['重登后复判', /else[\s\S]*?token/],
    ]
    for (const [i, blk] of blocks.entries()) {
      const head = blk.slice(0, blk.indexOf('fi'))
      expect(head, '第 ' + (i + 1) + ' 块：必须先说「探针无输出」').toMatch(/探针.{0,3}无输出/)
      expect(head, '第 ' + (i + 1) + ' 块（' + REAL[i][0] + '）：else 里必须有**它自己那一句**真判据').toMatch(
        REAL[i][1],
      )
    }
    expect(es, '不得再用 sat 的显示层兜底').not.toMatch(/\$\{sat:-/)
    // ⚠️ **提示语不得描述代码没有做的行为**（第十八轮）。这里 do_login 是**无条件**的：
    //    探针无输出时照样会重登。此前那半句写的是「别去重登/换 token」——
    //    指挥人读到「别去重登」，下一行代码却正在重登，指引与控制流**正面矛盾**。
    //    归因提醒（别认定 token 失效）要留，「别去重登」这个**行为声明**要删。
    const noOutMsg = blocks[0].slice(0, blocks[0].indexOf('fi'))
    expect(
      noOutMsg,
      '探针无输出那半不得声称「别去重登」—— do_login 无条件执行，措辞必须承认这一点',
    ).not.toMatch(/别去重登|别去换 token|不要重登/)
    expect(
      noOutMsg,
      '探针无输出那半必须**承认仍会重登**（与控制流一致），否则等于撒了个谎',
    ).toMatch(/仍会照常自动重登/)
  })
  it('codeOf 同时认 bash 的 # 与 TS 的 //（CONTEXT.md 承诺的是两者）', () => {
    // 第八轮 Standards F-3：词条治的是 `*.template.test.ts`（标记 `//`），
    // 而示范实现只滤 `#` ⇒ **规范宽于示范**，照规范写 TS 守卫的人会被误导。
    expect(codeOf('# bash 注释'), '行首 # 应被排除').toBe('')
    expect(codeOf('// ts 注释'), '行首 // 应被排除').toBe('')
    expect(codeOf('    // 缩进的 ts 注释'), '缩进后的 // 也应被排除').toBe('')
    // ⚠️ 只看**行首**：行尾注释所在行必须保留，代码不能被整行丢掉。
    expect(codeOf('a=1 # 尾部'), '行尾注释在代码行上，行必须保留').toContain('a=1')
    expect(codeOf('const a = 1 // 尾部'), 'TS 行尾注释同理').toContain('const a = 1')
    expect(codeOf('x=1'), '纯代码行原样保留').toBe('x=1')
  })

  it('注释里的**反例字面量**不算调用点（CONTEXT.md 那个例外的自证）', () => {
    // ⚠️ CONTEXT.md 源级守卫条目写下了「逐行排除注释」这个例外，但**零变异自证**：
    //    删掉守卫 ① 里的注释过滤，整支仍 17 条全绿 —— 标准写了、遵守标准的行为没被钉住。
    // 这条把该行为本身变成被测对象：用一段合成源码证明「注释里有 dbg_lazy + $( 时不误报」，
    // 且「代码里真有同样写法时照样报出来」。反事实：去掉 codeOf 的过滤 ⇒ 本条转红。
    const withCommentOnly = ['# dbg_lazy "x $(whoami)"', 'echo ok'].join('\n')
    const findOffenders = (src: string): string[] => {
      const out: string[] = []
      src.split('\n').forEach((line, i) => {
        if (codeOf(line).trim() === '') return // 注释行/空行
        if (/^\s*dbg_lazy\(\)/.test(line)) return // 函数定义本身是展开点，正确
        if (!/\bdbg_lazy\b/.test(line)) return
        if (line.includes('$(')) out.push(`${i + 1}`)
      })
      return out
    }
    expect(findOffenders(withCommentOnly), '注释里的反例写法不得被当成残留缺陷').toEqual([])
    expect(findOffenders('dbg_lazy "x $(whoami)"'), '代码里真的这么写必须报出来').toHaveLength(1)
    expect(findOffenders('dbg_lazy some_cmd'), '正常调用不得误报').toEqual([])
    // 顺带钉住 helper 本身：行尾注释（前面有代码）不算注释行，不该被整行丢掉。
    expect(codeOf('a=1 # b=2'), '行尾注释在代码行上，行本身必须保留').toContain('a=1')
  })

  it('每个调用点传的是**命令名**，不是含 $(…) 的字符串', () => {
    // 反事实：把调用点改回 `dbg_lazy "…$(cmd)"` 形态 ⇒ 本条转红。
    // 依据：bash 在**调用前**就展开实参里的 $(…)，与 dbg 完全同形。
    const offenders: string[] = []
    SH.split('\n').forEach((line, i) => {
      // 注释行不是调用点。⚠️ 本脚本的注释里**故意**写着那个错误写法当反例，
      // 不过滤就会把「记录缺陷的注释」当成「残留的缺陷」——第一版就栽在这里。
      if (/^\s*#/.test(line)) return
      if (/^\s*dbg_lazy\(\)/.test(line)) return // 函数定义本身就是展开点，正确
      if (!/\bdbg_lazy\b/.test(line)) return
      if (line.includes('$(') || line.includes('`')) offenders.push(`${i + 1}: ${line.trim()}`)
    })
    expect(offenders, `dbg_lazy 调用点含命令替换 ⇒ 开关关着时照样跑全屏解码:\n${offenders.join('\n')}`).toEqual([])
  })

  it('函数体把展开留在**体内**（$1 之外的参数不被提前求值）', () => {
    const body = fnBody(SH, 'dbg_lazy')
    // 形状：先判开关，再把 "$@" 的**输出**交给 dbg。缺了开关判断就变成永远打印。
    expect(body, 'dbg_lazy 必须先判 MD3_DEBUG 再展开').toMatch(/MD3_DEBUG/)
    expect(body, 'dbg_lazy 必须在函数体内展开命令（dbg "$("$@")"）').toMatch(/dbg\s+"\$\("\$@"\)"/)
  })
})

describe('② 身份门禁必须**后置**（§8.5 回归防线）', () => {
  it('shot()：screencap 落盘之后才验 on_app_page', () => {
    const body = fnBody(SH, 'shot')
    // ⚠️ 必须用 codeIndexOf（过滤注释），不能裸 indexOf —— 理由见 codeOf 的注释。
    //    裸 indexOf 会被本函数里那段「讲分流理由的注释」顶替，本轮已因此假绿过一次。
    const cap = codeIndexOf(body, 'screencap')
    const gate = codeIndexOf(body, 'on_app_page')
    expect(cap, 'shot() 里找不到 screencap').toBeGreaterThan(-1)
    expect(gate, 'shot() 里找不到 on_app_page —— 身份门禁被拆掉了').toBeGreaterThan(-1)
    // 前置检查只能挡住「进循环前就掉线」，挡不住「采集中途掉线」。
    expect(gate, 'on_app_page 必须排在 screencap **之后**（前置 = 一格延迟的漏洞）').toBeGreaterThan(cap)
  })

  it('续采路径 resume_reason() 同样验身份，不只验「有内容」', () => {
    expect(fnBody(SH, 'resume_reason'), '续采只验内容会把上一轮的空白页当成功').toContain('on_app_page')
  })
})

describe('③ 明暗判据量**主题表面**而不是整屏（9 条假警报的回归防线）', () => {
  it('MODE_BAND 是**顶栏中段**（跟 app 主题、且不含系统导航栏），且 band_luma 真的用了它', () => {
    const band = SH.match(/^MODE_BAND=(.+)$/m)
    expect(band, '找不到 MODE_BAND 常量').not.toBeNull()
    // ⚠️ 早先钉的是 `0.00,0.93,1.00,1.00`（底部 7%）。那一条**自身就是缺陷 D-5**：
    //   底部 7% 在 Android 上整片是系统导航栏，跟系统主题走 ⇒ app 暗 + 系统亮时
    //   实测 227.66，被判成「亮」。这条断言当时把缺陷当成了「要避开的系统导航栏」，
    //   恰恰说明**光写注释不写依据，断言会反过来给缺陷盖章**。
    expect(band![1].trim(), 'MODE_BAND 必须是顶栏中段：跟 app 主题走，不落在系统导航栏上').toBe('0.20,0.02,0.80,0.09')
    // ⚠️ 整屏口径实测会把 8 张暗色 Feed（整幅 93.51–115.22）判成「不是暗色」。
    expect(fnBody(SH, 'band_luma'), 'band_luma 必须把 --region 传给 png-luma.py').toContain('--region=$MODE_BAND')
  })

  it('探针默认（不给 --region）不得被用在明暗判定上', () => {
    // luma() 是整幅探针。它可以留着给别的用途，但 resume_reason 的明暗分支
    // 必须走 band_luma —— 这一条钉的是**调用点**，不是函数存不存在。
    expect(fnBody(SH, 'resume_reason')).toContain('band_luma "$f"')
  })

  it('**值流**也走底带：`l` 只被 band_luma 赋过一次（变异 MC）', () => {
    // 只钉「调用过 band_luma」不够：保留调用、紧接着用整屏 luma 覆写 `l`，
    // 上一条照样绿。这条钉的是**赋值的唯一来源**（模板 B 的已知边界）。
    const assigns = [...fnBody(SH, 'resume_reason').matchAll(/\bl="([^"]*)"/g)].map((m) => m[1])
    expect(assigns.length, '`l` 的赋值点应恰好一处').toBe(1)
    expect(assigns[0], '`l` 必须由 band_luma 赋值').toContain('band_luma')
  })

  it('「探针无输出」与「判据不达标」在**措辞上**被分开（六轮 Spec 轴）', () => {
    // on_app_page / has_content 都把「读不出来」收敛成 false；调用点若照字面印
    // 「sat= < 20」/「stddev < 20」，人就会去调**判据阈值**，而真因是截图根本读不出来。
    // 与本脚本 :174-178 记的老病（0 字节被报成「找不到控件」、查了 3 轮）同形。
    // 这里钉的是**措辞分流**；控制流（分支与退出码）刻意不变 —— 那要真机才验得了。
    const body = fnBody(SH, 'shot')
    const rr = fnBody(SH, 'resume_reason')
    // ⚠️⚠️ **每一处分流都必须「成对」**：既有「探针无输出」那一半，也要有 else 里的
    //    **真判据**那一半。第八轮 Spec 轴 F3 查出：原注释声称「成对出现」，
    //    但 6 条断言**全部只匹配 -z 那一半** —— 四条 else 半边可以被**无痕删除**：
    //    MF/MG/MI/MJ 四个变异全部 19 全绿。其中 **MJ 是控制流洞**（最严重）：
    //    删掉 resume_reason ② 的 else 整块后，「声称 dark 实测 light」时
    //    `return 1` 消失 ⇒ 走 `return 0` ⇒ **把「名字对、内容错」的图当可续采证据**，
    //    正是本仓一直在消灭的假绿。
    //
    // ⚠️ 为什么必须**逐块锚定**、不能用一条函数级 `else[\s\S]*?`：
    //    shot() 里有**两份**同形状（`_cs` 与 `_cs2`），函数级锚定在**同一函数内**
    //    失去区分力 —— 删掉 A 的 else 半边，会被 B 的内容顶替而照样绿。
    //    锚点用**变量名**（`${_cs}` vs `${_cs2}` 尾部 `}` 不同）才互不顶替。
    const PAIRS: Array<[string, string, RegExp, RegExp]> = [
      [
        'shot 重拍 FAB 侧',
        'shot',
        /-z "\$_fs"[\s\S]*?FAB 区探针无输出/,
        /-z "\$_fs"[\s\S]*?else[\s\S]*?拍到的是登录页或未加载/,
      ],
      [
        'shot 重拍 内容侧',
        'shot',
        /-z "\$_cs"[\s\S]*?内容区探针无输出/,
        /-z "\$_cs"[\s\S]*?else[\s\S]*?内容区为空（stddev \$\{_cs\}/,
      ],
      [
        'shot 续采 内容侧',
        'shot',
        /-z "\$_cs2"[\s\S]*?内容区探针无输出/,
        /-z "\$_cs2"[\s\S]*?else[\s\S]*?内容区为空（stddev \$\{_cs2\}/,
      ],
      [
        'resume_reason ① FAB 侧',
        'rr',
        /-z "\$_fs2"[\s\S]*?FAB 区探针无输出/,
        /-z "\$_fs2"[\s\S]*?else[\s\S]*?停留在登录页或未加载/,
      ],
      [
        'resume_reason ② 明暗侧（既有正确口径）',
        'rr',
        /-z "\$l"[\s\S]*?底带亮度探针无输出/,
        /-z "\$l"[\s\S]*?声称 \$\{want\}/,
      ],
    ]
    const src: Record<string, string> = { shot: body, rr }

    // ⚠️⚠️ **PAIRS 只钉「文本存在」，不钉「可达性」**（第九轮 Spec 轴查实，四种绕过全绿）：
    //   ① `why=` → `RESUME_WHY=`（两半都换）⇒ 局部变量再也不被赋值，消息变空
    //   ② `else` 里嵌 `if [ 1 = 2 ]` ⇒ 真判据变死代码
    //   ③ 条件改成 `-z "$x" ] && false` ⇒ **原病逐字复活**
    //   ④ 整对包进 `if false` ⇒ 文本全在、整对不可达
    // 纯文本断言在**原理上**做不到：它看的是「字符串在不在文件里」，不是「跑起来走哪条路」。
    //
    // 下面把分流块**抽出来 eval + stub 探针真跑**。承重性质是「实际被赋成了哪句话」，
    // 而非「那句话在不在」。ATK1/2/3 会被这一条抓住（③ 正是原误诊复活的形态）。
    const chr = String.fromCharCode(10)
    // ⚠️ 全部 **7 处**分流，逐条**真跑**（不是比文本）。少一处就等于留一个已证实的假绿通道。
    // 每条带一个自己的「低于本块阈值的合法读数」：$l 判明暗，12.91 反而是**合法暗色**
    // (<70) 会走「一致」而不打印任何消息，必须给 200 才落到 else。
    // 第 5 个字段 = 本条消息**本该落在哪个变量**（'' = 只 echo，不赋值）。
    // ⚠️ 必须挑着断言：笼统接受「why 或 RESUME_WHY 任一非空」的话，把 `why=` 改名成
    //    `RESUME_WHY=`（ATK1）照样绿 —— 消息还在，只是搬到了另一个变量里（实测漏检）。
    const CONDS: Array<[string, string, string, string, string]> = [
      ['resume_reason ① FAB 侧', '_fs2', 'if [ -z \"$_fs2\" ]; then', '12.91', 'RESUME_WHY'],
      ['resume_reason ② 明暗侧', 'l', 'if [ -z \"$l\" ]; then', '200', 'RESUME_WHY'],
      ['shot 续采 内容侧', '_cs2', 'if [ -z \"$_cs2\" ]; then', '12.91', 'why'],
      ['shot 重拍 FAB 侧', '_fs', 'if [ -z \"$_fs\" ]; then', '12.91', 'why'],
      ['shot 重拍 内容侧', '_cs', 'if [ -z \"$_cs\" ]; then', '12.91', 'why'],
      ['ensure_session 首次判会话', 'sat', 'if [ -z \"$sat\" ]; then', '12.91', ''],
      ['ensure_session 重登后复判', 'sat', 'if [ -z \"$sat\" ]; then', '12.91', ''],
    ]
    const AWK_B = join(tmpdir(), 'md3-split-v3.awk')
    // 每次都写，不用 existsSync 守卫：那个文件名下有过上一版的残留，而守卫**不会**覆盖，
    // 会静默吃到错程序（实测抽取全空 = V[][]）。多一次 write 换「不可能吃错」。
    writeFileSync(
      AWK_B,
      // ⚠️ 必须**按出现次序**取块（c++; on=(c==k)）。早先这里没有计数器，于是每个 k 都抽
          //    **第一处**匹配 —— 复制一份同名块、再把原块 else 删掉，文本门禁与行为门禁**双双放行**
    //    （第十九轮实测 23 全绿）。变量名锚定**必要但不充分**（Standards R-4）。
      'BEGIN{c=0} index($0,a){c++; on=(c==k)} on{print; if ($0 ~ /^[ \\t]*fi$/) exit}',
    )
    /**
     * 一次 spawn 跑完全部 7 条；两次 spawn 覆盖「探针无输出」与「探针有值」。
     * ⚠️ 曾写成「每条各起一次」= 7×2 + 7 次 grep = **21 次进程**，实测足以把本机
     *     拖到**别的文件**的用例 5s 超时（第十二轮全量 5 条红，跨 pngLuma/AppIcon）。
     * ⚠️ bash 程序放在 tests/fixtures/*.sh，**不塞进 TS 字符串**：" 与 $ 与 ${} 会在
     *     转义层被吃掉（连续两轮都栽在这），条件直接走 **argv**，两侧都零转义。
     */
    // 从一次 spawn 的原始输出里，取出**指定变量**那一格（'' = 只 echo，取 O）。
    // ⚠️ 标签必须匹配 **NONCE**：裸 `W[…]`/`O[…]` 会被被测块自己的 echo 顶替
    //    （第二十轮 Spec F2）。NONCE 由这里现场生成、只经环境传给夹具，
    //    被测代码读不到 ⇒ 它**伪造不出**合法标签，只能贡献噪声而不能冒充真值。
    const NONCE = 'N' + Math.random().toString(36).slice(2) + Date.now().toString(36);

    const runAll = (useLow: boolean): Map<string, string[]> => {
      const flat: string[] = [];
      for (const [, v, c, lo] of CONDS) flat.push(v, c, lo);
      const r = spawnSync('bash', [FIX, SH_PATH, AWK_B, useLow ? '1' : '0', ...flat], {
        encoding: 'utf8',
        env: { ...process.env, NONCE },
      });
      // ⚠️ **逐个出现处**收集成数组，**不拼接**。同名条件出现多次时（复制副本顶替原块），
          //    拼接会让**正确的那份掩盖被破坏的那份** —— 第十九轮实测副本顶替仍 23 全绿。
      const res = new Map<string, string[]>();
      let cur = -1;
      let occ: string[] = [];
      const flush = () => {
        if (cur < 0) return;
        const key = CONDS[cur]?.[0] ?? String(cur);
        const all = res.get(key) ?? [];
        all.push(occ.join(' ').trim());
        res.set(key, all);
        occ = [];
      };
      for (const ln of (r.stdout ?? '').split(chr)) {
        // 只有**逐出现处**的标记才 flush；条件级标记会凭空多出一个空条目。
        const mk = ln.match(/^@@(\d+)@\d+$/);
        if (mk) {
          flush();
          cur = Number(mk[1]);
          continue;
        }
        if (cur >= 0) occ.push(ln);
      }
      return res;
    };
    const NO_OUT = runAll(false);
    const WITH_VAL = runAll(true);
    const pick = (raw: string, msgVar: string): string => {
      const tag = msgVar === '' ? 'O' : msgVar === 'why' ? 'W' : 'R';
      return (raw.match(new RegExp(tag + NONCE + '\\[([^\\]]*)\\]'))?.[1] ?? '').trim();
    };
    for (const [label, , cond, low, msgVar] of CONDS) {
      // ⚠️⚠️ 可达性前置检查。行为断言**看不见**「整对被套进恒假壳」—— 按条件行抽取时
      //    套壳在内层之外，逻辑照跑照对，但真脚本里那段是**死代码**。这与 ATK1/2/3 是
      //    **不同的失效类**（前者「判错」、后者「不可达」），要单独钉。
      //
      //    ⚠️⚠️ 必须**逐个出现处**查，且判据要**覆盖一族**而不是一个字面量。
      //    第二十轮双轴复核（R20-1 / F1）把前两版都打回：
      //      ① findIndex 只看**第一处** —— 两个 `sat` 条目条件串**完全相同**，
      //         把**第二块**包进 `if false` ⇒ 23 全绿（我实测复现）；
      //      ② 只认字面 `false` 且只看**紧邻上一行** ⇒ `[ 1 = 2 ]` / `while false` /
      //         从不赋值的变量 / 子 shell 五族全绿（spec-r8 实测）。
      //    我上一轮报「ATK7 2/2 抓住」，只是因为**我恰好写中了紧邻+字面 false 那个形状**。
      const condLines = SH.split(chr);
      const occIdx = condLines.flatMap((l, i) => (l.trim() === cond ? [i] : []));
      expect(occIdx.length, `脚本里找不到分流条件：${cond}`).toBeGreaterThan(0);
      // 恒假壳的判据：一族，不是单条。`false` / `[ 1 = 2 ]` / `while false` /
      // `[ -z "$从不被赋值的变量" ]` / 子 shell `( … )` 都归在这里。
      // 关键字类**不加行尾锚点**：`if false; then  # M` 里 `false` 之后还有内容，
      // 锚上去反而匹配不到（实测五个族全漏）。只有**光秃秃的 `(`** 才需要行尾锚点，
      // 且要允许**行尾注释**，否则 `(  # MUTANT` 会溜过去（实测漏检）。
      // DEAD 已提到模块级（见文件头「恒假壳」检测）
      for (const ci of occIdx) {
        const above = condLines
          .slice(0, ci)
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'));
        const blocker = above[above.length - 1] ?? '';
        expect(
          blocker,
          `${label} 第 ${condLines.slice(0, ci + 1).filter((l) => l.trim() === cond).length} 处：紧邻着「${blocker}」—— 整对被套进去就成了**死代码**，行为断言看不见`,
        ).not.toMatch(DEAD);
      }
      // ⚠️ **逐个出现处**断言。同名条件出现多次时，**每一份**都得自己站得住 ——
      //    「其中一份对」不等于「这对」（R-4 的副本顶替就栽在这里）。
      const noOuts = (NO_OUT.get(label) ?? []).map((r) => pick(r, msgVar));
      const withVals = (WITH_VAL.get(label) ?? []).map((r) => pick(r, msgVar));
      expect(noOuts.length, label + '：应至少抽到一处分流块').toBeGreaterThan(0);
      expect(withVals.length, label + '：有值那一轮的出现处数应与无输出一致').toBe(noOuts.length);
      for (const [j, noOut] of noOuts.entries()) {
        // 探针**无输出** ⇒ 必须说「读不出来」，绝不能说「内容为空/会话失效」并给出空数值
        expect(
          noOut,
          `${label} 第 ${j + 1} 处：探针无输出时必须判成「读不出来」（ATK3 的 && false 会让它变成「内容为空（stddev  < 20）」）`,
        ).toMatch(/探针.{0,3}无输出/);
        expect(noOut, `${label} 第 ${j + 1} 处：无输出那半**不得**印出阈值（那会让人以为测到了 0）`).not.toMatch(
          /< 20/,
        );
        // 探针**有输出但低于阈值** ⇒ 必须走真判据那半边
        expect(
          withVals[j],
          `${label} 第 ${j + 1} 处：探针有值时必须走真判据（ATK1 会让它变空 / ATK2 会让它恒空 / R-4 副本顶替会掏空其中一份）`,
        ).toMatch(new RegExp(low.replace('.', '\\.')));
      }
    }
    for (const [where, key, noOut, realCriterion] of PAIRS) {
      expect(src[key], where + '：缺「探针无输出」那一半').toMatch(noOut)
      expect(
        src[key],
        where + '：缺 else 里的**真判据**那一半（成对被打破）',
      ).toMatch(realCriterion)
    }
  }, 60_000)

  it('probe_mode **维持整幅**口径 —— 与上一条相反是刻意的（该页无作品图）', () => {
    // 同一个 DARK_MAX/LIGHT_MIN 有两个消费方，输入页面不同 ⇒ 口径**故意**不同：
    //   resume_reason 判内容页（作品图主导 ⇒ 必须用 `MODE_BAND` 顶栏中段）；
    //   probe_mode   判**「我的」页**（⚠️ 早先这里写「外观设置页」是**错的**：`set_mode`
    //     里那记 `back` 不离开页面，只弹「再按一次退出应用」toast）。该页无作品图，
    //     实测整幅 2×2 四格 **34.86 / 49.48**（暗）与 **229.19 / 237.47**（亮）全部同侧
    //     ⇒ 整幅够用，且 D-5（底带=系统导航栏）**不波及它**，故本轮不改。
    // ⚠️ 拿内容页的「整幅误判 9/31」去论证 probe_mode 会假失败是**错的**。
    // 改这里之前先读文件头「两个明暗消费点」，并重跑真机。
    const body = fnBody(SH, 'probe_mode')
    expect(body, 'probe_mode 应使用整幅 luma').toContain('l="$(luma "$probe")"')
    expect(body, 'probe_mode 改成底带前需先在真机复验暗色设置页（emulator 离线）').not.toContain('band_luma')
  })
})

describe('④ 阈值 + 区域在**三处副本**间不得分叉（跨文件契约）', () => {
  // ⚠️ 真正的独立 oracle 是本文件里的 `documented` 字面量（出处见文件头）。
  // png-luma.py 的 GATE_PRESET 自称「与 capture-md3-matrix.sh 同源」——「同源」意味着
  // 它**就是副本**，不是独立源；这里断言三方相等，防的是「改一处不改另一处」的漂移。
  // GATE_PRESET 现在是跨行的括号拼接串，解析要同时吃下两种写法，否则会**静默取空**。
  const presetSpec = (() => {
    // ⚠️ 这里踩过**两个恒绿洞**（第四轮 N1/N2），都是「正则取源码」特有的：
    //  · N1：Python 的模块级同名赋值**后者覆盖前者**，而正则取的是**第一个**匹配。
    //    在 png-luma.py 文末追加一行合法 `GATE_PRESET = "mean:9:full;…"`，
    //    运行时区域退回整幅、测试却仍读到前面那份 ⇒ 16 条全绿。
    //    ⇒ 必须先断言**只定义一次**，把「多处定义」变成硬失败。
    //  · N2：跨行拼接串用 `\n\)` 收尾**没有上界**，后文任意一处行首 `)`
    //    （一次普通重构就会有的多行函数签名）就会把整个文件尾部吞进来。
    //    ⇒ 改成**逐行收集、见行首 `)` 即停、并限制最多 10 行**。
    const lines = PL.split('\n')
    const defs = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => !/^\s*#/.test(l) && /^\s*GATE_PRESET\s*=/.test(l))
    expect(defs.length, 'GATE_PRESET 应**恰好定义一次**（多处定义 ⇒ Python 取最后一个，测试会与运行时不一致）').toBe(1)
    let chunk = lines[defs[0].i]
    if (!/\)\s*$/.test(chunk)) {
      // 跨行的括号拼接串：向下收集到行首 `)` 为止，硬上限 10 行防越界吞文件。
      for (let i = defs[0].i + 1; i < Math.min(defs[0].i + 10, lines.length); i++) {
        chunk += `\n${lines[i]}`
        if (/^\s*\)\s*$/.test(lines[i])) break
      }
    }
    return [...chunk.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]).join('')
  })()
  expect(presetSpec, 'GATE_PRESET 解析出空串 ⇒ 断言会全绿').not.toBe('')
  expect(presetSpec.split(';').length, 'GATE_PRESET 应恰好 4 段门禁；解析吞进多余内容说明收尾逻辑坏了').toBe(4)
  const gates = presetSpec.split(';').map((g) => g.split(':'))
  const gateVal = (dim: string) => Number(gates.find((g) => g[0] === dim)![1])
  /** 取清单脚本（第三份副本）某常量的赋值右值。 */
  const invRight = (name: string): string => {
    const line = INV.split('\n').find((l) => !/^\s*#/.test(l) && new RegExp(`^\\s*${name}\\b`).test(l))
    expect(line, `md3-matrix-inventory.py 里找不到 ${name} 的赋值行`).toBeDefined()
    return line!.split('=').slice(1).join('=')
  }

  /** 取脚本里的数值常量。⚠️ 不能锚到行首：`DARK_MAX=70; LIGHT_MIN=100` 写在**同一行**，
   *  锚 `^NAME=` 会静默匹配不到 ⇒ 断言变成 NaN 比较，恒绿。 */
  const constOf = (name: string): number => {
    // 跳过注释行：注释里若出现 `DARK_MAX=70`，正则会先命中注释、真正的赋值被遮住，
    // 日后改了赋值而注释没改，这条就静默放行。与 ① 的 dbg_lazy 检测器同一类错。
    const line = SH.split('\n').find((l) => !/^\s*#/.test(l) && new RegExp(`\\b${name}=[0-9.]`).test(l))
    expect(line, `脚本里找不到常量 ${name} 的赋值行`).toBeDefined()
    return Number(line!.match(new RegExp(`\\b${name}=([0-9.]+)`))![1])
  }

  it.each([
    ['DARK_MAX', 70],
    ['LIGHT_MIN', 100],
  ] as const)('%s 与 GATE_PRESET 的 mean 门禁一致', (name, documented) => {
    // 两条 mean 门禁（70 / 100）分别对应 dark / light，按出现次序取。
    const means = gates.filter((g) => g[0] === 'mean').map((g) => Number(g[1]))
    const want = name === 'DARK_MAX' ? means[0] : means[1]
    expect(constOf(name), `${name} 与 png-luma.py GATE_PRESET 不同源`).toBe(want)
    expect(want, `GATE_PRESET 的 mean 门禁应仍是 ${documented}`).toBe(documented)
  })

  it.each([
    ['MIN_CONTENT_SD', gateVal('sd'), 20],
    // ⚠️ 10 = 第二十六轮按 **6.3.0** 重标定。旧值 20 的依据是 5.2.0（登录态 25.02~66.93），
    //    而 6.3.0 的 MD3 淡蓝 FAB 登录态只有 **14.16**（n=4，方差 0）⇒ 20 会把**合法登录态**
    //    判成「会话失效」。登录页 6.11 ⇒ 两侧裕量 4.16 / 3.89。
    ['MIN_FAB_SAT', gateVal('sat'), 10],
  ] as const)('%s 与 GATE_PRESET 的 %s 门禁一致', (name, want, documented) => {
    expect(constOf(name), `${name} 与 png-luma.py GATE_PRESET 不同源`).toBe(want)
    expect(want, `GATE_PRESET 的该门禁应仍是 ${documented}`).toBe(documented)
  })

  it('GATE_PRESET 的两条 mean 门禁**区域**是顶栏中段，不是 full / 底部（变异 M7b）', () => {
    // 上一轮只钉阈值不钉区域 ⇒ 把 mean 的区域改掉（退回整幅）时门禁全绿。
    // 区域是判据的**半条命**：整幅口径实测误判 9/31。
    const means = gates.filter((g) => g[0] === 'mean')
    expect(means, 'GATE_PRESET 应有两条 mean 门禁').toHaveLength(2)
    for (const g of means) {
      expect(g[2], `mean 门禁 ${g[1]} 的区域应为顶栏中段（跟 app 主题走）`).toBe('0.20,0.02,0.80,0.09')
    }
  })

  it('清单脚本的阈值/区域是**第三份副本**，同样不得分叉（变异 M7c）', () => {
    // 该脚本零程序化调用方、零测试，历史上改它没人拦：把它退回整幅口径时
    // 清单会回到「9 张不一致」，而本文件全绿（Spec 轴 F2）。
    const pair = (invRight('DARK_MAX').match(/[\d.]+/g) ?? []).map(Number)
    expect(pair[0], '清单脚本 DARK_MAX 与采集脚本分叉').toBe(constOf('DARK_MAX'))
    expect(pair[1], '清单脚本 LIGHT_MIN 与采集脚本分叉').toBe(constOf('LIGHT_MIN'))
    const sd = Number((invRight('MIN_CONTENT_SD').match(/[\d.]+/g) ?? [])[0])
    expect(sd, '清单脚本 MIN_CONTENT_SD 与采集脚本分叉').toBe(constOf('MIN_CONTENT_SD'))
    const region = (invRight('MODE_REGION').match(/[\d.]+/g) ?? []).join(',')
    const shellBand = SH.match(/^MODE_BAND=(.+)$/m)![1].trim()
    expect(region, '清单脚本 MODE_REGION 必须与 MODE_BAND 同源（顶栏中段）').toBe(shellBand)
    expect(region, '清单脚本区域须与 GATE_PRESET 的 mean 区域同源').toBe(gates.find((g) => g[0] === 'mean')![2])
    // ⚠️ **第四份副本**（第七轮 Spec 轴 F3 补上）：上面这条只查了阈值与 MODE_REGION，
    //    而 `CONTENT_REGION` 是**另一个**区域常量，同样把内容区标准差口径复制了一份，
    //    此前**无任何测试引用**。它若分叉，「有内容」列的判据就与 GATE_PRESET 的 sd 区脱钩。
    const contentRegion = (invRight('CONTENT_REGION').match(/[\d.]+/g) ?? []).join(',')
    expect(contentRegion, '清单脚本 CONTENT_REGION 须与 GATE_PRESET 的 sd 区域同源').toBe(
      gates.find((g) => g[0] === 'sd')![2],
    )
    // 反向也钉：它必须与采集脚本 content_sd() 的硬编码区域一致（那是**第三**份）。
    const shellContent = SH.match(/content_sd\(\).*--region=([0-9.,]+)/)?.[1]
    expect(contentRegion, '清单脚本 CONTENT_REGION 须与采集脚本 content_sd() 一致').toBe(shellContent)
  })
})

describe('⑤ refresh_token 明文截图必须用完即删（含信号路径）', () => {
  it('EXIT / INT / TERM 三个 trap 都挂了 scrub_login_probe', () => {
    // 只在正常路径清理不够：被信号打断时明文 token 就留在盘上。
    for (const sig of ['EXIT', 'INT', 'TERM']) {
      const re = new RegExp(`^trap '[^']*scrub_login_probe[^']*' ${sig}$`, 'm')
      expect(re.test(SH), `trap ${sig} 上没有 scrub_login_probe`).toBe(true)
    }
  })

  it('登录探针**排他**：两个消费函数里都只被赋成 .login.png（变异 MA）', () => {
    // ⚠️ 第一版写的是 `expect(SH).toMatch(/\.login\.png/)` —— **零判别力**：
    //   脚本里到处是这个串，把探针改回 .nav.png 它照样绿（Spec 轴 F1 / Standards 轴 F6）。
    // ⚠️ 第二版只筛 `LOGIN_PROBE=` 行**仍然漏**：do_login 里真正的路径写在**局部**
    //   `probe=` 上（`probe=...` 紧跟 `LOGIN_PROBE="$probe"`），改那行照样绿。
    //   ⇒ 两个消费函数都要查，且局部变量与全局变量**都**算。
    for (const fn of ['do_login', 'ensure_session']) {
      const assigns = fnBody(SH, fn)
        .split('\n')
        .filter((l) => !/^\s*#/.test(l) && /(?:^|[\s"$])(?:LOGIN_PROBE|probe)=/.test(l))
      expect(assigns.length, `${fn}() 里找不到探针赋值行`).toBeGreaterThan(0)
      const joined = assigns.join('\n')
      expect(joined, `${fn}() 的探针必须指向 .login.png`).toMatch(/\.login\.png/)
      // ↓ 这一行才真正表达「不共用」：含明文 token 的探针与诊断截图共用 .nav.png ⇒
      //   任何一次后续导航都会盖掉它，token 是否泄漏「纯属侥幸」。
      expect(joined, `${fn}() 的探针不得与诊断截图共用 .nav.png（refresh_token 会留盘）`).not.toMatch(/\.nav\.png/)
    }
  })
})

/**
 * ⑥ 两条**新证据门禁**（第三十二轮随 D-6 / D-7 一起加）
 *
 * 这两条都不是「锦上添花的检查」，各自堵一个**静默产出错证据**的洞：
 * · `dim_guard`：截图**像素尺寸**必须等于本档声明的屏尺寸。
 *   真机实测（AVD `pictelio_low`）：`wm size 1080x2160` 之后显示**确实**改了
 *   （`Override size` / `DisplayFrames w=1080 h=2160` / `mStable=[0,72][1080,2016]`，
 *   点击坐标按新尺寸也正确落点），但 `screencap` **恒返回物理分辨率 720×1280**，
 *   **重启后依旧如此** ⇒ 屏宽轴会产出 12 张「名为 w-1080x2160-* 实为 720×1280」的图，
 *   而末位 `GOT != EXPECT` 只数张数，照样报「完成，32 张」。
 * · `frame_settled`：顶栏中段的 sd 超过 `MAX_BAND_SD` ⇒ 判为**撕裂帧**（切主题后
 *   app 未 repaint：状态栏已是新主题、app 内容还是旧主题），不计入证据。
 *   ⚠️ 早先这里写「37 张稳定帧 sd 全 **0.00**」——**与实测不符**：顶带含状态栏图标，
 *   32 张 6.3.0 实测 sd 亮 3.86~**11.59**（上沿 w-720x1280-light-*）/ 暗 **8.37**~18.25（下沿 w-1440x2560-dark-*）（撕裂帧 94.27）。
 *   阈值已据此从 20 改为 40。scrim 页（FAB 展开 / 搜索弹层）sd 3.86~12.59，**不误判**。
 */
describe('⑥ 证据门禁：尺寸必须对得上、撕裂帧不算数（D-6 / D-7）', () => {
  it('png_size 读 IHDR 宽高，且带 NF>=8 + exit（否则 awk 会对空行多吐一行 0x0）', () => {
    const body = fnBody(SH, 'png_size')
    expect(body, 'png_size 读不到 IHDR 宽高').toMatch(/16777216/)
    // ⚠️ 这两个条件是**同一条**坑的两半：缺 NF 会把空行算成 0x0 追加到输出，
    //    缺 exit 会在多行输入上全部打印 —— 两者都会让 `got` 变成两行，
    //    字符串比较恒不相等 ⇒ dim_guard 变成「每张都中止」，守卫自身失效。
    expect(body, 'png_size 必须过滤不足 8 个字段的行（od 可能吐续行）').toMatch(/NF\s*>=\s*8/)
    expect(body, 'png_size 必须在算出后立即 exit（只取第一行）').toMatch(/exit/)
  })

  it('shot() 的**重拍**与**续采**两条路径都过 dim_guard', () => {
    const body = fnBody(SH, 'shot')
    const cap = codeIndexOf(body, 'screencap')
    expect(cap, 'shot() 里找不到 screencap').toBeGreaterThan(-1)
    // ⚠️ 这里**不能**用 codeIndexOf(body,'dim_guard') 取第一次出现：shot() 里续采分支
    //    的 dim_guard 在 screencap **之前**，取第一个会拿它当重拍路径的守卫，
    //    断言恒真 —— 而真正要紧的是「存盘那一刻」那次。
    const afterCap = codeIndexOf(body.slice(cap), 'dim_guard')
    expect(afterCap, 'screencap 之后必须调 dim_guard（存盘那一刻才知道尺寸）').toBeGreaterThan(-1)
    // ⚠️ 必须在成功 echo **之前**（不能事后统计：末位 GOT 只数张数）。
    const ok = codeIndexOf(body.slice(cap), '内容区 stddev')
    expect(ok, 'shot() 里找不到成功提示').toBeGreaterThan(-1)
    expect(afterCap, 'dim_guard 必须排在「✓」之前').toBeLessThan(ok)
    // 续采路径也要查：旧文件尺寸不对时重拍也变不对（成因在环境，不在动作）。
    const existIdx = codeIndexOf(body, 'resume_reason')
    expect(
      codeIndexOf(body.slice(0, existIdx), 'dim_guard'),
      '续采读旧文件前也必须过 dim_guard（否则空等 3 次重拍再失败）',
    ).toBeGreaterThan(-1)
  })

  it('frame_settled 在 shot() 的**重拍**与**续采**两条路径都被调用（D-7 两半都要）', () => {
    const body = fnBody(SH, 'shot')
    const cap = codeIndexOf(body, 'screencap')
    // ⚠️ 同样**不能**用「第一次出现」定位（同 dim_guard 那条）：续采分支在续采分支里，
    //    取第一次会把续采那次当重拍路径的，断言恒真 —— 而真正要紧的是两条都在。
    const resumeIdx = codeIndexOf(body, 'resume_reason')
    const afterCap = codeIndexOf(body.slice(cap), 'frame_settled')
    const beforeResume = codeIndexOf(body.slice(0, resumeIdx), 'frame_settled')
    expect(cap, 'shot() 里找不到 screencap').toBeGreaterThan(-1)
    expect(resumeIdx, 'shot() 里找不到续采分支（resume_reason 调用）').toBeGreaterThan(-1)
    expect(afterCap, '重拍路径（screencap 之后）必须调 frame_settled').toBeGreaterThan(-1)
    expect(
      beforeResume,
      '续采路径也必须调 frame_settled —— 否则重跑已采齐目录时 D-7 防线一次都不执行',
    ).toBeGreaterThan(-1)
  })

  it('probe_mode 也查撕裂，否则把「没 repaint」误报成「切换失败」', () => {
    expect(fnBody(SH, 'probe_mode'), 'probe_mode 不查撕裂 ⇒ 撕裂与「点空了」在终局诊断上不可区分').toContain(
      'frame_settled',
    )
  })

  it('read_size 必须拿**声明值**与回读值比对（否则 dim_guard 形同虚设）', () => {
    const body = fnBody(SH, 'read_size')
    // ⚠️ 这条是独立复核「重要 2」的回归防线：`wm size <w>x<h>` 被拒/未生效时，
    //    输出里没有 `Override size` 行 ⇒ 回落 `Physical size` ⇒ CUR 变成物理尺寸。
    //    若不比对，dim_guard 比的也是回读值 ⇒ 720 的图会被存成 `w-1440x2560-*.png`，
    //    **与 D-8「名字对、内容错」完全同形**，守卫却放行。
    expect(body, 'read_size 必须读取声明值（形参）').toMatch(/want=/)
    expect(body, 'read_size 必须把回读值与声明值比对（不能只传给 dbg 打印）').toMatch(
      /\[ "\$s" != "\$want" \]/,
    )
    expect(body, '尺寸不符时必须中止，不能只是回退').toMatch(/exit 1/)
    // ⚠️ `reset` 的正确不变量**不是**「豁免比对」（二轮复核 F4 抓到那是新回归）：
    //    `wm size reset` 未生效时 Override 仍在 ⇒ CUR 变成陈旧 override ⇒ dim_guard 失效，
    //    正是 D-8 唯一的防线。正确做法是断言**覆盖必须已消失**。
    expect(body, 'reset 路径必须验「Override 已消失」，不能只是豁免比对').toMatch(
      /reset[\s\S]*?-n "\$ovr"[\s\S]*?exit 1/,
    )
    expect(body, 'reset 成功时取 Physical，而不是 Override').toMatch(/s="\$phys"/)
  })

  it('组件名只有一个来源：relaunch 必须用 "$ACT"，不得再写一遍字面量（F8）', () => {
    const body = fnBody(SH, 'relaunch')
    // ⚠️ 早先 `relaunch` 硬编码 `"$PKG/.LynxActivity"`，`ACT` 只剩注释在用 ⇒ 同一事实
    //    两次书写。改包名/类名漏一处 ⇒ `am start` 报错被 `2>&1 >/dev/null` 吞掉，
    //    只表现为「进程起不来」——**静默失效**，正是 D-1 的老病。
    expect(body, 'relaunch 必须用 $ACT（组件名的唯一来源）').toMatch(/-n "\$ACT"/)
    expect(body, 'relaunch 不得再写一遍字面量组件名').not.toMatch(/\$PKG\/\.LynxActivity/)
    // 断言 `ACT` 有定义，否则 `"$ACT"` 展开成空串 ⇒ am start 报组件不存在。
    // ⚠️ 不能锚 `^ACT=`：它与 `PKG` **写在同一行**（`PKG="…"; ACT="…"`），行首锚匹配不到。
    expect(SH, 'ACT 必须有定义（与 PKG 同行）').toMatch(/ACT="\$PKG\/\.LynxActivity"/)
  })

  it('frame_settled 必须**三态**：把「探针读不出来」并入「撕裂」会指错根因（F2）', () => {
    const body = fnBody(SH, 'frame_settled')
    // ⚠️ 二态版本对 0 字节 / 只有 magic / 截断的图返回「撕裂」⇒ 报「切主题未 repaint」，
    //    而真因是采集链路（adb 断连/截断）。这正是本仓反复记载的「探针无输出 vs 判据不达标」
    //    同形病；`shot()` 在 FAB/内容两条探针上早就分流了，唯独这条新路径当时漏了。
    expect(body, 'frame_settled 必须对「探针无输出」单独返回 2').toMatch(/\[ -z "\$sd" \] && return 2/)
    // 三个调用点必须都分流（只改 frame_settled 的返回值不够，调用方不读返回值等于没修）
    for (const [fn, where] of [
      ['shot', '重拍'],
      ['shot', '续采'],
      ['probe_mode', '在线探针'],
    ] as const) {
      const fb = fnBody(SH, fn)
      const m = fb.match(/_fsd\s*=\s*"\$\(frame_settled/g) ?? []
      expect(m.length, `${fn} 的${where}路径必须接住 frame_settled 的返回值`).toBeGreaterThan(0)
      expect(fb, `${fn} 必须对返回值 2（读不出来）与 1（撕裂）分别措辞`).toMatch(
        /"\$_fsd" = "2"/,
      )
      expect(fb, `${fn} 必须对返回值 1（撕裂）单独措辞`).toMatch(/"\$_fsd" = "1"/)
    }
    // ⚠️ 措辞不得把「读不出来」说成撕裂——那会让人去查 D-7 时序而不是 adb
    expect(
      fnBody(SH, 'shot'),
      '「读不出来」的消息里不得出现「撕裂」字样（否则根因指错）',
    ).toMatch(/读不出来[\s\S]{0,120}与「撕裂」是\*\*两回事\*\*/)
    // ⑥ **可达性**：把 `if [ "$_fsd" = "2" ]` 改成 `if false` 会让「读不出来」分支成死代码，
    //    而文本断言看不见（变异实测 34 全绿）。三处调用点的**每一处**都要查紧邻的上一行。
    const SHOT_BODY = fnBody(SH, 'shot')
    // ⚠️⚠️ 必须断言**出现次数**，不能只「找到就验」（实测 g1/g2/g3 三种注入全绿）：
    //    逐个校验的前提是「锚点还在」。把某一行改成 `if false` / 删掉，它就**从搜索集里
    //    消失** ⇒ 循环一次都不跑 ⇒ 永远绿灯。**「按锚点找出来再验」防不住锚点被改** ——
    //    防得住的只有「数它应该有几个」。
    const countOf = (src: string, re: RegExp) => (src.match(re) ?? []).length
    // ⚠️ 分组必须写 `(if|elif)`：写成 `if|elif …` 时 alternation 优先级会让 `if` 单独成立。
    const c2 = countOf(SHOT_BODY, /^\s*(if|elif) \[ "\$_fsd" = "2" \]; then$/gm)
    const c1 = countOf(SHOT_BODY, /^\s*(if|elif) \[ "\$_fsd" = "1" \]; then$/gm)
    expect(c2, 'shot() 的「读不出来」分支应恰好 2 处（续采 + 重拍）').toBe(2)
    expect(c1, 'shot() 的「撕裂」分支应恰好 2 处（续采 + 重拍）').toBe(2)
    for (const cond of ['if [ "$_fsd" = "2" ]; then', 'if [ "$_fsd" = "1" ]; then']) {
      const idxs = condLineIdx(SHOT_BODY, cond)
      expect(idxs.length, `shot() 里找不到分流条件 ${cond}`).toBeGreaterThan(0)
      for (const ci of idxs) {
        // ⚠️ **只查 `if` 开头的行**：`elif` 是同一条 if 链的延续，它上面那行往往是
        //    **上一支的正常提前退出**（本文件 `shot()` 里正是 `exit 1`）。把 `elif` 也
        //    送进 DEAD 会把合法代码判成壳 —— 第一版就踩了这个。
        const raw = SHOT_BODY.split('\n')[ci].trim()
        if (!raw.startsWith('if ')) continue
        // ① 条件行**自身**不得是恒假（`if false; then`）—— 只查「上一行」漏掉这一支，
        //    变异实测三种注入全绿（g1/g2/g3）。
        expect(raw, '分流条件自身被改成恒假（整支成死代码）').not.toMatch(
          /^(if|while|until)\b[^#]*\bfalse\b/,
        )
        // ② 条件行**上方**不得是死代码壳（`if false; then … fi` 把整对包进去）
        const above = SHOT_BODY
          .split('\n')
          .slice(0, ci)
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'))
        const blocker = above[above.length - 1] ?? ''
        expect(blocker, `shot() 的「${raw}」被套进死代码（紧邻着「${blocker}」）`).not.toMatch(
          DEAD,
        )
      }
    }
  })

  it('set_mode 的终局诊断**必须区分**「撕裂」与「点空」，且分流**可达**（独立复核次要 6）', () => {
    const body = fnBody(SH, 'set_mode')
    const pm = fnBody(SH, 'probe_mode')
    // ⚠️⚠️ 第一版这条只做 `toMatch(/撕裂/)` 之类的**文本存在**断言 ⇒ 把分流条件改成
    //    `if false`（文本全在、整段成死代码）**33 条全绿** —— 正是本文件自己写着
    //    「纯文本断言在**原理上**做不到：它看的是字符串在不在，不是跑起来走哪条路」。
    //    所以下面三步都要断**接线的两端**，而不只是断某个词出现过。
    //
    // ① 分流条件必须由变量驱动（挡住 `if false` / `if [ 1 = 2 ]` 这类死代码）
    expect(body, '终局分流条件必须由 $last_torn 驱动，不能是常量').toMatch(
      /if \[ -n "\$last_torn" \]; then/,
    )
    // ② $last_torn 必须真的从 probe_mode 写的分类里取（挡住「变量声明了但从没赋值」）
    expect(body, '$last_torn 必须从 $PROBE_WHY 派生，否则是未接线的空壳').toMatch(
      /last_torn="\$PROBE_WHY"|last_torn="\$\{PROBE_WHY\}"/,
    )
    // ③ probe_mode 必须真的写出**撕裂**这一类分类（挡住「分流条件在，但没人喂它撕裂值」）
    expect(pm, 'probe_mode 必须把撕裂写进 PROBE_WHY，否则撕裂分支永远进不去').toMatch(
      /PROBE_WHY="撕裂帧/,
    )
    // ④ 两条诊断都要在，且措辞不同 —— 合并成一条就等于没分流
    expect(body, '撕裂分支必须给出指向 D-7 渲染时序的诊断').toMatch(/渲染时序|repaint|D-7/)
    expect(body, '点空分支必须给出指向点击落点/坐标的诊断').toMatch(/mode_x|落点|坐标/)
    expect(body, '两条诊断不得是同一句话（合并即等于没分流）').toMatch(/未确认|最近一次原因/)
    // ⑤ **可达性**：把整对包进 `if false; then … fi` 是本文件 ③ 早已实现的那一族
    //    （DEAD 检测），⑦ 起初没套用 ⇒ 全绿。这里逐个出现处查「紧邻的上一行」。
    const cond = 'if [ -n "$last_torn" ]; then'
    const idxs = condLineIdx(body, cond)
    expect(idxs.length, 'set_mode 里找不到终局分流条件').toBeGreaterThan(0)
    for (const ci of idxs) {
      const raw = body.split('\n')[ci].trim()
      // ① 条件行自身不得恒假
      expect(raw, '终局分流条件自身被改成恒假（整支成死代码）').not.toMatch(
        /^(if|while|until)\b[^#]*\bfalse\b/,
      )
      // ② 上方不得是死代码壳
      const above = body
        .split('\n')
        .slice(0, ci)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
      const blocker = above[above.length - 1] ?? ''
      expect(
        blocker,
        '终局分流被套进了死代码（紧邻着它的是「' + blocker + '」）—— 行为断言看不见',
      ).not.toMatch(DEAD)
    }
  })

  it('MAX_BAND_SD 按**实测空档**定，而不是「稳定态=0 所以随便取」', () => {
    const v = Number(SH.match(/^MAX_BAND_SD=(\d+)$/m)![1])
    // 32 张 6.3.0 实测 sd：亮 3.86~**11.59**（上沿 w-720x1280-light-*）/ 暗 **8.37**~18.25（下沿 w-1440x2560-dark-*）（顶带含状态栏图标，
    // 暗色下白图标 vs 深底 ⇒ 局部对比大）/ 撕裂帧（n=2）94.27 ⇒ 空档 [18.25, 94.27]。
    // 40 取自空档几何中点附近，两侧余量 21.75 / 54.27。
    // ⚠️ 早先的注释写「37 张稳定帧 sd 全 0.00」并据此取 20 —— **那是旧批数字且与实测不符**：
    //   20 的下侧余量只有 1.75，换台设备（状态栏图标稍大）就会把合法页判成撕裂。
    //   这条断言就是为挡住「照着一个错的 0.00 重新调小」而存在的。
    expect(v, 'MAX_BAND_SD 变了 —— 依据是实测空档 [18.25, 94.27]，不是「稳定态 sd=0」').toBe(40)
  })
})

/**
 * ⑦ 弹层页身份探针（D-11）
 *
 * 搜索页是**底部弹层**，FAB 被完全遮住 ⇒ FAB 区 sat 实测 **0.00**，比登录页的 6.11 还低。
 * 两个状态像素**同形** ⇒ 不是阈值没调好，FAB 判据在这一页**原理上**不可用。
 * （已实测证伪两个「便宜替代」：顶带/内容区均值比 0.55/0.98 vs 0.09~8.26、
 *   顶带/弹层窄条比 0.51/0.99 vs 0.09~8.26 —— 都重叠。）
 * 所以加了显式 `sheet` 模式：**只**跳过 FAB 探针，进程 + 前台组件 + 内容三条仍要过。
 */
describe('⑦ 弹层页（sheet）走独立身份模式，不靠 FAB 探针（D-11）', () => {
  it('on_app_page 的 sheet 分支**只**跳过 FAB 探针，进程与前台组件仍必须过', () => {
    const body = fnBody(SH, 'on_app_page')
    const alive = codeIndexOf(body, 'app_alive')
    const fg = codeIndexOf(body, 'app_foreground')
    const sheet = codeIndexOf(body, '"sheet"')
    const fab = codeIndexOf(body, 'fab_sat')
    expect(alive, 'on_app_page 里找不到 app_alive').toBeGreaterThan(-1)
    expect(fg, 'on_app_page 里找不到 app_foreground').toBeGreaterThan(-1)
    expect(sheet, 'on_app_page 里找不到 sheet 分支').toBeGreaterThan(-1)
    expect(fab, 'on_app_page 里找不到 fab_sat').toBeGreaterThan(-1)
    // ⚠️ 顺序是这条断言的全部意义：两条系统信号在前，sheet 的提前返回夹在
    //    「系统信号」与「FAB 探针」**之间**。若把 sheet 分支放到 app_alive 之前，
    //    sheet 模式就等于**什么都不验** —— 那才是真正的门禁废除。
    expect(alive, 'app_alive 必须先于 sheet 提前返回').toBeLessThan(sheet)
    expect(fg, 'app_foreground 必须先于 sheet 提前返回').toBeLessThan(sheet)
    expect(sheet, 'sheet 提前返回必须晚于系统信号、早于 FAB 探针').toBeLessThan(fab)
  })

  it('搜索页的 shot 显式走 sheet 模式，且 resume_reason 把模式透传下去', () => {
    expect(SH, 'pg-*-06-search 必须走 sheet 模式（该页无 FAB，D-11）').toMatch(
      /shot "pg-\$\{mode\}-06-search"[^\n]*\bsheet\b/,
    )
    // ⚠️ 漏传的后果很具体：续采时弹层页被 FAB 探针判「不是 app 页」⇒ 每次重跑都重拍那一张，
    //    白等 3×2.5s，且日志会指向错误的根因。
    expect(
      fnBody(SH, 'resume_reason'),
      'resume_reason 必须把身份模式透传给 on_app_page，否则弹层页永远重拍',
    ).toMatch(/on_app_page "\$f" "\$kind"/)
  })

  it('sheet 模式**不得**印「拍到的是登录页」—— 那是误导性措辞（D-11 实测）', () => {
    const body = fnBody(SH, 'shot')
    const sheetBranch = body.indexOf('"$kind" = "sheet"')
    expect(sheetBranch, 'shot() 里找不到 sheet 模式的措辞分流').toBeGreaterThan(-1)
    const slice = body.slice(sheetBranch, body.indexOf('else', sheetBranch))
    expect(slice.length, '找不到 sheet 分支的 else 边界').toBeGreaterThan(0)
    expect(slice, 'sheet 分支里不得出现「登录页」措辞（弹层页 FAB 被遮是正常的）').not.toMatch(
      /登录页/,
    )
    // 反面：非 sheet 分支**仍要**保留那条措辞（它在那里是对的）
    expect(body, '非 sheet 分支仍应保留「登录页」措辞').toMatch(/拍到的是登录页或未加载/)
  })
})
