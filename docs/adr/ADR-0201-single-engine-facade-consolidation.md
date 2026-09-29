# ADR-0201：webview 下线后的三门面收口（只改文档，不动产品代码）

## 状态

accepted（2026-09-29）

## 背景

[#610](https://github.com/a1121611810/Pictelio/issues/610) 单引擎化已合入 main，v6.3.0 是首个单引擎发布版，
`website/version.json` 的更新日志也已对外宣布「WebView 引擎已下线」。但三处门面仍叙述双引擎形态：

- `packages/website/src/pages/index.astro` 仍设「WebView 客户端」卡片与「双引擎，随心切换」整块卖点
- `README.md` 标题仍写 dual-engine、技术栈仍列 Capacitor、脚本表仍列已不存在的 `pnpm cap:*`
- `AGENTS.md` 仍写「自定义 Capacitor 插件在 `MainActivity.java` 经 `registerPlugin()` 注册」——
  该类与该机制**均已不存在**，真实存在的约束是 `LynxActivity.java` 的 `SplashScreen.installSplashScreen()`
  必须在 `super.onCreate()` 之前

同时 [\#805](https://github.com/a1121611810/Pictelio/issues/805)（文档/CI 收口执行票）**已半过期**：
其两条事实（`docs/release-checklist.md` 的「三个签名 APK」、CI 的 `testFullDebugUnitTest`）已分别由
`97c4099c` 与沙盒合流修复，且其 AGENTS.md 预算数字已过时（改前实测与本票初稿一致，完整体积账见后果段）。
#805 也从未覆盖上述三处门面。

## 决策

1. **范围 = 4 个文档门面 + 0 行产品代码。** 落地页 / README / AGENTS.md / `docs/` 存档横幅。
   `packages/app/src/**` 的 WebView 源码清理维持 [#819](https://github.com/a1121611810/Pictelio/issues/819)
   第 4 项挂账，本次不动。
2. **统一措辞锚点。** 三处门面逐字复用 `glossary-single-engine-facade.md` 的锚点句，不各写各的。
3. **落地页删除「双引擎」区块的引擎对比内容**，Hero 后直接接功能区——**不臆造**单引擎价值主张
   （「更快更轻」之类未经拍板的营销定位不写）。落地页改为承载一句**事实性**单引擎陈述
   （措辞锚点句 1，复用既有 `vc-features` 样式类，不新增 CSS）。原嵌在双引擎区块内的
   「安全与隐私」条带**保留**并归入新节——其内容与引擎无关，删除会丢失真信息。
4. **历史文档只加存档横幅，正文一字不改。** 覆盖 `docs/adr/`、`docs/research/**`、`docs/specs/**`
   与双引擎期术语文档。
5. **订正 [\#805](https://github.com/a1121611810/Pictelio/issues/805) 的过期事实**，门面工作作为其子项挂入，
   不另开平行执行票。

## 考虑过的方案

| 选项 | 为什么不选 |
|---|---|
| 连同 `packages/app/src` 源码一并清理 | 约 291 源文件（`find packages/app/src -name '*.ts' -o -name '*.tsx' \| wc -l`）+ 约 170 单测（`find packages/app/tests/unit -name '*.test.ts' \| wc -l`，计数随增删漂移），需重划 `check:all`/`test:all` 的 CI 范围并重跑全量门禁；与 #819 第 4 项重复立项。**范围应按票切分，不在文档票里夹带代码重构。** |
| 落地页把双引擎区块改写为单引擎价值主张 | 需要臆造新的对外定位（「更快更轻」等），属未经用户拍板的营销决策；只陈述事实、不造卖点。 |
| 按当前事实改写历史文档 | 会抹掉决策史——ADR 之外的实现记录一旦改写即不可考。横幅能同时满足「不误导」与「不丢记录」。 |
| 从 `AGENTS.md` 删除 `Capacitor 8.5` 字样 | 会击穿 `agentsMd.contract.test.ts` 的「技术栈行的主版本号与 package.json 一致」（以 `package.json` 为 oracle 的漂移防线），且依赖确实还在，属为了让文档好看而牺牲机器防线。 |

## 后果

- **`AGENTS.md` 有两条契约测试锚点必须存活**，`super.onCreate()` 约束是**改写**（机制从 Capacitor
  改为 SplashScreen）而非删除；`Capacitor 8.5` 是**加限定语**而非删除。二者都由
  `packages/app/tests/unit/agentsMd.contract.test.ts` 守门。
- **「逐字复用措辞锚点」必须有机器防线，否则等于没有。** 首轮 review 的反事实实验证明：
  把锚点同义改写，整套断言全绿。故新增「措辞锚点逐字存活」断言，并**只对 `AGENTS.md` 强制**
  （它受体积门禁约束，采用压缩形式，只断言两个子串）。**落地页与 README 无等价防线**——
  静态站点与 Markdown 无测试接缝，改动这两处时必须人工比对术语文档。
- **术语文档不得成为「可逐字粘贴的模板」。** 首版术语文档给出的 `AGENTS.md` 硬约束整句点名了
  被删的宿主类与注册机制，与新加的清零断言直接冲突——**照抄即让 CI 转红**（反事实实测 3 条同时转红）。
  术语文档的「提及某机制已下线」与指令文件的「不得出现该机制字样」是两种诉求，不可互相照搬。
  该教训已写回术语文档的使用约束节。
- **删除 `05_client_switch.png` 必须 T1/T2 联动**：落地页与 README 截图表同时引用它，
  两侧引用都摘掉才能删文件。
- `packages/app-lynx/CONTEXT.md` 首句原写「与 webview 客户端构成双引擎形态」，**已按本 ADR 订正**。
- `openwiki/` 的过期内容（仍描述三 flavor 与 `src/webview/` 插件）**不处理**——生成物，
  CI 定时任务会重生成；禁止手改、禁止本地 `pnpm openwiki:update`。
- 依赖留存期间，`AGENTS.md` 的 Capacitor 表述会长期「明知过时仍保留」，这是契约测试锚点的代价，
  已在术语文档显式说明，#819-4 清理依赖后同步解除。
- **`AGENTS.md` 体积账（改完即量，勿凭改前数推断）**：改前 28,613 B（余 59 B）→ 本次补齐包清单、
  锚点句与原生侧订正后一度顶到 28,672 B（余 0，贴线通过）→ 合并 OpenWiki 路由三条重复表述
  （−178 B）后为 **28,654 B（余 18 B）**。门禁常量 `28_672` 未动。
  **余量只有 6 个中文字符**：下一次往 `AGENTS.md` 加规则必然要再拿约束强度换字节，
  应先找可合并的既有表述，**不得放宽门禁**。
