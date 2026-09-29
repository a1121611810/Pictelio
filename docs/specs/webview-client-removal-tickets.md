# Ticket graph：WebView 客户端删除与宿主迁移

> Spec：[webview-client-removal.md](./webview-client-removal.md)（#832）
> 决策：[ADR-0203](../../adr/ADR-0203-webview-client-source-removal.md)
> 本文档是执行编排的**依赖锚点**。blocking 边同时以 GitHub 原生关系落库，两者须一致。

## 票与依赖

```
Wave 1（无阻塞，并发执行）
  T01 #835  建立仓库不变量契约测试（先红）
  T02 #833  事实源迁移：凭证与版本号归位到 Lynx
  T03 #834  知识保全：抢救只存在于被删源码的领域结论
  T09 #841  清理 OTA web bundle 残留 API（保留 APK 更新检查）
        ↓
Wave 2
  T04 #836  宿主包骨架与 Gradle 工程迁移        ← #833
        ↓
Wave 3                                  Wave 2'
  T05 #837  发布脚本迁移 + pre-push 门禁   ← #836
  T06 #838  测试资产迁移                 ← #836
                                             T08 #840  差分真值表改写  ← #834
        ↓
Wave 4
  T07 #839  根命令裸名重新定义                ← #837
        ↓
Wave 5（不可逆闸）
  T10 #842  删除 packages/app 整包            ← #839 #840 #841
        ↓
Wave 6-7
  T11 #843  门面与文档收敛                    ← #842
  T12 #844  全量验证与收口                    ← #843
```

## 关键顺序约束（不可颠倒）

1. **T04 必须在 T10 之前完整完成。**
   宿主迁移未完就删包，会同时打断三处且互相掩盖：Lynx 客户端构建期 fail-closed 读取、
   pre-push 门禁的反向 import、CI 原生单测 job 的工作目录。

2. **T01 必须最先写、且真实地红。**
   它是「删干净了」的唯一权威判据，**不是**事后追认的验收脚本。
   T10 的完成定义就是它的七组不变量全绿。

3. **T03 必须在 T10 之前完成。**
   被删源码里只此一处记录、但对 Lynx 侧仍有效的领域结论，删了永久没了。
   重点是搜索关键词的两个实测硬约束与图床缓存键契约。

4. **T06 必须在 T11 之前完成。**
   AGENTS.md 体积门禁的守门人住在待删包里。先改文档、后迁守门人，会出现一段 CI 红窗口。

## 实施期订正（2026-09-29）

**订正 1：连带项是 7 个文件，不是 spec 写的 1 个。**
spec「Further Notes」只点了 i18n 契约测试会「从对面炸回来」。
实测：Android 工程迁移后，**7 个存活测试**仍用旧 Java 路径，全部 ENOENT：

```
packages/app-lynx/src/utils/clientSwitchJavaContract.test.ts
packages/app-lynx/src/utils/clipboardBridgeContract.test.ts
packages/app-lynx/src/utils/darkModeJavaContract.test.ts
packages/app-lynx/src/utils/galleryBridgeContract.test.ts
packages/app-lynx/src/utils/safeAreaJavaContract.test.ts
packages/app-lynx/tests/benchnav-parity.test.ts
packages/app-lynx/tests/differential/i18nLanguageKeyContract.test.ts
```

**教训**：spec 点名某一个文件时，要假设它是一类而非一个。
判据应是「凡是跨包读被迁移对象的，全部算」，
而不是「spec 点名的那个」——后者会在实施期漏掉其余六个。

**订正 2：`differential/` 目录名在 T08 后已失实。**
对侧消失后，迁入的断言要么是「与 Java/spec 的契约」，要么是「单端基准」，
两者都不是「差分」。目录整体应改名为 `contract/` 或 `baseline/`。
原目录在 T08 的文件所有权之外，未能重命名。

## 反例警示

- **不得**断言「全仓 `capacitor` 字样为 0」。
  存量格式契约（`capacitor-storage_` / `CapacitorStorage`）必须保留以兼容已安装用户，
  那是一条**恒假**的断言。正确形态是「依赖声明为 0」**且**「存量契约命中 ≥ 1」。

- **不得**在删掉一侧后仍把单端断言称作 differential。
  差分的对侧已经消失，保留措辞即失实陈述。

- **不得**断言「全仓 `packages/app` 字样为 0」。
  历史文档按既有规则只加存档横幅、正文一字不改，它们会保留该路径字样。
  正确形态是「该目录不存在」，不是「该字符串不出现」。

- **不得**借迁移之机重构 Java 侧。
  保真迁移的定义是逐件搬走、不改写；混入会让「迁完了没有」变得不可判定。

## 并发纪律

- 并行写者文件所有权必须**互斥**；派发简报必须写明「禁止任何 git 写命令」。
- 子代理结论**不可直接采信**，须独立复跑。
- 每条新写的防线必须当场做**反事实检验**（把违规塞回去看它转不转红）。
  改动前就已绿的断言不是防线。
- 本机内存受限：禁止并行全仓测试（`test:all` / `check:all` 同时跑会 OOM kill），
  一律 `pnpm --filter <pkg> test`。收尾验证必须**串行**。
- 禁止仓库级 `pnpm fmt`（`--write` 会覆盖并行写入者）；`fmt:check` 允许且应跑。
