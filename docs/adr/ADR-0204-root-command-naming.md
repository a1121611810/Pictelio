# ADR-0204：根命令裸名重新定义（取代 ADR-0059 的委托指向）

## 状态

accepted（2026-09-29）

## 背景

[ADR-0059](./ADR-0059-root-script-convention.md) 确立了「`<命令>` 裸名 = 委托 `pictelio-app`」
的根脚本约定。这条约定在 WebView 客户端是唯一「应用包」时是自洽的。

但 WebView 客户端已随 [ADR-0203](./ADR-0203-webview-client-source-removal.md) 整包删除。
仓库里现在有两个性质不同的包：

- `pictelio-app-lynx` —— **客户端本体**。开发、改代码、跑测试，都是对它做的事。
- `@pictelio/android-host` —— **构建宿主**。装 APK、发版、跑模拟器 E2E。

原约定把裸名绑给前者，而后者是「把前者装进 APK 并发出去」的工具。
让「装 APK」占用「开发这个应用」的裸名，是把工具动作与应用动作混为一谈。

## 决策

### 决策 1：五条裸命令改指唯一客户端

`dev` / `build` / `check` / `test` / `preview` 一律委托 `pictelio-app-lynx`。

**本 ADR 取代 ADR-0059 的裸名指向部分**。ADR-0059 关于「根脚本统一委托、避免在根重复实现」
的其余约定继续有效。

### 决策 2：宿主包的命令一律显式命名，不占用裸名

宿主包的动作全部带 `:android-host` 后缀：

```
dev:android-host          build:android-host
check:android-host        build:android-host:release
test:android-host         test:android-host:unit
test:android-host:e2e     release:android-host
                          release:android-host:transition
```

理由：`pnpm build:android` 读起来像「构建这个应用」，实际是「构建装进手机的产物」。
显式命名让两类动作在命令名上就不可混淆——这是本决策的全部目的。

### 决策 3：删除已无被测对象的命令

随 WebView 客户端删除的命令（`dev:app` / `build:app` / `check:app` / `preview:app` /
`test:app` / `test:app:all` / `test:watch` / `test:agent-browser` / `kill:app`）全部移除。
它们无一例外指向已删包或已删测试套件，保留只会让人照着跑出一个 command not found。

`kill:all` 保留但其枚举随包删除收敛。

### 决策 4：聚合命令的包清单

`check:all` / `test:all` / `build:all` / `dev:all` / `preview:all` 的 filter 列表去掉已删包，
并**把 `@pictelio/android-host` 纳入 `test:all`**——它的测试此前由被删包的 `test` 入口承载，
不补进来会让宿主包的 367 个单测从 CI 消失。

## 后果

- `pnpm dev` 现在起的是 Lynx 客户端（此前起的是一个没有用户的 Vite 服务）
- 根命令表里每一条都指向真实存在的包与脚本
  （由 `packages/android-host/tests/unit/agentsMd.contract.test.ts` 的「根命令表可达性」断言钉住，
  oracle 为本 spec 用户故事 16）
- 迁移后 `AGENTS.md` 的命令表必须与之同步，否则上述断言会红

## 门禁范围的一处刻意不扩大

宿主包的 `tsconfig` include 与迁移前**逐项对齐**：迁移前被检查的是
`src` + `tests/android-e2e`；`src` 随整包删除，故只留 `tests/android-e2e`。

`tests/unit` **有意不在类型检查面内**——它在本仓历史上从未被 `tsc` 检查过，
现存约 225 处隐式 any / 缺声明的存量欠账。把它们拉进检查面会让本次迁移
立刻背上一个与重构无关的失败集，属范围蔓延。

**该欠账是独立工作项**，既不是本 ADR 的后果，也不是本轮的遗漏。

## 参考

- 决策来源：[ADR-0203](./ADR-0203-webview-client-source-removal.md) 决策 6 与「后果」第 1 条
- 术语：[`glossary-webview-client-removal.md`](./glossary-webview-client-removal.md)
- 被取代：[ADR-0059](./ADR-0059-root-script-convention.md)
- 规格：[`webview-client-removal.md`](../specs/webview-client-removal.md)
