# SettingsEndpoint a11y / UX 残余 — #637 action plan（PR #657 后）

> **背景**：#637 经 #645 核查收敛到 7 条精确残余，全部集中在 `packages/app-lynx/src/components/SettingsEndpoint.vue`（494 行）。本文件是按代价/收益排序的执行清单。

## 残余列表（按优先级）

### P0 — 必做（数据层已就绪、纯 UI 缺口）

#### 1. Target / Source Language 选择器（数据层 done）
- **现状**：5 个表单字段只实现 3 个（Base URL / API Key / Model）。`SettingsEndpoint.vue:273/294/311` 只有 3 个 `<input>`
- **数据层**：`stores/novelTranslateStore.ts:229/:233/:338-339/:435` 已 ready；`api/translate.ts:44-55` 支持 `targetLang`
- **交付**：
  - SettingsEndpoint.vue 新增 2 个 `<select>`：Target Language（zh-CN 默选）/ Source Language（ja 默选）
  - i18n 键 `endpoint.targetLang.label` / `endpoint.sourceLang.label` / `endpoint.value.label`（zh-CN/en 各 3 条）
  - onMount / onSubmit 时把 `targetLang` / `sourceLang` 写进 endpoint metadata（与 `baseURL` / `model` 同路）
- **测试**：1 条 vitest（i18n key 数 +5 同步更新）+ 1 条 vitest（保存后 metadata 包含 target/source lang）
- **估计**：30 min

#### 2. API Key show/hide toggle + 字段级清空
- **现状**：`.vue:292-300` 静态 `type="password"`；`.vue:246-259` / `:461-492` 的 `onClear` 清的是**整份 endpoint**
- **交付**：
  - API Key input 旁加「👁」图标按钮 → `type` 在 `password` ↔ `text` 之间切换
  - 加「×」图标按钮 → 只清空 API Key 字段（保留 baseURL/model/target/source lang）
  - show/hide 5s 自动转回 password（票面要求）
- **测试**：1 条 vitest（input.type 切换）+ 1 条（清空 API Key 不影响其他字段）
- **估计**：20 min

### P1 — 应做（防用户挫败）

#### 3. 保存失败用户反馈
- **现状**：`.vue:239` 只 `console.warn`；`.vue:331` 「已保存」仅状态行文案
- **ADR-0173 D5 偏离**：不弹 Snackbar，用页内内联提示 4s 后淡出。**本行的残余不是「没做 Snackbar」，是「失败没反馈」**
- **交付**：
  - `onSave` 失败分支也调用页内内联提示（复用现有的「已保存」UI 组件）
  - 新增 i18n 键 `endpoint.save.failed`（zh-CN/en 各 1 条）
- **测试**：1 条 vitest（保存失败 → 显示提示）
- **估计**：15 min

#### 4. 空字段 inline error
- **现状**：`.vue:282/:301/:317` error 渲染带 `.length > 0` 守卫，空表单**零反馈**；只有按钮 `opacity-50` + tap 早退
- **交付**：
  - 校验时把空字段标红（输入框加 `border-error`）
  - inline error 显示具体哪个字段为空
- **测试**：1 条 vitest（3 字段全空 → 3 个 inline error）
- **估计**：20 min

### P2 — 应做（a11y + UX 一致性）

#### 5. a11y：3 个 input 加 accessibility-label + `ME_A11Y_LABELS` 登记
- **现状**：`.vue:273/:294/:311` 三个 `<input>` 无 `accessibility-label`；`grep -n "aria-" SettingsEndpoint.vue` 0 命中
- **现状注册表**：`utils/accessibility.ts:12-` 无 endpoint 键；`tests/unit.test.ts:1291` 注册表校验测试只读 `Me.vue`，对子组件**结构上无效**
- **交付**：
  - 3 个 `<input>` 加 `:accessibility-label="t('endpoint.<field>.label')"`（label 已存在）
  - `utils/accessibility.ts` 注册 3 个新键：`endpoint.baseUrl.a11y` / `endpoint.apiKey.a11y` / `endpoint.model.a11y`
  - 注册表校验测试改为遍历所有 `*.vue` 而非只 `Me.vue`（或至少加 `SettingsEndpoint.vue` 到白名单）
- **测试**：注册表测试现在覆盖到 endpoint 字段
- **估计**：20 min

### P3 — 可选（UX 增益）

#### 6. 测试连接无延迟数据
- **现状**：`stores/novelTranslateStore.ts:540-542` `testConnection` 返回 `{ok, code, detail}` 无 `elapsedMs`
- **ADR-0173 D5 偏离**：反馈形态走页内内联 4s 淡出，**不是**残余反馈形态问题
- **交付**：
  - `testConnection` 内部用 `performance.now()` 包一下，返回 `{ok, code, detail, elapsedMs}`
  - UI 内联提示追加 `${elapsedMs}ms`
- **估计**：10 min

#### 7. 清缓存无 UI
- **现状**：`utils/translationCache.ts:371` `clearTranslationCache()` **零调用点**
- **交付**：SettingsEndpoint.vue 末尾加「清除翻译缓存」按钮 → 调 `clearTranslationCache()` + 提示「已清除 N 章」
- **注意**：filesystem adapter 也得支持（commit 08c9da6e 已实现 `clearTranslationCache`）
- **估计**：15 min

### P0 — 顺手清理（小死代码 / 死键）

#### 8. 死代码 / 死键清理
- `savedAt` 被写 4 次但模板从不读取（`.vue:29/:173/:231/:252`）→ 删 4 处赋值 + 删 ref
- i18n 键 `probe.failed` / `probe.timeout` 已定义但无使用点 → 删 + 同步 EXPECTED_KEYS 测试
- **估计**：10 min

---

## 总估计 + 顺序

| 序号 | 工作量 | 累计 |
|---|---|---|
| 1. Target/Source lang 选择器 | 30 min | 30 min |
| 2. API Key show/hide + clear | 20 min | 50 min |
| 3. 保存失败反馈 | 15 min | 65 min |
| 4. 空字段 inline error | 20 min | 85 min |
| 5. a11y labels + 注册表 | 20 min | 105 min |
| 6. 测试连接 elapsedMs | 10 min | 115 min |
| 7. 清缓存 UI | 15 min | 130 min |
| 8. 死代码 / 死键清理 | 10 min | 140 min |

**总计 ~2.5 小时**。

## 执行建议

```
[Batch 1: P0 必做] → 1 + 2 + 8 → 1 commit
[Batch 2: P1 应做] → 3 + 4 → 1 commit
[Batch 3: P2 a11y] → 5 → 1 commit
[Batch 4: P3 可选] → 6 + 7 → 1 commit
```

每个 batch 跑完跑 `pnpm check:app-lynx && pnpm test:app-lynx` 验证。

## commit 模板（参考 #640 step 7 风格）

```bash
git commit -m "feat(app-lynx): SettingsEndpoint Target/Source lang + show/hide (#637 partial)

#637 a11y / UX 残余 Batch 1 (P0)：
- Target/Source Language 选择器（zh-CN/ja 默选；i18n 键 +6）
- API Key show/hide toggle + 字段级清空
- 顺手清理：savedAt 死代码 + probe.failed/probe.timeout 死键（同步 EXPECTED_KEYS 测试）

i18n 期望键数：80 → 86（5 endpoint 子命名空间 + 3 endpoint 键）

关联: wayfinder map #644 / issue #637 / ADR-0173 D5"
```

## 关联

- #617 wayfinder map（map #644 = 本批次的 4 张实施工单已全部落地）
- #645 收口修订（指明这 7 条残余）
- ADR-0173 D5（页内内联提示偏离；R18 闸门偏离）
- ADR-0171 §1（缓存 6 元组 namespace）
- ADR-0178 D3（用户 retry 1.5s debounce 设计完成，UI 待 #637 落地）

## Resolution 时

- close issue #637
- 在 #617 「Decisions so far」追加 `[T9 SettingsEndpoint a11y](link): P0+P1+P2 完成，UI 满足设计约束`
- 通知 release checklist owner（#640 已 link）：step 3 retry 1.5s debounce 验证现可通过此 commit 触发