# Ticket Plan — Fix empty-stream gate (wayfinder #654)

**Part of:** wayfinder map #644（app-lynx 小说翻译收尾）
**Source ticket:** issue #654（wayfinder:task）
**Base line:** HEAD `c3218082`（地图 #644 起点 `108d892d` 之后 7 个提交）
**Target end state:** zero-delta 流经终态收尾分支时判 `error("LLM 未返回任何译文...")` 而非 `done`，CI 内可被 Robolectric 单测守住。

## 范围

**In:**
- `packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioTranslateModule.java` —— 删 `deltaSeen` 实例字段、收尾分支改用 `sseParser.hasText()`、注释与日志同步
- `packages/app/android/app/src/testFull/java/io/pictelio/app/PictelioTranslateModuleEmptyStreamTest.java`（**新**）—— Robolectric 驱动 translateStream + MockWebServer 只发 `response.completed` 零 delta，断言终态
- `packages/app-lynx/tests/unit/api/nativeTranslate.test.ts` —— 补一条「Java 侧空流 → `classifyNativeError("未返回任何译文") = content_filter`」契约
- `docs/specs/app-lynx-novel-translation.md` §7.2 状态转移表 —— 补一行「空流 → `failed`（content_filter）」
- `docs/adr/ADR-0170-*.md`（如存在）—— 交付通道实测表新增一行

**Out:**
- 跨流状态收进 per-stream 对象（#652 grilling）—— 仅顺手消除 `deltaSeen` 一个实例字段，`sseParser` / `frameQueue` 仍为字段；后续 #652 决议再动
- `TranslationSseParser.emitConsolidated` 空 paragraphs 时是否仍 emit 空 `delta_all` 帧 —— 那是另一档（sink 形态），不影响当前 bug
- JS 侧错误分类（`classifyNativeError`）—— 已能识别 `未返回任何译文` 字符串（`nativeTranslate.ts:253`），无需改动
- webview 端翻译栈 —— 显式 out of scope（#644 地图）

## 前置依赖

- 无（#654 在地图 #644 中独立可开工）

## Tickets

### T1 — Robolectric 单测：空流必须判失败（**红→绿 基线**）

- 新增 `packages/app/android/app/src/testFull/java/io/pictelio/app/PictelioTranslateModuleEmptyStreamTest.java`
- 复用 #646 验证的基础设施（`TestLynxContext` + 假 AndroidKeyStore + `request()` + `pollUntilNonPending()` + `Rec`/`noopCallback`）
- 核心用例：`MockWebServer` 只 enqueue 一帧 `response.completed`（无任何 delta） → `translateStream` → `translatePoll` 拿到终态 → 断言 `type == "error"` 且 `message` 含 `未返回任何译文`
- **Oracle 溯源**（测试硬约束 #6）：期望值 `error + 未返回任何译文` 来自三处已记录的证据：
  1. `deltaSeen` 字段注释（`PictelioTranslateModule.java:120`）
  2. 收尾分支 `else if (!deltaSeen)` 的注释（`:423`）
  3. 交接文档记录的真机事实（DeepSeek 对 R-18 正文 200 但零输出）
- 期望：**先红**（当前实现走 `done`）→ T2 修复后**绿**

### T2 — Java 修复：删 `deltaSeen` 字段，收尾改用 `sseParser.hasText()`

修改 `PictelioTranslateModule.java`：
- 删除字段声明 `:121` `private boolean deltaSeen = false;`
- 删除 `:392` `deltaSeen = false;`（每流重置）
- 删除 sink 中的 `:858-863` `deltaSeen = true` 判定
- `:405` 日志 `deltaSeen=` 改为 `hasText=`
- `:423` `else if (!deltaSeen)` → `else if (!sseParser.hasText())`
- 字段注释 `:120` 改为指向 `sseParser.hasText()`
- sink 注释 `:858-863` 改为解释为何不再用帧类型字符串作为空流判据

**不动**：`sseParser` 字段、`frameQueue` 字段（属于 #652 主题）
**不动**：`TranslationSseParser.emitConsolidated` 在空 paragraphs 时仍 emit 空 `delta_all` 帧（sink 不再以此作为判据即可）

### T3 — 跑 `testFullDebugUnitTest --rerun` 全绿

- 验证 T1 新测试绿
- 验证 #646 探针里 P11（zero-delta）从「红」变「绿」—— 等等，P11 在 #646 §1.2 写的是「改断言后绿」，但 #646 那次实测是 done（与修复前一致），断言按 done 改的。所以 P11 在 #646 里实际是按 done 断言的绿用例。**新 T1 才是按 error 断言的真测试**。
- 验证 13 条现存 Java 单测不红（`PictelioTranslateAbortStreamTest` 等）
- 验证 41 条其他测试类不红

### T4 — spec §7.2 补空流行

`docs/specs/app-lynx-novel-translation.md` §7.2 状态转移表新增一行：

```
| `translating` | chunk `done` 但 zero-delta（零译文段） | `failed` | errorCode=content_filter; emit `lastError` |
```

放在 `translating | chunk done → completed` 那行（`:526`）之后。

### T5 — JS 端契约补强

`packages/app-lynx/tests/unit/api/nativeTranslate.test.ts` 补一条：

```ts
it("native 空流错误消息被 classifyNativeError 识别为 content_filter", () => {
  expect(classifyNativeError("LLM 未返回任何译文（可能被服务端内容策略拦截）"))
    .toBe("content_filter")
})
```

这条是 JS 侧契约：Java 修复后 JS 必须能正确分类。**不依赖真 Java 调用**，纯函数断言。

### T6 — `/code-review` 闭环 + commit

- 跑 code-review skill（固定点到 HEAD）
- commit message：`fix(app-lynx,android-lynx): gate zero-delta streams as failed (issue #654)`
- 注意 ADR-0170 是否要同步：取消通道 + 空流闸门是两条独立的 fix，但都是「翻译流可靠性」收尾。**#644 地图 §「Not yet specified」已标这条 ADR 影响面**

## 闭环验收

1. `cd packages/app/android && GRADLE_USER_HOME=$(pwd)/.gradle ./gradlew testFullDebugUnitTest --rerun --no-daemon` exit 0
2. 新测试 `PictelioTranslateEmptyStreamTest.emptyStreamIsFailed_notDone` 绿
3. 现有 13 条 `PictelioTranslate*` 测试 0 红
4. 变异实验：`deltaSeen = true` 改回（模拟修复前的 sink 形态）→ T1 新测试必须**变红**
5. `nativeTranslate.test.ts` 「JS 侧空流识别」用例绿
6. `/code-review` 0 阻塞项

## 与 #652 的边界

本 ticket **仅消除 `deltaSeen` 字段**（一个实例级解析状态），不动 `sseParser` 与 `frameQueue`。这两者是 #652「per-stream 对象」议题的剩余内容。完成 #654 后 #652 议题更聚焦：

| #652 范围 | #654 处理 |
|---|---|
| `sseParser` 字段 | 不动 |
| `frameQueue` 字段 | 不动 |
| `deltaSeen` 字段 | **删除**（顺手）|

`deltaSeen` 的消除让 #652 议题清单少一项，且 sink 改读 `sseParser.hasText()` 让 sink 与解析器之间形成更内聚的耦合（sink 不再各自维护解析状态）。
