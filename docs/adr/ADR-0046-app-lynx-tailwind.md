# ADR 0046: app-lynx 引入 Tailwind CSS（spacing=vw / fontSize=rpx / Fluent 语义色板）

## 状态

已采纳

## 分类

技术决策

## 日期

2026-08-01

## 背景

`packages/app-lynx` 的 6 个页面全部使用手写 scoped CSS，样式体系与 Web 生态脱节。vue-lynx 官方支持 Tailwind CSS（v3 + `@lynx-js/tailwind-preset` + `rsbuild-plugin-tailwindcss`）。目标：utility-first 开发 + 新页面默认 Tailwind。

## 原型验证（关键前置）

搭建 throwaway 原型页（`PrototypeTailwind.vue`），在 web-core 预览下实测四类单位：

| 单位 | 实测 | 结论 |
|------|------|------|
| px（arbitrary） | ✅ 正常 | 可靠 |
| vw（arbitrary） | ✅ 正常 | 可靠 |
| **rem（Tailwind 默认档）** | ✅ **正常，未塌陷** | **推翻"rem 走 --rem-unit 变量链会塌陷"的理论假设**（wasm 转换模板存在 `--rem-unit` 引用但 client.css 无定义——理论推断塌陷，实测正常；web-core 实际未对 rem 走该转换） |
| 百分比嵌套 | ✅ 正常 | 普通 view 百分比相对父正确；登录页 input 溢出是 `<input>` 元素特例（flex 修复见提交 `acf565a`） |

## 决策

1. **技术栈**：Tailwind CSS v3.4 + `@lynx-js/tailwind-preset` 0.5 + `rsbuild-plugin-tailwindcss` 0.2。**v4 禁止**（Lynx 生态不兼容，官方明确）。
2. **spacing → vw 档位**（顶层替换）：375 设计稿，N 档 = N×4px 的 vw 值（`p-4` = 4.267vw = 16px）。延续"间距随屏宽缩放"的既有响应式语义。
3. **fontSize → rpx 档位**（顶层替换）：`text-base` = 24rpx 等，沿用现有字号语义。
4. **colors → Fluent 语义色板**（extend）：`background`/`foreground`/`stroke`/`brand`/`danger`/`warning`/`success`/`overlay`，值引用 `tokens.css` 现有 CSS 变量——**tokens.css 保持单一事实源**。
5. **顶层替换而非 extend 的 spacing/fontSize**：`theme.extend` 深合并会残留 Tailwind 默认档位（spacing 72/80/96、fontSize 7xl+ 等 rem 值）——虽然原型实测 rem 在 web-core 未塌陷，但为一致性（其余布局单位全 vw/rpx）与防未来风险，显式排除 rem。
6. **迁移**：6 页面 scoped CSS → Tailwind utility 全量重写，视觉不变；`[lynx:fix]` 语义保留为模板注释 + arbitrary utility。
7. **约定**：新页面默认优先使用 Tailwind（写入 AGENTS.md 硬性约定）；禁止新增手写 scoped CSS。
8. **冗余令牌**：`--fontSize*`/`--spacing*`（被 Tailwind 映射取代、零引用）删除。

## 核心动机

- utility-first 开发效率、与 Web 生态一致的写法、官方支持（preset 为 Lynx 裁剪核心插件）
- 延续既有响应式语义（vw/rpx），与主应用（SolidJS）"字号随屏宽、间距固定"对齐（app-lynx 是间距也缩放）
- 颜色单一事实源（tokens.css 变量），Tailwind 色板只是引用层

## 风险与反面

- **`@lynx-js/tailwind-preset` 是 experimental**（官方自述）：API 可能演进，升级需回归
- **Tailwind 新类 HMR 不生效**（v3 JIT 扫描）：新增 utility 后需重启 dev server（已有文档习惯）
- **arbitrary utility 依赖类名扫描**：动态拼接类名不会生效（JIT 只扫源码字面量）——本项目动态类均用互斥条件全字符串（如 `selectedClient === 'webview' ? 'border-brand-stroke bg-brand' : 'border-stroke'`）
- **rem 未来风险**：原型实测 rem 正常，但 web-core 的 wasm 转换模板含 `--rem-unit` 引用，未来 web-core 升级可能启用转换导致 rem 塌陷——故配置层面仍禁 rem（双保险）
- **tokens.css 冗余令牌清理**：`--borderRadius*`、`--elevation*`、`--duration*` 保留（Tailwind 侧暂用 arbitrary `var()` 引用，后续可建映射）

### 正面

- 6 页面样式统一为 utility，代码量显著减少（每页删除 83–126 行 scoped CSS，Me 页 164 行）
- 新页面默认 Tailwind 约定生效，样式体系长期收敛
- 视觉零变化迁移（utility 值 = 原 CSS 值）

### 反面

- 类名长（arbitrary 多），可读性略降
- 样式从"CSS 文件集中"变为"模板内联"，设计令牌归属需靠 AGENTS.md 约定约束

## 相关

- `glossary-web-core-pitfalls.md`（web-core 已知缺陷与 Tailwind rem 风险条目）
- vue-lynx 官方文档 `tailwindcss.md`（集成方案）
- 实施提交：`062c7db`（T1 配置）、`e210b48`–`1321330`（T2–T7 页面迁移）
