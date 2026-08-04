// ─── app-lynx 设置页滚动 E2E 回归验证（issue #90） ───
// 驱动：Vivaldi 持久 profile + CDP（--remote-debugging-port=9223），裸 WebSocket（node ≥ 22 全局可用）。
// 方法学同 e2e-first-frame.mjs：递归穿透 lynx-view 内 srcdoc iframe + shadowRoot 才能读到 x-* 元素。
// 场景：登录 → 推荐页 → 我的（设置页）→ 断言可滚动 / header 固定 / 退出登录可达 / R18 开关交互。
// 运行前置：
//   1) 起 dev：PICTELIO_LYNX_DEV=1 pnpm dev（web 预览 3000/3001）
//   2) 起 Vivaldi CDP（默认 profile）：/Applications/Vivaldi.app/Contents/MacOS/Vivaldi \
//        --remote-debugging-port=9223 --remote-allow-origins=*
//   3) packages/app-lynx/.env 含 PIXIV_REFRESH_TOKEN（gitignore，勿提交）
// 退出码：0 = 全部通过；1 = 任一断言失败。
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
  console.error('[e2e-me-scroll] 缺少 PIXIV_REFRESH_TOKEN（packages/app-lynx/.env）')
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
  close() {
    try { this.ws.close() } catch { /* noop */ }
  }
}

// ─── 渲染探测：递归穿透 iframe + shadowRoot，收集 x-* 元素（含文本/class/视口位置） ───
const PROBE_EXPR = `(() => {
  const out = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      const tag = el.tagName.toLowerCase();
      const r = el.getBoundingClientRect();
      out.push({
        tag,
        t: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60),
        c: (el.getAttribute('class') || '').slice(0, 120),
        top: Math.round(r.top), bot: Math.round(r.bottom),
        sh: el.scrollHeight, ch: el.clientHeight, st: el.scrollTop,
      });
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
const findTextTop = (els, s) => {
  const e = els.find((x) => x.t.startsWith(s))
  return e ? e.top : null
}

async function waitFor(cdp, fn, { timeout = 40000, interval = 300, label = 'condition' } = {}) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeout) {
    try {
      last = await fn()
    } catch {
      last = null
    }
    if (last) return last
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`timeout waiting for ${label}; last=${String(last).slice(0, 300)}`)
}

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

async function newPage() {
  const url = await findPreviewUrl()
  const r = await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
  if (!r.ok) throw new Error(`json/new 失败: HTTP ${r.status}`)
  const target = await r.json()
  if (!target.webSocketDebuggerUrl) throw new Error('json/new 未返回 webSocketDebuggerUrl')
  try {
    await fetch(`${CDP_HTTP}/json/activate/${target.id}`)
    await new Promise((res) => setTimeout(res, 300))
  } catch { /* 忽略 */ }
  return target
}

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
    if (hasText(await probe(cdp), 'Lynx Client MVP')) return
  }
  throw new Error('clearAuth 失败')
}

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
  await cdp.send('Input.insertText', { text: TOKEN })
  await new Promise((r) => setTimeout(r, 300))
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

// 找滚动容器：优先 tag 含 scroll 的元素，兜底扫描所有 scrollHeight 溢出的元素
async function findScrollContainers(cdp) {
  return evalJS(
    cdp,
    `(() => {
      const out = [];
      const walk = (root) => {
        for (const el of root.querySelectorAll('*')) {
          const tag = el.tagName.toLowerCase();
          if (el.shadowRoot) walk(el.shadowRoot);
          if (el.tagName === 'IFRAME') { try { const d = el.contentDocument; if (d) walk(d); } catch {} }
          const overflow = getComputedStyle(el).overflowY;
          const scrollable = (tag.includes('scroll') || overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight + 10;
          if (scrollable) out.push({ tag, c: (el.getAttribute('class') || '').slice(0, 80), sh: el.scrollHeight, ch: el.clientHeight });
        }
      };
      walk(document);
      return out;
    })()`,
  )
}

// 对指定滚动容器执行滚动（delta 可为 'max' 表示滚到底），返回滚动后 scrollTop
async function scrollBy(cdp, expr, delta = 800) {
  const d = JSON.stringify(delta)
  return evalJS(
    cdp,
    `(() => {
      let hit = null;
      const walk = (root) => {
        for (const el of root.querySelectorAll('*')) {
          if (${expr}) { hit = el; return; }
          if (el.shadowRoot) walk(el.shadowRoot);
          if (el.tagName === 'IFRAME') { try { const d = el.contentDocument; if (d) walk(d); } catch {} }
        }
      };
      walk(document);
      if (!hit) return null;
      const before = hit.scrollTop;
      const max = hit.scrollHeight - hit.clientHeight;
      hit.scrollTop = ${d} === 'max' ? max : Math.max(0, before + ${d});
      hit.dispatchEvent(new Event('scroll', { bubbles: true }));
      return { before, after: hit.scrollTop, max, delta: ${d} === 'max' ? max - before : ${d} };
    })()`,
  )
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

async function main() {
  let target
  try {
    target = await newPage()
  } catch (err) {
    console.warn(`[e2e-me-scroll] 新开 tab 失败（${err.message}），回退复用现有 tab`)
    target = await findUsablePage()
  }
  console.log(`使用 target: ${target.url || '(about:blank)'}`)
  const cdp = new CDP(target.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Network.enable')
  await cdp.send('Network.clearBrowserCache')
  await cdp.send('Page.reload', { ignoreCache: true })

  try {
    console.log('\n[1/5] 未登录 → 登录 → 推荐页')
    await waitFor(cdp, async () => (await probe(cdp)).length > 0, { timeout: 30000, label: 'initial render' })
    await clearAuth(cdp)
    await login(cdp)
    await waitFor(cdp, async () => hasText(await probe(cdp), '推荐插画'), { timeout: 45000, label: 'login → recommended' })
    check('S0 登录后进入推荐页', true)

    console.log('\n[2/5] 导航到我的（设置页）')
    await waitFor(cdp, async () => {
      const els = await probe(cdp)
      if (!hasText(els, '我的')) return null
      return els
    }, { timeout: 30000, label: 'recommended header ready' })
    await dispatchTap(cdp, `el.tagName.toLowerCase() === 'x-text' && (el.textContent || '').trim() === '我的'`)
    await waitFor(cdp, async () => {
      const els = await probe(cdp)
      return hasText(els, '我的收藏') ? els : null
    }, { timeout: 30000, label: 'me page rendered' })
    check('S1 设置页渲染（我的收藏可见）', true)

    console.log('\n[3/5] 滚动能力')
    const containers = await findScrollContainers(cdp)
    check('S2 存在滚动容器', containers.length > 0, containers.length ? `found=${JSON.stringify(containers[0])}` : '无 scrollHeight 溢出容器')
    const meScroll = containers.find((c) => c.sh && c.ch) || containers[0]
    const svExpr = `el.tagName.toLowerCase() === '${meScroll ? meScroll.tag : 'scroll-view'}'`
    if (meScroll) {
      const beforeProbe = await probe(cdp)
      const loginTopBefore = findTextTop(beforeProbe, '退出登录')
      const viewH = meScroll.ch
      check('S3 退出登录初始在视口外', loginTopBefore !== null && loginTopBefore > viewH, `top=${loginTopBefore} viewH=${viewH}`)
      // 滚 800：内容必须真的上移（退出登录 top 减少 ≈delta），证明滚动生效而非仅属性写入
      const scrollRes = await scrollBy(cdp, svExpr, 800)
      await new Promise((r) => setTimeout(r, 400))
      let afterProbe = await probe(cdp)
      const loginTopMid = findTextTop(afterProbe, '退出登录')
      const moved = loginTopBefore !== null && loginTopMid !== null && loginTopMid < loginTopBefore - 500
      check('S4 滚动生效（内容实际移动）', !!scrollRes && moved, `top ${loginTopBefore}→${loginTopMid} max=${scrollRes?.max}`)
      // 滚到底：退出登录必须进入视口（整页最底部内容可达 = 全页可滚动）
      await scrollBy(cdp, svExpr, 'max')
      await new Promise((r) => setTimeout(r, 400))
      afterProbe = await probe(cdp)
      const loginTopAfter = findTextTop(afterProbe, '退出登录')
      check('S5 滚动到底后退出登录进入视口', loginTopAfter !== null && loginTopAfter < viewH, `top=${loginTopAfter} viewH=${viewH}`)
      // header 固定：顶栏标题（text-2xl 的“我的”）滚动前后位置不变；内容（我的收藏）已滚出视口
      const titleTopBefore = findTextTop(beforeProbe, '我的')
      const titleTopAfter = findTextTop(afterProbe, '我的')
      const fixedHeader =
        titleTopBefore !== null &&
        titleTopAfter !== null &&
        Math.abs(titleTopBefore - titleTopAfter) < 10 &&
        titleTopAfter < 200
      const contentTopAfter = findTextTop(afterProbe, '我的收藏')
      check('S6 header 固定（顶栏“我的”不动）', fixedHeader, `title ${titleTopBefore}→${titleTopAfter}`)
      check('S6b 内容随滚动移出视口（我的收藏）', contentTopAfter !== null && contentTopAfter < 0, `top=${contentTopAfter}`)
      // 回到顶部，供后续交互断言
      await scrollBy(cdp, svExpr, -4000)
      await new Promise((r) => setTimeout(r, 300))
    } else {
      check('S3 退出登录初始在视口外', false, '无滚动容器可断言')
      check('S4 滚动生效', false, '无滚动容器')
      check('S5 滚动到底后退出登录进入视口', false, '无滚动容器')
      check('S6 header 固定', false, '无滚动容器')
      check('S6b 内容滚动', false, '无滚动容器')
    }

    console.log('\n[4/5] 分组渲染（新分组标题）')
    const groupEls = await probe(cdp)
    for (const [label, text] of [
      ['账户组', '我的收藏'],
      ['客户端组', '客户端'],
      ['内容组', '内容'],
      ['动图组', '动图播放'],
      ['退出登录组', '退出登录'],
    ]) {
      check(`S7 ${label}渲染`, hasText(groupEls, text))
    }

    console.log('\n[5/5] R18 开关交互')
    // 回滚顶部再操作开关（保证可见）
    await scrollBy(cdp, svExpr, -4000)
    await new Promise((r) => setTimeout(r, 300))
    await dispatchTap(cdp, `el.tagName.toLowerCase() === 'x-text' && (el.textContent || '').trim().startsWith('显示 R-18')`)
    await new Promise((r) => setTimeout(r, 400))
    const toggled = await probe(cdp)
    const switchOn = toggled.filter((e) => e.c.includes('bg-brand') && e.c.includes('justify-end'))
    check('S8 R18 开关切换生效（on 态出现）', switchOn.length > 0, `brand-switch=${switchOn.length}`)
  } finally {
    cdp.close()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n════ 结果：${results.length - failed.length}/${results.length} 通过 ════`)
  process.exit(failed.length ? 1 : 0)
}

main().catch((err) => {
  console.error(`[e2e-me-scroll] 异常退出: ${err.message}`)
  process.exit(1)
})
