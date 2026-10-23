# 两条残留结论的取证与建议：exitHint/muteTagHint 主题敏感性、`is_accept_request` 接入现状（2026-10-23）

> 起因：#1018 关票时登记的残留（两条瞬态轻提示未单独取帧）+ #755 契约校准票留下的
> 「`is_accept_request` 有类型声明但用途未落地」疑问。本篇把两条都查到底并给出结论。

---

## 1. 结论先行

| 问 | 答 |
| --- | --- |
| exitHint / muteTagHint 在明暗翻转下会出问题吗？ | **不会**。两者都用 `var(--md-inverse-*)` **CSS 变量引用**，随主题类切换**即时重算**，不存在「2 秒内看到旧色」的窗口。⇒ **不建票**，补两条源级守卫即可 |
| `is_accept_request` 项目目前接了吗？ | **没接，但这是「有意不做」而非「漏做」**。ADR-0193 与 spec D7 都把它明确列为 Out of Scope。⇒ **不建票**，维持挂账 |

---

## 2. exitHint / muteTagHint：为什么判定「无主题敏感」

### 2.1 两条提示的形态

| | exitHint | muteTagHint |
| --- | --- | --- |
| 触发 | 根页面按返回键 | 作品页长按标签静音（`Recommended.vue:287`） |
| 载体 | `App.vue` 根 `<page>` 直下的瞬态 view | 同 |
| 时长 | 2s 自动消失 | 2s 自动消失（`settingsStore.ts:919` 的 timer） |
| 配色 | `bg-inverse-surface` + `text-inverse-on-surface` | 同（`App.vue:294` / `App.vue:303`） |

### 2.2 关键事实：颜色是 CSS 变量引用，不是硬编码值

`packages/app-lynx/tailwind.config.ts` 的 inverse 色组：

```
inverse: {
  surface: 'var(--md-inverse-surface)',
  'on-surface': 'var(--md-inverse-on-surface)',
}
```

⇒ 这两个 utility **没有把颜色写死**；实际取值来自 `packages/app-lynx/src/styles/tokens.css`
的 `--md-inverse-*` 变量，而该变量在每套色板的 `.theme-*` / `.theme-*.dark` 段里各有一份。

### 2.3 明暗两套色板的 inverse 取值确实不同（但这不构成问题）

以 sky 色板为例：

| | `--md-inverse-surface` | `--md-inverse-on-surface` |
| --- | --- | --- |
| 亮（`tokens.css:50`） | `#2e3136`（深底） | `#eff1f7`（浅字） |
| 暗（`tokens.css:762`） | `#e0e2e8`（浅底） | `#2d3135`（深字） |

⇒ 值确实随主题切换而变。**但正因为是变量引用，切换主题类的那一刻浏览器就会重新求值
并重绘** —— 不存在「组件把旧色快照下来」的机制。

> ⚠️ 我最初怀疑的方向（「翻转后 2 秒内看到旧色」）**不成立**：那要求组件把颜色
> 求值成静态值再缓存，而 Tailwind utility 走的是变量引用，天然是动态的。

### 2.4 那 #1018 为什么没给它们单独取帧？

不是「怕取到旧色」，而是**瞬态性**：两条提示 2 秒自动消失，而 #1018 的取证方法是
「翻转主题 → 取第二帧」。要取到第二帧，就得在**提示还在屏上的那 2 秒内**完成一次
主题翻转 —— 时序上极不可靠。⇒ **只能定性，不能取证**。

### 2.5 可达性也低

- 根页面**没有**外观切换入口（外观设置在「我的 → 外观」）；
- 而 `exitHint` 只在**根路由**按返回键时出现，`muteTagHint` 只在作品页长按标签时出现；
- ⇒ 唯一可达的翻转触发是**系统 uiMode 变化**（自动深色模式场景）。

### 2.6 建议（不建票）

**加两条源级守卫**，把「不得退化成静态色」这条不变量钉住 —— 比真机取帧便宜得多，
且覆盖的正是真实风险点（有人日后把它改成硬编码色值 / 加 `theme` 快照）：

1. 断言两条提示都**不出现字面量颜色**（`#` / `rgb(` / 具名色）⇒ 强制走令牌；
2. 断言两者都**挂在根 `<page>` 直下**且**用 inverse 令牌**（`bg-inverse-surface` /
   `text-inverse-on-surface`）⇒ 钉住「瞬态轻提示统一形态」这条 ADR-0187 D5 约定。

落点建议：`packages/app-lynx/tests/dialogThemeFlipContract.test.ts`（已有 #1018 的
CI 防线宿主，就近加，避免新开门禁文件）。

**不建议**开票：影响面 = 「2 秒旧色 snackbar」，而该风险已被 CSS 变量机制排除。

---

## 3. `is_accept_request`：接入现状分析

### 3.1 字段语义

Pixiv API `user` 块里的布尔字段 = **好P友申请状态**（对方是否发来/你是否已接受
好P友申请）。本仓一手抓包实测（`docs/research/mypixiv-real-capture-2026-10.md`）：
mypixiv 28/28 + following 30/30 条目**均带此键**，true / false 两侧都出现过。

### 3.2 现状：本仓**零生产消费方**

全仓 grep 命中仅 4 类：

| 类别 | 位置 |
| --- | --- |
| 类型声明（唯一） | `packages/app-lynx/src/api/types.ts:22` — `is_accept_request?: boolean;` |
| fixture | `src/api/__fixtures__/search-users.json`、`mypixiv-users.json`、`tests/fixtures/novel-recommended.real.json` |
| 契约测试断言 | `src/api/user.test.ts:82`/`:87`/`:90`/`:91`/`:96`/`:97`/`:129`/`:131` |
| 文档提及 | `docs/specs/lynx-mypixiv.md:52` / `docs/adr/ADR-0193-lynx-mypixiv-list.md:56`/`:57` 等 |

**无**驼峰变体（`isAcceptRequest` / `acceptRequest`）命中 ⇒ **没有任何 UI 或业务逻辑读它**。

### 3.3 为什么「没接」是**有意为之**，不是漏做

三处规格文件都把它明确划在范围外：

- `docs/adr/ADR-0193-lynx-mypixiv-list.md:54`（取舍，已接受）：
  「好P友申请/审批流**未求证不做**（留待端点取证）」
- `docs/adr/ADR-0193-lynx-mypixiv-list.md:58`（后续候选，不在本期）：
  「好P友申请/审批流（**端点取证后立项**）」
- `docs/specs/lynx-mypixiv.md:48`（D7 范围口径）：
  「本批交付严格 = 双向好P友关系的**用户列表**；申请/审批流…均不做」
- `docs/specs/lynx-mypixiv.md:68`（Out of Scope）：
  「端点存在性无可靠来源（六客户端交叉验证未覆盖写操作）——**未求证，不做**」

### 3.4 端点侧现状（联网复核，2026-10-23）

Pixiv **公开 API 未提供**好P友申请的受理/审批写端点。检索到的公开 SDK
（pixiv-api / pixiv-cli / pixiv-cui 等）暴露的都是**读**端点
（`/v1/user/mypixiv`、`/v1/illust/mypixiv` 等），**无** accept/approve 类写操作。
⇒ 「未做」的技术理由仍然成立：即便要做，**写端点也没有可依据的公开来源**。

### 3.5 建议

**维持挂账，不建票、不实现**。理由：

1. 该字段是**服务端下发的事实**，本仓的类型层已声明（#755 契约校准的成果），
   契约面完整；
2. 要做「处理对方的好P友申请」需要**写端点**，而公开来源不存在 ⇒ 无法实现，
   不是「没排期」；
3. `is_accept_request` 保持**可选**（`?: boolean`）是保守正确的选择 ——
   其它端点的 user 块未逐一实测。

**若将来要做**，前置条件是：拿到写端点的一手来源（官方客户端抓包），
再按「ADR-0193 后续候选」的流程立项。

---

## 4. 两条残留的共同处置口径

| 残留 | 判定 | 处置 |
| --- | --- | --- |
| exitHint / muteTagHint 未取帧 | **无风险**（CSS 变量引用 ⇒ 主题切换即时重算） | 补源级守卫；**不建票** |
| `is_accept_request` 无消费方 | **有意不做**（写端点无公开来源） | 维持挂账；**不建票** |

⇒ 两处都**不新增 issue**。#1018 与 #755 的关票结论维持不变（详见两票的关票评论）。
