# ADR-0203：WebView 客户端源码删除与宿主迁移

## 状态

accepted（2026-09-29）

## 背景

WebView 客户端的**运行时**已随 [#610](https://github.com/a1121611810/Pictelio/issues/610) 于 v6.3.0 下线，
OTA web bundle **发布通道**已随 [#829](https://github.com/a1121611810/Pictelio/issues/829)（[ADR-0202](./ADR-0202-ota-web-bundle-channel-retirement.md)）下线。
但**源码、依赖与测试**仍完整留在仓库，`packages/app` 一个包里挤着三样不相干的东西。

2026-09-29 实测（`git ls-files`，755 个被追踪文件）：

| 组成 | 文件数 | 性质 |
| --- | ---: | --- |
| `src/` SolidJS 客户端 | 295 | **死代码**（无 Activity 承载，永不加载） |
| `tests/` | 279 | unit 220（其中 173 依赖 `src/`）+ agent-browser 16 + android-e2e 37 |
| `android/` Gradle 工程 | 140 | **生产命脉**（22,559 行 Java，Lynx 全部原生能力） |
| `scripts/` | 22 | **生产命脉**（发布链、凭证/版本同步） |
| 根级配置 | 11 | 混合（vite/uno/index.html 死，`credentials.json5` 承重） |

**`packages/app` 不能整包删除**。四条独立的承重引用：

1. `packages/app-lynx/lynx.config.ts:15` 在**配置期 fail-closed** 读 `../app/credentials.json5`；
   `:22` 与 `vitest.config.ts:8` 读 `../app/package.json` 的 `version`。删包 ⇒ Lynx `build`/`dev`/`test` 立即 ENOENT 崩。
2. `packages/app-lynx/scripts/sync-android-assets.mjs:12` 把 Lynx bundle 写到 `../app/android/app/src/main/assets/`。
3. `scripts/check-push-refs.mjs:22` 反向 `import ... from "../packages/app/scripts/lib/git-refs.mjs"`，
   该脚本由 `.husky/pre-push` 调用 ⇒ 删包则**所有 push 被拦**。
4. `.github/workflows/ci.yml:95,100-101` 的 `android-unit-test` job 用
   `pnpm --dir packages/app run sync:credentials` 与 `working-directory: packages/app/android`。

同时，「运行时已下线」这个说法本身有歧义，正是 [ADR-0201](./ADR-0201-single-engine-facade-consolidation.md)
与 `glossary-single-engine-facade.md` 反复返工的原因。本轮先由
[`glossary-webview-client-removal.md`](./glossary-webview-client-removal.md) 钉死术语，再由本文决策。

## 决策

### 决策 1：拆成两个动作，硬顺序执行

**先宿主迁移，再客户端删除。** 二者之间不存在可并行窗口（理由见背景的四条承重引用）。

### 决策 2：宿主迁到新包 `packages/android-host`，`packages/app` 彻底删除

`packages/android-host` 承重：Android Gradle 工程（140）、构建/发布脚本（剔除 webview 专项后）、
`tests/android-e2e/**`（37）、`tests/unit/scripts/**`（15）、`tests/unit/android/**`（1）。

**保真迁移**判定（逐件搬走，不改写）：22,559 行 Java + 49 个 JVM/Robolectric 单测 +
37 个 android-e2e 文件 + 发布脚本及其单测，一件不少、且全部仍被门禁覆盖。

选「新建包」而非「留包改名」的理由：留包会让 `pictelio-app` 这个名字与内容长期错配，
且 [ADR-0059](./ADR-0059-root-script-convention.md) 的裸名委托约定仍要重写——改名的工作量一个都省不掉。

### 决策 3：两处事实源迁到 `packages/app-lynx`

| 事实 | 原位置 | 新位置 |
| --- | --- | --- |
| Pixiv OAuth 凭证 | `packages/app/credentials.json5` | `packages/app-lynx/credentials.json5` |
| 产品版本号 | `packages/app/package.json` 的 `version` | `packages/app-lynx/package.json` 的 `version` |

理由：Lynx 是唯一客户端，凭证与版本天然属于它。迁移后 **app-lynx 不再跨包 fail-closed 读取**，
宿主包改为消费它们。`sync-credentials.mjs` 与 `sync-android-version.mjs` 相应改读 `../app-lynx/`。

### 决策 4：OTA web bundle 的消费层与 API 一并清理

ADR-0202 保留了 `@pictelio/update-check` 的 web bundle API（`minWebVersion` / `webBundle` /
`parseWebBundle` / `isBelowMin`），理由是「消费层源码仍 import 它，提前删会让留存源码编译失败」。
**该前提在本轮消失**——消费层随 `src/` 一起删除，编译约束自动解除。

⚠️ **只删 web bundle API，不动 APK 更新检查**。`packages/app-lynx/src/stores/updateStore.ts:12`
消费的是 `checkForUpdate`，与 web bundle 无关。`@pictelio/update-check` **不是孤儿包**，必须留存。

### 决策 5：差分真值表迁移到 app-lynx，但**必须改写语义**

`packages/app/tests/unit/differential/` 的 28 个文件随包删除。其中承载行为基准的部分迁到
`packages/app-lynx/tests/differential/`，**改写断言与命名**：

- 「webview 与 Lynx 逐字一致」→ Lynx 单端对 Java / spec 的契约（差分的**对侧消失**，差分语义不复存在）
- 双份 `shared*.ts` fixture 删 webview 副本，Lynx 副本成为唯一事实源

**不允许**原样搬运后仍叫 differential。允许的降级形态只有一种：
`X ↔ webview 一致` ⇒ `X ↔ Java/spec 契约`（若存在对侧）或 `X 单端行为基准`（若不存在对侧）。

### 决策 6：接受的缺口（4 项，不再补做）

删除 WebView 客户端**不减少任何已交付能力**——下面 4 项在 WebView 侧的实现**依赖早已不存在的
Capacitor 插件**，运行时本就不可用。Lynx 侧对全部其余能力均已具备或更优。

| 缺口 | WebView 侧状态 | 处置 |
| --- | --- | --- |
| 浏览历史 | 依赖 TanStack DB，Lynx 零实现 | **接受**，另立票再议 |
| 图床设置写入口 | 读端 Java（`ImageHostConfig`）在 Lynx 侧生效，写端 UI 随源码删除 | **接受**（退回默认图床） |
| 图片缓存三层设置 UI | L3 走已死的 Capacitor 插件 | **接受** |
| PKCE 授权码登录 | `OAuthPlugin` 的 Java 对端已不存在 | **接受**（Lynx 用 refresh_token 粘贴） |

**实施期不得**把任何一项悄悄扩大为「顺便补上」——那是范围蔓延，不是本 ADR 的授权。

## 存量格式契约（不可动）

删除源码后，`capacitor` 字样**不应**从仓库清零。以下字面量必须原样保留：

- `SecureStorageCompat.java` 的 `PREFIX = "capacitor-storage_"`
- `ImageHostConfig` / `PictelioPrefsModule` 的 `PREFS_NAME = "CapacitorStorage"`

依据 ADR-0050。改动会导致已安装用户读不到 `refresh_token` 与全部设置——这是数据事故，不是清理。

## 后果

**正面**
- 仓库少 755 个被追踪文件中的约 500 个（死代码与其测试）
- 5 个 Capacitor npm 依赖 + `agent-browser` / `canvas` / `webdriverio` 等待办依赖出仓库
- `pnpm install` 攻击面与时长下降（`deploy.yml` 每次装全仓依赖）
- 消除「去 Capacitor 化但依赖仍在」的自相矛盾状态

**负面 / 必须一并处理**
1. **根脚本裸名约定失效**。ADR-0059 确立「`<命令>` 裸名 = 委托 `pictelio-app`」。
   删包后 `dev` / `build` / `check` / `test` / `preview` 五条裸命令失去目标，
   须重定义为委托 `pictelio-app-lynx` 或 `pictelio-android-host`。**由 ADR-0203 取代 ADR-0059 的裸名指向。**
2. **lint/fmt 覆盖面塌缩**。`vite.config.ts:18,134` 忽略 `packages/app/android/**`；
   `packages/app-lynx/**` 本就被 ADR-0185 全量豁免。删包后仓库将**几乎没有应用源码**在 lint/fmt 面内。
   体积门禁与 lint 门禁的存续本身需在新结构下重新确认。
3. **68 个单测以 `docs/specs/**` / `docs/adr/**` 为 oracle**，随源码删除而消失。
   知识（文档）不丢，但「spec 漂移」将无人发现。
4. **`agent-browser` E2E 整轮不可用**（12 spec，依赖 Vite 5173 dev server）。无替代实现。
5. **`i18nLanguageKeyConsistency.test.ts` 从对面炸**：它位于 app-lynx 包内却读
   `packages/app/src/i18n/index.ts`。删 src 会让 **app-lynx 的 CI 转红**。必须同步改写。

## 复核判据

```bash
cd /Users/lilianda/develop/pixivizer
test ! -d packages/app                                  # 客户端已删除
test -d packages/android-host/android/app/src/lynx     # 宿主已就位
grep -rn "\.\./app/" packages/app-lynx/lynx.config.ts   # 跨包读取已解除（应无输出）
grep -rn "@capacitor/" --include=package.json packages/ # 依赖已清零（应无输出）
grep -c "capacitor-storage_" packages/android-host/android/app/src/main/java/io/pictelio/app/SecureStorageCompat.java  # 存量契约仍在（应 ≥1）
git ls-files packages/android-host | wc -l              # 宿主资产齐全
```

## 参考

- 术语：[`glossary-webview-client-removal.md`](./glossary-webview-client-removal.md)
- 前序：[ADR-0201](./ADR-0201-single-engine-facade-consolidation.md)（门面收口）、
  [ADR-0202](./ADR-0202-ota-web-bundle-channel-retirement.md)（OTA 通道下线）、
  [ADR-0050](./ADR-0050-lynx-login-persistence.md)（存量存储格式）、
  [ADR-0059](./ADR-0059-root-script-convention.md)（根脚本约定，本 ADR 取代其裸名指向）
- Issue：[#610](https://github.com/a1121611810/Pictelio/issues/610)、
  [#819](https://github.com/a1121611810/Pictelio/issues/819) 第 4 项、
  [#829](https://github.com/a1121611810/Pictelio/issues/829)
- 取证口径：2026-09-29 `git ls-files` + `codegraph`，四轴并发只读取证
