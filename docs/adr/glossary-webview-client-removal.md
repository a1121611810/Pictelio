# WebView 客户端源码删除 — 统一术语文档（glossary-webview-client-removal）

> 状态：已定稿。决策：[ADR-0203-webview-client-source-removal.md](./ADR-0203-webview-client-source-removal.md)。
> 前序：[glossary-single-engine-facade.md](./glossary-single-engine-facade.md)（本文档**取代**其「源码留存 / 依赖留存 / 三态并存」三词）。
> 背景：[#610](https://github.com/a1121611810/Pictelio/issues/610) 已下线 WebView **运行时**；
> [#829](https://github.com/a1121611810/Pictelio/issues/829) 已下线 OTA **发布通道**；
> [#819](https://github.com/a1121611810/Pictelio/issues/819) 第 4 项挂账的「webview 残留」是本轮的执行对象。
> 术语惯例沿用 `CONTEXT.md`：中文定义 + 英文标识符；`_Avoid_` 标注禁用词。
> 规模数字口径：2026-09-29 `git ls-files` 实测。数字随增删变动，**引用时给命令不给定数**。

## 为什么要写这份文档

`glossary-single-engine-facade.md` 把现状描述成**三态并存**（运行时下线 / 源码留存 / 依赖留存）。
本轮执行之后，「源码留存」与「依赖留存」**都不再成立**——那三态的措辞会集体失效。
若不先钉死新词，实施期就会出现「删了一半」被写成「已删除」的老问题
（正是 ADR-0202 批评 `glossary-single-engine-facade.md` 首版的同一类错误）。

本文档只做两件事：①把「删掉了什么、留下了什么、凭什么说删干净了」变成**可复核的判据**；
②把「宿主迁移」与「客户端删除」这两个**必须分开做**的动作命名清楚。

## 术语

### 一、三个必须分开的动作

**运行时下线（runtime decommissioned）**：
WebView 客户端在构建链与进程入口层面的下线，随 #610 完成。本轮**不重复**该动作。
复核命令见 `glossary-single-engine-facade.md` 的判据表（仍然有效，无需重抄）。

**宿主迁移（host migration）**：
把 `packages/app` 中**仍在承重**的 Android 原生工程与发布工具链迁到新包
`packages/android-host`，并改完全部路径引用。**先做、且必须先做完**。
_Avoid_: 重构（refactor）—— 迁移本身不改行为；混入行为改动会让「迁完了没有」不可判定。

**客户端删除（client removal）**：
删除 WebView 客户端的源码、构建配置、依赖与专属测试。**必须在宿主迁移完成后**做。
_Avoid_: 清理（cleanup）—— 「清理」暗示可选；本轮是删除，不再有「暂时保留」这个状态。

> **硬顺序**：宿主迁移 → 客户端删除。二者之间不存在可并行的窗口。
> 原因是 `packages/app-lynx/lynx.config.ts:15,22` 与 `vitest.config.ts:8` 在**构建期 fail-closed**
> 读 `packages/app/credentials.json5` 与 `packages/app/package.json` 的 `version`；
> `scripts/check-push-refs.mjs:22` 反向 import `packages/app/scripts/lib/git-refs.mjs`；
> `.github/workflows/ci.yml` 的 `android-unit-test` job 用 `working-directory: packages/app/android`。
> 先删包会同时打断 Lynx 构建、pre-push 门禁与 CI 原生单测。

### 二、删除后成立的两个状态

**源码删除（source removed）**：
`packages/app/src/**` 的 SolidJS 客户端源码（实测 295 个被追踪文件）**已从仓库删除**。
删后不存在「无 Activity 承载的留存源码」这一中间态。
_Avoid_: 源码留存（source retained）—— 那是删除前的状态；删除后使用本词会误导读者去找可运行代码。
_Avoid_: 已废弃（deprecated）—— 废弃暗示可恢复；本轮无恢复路径。

**依赖清零（dependency zeroed）**：
5 个 Capacitor npm 依赖（`@capacitor/{android,app,core,preferences,cli}`）与
`@aparajita/capacitor-secure-storage` 随源码一并从 `package.json` 移除，**全仓不再声明**。
_Avoid_: 依赖留存（dependency retained）—— 那是删除前的状态。
⚠️ 「依赖清零」**不等于**「仓库内不再出现 `capacitor` 字样」——见下文「存量格式契约」。

**两态收敛（two-state collapse）**：
`glossary-single-engine-facade.md` 的三态并存收敛为两态：**运行时下线 + 源码删除**
（依赖清零是源码删除的派生结果，不是独立状态）。
本词**取代**「三态并存」。

> **口径纠正（对前序文档的显式订正）**：
> `glossary-single-engine-facade.md` 把「APK 内仍残留 `assets/public/*`」与「运行时已下线」并列为两态。
> 本轮清掉本机残留后，**APK 内不再打包任何 web bundle**——gradle 早已不裁剪 assets
> （`app/build.gradle` 注释：「assets 只剩 `main.lynx.bundle`」），
> 残留纯粹是**本机 git-ignored 旧产物**。它不是「状态」，是**未清理的磁盘垃圾**。
> 复核：清掉 `packages/app/android/app/src/main/assets/public/` 后重新 `assembleDebug`，
> 解压 APK 断言 `assets/public` 与 `capacitor.*.json` 均不存在。

### 三、必须分清的三类「capacitor 字样」

删除源码后，`capacitor` 字样**不应**从仓库清零。按性质分三类，处置不同：

| 类别 | 实例 | 处置 | 理由 |
| --- | --- | --- | --- |
| **依赖声明** | `package.json` 的 5 个 `@capacitor/*` | **删除** | 无消费方 |
| **构建期残留** | `capacitor.settings.gradle` / `capacitor.build.gradle` / `capacitor-cordova-android-plugins/` | **删除本机副本** | git-ignored 生成物，`settings.gradle` 早已不 include |
| **存量格式契约** | `SecureStorageCompat.java` 的 `PREFIX = "capacitor-storage_"`；`ImageHostConfig` / `PictelioPrefsModule` 的 `PREFS_NAME = "CapacitorStorage"` | **保留，一字不改** | 存量用户数据格式。改动会导致已安装用户 refresh_token 与全部设置读不到（ADR-0050） |

**存量格式契约（persisted-format contract）**：
为兼容已安装用户而**必须原样保留**的历史数据格式常量。
判据：改动会让**已安装的旧版本用户**丢失数据或设置，则该字面量属此类。
_Avoid_: 历史包袱（legacy baggage）—— 包袱可清理；存量格式契约清理等于数据事故。

> 由此推出一条**必须写进验收的断言**：`capacitor` 字样在 `packages/android-host/android/app/src/**`
> 的出现次数**减少但不归零**。把它断言成 0 是一条**恒假**的防线。

### 四、迁移中的关键概念

**宿主包（host package）**：
`packages/android-host`。承重三件事：Android Gradle 工程、发布/构建脚本、原生 E2E。
它**不是**一个客户端——它只负责把 Lynx 客户端的产物装进 APK 并发出去。
_Avoid_: 应用包（app package）—— 「应用」指产品，本包只是应用的构建宿主。

**事实源迁移（source-of-truth migration）**：
两处跨包构建期读取的归属变更，随宿主迁移一并完成：

| 事实 | 原位置 | 新位置 | 消费方 |
| --- | --- | --- | --- |
| Pixiv OAuth 凭证 | `packages/app/credentials.json5` | `packages/app-lynx/credentials.json5` | `lynx.config.ts`（自身包内）+ `sync-credentials.mjs` |
| 产品版本号 | `packages/app/package.json` 的 `version` | `packages/app-lynx/package.json` 的 `version` | `lynx.config.ts` / `vitest.config.ts`（自身包内）+ `sync-android-version.mjs` |

迁移后，**app-lynx 不再跨包 fail-closed 读取**——它读自己的文件。
理由：Lynx 已是唯一客户端，产品版本与客户端凭证天然属于它；宿主包消费它们，而非相反。

**保真迁移（faithful migration）**：
迁移后的宿主包**行为等价**，判定为「以下四类资产一件不少、且全部仍被门禁覆盖」：
① 22,559 行 Java 生产代码 ② 49 个 Robolectric/JVM 单测 ③ `tests/android-e2e/**` 37 个文件
④ 22 个构建/发布脚本及其单测。
_Avoid_: 等价迁移（equivalent）—— 暗示可替换实现；保真指**逐件搬走，不改写**。

**死桥（dead bridge）**：
`packages/app/src/native/**` 的 12 个 Capacitor 插件封装。
判据：其 Java 对端（`AuthPlugin` / `OAuthPlugin` / `OtaPlugin` / `WebDav` / `PictelioShare` 等）
**已不存在于 Android 源集**，故这些封装在任何运行时下都不可用。
它们在 WebView 源码内部**并非死代码**（有 33 处包内 import），
但**跨包视角下零消费者**。本轮随源码删除，不需要单独判死。

### 五、删除后的能力口径

**能力不退化（capability parity）**：
删除 WebView 客户端**不减少**任何已交付能力。逐项对照见 ADR-0203 的能力矩阵。
例外是被**显式接受**的缺口（下称「接受的缺口」），共 4 项，均为 WebView 侧实现
**依赖已不存在的 Capacitor 插件**、即运行时本就不可用的功能。

**接受的缺口（accepted gap）**：
删除后 Lynx 侧不提供、且**不再补做**的能力：浏览历史、图床设置写入口、
图片缓存三层设置 UI、PKCE 授权码登录。
_Avoid_: 已知问题（known issue）—— 暗示待修；这些是**主动接受**的删除结果。
每项的处置见 ADR-0203「能力缺口」一节，**不得**在实施期悄悄扩大为「顺便补上」。

**存档横幅（archive banner）**：
描述已下线形态的历史文档顶部加的一行声明，**只加横幅、正文一字不改**。
沿用 `glossary-single-engine-facade.md` 的既有规则，本轮不新增也不放宽。
_Avoid_: 直接删除历史文档 —— 会丢失 ADR 之外的实现记录与踩坑结论。

## 措辞锚点（可逐字复制）

供 `README.md` / `AGENTS.md` / `packages/website/` / `CONTEXT-MAP.md` 复用：

> **单引擎**：Pictelio 是 Lynx 单引擎客户端。WebView 客户端的运行时随 #610 下线，
> 其源码与依赖随 ADR-0203 删除，仓库中不再保留。

> **宿主包**：`packages/android-host` 承重 Android Gradle 工程、发布脚本与原生 E2E；
> 它不是客户端。客户端是 `packages/app-lynx`。

> **存量格式契约**：`capacitor-storage_` / `CapacitorStorage` 是存量用户数据格式，
> 一字不改（ADR-0050）。

_Avoid_ 清单（描述当前状态时一律禁用）：双引擎、双客户端、源码留存、依赖留存、
三态并存、已废弃、待清理、暂时保留。

## 复核命令

```bash
cd /path/to/Pictelio
# 源码已删除
test ! -d packages/app && echo "OK: packages/app 不存在"
# 依赖已清零
grep -rn "@capacitor/" --include=package.json packages/ . --exclude-dir=node_modules || echo "OK: 无 capacitor 依赖声明"
# 存量格式契约仍在（必须非 0）
grep -rn "capacitor-storage_\|CapacitorStorage" packages/android-host/android/app/src/ | head
# 宿主资产齐全
git ls-files packages/android-host | wc -l
# 跨包 fail-closed 读取已解除
grep -rn "\.\./app/" packages/app-lynx/lynx.config.ts packages/app-lynx/vitest.config.ts || echo "OK: 无跨包读取"
```

## 风险与易错点

1. **「`capacitor` 全仓为 0」是恒假断言**。存量格式契约必须保留（见「存量格式契约」）。
   写防线时若断言 0 命中，它会永远红；若为了让它绿而去删 `PREFIX`，那是数据事故。
2. **AGENTS.md 的体积门禁与 `Capacitor 8.5` 断言**。删除前
   `packages/app/tests/unit/agentsMd.contract.test.ts` 以 `packages/app/package.json` 为 oracle
   断言 `AGENTS.md` 逐字含 `Capacitor 8.5`；且断言 `AGENTS.md` 字节数 ≤ 28,672（实测 28,646，余量 26 B）。
   删包后 oracle 消失，**该测试必须迁到宿主包并改写**（去掉版本号断言，保留体积门禁）。
3. **`i18nLanguageKeyConsistency.test.ts` 会读 webview 源码**。它位于 **app-lynx 包内**
   （`packages/app-lynx/tests/differential/`），但 `:14` 读 `app/src/i18n/index.ts`。
   删 `packages/app/src` 会让它**在 app-lynx 的 CI 里转红**——这是本轮唯一会「从对面炸回来」的陷阱。
4. **差分测试语义退化的表述纪律**。`packages/app/tests/unit/differential/` 的 28 个文件
   多数断言「webview 与 Lynx 逐字一致」。删掉一侧后，**不能说成「差分测试继续覆盖两端」**——
   它退化成了 Lynx 单端基准。迁移时必须改写断言与文件名，不允许原样搬运后仍叫 differential。
