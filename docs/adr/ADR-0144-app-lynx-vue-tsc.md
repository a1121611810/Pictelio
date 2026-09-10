# ADR-0144: app-lynx check 工具从 tsc 切到 vue-tsc

- **状态**：提议（2026-09-10）
- **范围**：`packages/app-lynx` 单包；app 端不动。
- **背景决策**：ADR-0138（vue-router 迁移时"vue-tsc 暂缓"）——本 ADR 兑现"暂缓"的解除。

## 1. 背景

`packages/app-lynx` 是 vue-lynx 客户端（40 个 .vue 文件 / 113 个 .ts 文件）。`tsconfig.json` 的 `src/tsconfig.json` 已配置 `vueCompilerOptions.plugins: ["vue-lynx/types/volar-plugin"]`、`.vue` 已在 `include` 中——但 `package.json` 的 `check` 脚本是 `tsc --noEmit -p src/tsconfig.json`：

```jsonc
// src/tsconfig.json（节选，已存在的契约定型）
{
  "compilerOptions": { /* TS 严格模式 */ },
  "vueCompilerOptions": { "plugins": ["vue-lynx/types/volar-plugin"] },
  "include": ["./**/*.ts", "./**/*.vue", "./**/*.d.ts"]
}
```

**问题**：纯 `tsc` 不会解析 `.vue` 模板（volar/vue-tsc 的责任）——`.vue` 在 `include` 命中后只走 TS 部分（`<script setup>` 的代码），**模板表达式、`defineProps` 推导、slot 作用域绑定等 0 文件参与类型检查**。盲区具体表现：UgoiraViewer.vue 调 `settings.ugoiraMode` 拿不到 ref 类型、Recommended 拿不到 `MixFeedItem` 透传、NovelDetail 模板 `prompt?.watchAdded` 被 CFA 收窄为 `never`、CarouselSwiper 插槽里 `slides: unknown[]` 让 `#slide` 槽的 `item` 永远是 `unknown`。

盲区**真实后果**：vue-tsc 一次性接入暴露 **17 个 vue-tsc 报错**，其中 **3 个是 tsc 静默放过的真实运行时 bug**（详见 §3 收益）。

历史上 vue-tsc 接入被暂缓是 ADR-0138（vue-router 迁移）的代价控制——本次 effort 是解除该暂缓、兑现 check 工具现代化的承诺。

## 2. 决策

`packages/app-lynx/package.json` 的 `check` 脚本从 `tsc --noEmit -p src/tsconfig.json` 改为 `vue-tsc --noEmit -p src/tsconfig.json`，装 `vue-tsc@^3.3.11` 到 devDependencies。

```diff
   "scripts": {
-    "check": "tsc --noEmit -p src/tsconfig.json",
+    "check": "vue-tsc --noEmit -p src/tsconfig.json",
   },
   "devDependencies": {
+    "vue-tsc": "^3.3.11",
   }
```

`src/tsconfig.json` 已是单一事实源（vueCompilerOptions 已配），**不做修改**。`tsconfig.node.json` / `tsconfig.json` 顶层项目引用结构不动。

## 3. 收益

vue-tsc 接入**一次**抓到 17 个错误，分两类：

**3 个真运行时 bug**（这些是 tsc 静默放过、运行时表现为「详情图全白 / 关注列表请求错 / 弹窗状态不更新」）：

1. `UgoiraViewer.vue:13` + `IllustDetail.vue:19` Pinia 解构误用 `.value`：Pinia 迁移后 `useSettingsStore().ugoiraMode` 是**普通值**（非 ref），被当 ref 调 `.value` → 运行时传 undefined → `resolveQualityUrl(undefined, …)` 走 default 兜底返回空串 → 详情图 URL 空 → 详情图全白。
2. `IllustList.vue:35-39` + `NovelList.vue:31-35` 联合函数参数位错位：`loadFollow(restrict, signal)` 首参是 restrict，signal 是第二；旧 `const first = m === 'recommend' ? loadRecommended : loadFollow; first(signal)` 联合成 `first: (signal) => Promise<…>`，关注模式下 signal 落到 restrict 位 → 请求参数变 `[object AbortSignal]`、abort 丢失。
3. `NovelDetail.vue:39` 用 `let prompt: WatchlistPromptController | null` 在模板读 `prompt?.watchAdded`/`?.dialogOpen`——CFA 收窄为 `never`、实例替换不触发重渲染。**响应性 bug**（弹窗状态、追更徽标偶发不更新）。

**14 个类型盲区**（vue-tsc 闭 .vue 模板类型盲区本职，包括 `CarouselSwiper slides: unknown[]` 让 Recommended 模板 `item` 是 `unknown`、UgoiraViewer 在模板用 `ugoiraMode.value`、IllustDetail `openAuthor` 无 null 守等）。

**未来防御**：后续 .vue 改动中此类问题在 check 阶段就阻断（不依赖运行 / 模拟器回归）。

## 4. 代价与风险

- **CI 时间**：vue-tsc 解析 .vue 比 tsc 慢（实测 ~10s 增到 ~30s 量级——app-lynx 文件数少，整体仍在分钟级）。可接受。
- **门禁分歧**：vue-tsc 与 build 路径（rspack/SWC）**不共用任何编译路径**——rspack 走 `@lynx-js/rspeedy` 的 SWC 转 .vue，vue-tsc 走 `@vue/compiler-sfc` + TS compiler。两者**正交**：vue-tsc 报错不意味着 build 必挂、build 成功不意味着类型干净——本次 effort 在交付前已用 `pnpm --filter pictelio-app-lynx build` 验证构建通过。
- **false positive 风险**：vue-tsc 3.x 在 vue-lynx volar 插件配合下表现稳定（17 错均为真问题，无 false positive）。**若**未来出现 false positive，规避路径是 `@ts-expect-error` 显式抑制（项目内尚无先例；如出现需 ADR 评估）。
- **lock 副带**：装 vue-tsc 引入 `@volar/language-core@2.4.28` / `@volar/source-map@2.4.28` / `@volar/typescript@2.4.28` 三个子依赖，pnpm-lock 增加 ~65 行。本次 effort 末段跑 `pnpm install --lockfile-only` 收敛 lockfile（避免装 vue-tsc 时顺带改 resolutions 破坏 packages/app 的 vite.config 解析）。

## 5. 备选方案

### 5.1 维持 `tsc`（=不接入 vue-tsc）
拒绝理由：盲区不消失、3 个运行时 bug 长期靠模拟器/真机回归兜底。**不可接受**。

### 5.2 双跑（`tsc && vue-tsc`）
拒绝理由：vue-tsc 内部已走 tsc 包装（同样对 .ts 部分做严格检查），双跑对 .ts 重复检查、耗时 ×2、收益零。**不可接受**。

### 5.3 在 `vite-plus` 集中配置（项目根 `vp` 接管 app-lynx check）
**不**采用：app-lynx 是独立子包（vue-lynx 工具链，rspeedy 而非 vite），无 `vp` 配置；强行接入会破坏其相对独立的构建路径。仅在 app-lynx 切到 vite-plus 时（本 effort 范围外）才考虑。

### 5.4 仅修复 3 个运行时 bug，不接入 vue-tsc
**不**采用：保留盲区 = 接受未来同类 bug 继续靠人工/真机兜底。vue-tsc 接入是闭盲区 + 抓 bug 双重收益。

## 6. 实施

**变更文件**（分支 `feat/app-lynx-vue-tsc`，未推送）：
- `packages/app-lynx/package.json` — `check` 脚本 + 加 `vue-tsc` devDep
- `pnpm-lock.yaml` — 装 vue-tsc 引入 @volar/* 系列
- `packages/app-lynx/src/rspeedy-env.d.ts` — `LynxGlobalEventEmitter` 补 `removeListener`（vue-tsc 抓出）+ 加 `SystemInfo` 全局声明（CarouselSwiper 泛型 SFC 需）
- `packages/app-lynx/src/components/CarouselSwiper.vue` — 泛型 SFC（`generic="T"` + `slides: T[]`），去掉局部 SystemInfo declare
- `packages/app-lynx/src/components/UgoiraViewer.vue` — Pinia 解构 .value 误用修复
- `packages/app-lynx/src/pages/IllustDetail.vue` — 同上 + openAuthor null 守
- `packages/app-lynx/src/pages/IllustList.vue` + `NovelList.vue` — loadFollow 参数位修复
- `packages/app-lynx/src/pages/NovelDetail.vue` — `let prompt` → `shallowRef`、`runOnBackground` 回调签名对齐
- `packages/app-lynx/tests/unit.test.ts` — 源码字面量断言更新为 `prompt.value?.decline()/cancel()`

**全量门禁（验收时跑）**：
- `pnpm --filter pictelio-app-lynx check`（vue-tsc）：0 错误
- `pnpm --filter pictelio-app-lynx test`：50 文件 / 804 测试全过
- `pnpm --filter pictelio-app-lynx build`：build 成功（lynx 953.9 kB / web 939.6 kB）
- `pnpm check:all`：5 包全 pass（app fmt+lint+tsc、ugoira ts、update-check ts、app-lynx vue-tsc）
- `pnpm lint:all`：0 warnings / 0 errors

## 7. 决策窗口 / 回退

**回退**为单行 revert（`tsc --noEmit -p src/tsconfig.json`）+ 卸 devDep。但回退后盲区回归 + 3 个 runtime bug 失守——**强烈不推荐**回退，除非 vue-tsc 出现阻塞性 false positive。

**未来扩展**：app 端（SolidJS）暂不切 vue-tsc（其类型系统独立、模板路径不同）。若 vue-query/其他 .vue 大改动时**未切** vue-tsc 的项目受益于此 ADR——可参照本 ADR 走类似路径。

## 8. 关联

- **解除** ADR-0138 §4「vue-tsc 暂缓」备注
- **类比** `glossary-vue-router-migration.md` / `ADR-0138-app-lynx-vue-router.md`——同 effort 类别（vue-lynx 工具链现代化）
- **契约定型**（保持不变）：`verbatimModuleSyntax: true` / `isolatedModules: true` / `vueCompilerOptions.plugins`
- **承接本 ADR 副作用**（不是目标）：3 个运行时 bug 修复（见 §3）
