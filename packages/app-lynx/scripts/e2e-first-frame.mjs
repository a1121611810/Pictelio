// ─── app-lynx 首帧内容化 E2E 回归验证（#64） ───
// 驱动：Vivaldi 持久 profile + CDP（--remote-debugging-port=9223），裸 WebSocket（node ≥ 22 全局可用）。
// 方法学：lynx web-core 渲染须递归穿透 lynx-view 内 srcdoc iframe + shadowRoot 才能读到 x-* 元素
// （见项目 memory：lynx-automated-render-probe / lynx-login-verification-vivaldi）。
// ─── 启动方式（用平常的浏览器，不要独立 profile / 不要覆盖现有标签页） ───
// 先起 rspeedy dev（web 预览 3001，PICTELIO_LYNX_DEV=1）与 Vivaldi CDP：
//   /Applications/Vivaldi.app/Contents/MacOS/Vivaldi \
//     --remote-debugging-port=9223 --remote-allow-origins=* \
// 注意：不带 --user-data-dir（用默认 profile = 日常浏览器环境，扩展/书签/历史都在）；
// 不带 --new-window（让浏览器恢复日常会话窗口）。若 Vivaldi 已在运行，CDP 端口不生效，
// 需先关闭再启动（Chromium 系设计：已运行的实例不接受新参数）。
// 脚本默认新开一个标签页访问（不覆盖你现有的标签页），见 newPage()。
// 依赖真实 Pixiv 网络（走代理 10808），token 读自 ../.env（gitignore，勿提交）。
import { readFileSync } from 'node:fs'

const CDP_HTTP = 'http://127.0.0.1:9223'

// ─── token（.env，PIXIV_REFRESH_TOKEN） ───
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf-8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)
const TOKEN = env.PIXIV_REFRESH_TOKEN
if (!TOKEN) {
  console.error('[e2e] 缺少 PIXIV_REFRESH_TOKEN（packages/app-lynx/.env）')
  process.exit(2)
}

// ─── CDP 客户端（裸 WebSocket） ───
class CDP {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.id = 0
    this.pending = new Map()
    this.handlers = new Map()
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = res
      this.ws.onerror = () => rej(new Error('ws connect failed'))
    })
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)
      } else if (msg.method && this.handlers.has(msg.method)) {
        for (const cb of this.handlers.get(msg.method)) cb(msg.params)
      }
    }
    // Vivaldi 中途退出时拒绝所有 pending，避免 waitFor 永久挂起
    this.ws.onclose = () => {
      for (const [, p] of this.pending) p.rej(new Error('CDP WebSocket 已关闭'))
      this.pending.clear()
    }
  }
  async send(method, params = {}) {
    await this.ready
    const id = ++this.id
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  on(method, cb) {
    if (!this.handlers.has(method)) this.handlers.set(method, [])
    this.handlers.get(method).push(cb)
  }
  close() {
    try { this.ws.close() } catch { /* noop */ }
  }
}

// ─── 渲染探测：递归穿透 iframe + shadowRoot，收集 x-* 元素 ───
const PROBE_EXPR = `(() => {
  const out = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      const tag = el.tagName.toLowerCase();
      if (['x-view','x-text','x-input','x-image','list-item'].includes(tag)) {
        out.push({ tag, t: (el.textContent || '').replace(/\\s+/g,' ').trim().slice(0, 60), c: (el.getAttribute('class') || '').slice(0, 90) });
      }
      if (el.shadowRoot) walk(el.shadowRoot);
      if (el.tagName === 'IFRAME') { try { const d = el.contentDocument; if (d) walk(d); } catch {} }
    }
  };
  walk(document);
  return out;
})()`

async function evalJS(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) {
    throw new Error('eval exception: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
  }
  return r.result?.value
}
const probe = (cdp) => evalJS(cdp, PROBE_EXPR)
const hasText = (els, s) => els.some((e) => e.t.startsWith(s))
const hasClass = (els, c) => els.some((e) => e.c.includes(c))

async function waitFor(cdp, fn, { timeout = 40000, interval = 300, label = 'condition' } = {}) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeout) {
    try {
      last = await fn()
    } catch {
      last = null // reload 等 context 销毁窗口的单次失败不中断轮询
    }
    if (last) return last
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`timeout waiting for ${label}; last=${String(last).slice(0, 300)}`)
}

// 自动探测 web 预览端口（rspeedy dev 3000 被占时用 3001）
async function findPreviewUrl() {
  for (const port of [3000, 3001]) {
    const url = `http://127.0.0.1:${port}/__web_preview?casename=main.web.bundle`
    try {
      const r = await fetch(url, { method: 'HEAD' })
      if (r.ok) return url
    } catch { /* 端口未监听 */ }
  }
  throw new Error('未找到 web 预览（先起 rspeedy dev）')
}

// 新开一个标签页访问（不覆盖用户现有 tab；--remote-allow-origins=* 下新建 tab 可用，
// 且新建即激活，不会像后台 tab 那样被 Vivaldi 冻结）
async function newPage() {
  const url = await findPreviewUrl()
  const r = await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
  if (!r.ok) throw new Error(`json/new 失败: HTTP ${r.status}`)
  const target = await r.json()
  if (!target.webSocketDebuggerUrl) throw new Error('json/new 未返回 webSocketDebuggerUrl')
  // 默认 profile 下新建 tab 是后台 tab，会被 Vivaldi 节能冻结（CDP 无响应）——
  // 先 /json/activate 激活解冻（实测必要；激活失败则回退 findUsablePage）
  try {
    await fetch(`${CDP_HTTP}/json/activate/${target.id}`)
    await new Promise((res) => setTimeout(res, 300))
  } catch { /* 忽略，兜底路径处理 */ }
  return target
}

// 兜底：newPage 失败时才复用现有 page target（Vivaldi 会冻结后台/僵尸 tab，逐个探测跳过）
async function findUsablePage() {
  const list = await (await fetch(`${CDP_HTTP}/json/list`)).json()
  for (const t of list) {
    if (t.type !== 'page' || (t.url || '').startsWith('chrome-extension')) continue
    const ok = await new Promise((res) => {
      const ws = new WebSocket(t.webSocketDebuggerUrl)
      const timer = setTimeout(() => { try { ws.close() } catch {} res(false) }, 2000)
      ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: '1', returnByValue: true } }))
      ws.onmessage = () => { clearTimeout(timer); try { ws.close() } catch {} res(true) }
      ws.onerror = () => { clearTimeout(timer); try { ws.close() } catch {} res(false) }
    })
    if (ok) return t
  }
  throw new Error('无可用的 page target（Vivaldi CDP 无响应）')
}

// 真实鼠标点击（坐标命中元素中心，触发 lynx 触摸管线）
// ─── 清理登录态（删除 IndexedDB 中的 refresh_token，reload 后 worker 重建） ───
// worker 的 idbKV 连接可能占用 db 导致 deleteDatabase 排队（onblocked 不删除）——
// 循环尝试 + 验证落在登录页，最多 3 轮
async function clearAuth(cdp) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await evalJS(
      cdp,
      `(async () => {
        if (!indexedDB.databases) return 'no-api';
        const dbs = await indexedDB.databases();
        await Promise.all(dbs.map((db) => new Promise((res) => {
          const req = indexedDB.deleteDatabase(db.name);
          req.onsuccess = req.onerror = req.onblocked = () => res();
        })));
        return 'deleted:' + dbs.map((d) => d.name).join(',');
      })()`,
    )
    await cdp.send('Page.reload', { ignoreCache: true })
    await waitFor(cdp, async () => (await probe(cdp)).length > 0, { timeout: 30000, label: 'render after clearAuth' })
    const els = await probe(cdp)
    if (hasText(els, 'Lynx Client MVP')) return // 已清除，落在登录页
  }
  throw new Error('clearAuth 失败：多次尝试后仍无法清除登录态')
}

// lynx 元素统一用 dispatchEvent('click') 触发 @tap（坐标点击不可靠，见 lynx-login-verification-vivaldi）
async function dispatchTap(cdp, predicateJs) {
  return evalJS(
    cdp,
    `(() => {
      let hit = null;
      const walk = (root) => {
        for (const el of root.querySelectorAll('*')) {
          if (${predicateJs}) { hit = el; return; }
          if (el.shadowRoot) walk(el.shadowRoot);
          if (el.tagName === 'IFRAME') { try { const d = el.contentDocument; if (d) walk(d); } catch {} }
        }
      };
      walk(document);
      if (hit) { hit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; }
      return false;
    })()`,
  )
}

async function login(cdp) {
  // 1) 聚焦 refresh_token 输入框：x-input 是 0×0 虚拟元素，坐标点击无法聚焦，
  //    需 evaluate 对内部原生 input 调 focus()（实测 insertText 才有效）
  const focused = await evalJS(
    cdp,
    `(() => {
      let hit = null;
      const walk = (root) => {
        for (const el of root.querySelectorAll('*')) {
          if (el.tagName.toLowerCase() === 'input') { hit = el; return; }
          if (el.shadowRoot) walk(el.shadowRoot);
          if (el.tagName === 'IFRAME') { try { const d = el.contentDocument; if (d) walk(d); } catch {} }
        }
      };
      walk(document);
      if (hit) { hit.focus(); return true; }
      return false;
    })()`,
  )
  if (!focused) throw new Error('login: 未找到输入框')
  await new Promise((r) => setTimeout(r, 300))
  // 2) Input.insertText 键入 token（vue-lynx v-model 不响应原生 value 事件，必须走 insertText）
  await cdp.send('Input.insertText', { text: TOKEN })
  await new Promise((r) => setTimeout(r, 300))
  // 3) 点击登录按钮（x-view 含 bg-brand；dispatchEvent click 为已验证路径，见 lynx-login-verification-vivaldi）
  const clicked = await evalJS(
    cdp,
    `(() => {
      let hit = null;
      const walk = (root) => {
        for (const el of root.querySelectorAll('*')) {
          if (el.tagName.toLowerCase() === 'x-view' && (el.getAttribute('class') || '').includes('bg-brand')) { hit = el; return; }
          if (el.shadowRoot) walk(el.shadowRoot);
          if (el.tagName === 'IFRAME') { try { const d = el.contentDocument; if (d) walk(d); } catch {} }
        }
      };
      walk(document);
      if (hit) { hit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; }
      return false;
    })()`,
  )
  if (!clicked) throw new Error('login: 未找到登录按钮')
}

// ─── 场景断言 ───
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

async function main() {
  let target
  try {
    target = await newPage() // 优先新开 tab（不覆盖用户现有标签页）
  } catch (err) {
    console.warn(`[e2e] 新开 tab 失败（${err.message}），回退复用现有 tab`)
    target = await findUsablePage()
  }
  console.log(`使用 target: ${target.url || '(about:blank)'}`)
  const cdp = new CDP(target.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  try {

  console.log('\n[1/4] 场景 A：未登录启动 → 登录页')
  // newPage 已通过 /json/new?url 直接导航到预览页，等待渲染即可
  await waitFor(cdp, async () => (await probe(cdp)).length > 0, { timeout: 30000, label: 'initial render' })
  await clearAuth(cdp) // 保证未登录态
  const elsA = await probe(cdp)
  const onLoginA = hasText(elsA, 'Lynx Client MVP')
  const onRecommendA = hasText(elsA, '推荐插画')
  check('A1 未登录启动落在登录页', onLoginA && !onRecommendA, `login=${onLoginA} recommend=${onRecommendA}`)

  console.log('\n[2/4] 场景 C：未登录 → 登录成功 → 推荐页自动加载（无 401 残留）')
  await login(cdp)
  const recommendC = await waitFor(cdp, async () => {
    const els = await probe(cdp)
    return hasText(els, '推荐插画') ? els : null
  }, { timeout: 45000, label: 'login → recommended' })
  const errC = recommendC.filter((e) => e.t.startsWith('加载失败') || e.t.startsWith('加载更多失败'))
  check('C1 登录后进入推荐页', hasText(recommendC, '推荐插画'))
  check('C2 无 401 错误残留', errC.length === 0, `errors=${errC.length}`)
  // 数据自动加载：等列表出现真实卡片（推荐页无骨架 class 且含作品标题 x-text）
  const loadedC = await waitFor(cdp, async () => {
    const els = await probe(cdp)
    const cardTexts = els.filter((e) => e.tag === 'x-text' && !hasClass([e], 'text-foreground-3')).length
    return cardTexts > 3 ? els : null
  }, { timeout: 45000, label: 'recommended data loaded' })
  check('C3 推荐页数据自动加载（有卡片）', !!loadedC)

  console.log('\n[3/4] 场景 B：已登录 reload → 首帧即推荐页骨架（无登录闪屏）')
  const seenLogin = []
  const seenShimmer = []
  await cdp.send('Page.reload', { ignoreCache: true })
  const endAt = Date.now() + 30000
  while (Date.now() < endAt) {
    const els = await probe(cdp)
    if (hasText(els, 'Lynx Client MVP')) seenLogin.push(Date.now())
    if (hasClass(els, 'shimmer')) seenShimmer.push(Date.now())
    // 数据加载完成的信号 = list-item 卡片出现；不能用「推荐插画且无 shimmer」——
    // reload 早期帧（bundle 加载、头部已渲染但骨架未挂载）也满足该条件（实测）
    if (els.some((e) => e.tag === 'list-item')) break
    await new Promise((r) => setTimeout(r, 50))
  }
  const finalB = await probe(cdp)
  check('B1 全程未出现登录页（无闪屏）', seenLogin.length === 0, `loginFrames=${seenLogin.length}`)
  check('B2 首帧出现推荐页骨架 shimmer', seenShimmer.length > 0, `shimmerFrames=${seenShimmer.length}`)
  check('B3 最终为推荐页', hasText(finalB, '推荐插画'))

  console.log('\n[4/4] 场景 D：KeepAlive 回归（详情返回列表不重载）')
  // 点第一张卡片进详情：@tap 绑定在卡片内容 x-view 上（list-item 是 lynx 特殊元素，
  // DOM click 不触发其事件；x-view 已验证有效——见登录按钮）
  const tapped = await dispatchTap(cdp, `el.tagName.toLowerCase() === 'x-view' && (el.getAttribute('class') || '').includes('w-full flex flex-col')`)
  if (!tapped) {
    check('D1 进入详情页', false, '未找到卡片（可能列表未加载）')
  } else {
    const detailEls = await waitFor(cdp, async () => {
      const els = await probe(cdp)
      return hasText(els, '‹ 返回') ? els : null
    }, { timeout: 30000, label: 'detail page' })
    check('D1 进入详情页', !!detailEls)
    // 点 "‹ 返回"：精确匹配返回按钮 class（py-1 pr-2）——含"返回"文本的祖先容器
    // 无 @tap 绑定，dispatch 无效（实测根容器 w-full h-full 命中不触发）
    const backTap = await dispatchTap(cdp, `el.tagName.toLowerCase() === 'x-view' && (el.getAttribute('class') || '').includes('py-1 pr-2')`)
    if (backTap) {
      const backEls = await waitFor(cdp, async () => {
        const els = await probe(cdp)
        return hasText(els, '推荐插画') ? els : null
      }, { timeout: 30000, label: 'back to recommended' })
      const listHasCards = backEls.filter((e) => e.tag === 'x-text').length > 4
      check('D2 返回后列表仍在（KeepAlive 未重载）', !!backEls && listHasCards, `texts=${backEls.filter((e) => e.tag === 'x-text').length}`)
    } else {
      check('D2 返回后列表仍在', false, '未找到返回按钮')
    }
  }

  console.log('\n[5/8] 场景 F：关注 Feed（P0-T4）')
  // 推荐页头部"关注"入口（x-view ml-6 px-1 py-1 含 关注 文本；精确匹配避免命中根容器）
  const followTap = await dispatchTap(
    cdp,
    `el.tagName.toLowerCase() === 'x-view' && (el.getAttribute('class') || '').includes('ml-6 px-1 py-1') && el.textContent && el.textContent.includes('关注')`,
  )
  if (!followTap) {
    check('F1 进入关注 Feed', false, '未找到关注入口')
  } else {
    const followEls = await waitFor(cdp, async () => {
      const els = await probe(cdp)
      // 列表或空态（新账号关注列表可能为空）都算进入成功
      return els.some((e) => e.tag === 'list-item') || hasText(els, '暂无关注更新') ? els : null
    }, { timeout: 45000, label: 'follow feed loaded (F)' })
    check('F1 进入关注 Feed 并加载', !!followEls, followEls ? (followEls.some((e) => e.tag === 'list-item') ? '列表' : '空态') : '')
    // 返回推荐页（供场景 E 使用）
    const backF = await dispatchTap(cdp, `el.tagName.toLowerCase() === 'x-view' && (el.getAttribute('class') || '').includes('py-1 pr-2')`)
    if (backF) {
      await waitFor(cdp, async () => {
        const els = await probe(cdp)
        return hasText(els, '推荐插画') ? els : null
      }, { timeout: 30000, label: 'back to recommended (F)' })
    }
  }

  console.log('\n[6/8] 场景 G：收藏列表（P0-T6）')
  // 推荐页点"我的"入口
  const meTap = await dispatchTap(cdp, `el.tagName.toLowerCase() === 'x-view' && (el.getAttribute('class') || '').includes('ml-6 px-1 py-1') && el.textContent && el.textContent.includes('我的')`)
  if (!meTap) {
    check('G1 进入收藏页', false, '未找到我的入口')
  } else {
    const meEls = await waitFor(cdp, async () => {
      const els = await probe(cdp)
      return hasText(els, 'Client 切换') ? els : null
    }, { timeout: 30000, label: 'me page (G)' })
    check('G1a 进入我的页面', !!meEls)
    const bmTap = await dispatchTap(cdp, `el.tagName.toLowerCase() === 'x-view' && (el.getAttribute('class') || '').includes('py-3.5') && el.textContent && el.textContent.trim().startsWith('我的收藏')`)
    if (!bmTap) {
      check('G1 进入收藏页', false, '未找到收藏入口')
    } else {
      const bmEls = await waitFor(cdp, async () => {
        const els = await probe(cdp)
        // 列表或空态（可能无收藏）都算进入成功
        return els.some((e) => e.tag === 'list-item') || hasText(els, '暂无收藏') ? els : null
      }, { timeout: 45000, label: 'bookmarks loaded (G)' })
      check('G1 进入收藏页并加载', !!bmEls, bmEls ? (bmEls.some((e) => e.tag === 'list-item') ? '列表' : '空态') : '')
      // 返回推荐页（收藏 → 我的 → 推荐，供场景 E 使用）
      await dispatchTap(cdp, `el.tagName.toLowerCase() === 'x-view' && (el.getAttribute('class') || '').includes('py-1 pr-2')`)
      await waitFor(cdp, async () => {
        const els = await probe(cdp)
        return hasText(els, 'Client 切换') ? els : null
      }, { timeout: 30000, label: 'back to me (G)' }).catch(() => null)
      await dispatchTap(cdp, `el.tagName.toLowerCase() === 'x-view' && (el.getAttribute('class') || '').includes('py-1 pr-2')`)
      await waitFor(cdp, async () => {
        const els = await probe(cdp)
        return hasText(els, '推荐插画') ? els : null
      }, { timeout: 30000, label: 'back to recommended (G)' }).catch(() => null)
    }
  }

  console.log('\n[7/8] 场景 E：作者主页（P0-T1）')
  // 进详情页（复用 D 的卡片点击）
  const tappedE = await dispatchTap(cdp, `el.tagName.toLowerCase() === 'x-view' && (el.getAttribute('class') || '').includes('w-full flex flex-col')`)
  if (!tappedE) {
    check('E1 进入详情页', false, '未找到卡片（列表未加载）')
  } else {
    const detailE = await waitFor(cdp, async () => {
      const els = await probe(cdp)
      return hasText(els, '‹ 返回') ? els : null
    }, { timeout: 30000, label: 'detail page (E)' })
    check('E1 进入详情页', !!detailE)
    // 作者区在详情数据返回后才渲染——先等 'by ' 作者文本出现（骨架期点击无效）
    const authorReady = await waitFor(cdp, async () => {
      const els = await probe(cdp)
      return els.some((e) => e.t.startsWith('by ')) ? els : null
    }, { timeout: 45000, label: 'detail author loaded (E)' })
    check('E1b 详情数据加载（作者区就绪）', !!authorReady)
    // 点作者区（x-view: flex flex-row items-center mt-2，T1 新增的作者点击入口）
    const authorTap = await dispatchTap(cdp, `el.tagName.toLowerCase() === 'x-view' && (el.getAttribute('class') || '').includes('flex flex-row items-center mt-2')`)
    if (!authorTap) {
      check('E2 进入作者主页', false, '未找到作者区')
    } else {
      const homeEls = await waitFor(cdp, async () => {
        const els = await probe(cdp)
        // 用户主页特征：插画/小说 tab 出现
        return hasText(els, '插画') && hasText(els, '小说') ? els : null
      }, { timeout: 30000, label: 'user home (E)' })
      check('E2 进入作者主页（tab 渲染）', !!homeEls)
      const worksEls = await waitFor(cdp, async () => {
        const els = await probe(cdp)
        return els.some((e) => e.tag === 'list-item') ? els : null
      }, { timeout: 45000, label: 'user works loaded (E)' })
      check('E3 作者主页作品列表加载', !!worksEls)
    }
  }

  console.log('\n[8/8] 场景 H：关注/粉丝列表（P0-T2）')
  // E 结束在作者主页：点"关注 N"入口（x-view py-1 px-3 含 关注 文本）
  const followEntry = await dispatchTap(cdp, `el.tagName.toLowerCase() === 'x-view' && (el.getAttribute('class') || '').includes('py-1 px-3') && el.textContent && el.textContent.trim().startsWith('关注')`)
  if (!followEntry) {
    check('H1 进入关注列表', false, '未找到关注入口')
  } else {
    const listEls = await waitFor(cdp, async () => {
      const els = await probe(cdp)
      // 用户卡片（list-item）或空态
      return els.some((e) => e.tag === 'list-item') || hasText(els, '暂无关注') ? els : null
    }, { timeout: 45000, label: 'follow list loaded (H)' })
    check('H1 进入关注列表并加载', !!listEls, listEls ? (listEls.some((e) => e.tag === 'list-item') ? '列表' : '空态') : '')
    // 列表内关注按钮（独立 waitFor，不依赖 H1 快照时序）
    if (listEls) {
      const btnEls = await waitFor(cdp, async () => {
        const els = await probe(cdp)
        return els.some((e) => e.t === '关注' || e.t === '已关注') ? els : null
      }, { timeout: 30000, label: 'follow button (H)' })
      check('H2 列表内关注按钮渲染', !!btnEls)
    }
  }

  } finally {
    cdp.close() // 异常路径也关闭 WebSocket，避免进程挂死
  }
  const failed = results.filter((r) => !r.ok)
  console.log(`\n==== 结果：${results.length - failed.length}/${results.length} 通过 ====`)
  process.exitCode = failed.length > 0 ? 1 : 0
}

main().catch((err) => {
  console.error('\n[e2e] 异常中止:', err.message)
  process.exitCode = 1
})
