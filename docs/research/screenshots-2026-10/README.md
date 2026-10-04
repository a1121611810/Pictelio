# 维度重构模拟器存证（2026-10）

顶层导航由「媒介维度」（推荐/插画/小说/我的）改为「用户问题维度」（发现/更新/书架/我的）
的真机截图。拍摄设备 = Android 模拟器 `emulator-5554`（1080×2160）。

> ⚠️ **截图会过期。** 本目录同时含「重构中途」与「最终态」两组，同一页面可能有两张。
> 引用某张图作为某项主张的证据前，**先看下面「拍摄批次」确认拍摄时点**——
> 本目录历史上就出过一次「拿一张角标实现之前拍的图当角标没做的证据」。
> 换言之：图上没看到某功能，**不能**直接推出「该功能没做」。

## 最终态（对应 3769 测试全绿的那次构建）

| 文件 | 页面 / 主张 |
|---|---|
| `12-discover.png` | **发现页**：插画/小说已降为页内二级 tab；根页不画实体顶栏（ADR-0216） |
| `10-nav-badge-visible.png` | **外环四目的地 + 未读角标**：可见「更新」项右上角红色角标 `5`；角标内收定位，未压相邻环项 |
| `14-updates.png` | **更新页 段1/段2**：关注更新、追更新（真实数据） |
| `15-updates-notifications.png` | **更新页 段3**：通知 + 页内未读徽标 `5`（与外环角标同源） |
| `16-shelf.png` | **书架页**：我的收藏 / 稍后看 两段 + 「继续读」**显式说明未实现**（不假装有数据） |
| `13-me.png` | **我的页瘦身**：调试项已全部搬走，只留账号区与 7 个资产入口 |
| `11-metrics-panel.png` | **高级 → 本地使用度量**：spec §4 P0.5 四指标的真实读出；未观察到的段显示「暂无数据」而非 `0%` |

## 重构中途（保留作过程证据，不代表最终形态）

| 文件 | 拍摄时点与内容 |
|---|---|
| `01-discover.png` | 二级 tab 落地后、角标实现**之前** |
| `02-nav-ring.png` | 角标实现**之前**的外环四项目检 —— 画面上无角标属正常，见文件头警告 |
| `03-updates.png` / `04-shelf.png` / `05-me.png` / `06-advanced.png` | 「我的」瘦身与调试项搬运完成时 |
| `07-discover-novel-tab.png` | 「发现」页切到小说二级 tab |
| `08-novel-reading-actions.png` | 小说正文页新增的「收藏 / 稍后看」动作（spec §3.1 能力对齐） |
| `08a-novel-reading-toggled.png` | 上述动作已切换后的状态 |
| `09-shelf-after-toggle.png` | 端到端闭环：正文页加入「稍后看」→ 书架段 2 出现该条 |

## spec §7 两条缺口补做后的存证（2026-10-03 22:20）

| 文件 | 主张 |
|---|---|
| `17-me-migration-notice.png` | **一次性迁移提示**：「我的」页 scroll-view 最上方的可关闭卡片，文案说明「插画与小说已合并到『发现』；收藏/稍后看/通知/追更仍在下方」。⚠️ 拍摄时该旗标尚未落盘；点「知道了」→ **强杀进程重启** → 再进「我的」提示不再出现（"一次性"跨重启成立） |
| `18-updates-empty-following-guidance.png` | **关注更新空态引导**：标题「还没有关注更新」+ 解释 + 两个出口「去关注作者」/「看看排行榜」。⚠️ 该账号**有**关注数据，正常进入看不到空态分支；此帧由**临时探针**（加载后强制 `following.value = []`）拍摄，**拍完已还原并重装**，工作区与提交一致。**取消关注不是可接受的取证手段**，故用探针而非改账号 |

## 「继续读」真机取证批次（票 #929，2026-10-04 18:0x）

⚠️ **构建形态与上面几批不同**：这批是 **`BENCH_NAV=1` 的 debug 构建**（`BENCH_NAV=1 NODE_ENV=production pnpm --dir ../app-lynx run build` + `assembleDebug`）。
`BENCH_NAV=1` 决定 `__BENCH_NAV__` 宏（`lynx.config.ts:117`），**不注入则 `router.ts:449` 整块消除、benchNav 事件发到也不导航**——
这是本次取证第一轮踩到的坑（原生 `sendGlobalEvent` 日志四次齐全、页面纹丝不动）。
所以这批图**只用于验证功能行为**，不能用来判断「生产包是否也长这样」。

| 文件 | 主张 |
|---|---|
| `19-continue-shelf-section3-empty.png` | 段 3「继续读」空态：图标 + 「还没有记录」+ 引导文案（`shelf.continueReading.empty/.hint`） |
| `20-continue-novel-body-recorded.png` | 小说正文页（进入即记录位置的触发点，`NovelDetail.vue:476`） |
| `21-continue-shelf3-chapter-label.png` | **AC1 记录**：段 3 出现该书，行内「上次读到 第1话」 |
| `22-continue-single-novel-fits-one-screen.png` | 单本小说正文一屏放得下（末尾「－完－」可见）——`@scrolltolower` 开页即触发的现场 |
| `23-continue-shelf3-chapter9-and-r18.png` | 段 3 两行并排：「上次读到 第9话」（x=0 可点）与「第1话」（R-18 受限、不可点） |
| `24-continue-page-finished-group.png` | **AC4 完成软删**：`/continue` 主列表 + 「已读完」分组（软删条目仍可见可清） |
| `25-continue-resume-row-goes-straight-to-body.png` | **AC2 直达**：点段 3 行**无视介绍页开关**直进正文（`resume: true`，ADR-0219 §2.4） |
| `26-continue-intro-cta-start-reading.png` | **AC7 介绍页 CTA（未读）**：「开始阅读」 |
| `27-continue-intro-cta-continue-reading.png` | **AC7 介绍页 CTA（已读）**：同一本翻回介绍页变「继续阅读」 |
| `28-continue-illust-detail-opened.png` | 插画详情页（浏览历史的触发点） |
| `29-continue-shelf3-illust-row-no-chapter-text.png` | **AC6 浏览历史**：段 3 出现该插画，「插画」徽章、**无**「第N话」文案 |
| `30-continue-page-mixed-novels-and-illust.png` | `/continue` 两轴混排，按最近活动倒序（插画在小说之前） |
| `31-continue-completed-novel-not-revived.png` | **AC5 完成后重开不复活**：重开已读完那本后段 3 主列表仍无它 |
| `32-continue-scenario3-blocked-airplane-forces-login.png` | **AC3 取证受阻现场**：断网后冷启动被鉴权守卫弹回登录页，够不到正文页 |
| `33-continue-defect-shelf3-first-row-black-bg.png` | 本批发现的真机缺陷：段 3 **首行**底色变黑、深色字压深色底几乎不可读（见下） |

### 本批新发现的真机缺陷

1. **书架段 3 首行底色变黑**（`33-continue-defect-shelf3-first-row-black-bg.png`，
   另见 `21` / `23` / `29` / `31`）。
   现象：段 3 的**第一行**渲染成黑底，行内标题/作者是深色字 ⇒ 几乎读不了；
   同一条目在 `/continue` 上是正常白底（`30-continue-page-mixed-novels-and-illust.png` 对照）。
   跨三次不同首行（小说 `day9 チラ見`、插画 `Hina`）均复现 ⇒ 跟**内容类型无关，跟「段 3 首行」这个位置有关**。
   位置：`packages/app-lynx/src/pages/Shelf.vue:351-353`（段 3 用裸 `v-for` + `<view class="w-full">` 包裹，
   与 `ContinueReading.vue:166-179` 用 `<list>/<list-item item-key>` 的写法不同）+
   `packages/app-lynx/src/components/ContinueRow.vue:77-79`。
   ⚠️ 根因**未定位**：已排除 `bg-surface-container-lowest`（`tokens.css` 七套配色全为 `#ffffff`）、
   `pressColor.className`（`motion.ts:119` 只有 transition 类、不含底色）、受限行分支。
   **未修**（取证任务只记录）。
2. **单本小说「一屏放得下」时开页即完成**（`22-continue-single-novel-fits-one-screen.png`）。
   现象：正文未超出视口 ⇒ `<list>` 一开始就处在下边界 ⇒ `@scrolltolower` 在首帧即触发
   ⇒ `decideNovelCompletion` 走「单本小说触底」分支 ⇒ 立刻写 `completedAt`
   ⇒ 条目**当场**离开段 3 / `/continue` 主列表，用户一个字都还没读。
   与 ADR-0219 §2.3「触底 = 读完」的口径一致（确实已触底），但用户可见后果是
   「误开一本短小说就丢掉了续读入口」。是否算缺陷需产品裁定，**未修**。

## 已在本目录留下取证的两处真机缺陷

这两条**只有真机能发现**，当时全量单测是绿的：

1. **「发现」顶层触达率恒为 0%**（`10`/`11` 拍摄前）。
   记录点原挂在 FAB 的 `select` 派发上，而冷启动直接落在 `/discover`、登录后也直接
   `navigate`，两条路径都不经过它 ⇒ 用户每次启动都看的页面占比恒 0。
   修复后 `11-metrics-panel.png` 可见「发现 33%」。
2. **修完第一版仍为 0%**：改成监听 `routeState.value.path` 后依旧不触发 ——
   `routeState` 的**占位初值**就是 `/discover`，与首落点相同 ⇒ watcher 因「值未变」不触发。
   改为监听对象引用才解决。已加反向断言门禁锁死该形态。
