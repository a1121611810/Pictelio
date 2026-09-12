# i18n 抽取原型实测报告（wayfinder #496）

**日期**：2026-09-12
**分支**：`prototype/i18n-extraction`（throwaway，基于 feat/solidjs-2-migration）
**范围**：按选型票 #494 的结论，在 3 个代表文件上实测「字符串外置 + 双端 i18n 模块 + 即时切换」的全链路：主端 `ErrorDisplay.tsx` + `SettingsAppearance.tsx`（含新增语言切换行），副端 `errorPresentation.ts`。

---

## 0. 一句话结论

**选型成立，可进 spec**：`@solid-primitives/i18n@3.0.0-next.4` 在 solid-js 2.0.0-rc.6 上真实可用；per-locale chunk、TS 键完备约束、settings registry 接线全部走通；双端全量单测绿（app 1676 / lynx 1154）。但抓到 **3 个必须在 spec 里定案的真实接缝**（见 §3）。

## 1. 门禁结果

| 门禁 | 结果 |
| --- | --- |
| app `tsc --noEmit`（pnpm check） | ✅ |
| app oxlint + oxfmt（vp check） | ✅ 484 文件无警告 |
| app vitest 全量 | ✅ 174 文件 / 1676 测试 |
| lynx `tsc --noEmit`（check:app-lynx） | ✅ |
| lynx vitest 全量 | ✅ 81 文件 / 1154 测试 |

## 2. 原型产物（模式定稿候选）

```
packages/app/src/i18n/
├── index.ts          # locale signal + settings 键 + translator 装配 + t()
└── locales/
    ├── zh-CN.ts      # 源语言，静态内联；导出 I18nKey / Dict 类型
    └── en.ts         # satisfies Dict（key 漂移 = 构建失败），dynamic import 分 chunk

packages/app-lynx/src/i18n/
├── index.ts          # 手写 message 模块：module ref + t() + {{var}} 插值
└── locales/{zh-CN,en}.ts
```

- **t() 恒返回 string**：字典未就绪窗口回退源语言文案（`rawT(key) ?? zhCN[key] ?? key`），组件零适配、无空白闪烁。
- **键规范**：`<域>.<区块>.<语义>`（`error.action.retry` / `settings.appearance.language`），扁平点号 key（官方推荐预扁平，免运行时 flatten）。
- **语言设置键** `settings_language`（主端 registry `define` + `apply` 钩子联动 locale signal；`""` = 跟随系统）；双端共享键名，WebDAV 备份经 registry `rawValues` 自动收编。
- **加载策略**：源语言静态内联保首帧零闪烁；非源语言 dynamic import 后台预取。README 的 async memo + `<Loading>` 悬念模式未采用（组件树无 Loading 包裹，Nullable 平滑降级更贴近现状）——是否切换属 spec 决策。

## 3. 抓到的真实接缝（spec 必须定案）

### 3.1 SolidJS 2 批处理语义 × settings apply 钩子

`apply` 钩子里的 signal 写入在无 flush 时同步读不可见（与 registry #415 注释同源：`set` 后不 flush 读到旧值）。i18n 单测首版因此挂——`t()` 靠回退链通过、`currentLocale()` 却读到旧值。**测试断言前必须 flush 微任务**；真实 app 的 set 路径在事件处理器内由 Solid 批处理收口，无影响。

### 3.2 `navigator.language` 环境污染（比调研报告更严重）

- happy-dom 默认 `navigator.language = "en-US"` → app 端 SearchResults 测试渲染出 "Retry"（跟随系统默认正常工作，但测试不确定）。
- **Node ≥22 原生暴露 `navigator.language = "en-US"`** → lynx 端 node 环境测试同样漂移成英文。
- 修法：双端各加 `setupFiles` 钉 `navigator.language = "zh-CN"`（app `tests/setup/i18n-locale.ts` + vitest.config；lynx 同构）。
- **spec 决策点**：跟随系统探测必须收敛到显式注入点——native 侧经桥注入有效 locale（调研票 #493 的 WebView 异步重置结论）、测试经 setup 注入，**业务代码禁止散读 navigator.language**。

### 3.3 错误文案的两层结构

主端用户可见错误文案分两层：`api/client.ts` 的 `classifyError`/`toApiError`（在非响应式上下文产出中文字符串，84 行）+ `ErrorDisplay` 展示层（本期已抽）。**API 层的 message 进字典需要 key 化或延迟渲染改造**（`ApiError.message` 目前是生成时的快照字符串）——这是全量迁移里最大的一块结构改造，不能纯机械替换。lynx 端同构（`client.ts` classifyError + `errorPresentation.ts` 已抽）。

## 4. 机械工作量实测与全量推算

| 试点 | 文案处数 | 改造形态 | 备注 |
| --- | --- | --- | --- |
| ErrorDisplay.tsx | 9 | switch → key 映射表 | 9 个调用方零改动 |
| SettingsAppearance.tsx | 8 + 语言行 | 直替 + 新增 UI | `fluentOn`/`useNavigate` 等 auto-import 不受影响 |
| errorPresentation.ts | 6 | HINTS 值 → key 映射 | 18 个调用方零改动；分隔符「。」/「. 」随语言走 |

- 直接断言这些文案的测试：app 1 处（SearchResults）+ lynx 1 文件 14 断言；**setup 钉 locale 后零改动通过**——文案断言测试是全量迁移的主要测试面，但可被 setup 基建整体消解。
- **推算**：321 文件纯机械抽取 ≈ 每文件 5-15 分钟；结构改造点（API 层错误文案、`toLocaleDateString("zh-CN")` 8+ 处、native 侧桥注入、lynx settingsStore 接线 + 持久化）需单独工单。建议 spec 按「错误文案层 → settings → routes → components → stores/utils」分 8-12 批。
- 未实测：生产构建 bundle 增量（per-locale chunk 在 Rolldown 下的切分）——属 spec/实施阶段验证。

## 5. 遗留到 spec（#498）的决策清单

1. README async memo + `<Loading>` 模式 vs 本原型的「静态源语言 + 动态其余 + 回退链」
2. API 层错误文案的 key 化方案（含 `ApiError.message` 生命周期）
3. `settings_language` 的 lynx 侧持久化接线（lynx settingsStore 手写键 + 双端一致性契约测试）
4. native 桥注入有效 locale 的接口形态（替代散读 navigator.language）
5. 回退到「跟随系统」的 UI 入口（原型语言行只有显式两选）
6. 日期/数字集中格式化层（8+ 处 `toLocaleDateString("zh-CN")`）
