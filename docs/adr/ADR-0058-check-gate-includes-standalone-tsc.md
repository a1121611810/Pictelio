# ADR-0058：`pnpm check` 质量门禁包含独立 tsc 类型检查

`pnpm check` 此前只运行 `vp check`（oxfmt + oxlint，且 lint 因 `_redactProxyUrl` 的 `no-underscore-dangle` 警告超限处于红态），没有任何真实类型检查门禁。决定：`check` 脚本改为 `vp check && tsc --noEmit -p tsconfig.json`，并用独立 tsc 提供类型门禁；同时修复存量类型错误（`new Blob([Uint8Array<ArrayBufferLike>])` 的 typed-array 泛型不兼容、`appearance="accent"` 不在 Fluent 2 联合类型、`imageLoader.ts` 的 `process` 环境探测）与 lint 红（`_redactProxyUrl` 改名 `redactProxyUrl`，与 app-lynx `proxyRedact.ts` 命名统一）。

## Considered Options

- **vite-plus 内置 `lint.options.typeCheck`（否决）**：0.2.6 中 `typeCheck` 强制绑定 `typeAware`，启用后 oxlint 类型感知规则全开，实测 437 errors + 357 warnings（如测试中大量 `unbound-method`），需大规模规则调优，不可接受。未来若想复用 vp 内置类型检查，必须先解决 typeAware 规则噪声。
- **独立 `tsc --noEmit`（采纳）**：tsc 只检查 `src`（tsconfig `include`），测试目录暂不纳入；每次 `pnpm check` 增加约 2.7s。
- **vp 任务缓存（暂不启用）**：`vp run` 的脚本缓存默认关闭，且 build 的 `dist` 输出会被自动追踪计入输入导致缓存自毒，需把脚本任务化迁移并显式排除 `dist` 输入。当前收益边际，未实施；该决策可逆，未来可单独评估。

## Consequences

`pnpm check` 从约 1.4s 变为约 3.3s（fmt + lint + tsc，无缓存），成为真实的类型门禁；此后任何类型回归都会在 check 阶段失败。
