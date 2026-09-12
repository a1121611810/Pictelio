# UI 文案风格基线（ui-copy style baseline）

> 状态：v1（i18n spec `docs/specs/i18n.md` §7 的配套规范）
> 消费方：① AI 翻译管线的 prompt 注入（简中→英文批量翻译）② 人工校对 checklist ③ 新增文案时的写作规范
> 范围：**英文译文全量**按本基线执行；**中文存量文案不动**（迁移期零行为变更），**新建中文文案**跟随 §4 的中文增量基线。
> 依据：Apple Human Interface Guidelines — [Writing](https://developer.apple.com/design/human-interface-guidelines/writing)、[Voice and tone](https://developer.apple.com/design/human-interface-guidelines/voice-and-tone)、Apple Style Guide（术语）。

## 1. 英文硬规则（违反 = 校对不通过）

| # | 规则 | ✅ 正例 | ❌ 反例 |
| --- | --- | --- | --- |
| R1 | **Sentence case**：仅首词与专有名词大写（Pixiv、GitHub 等保持原样） | `Persistent scroll restoration` | `Persistent Scroll Restoration` |
| R2 | **动词开头**的 CTA/按钮，短动词短语优先 | `Retry` / `Sign in again` / `Check proxy settings` | `You can retry here` |
| R3 | **按钮与动作行末无标点** | `Retry` | `Retry.` |
| R4 | **避免客套词**（please / thank you / sorry）：直接说明发生了什么、下一步做什么 | `Check your network connection` | `Please check your network connection` |
| R5 | **单句提示不加句尾句号**（UI fragment）；多句提示按句加句号 | `Session expired. Sign in again` | `Session expired, please sign in again` |
| R6 | **不用逗号粘连两个独立句**（comma splice），拆成两句或用句号 | `Too many requests. Try again later` | `Too many requests, please try again later` |
| R7 | **避免行话与内部概念**：说用户目标，不说实现（代理/引擎等面向高级用户的设置页除外，此时用用户认知的词） | `Make sure the local proxy 127.0.0.1:10808 is running`（高级设置场景可接受） | `SOCKS5 endpoint unreachable (ECONNREFUSED)` |
| R8 | **语言自动名（autonym）不翻译**：语言选择器里 `简体中文` / `English` 恒以本名显示 | — | `Simplified Chinese`（作为选择器选项文本） |
| R9 | **插值占位符**用 `{{name}}`，占位符名用 camelCase；译文不得增删占位符 | `{{count}} results` | `{count} results` |

## 2. 英文术语表（以 Apple Style Guide 为锚，新词先查后补）

| 用 | 不用 | 备注 |
| --- | --- | --- |
| sign in / sign out | log in / log out / login（动词） | 名词可用 sign-in |
| delete | remove（数据销毁语义时） | |
| Retry | Try again（按钮）；提示句内可用 try again | |
| Done / Cancel / Save | OK / 确认类泛词 | 对话框按钮尽量用具体动词替代 Cancel 对（如 `Discard`） |
| bookmark | favorite / like / star | 对齐 Pixiv 域语义（收藏） |
| follow | subscribe / watch | |
| the Pixiv server | Pixiv's server / 服务器直译腔 | |
| email | e-mail / E-mail | |

## 3. 中英对照的构造约束（翻译单元）

- 一条 key = 一个翻译单元；**不要把两句中文拆成两个 key 后在英文里重组**，也不要把中文里可复用的字面量（如「加载」）抽出复用——英文没有对应的可重组粒度。
- 中文源文案里的标点（「」「·」、全角标点）不进译文；译文用自己的标点体系。
- 分隔符类文案（如 lynx 侧 `error.hintSeparator`「。」/ ". "）属于**翻译单元**，不硬编码在代码里拼。
- 复数：zh 只有 other 一类；en 手写 one/other 两态（`{{count}} photo(s)` 类文案写 `t(key, {count})` + 复数分支函数，不上 ICU）。

## 4. 中文增量基线（仅约束新建/改写文案，存量不动）

- 以 Apple 简体中文风格指南为锚：界面用词简体规范、数字用半角、中英之间加空格、书名号《》用于作品名。
- 避免「请」类客套堆叠（一句最多一个），错误提示说明「发生了什么 + 下一步」。
- 与既有 UI 词汇保持一致（收藏/关注/标签/追更等既有域词优先，见仓内既有文案）。

## 5. 校对流程（与翻译管线衔接）

1. AI 初稿产出后，按 §1 硬规则逐条机检（占位符一致、句号规则、please 扫描可脚本化）。
2. 人工按 §2 术语表抽查术语一致性与语感。
3. 校对通过的 key 直接进字典文件；未过的回 AI 重译（带具体违反规则号）。

## 6. 首批样例

原型字典 `packages/app/src/i18n/locales/en.ts` / `packages/app-lynx/src/i18n/locales/en.ts` 已按本基线校正（2026-09-12），作为基线的参考实现；后续 AI 翻译 prompt 直接引用本文档。
