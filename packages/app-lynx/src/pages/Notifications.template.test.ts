// Notifications.vue / NotificationChildren.vue 模板硬约束 + 路由注册（ADR-0188 / #728）。
// 期望值出处：ADR-0188 D4/D6/D7 + spec 边界 3/4/5/9 + ADR-0150（三态单链）/
// ADR-0061（a11y element+label）/ issue #140（list-item 图片显式高度）/
// ADR-0107 D4（refreshEpoch 重建）。模板断言 = 本仓既有源级守卫约定（Ranking.template.test 同款）。
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const src = readFileSync(fileURLToPath(new URL("./Notifications.vue", import.meta.url)), "utf8")
const childrenSrc = readFileSync(
  fileURLToPath(new URL("../components/NotificationChildren.vue", import.meta.url)),
  "utf8",
)
const router = readFileSync(fileURLToPath(new URL("../router.ts", import.meta.url)), "utf8")
const queryKeys = readFileSync(fileURLToPath(new URL("../api/queryKeys.ts", import.meta.url)), "utf8")
const store = readFileSync(
  fileURLToPath(new URL("../stores/notificationStore.ts", import.meta.url)),
  "utf8",
)
const a11y = readFileSync(fileURLToPath(new URL("../utils/accessibility.ts", import.meta.url)), "utf8")

describe("Notifications.vue 骨架硬约束", () => {
  it("首载三态互斥单链（ADR-0150：deriveFirstLoadView）", () => {
    expect(src).toContain("deriveFirstLoadView")
    expect(src).toContain("view === 'skeleton'")
    expect(src).toContain("view === 'error'")
    expect(src).toContain("view === 'empty'")
  })

  it("数据层：useNotificationsList（Vue Query）+ store 纯函数 accumulate/插入", () => {
    expect(src).toContain("useNotificationsList(")
    expect(src).toContain("flattenNotifications(")
    expect(src).toContain("buildNotificationRows(")
  })

  it("已读推进接线：拉取成功后 notifyListLoaded（失败不推进在 store 内判向）", () => {
    expect(src).toContain("list.isSuccess.value")
    expect(src).toContain("notifyListLoaded(true)")
  })

  it("KeepAlive name 配对声明（ADR-0049；本页不在 include 白名单=重进重拉）", () => {
    expect(src).toContain("name: 'notifications'")
    expect(router).toContain("'/notifications'")
  })

  it("list-item 图片显式高度（原生 LynxView aspect-ratio 解析为 0，issue #140）", () => {
    expect(src).toMatch(/w-\[12vw\] h-\[12vw\]/)
  })

  it("手势绑 view 层（lynx 平台约束：@tap 不得出现在 <text> 上）", () => {
    expect(src).not.toMatch(/<text[^>]*@tap/)
    expect(childrenSrc).not.toMatch(/<text[^>]*@tap/)
  })

  it("a11y：注册表 label 全部被模板消费且配套 element（ADR-0061）", () => {
    const registryMatch = /NOTIFICATIONS_A11Y_LABELS = \{([^}]*)\}/.exec(a11y)
    expect(registryMatch).not.toBeNull()
    const keys = [...(registryMatch![1]!.matchAll(/(\w+):/g))].map((m) => m[1]!)
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      expect(src).toContain(`NOTIFICATIONS_A11Y_LABELS.${key}`)
    }
    for (const m of src.matchAll(/:accessibility-label="NOTIFICATIONS_A11Y_LABELS\.\w+"/g)) {
      // 每处 label 引用的宿主 view 必须开启 element（模板内逐处成对）
      const around = src.slice(Math.max(0, (m.index ?? 0) - 200), (m.index ?? 0) + 100)
      expect(around).toContain("A11Y_ELEMENT_ENABLED")
    }
  })
})

describe("通知渲染安全与代理约束（spec 边界 4/5）", () => {
  it("文本经 notificationPlainText 剥离渲染（禁 HTML 注入通道：无 v-html/innerHTML）", () => {
    expect(src).toContain("notificationPlainText(")
    expect(childrenSrc).toContain("notificationPlainText(")
    expect(src).not.toContain("v-html")
    expect(src).not.toContain("innerHTML")
  })

  it("缩略图经图片服务重写通道（proxyImageUrl），禁直连 pximg/pixiv 域", () => {
    expect(src).toContain("proxyImageUrl(")
    for (const s of [src, childrenSrc, store, readFileSync(fileURLToPath(new URL("../utils/notificationTarget.ts", import.meta.url)), "utf8")]) {
      expect(s).not.toContain("i.pximg.net")
      expect(s).not.toContain("s.pximg.net")
      expect(s).not.toContain("app-api.pixiv.net")
    }
  })

  it("图片加载失败隐藏图区（不占位卡、不重试风暴：按行 key 记失败）", () => {
    expect(src).toContain("@error=")
    expect(src).toContain("failedImages")
  })
})

describe("路由与行交互（ADR-0188 D6/D7）", () => {
  it("router 注册 /notifications：requiresAuth（业务页守卫鉴权）", () => {
    expect(router).toMatch(/path: '\/notifications', name: 'notifications', component: Notifications, meta: \{ requiresAuth: true \}/)
  })

  it("行点击统一入口 openRow：组头展开、其余 target_url 解析（未知 scheme 静默忽略）", () => {
    expect(src).toContain("function openRow(")
    expect(src).toContain("openNotificationTarget(")
  })

  it("相对时间复用 time i18n 域（formatRelativeTime）", () => {
    expect(src).toContain("formatRelativeTime(")
    expect(childrenSrc).toContain("formatRelativeTime(")
  })
})

describe("NotificationChildren.vue（组头摊平子列表）", () => {
  it("独立 children query（useNotificationChildren，['pictelio','notifications','children',id]）", () => {
    expect(childrenSrc).toContain("useNotificationChildren(")
    // 键工厂单一事实源 = api/queryKeys.ts（store 经工厂引用，不散落字面量）
    expect(queryKeys).toContain("children: (id: number) => ['pictelio', 'notifications', 'children', id]")
    expect(store).toContain("queryKeys.notifications.children(headerId)")
  })

  it("older_than 游标翻页（getNextPageParam → next_url；footer 尽头 affordance）", () => {
    expect(childrenSrc).toContain("fetchNextPage")
    expect(childrenSrc).toContain("isFetchingNextPage")
    expect(childrenSrc).toContain("hasNextPage")
  })

  it("文本两行截断（[max-line:2]）+ 无内容占位", () => {
    expect(childrenSrc).toContain("[max-line:2]")
    expect(childrenSrc).toContain("notifications.noContent")
  })
})
