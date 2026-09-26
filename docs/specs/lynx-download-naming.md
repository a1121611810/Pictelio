# Spec: lynx 下载命名模板 / 按作者建目录

> 架构决策：ADR-0192（app-lynx 下载命名模板与按作者建目录）；双锚 ADR-0145（图片保存/下载——**文件名单一事实源**）、ADR-0146（下载队列任务载荷契约）；统一术语：「lynx 四功能统一术语表」——**下载命名模板**/**按作者建目录**/**相对目录**/**文件名单一事实源**/**保存 vs 下载**均以术语表为准。

## Problem Statement

现状（ADR-0192 背景节）：**保存**（单存相册链）与**下载**（下载队列链）两条链的产物文件名恒为 `Pictelio_<id>` / `Pictelio_<id>_p<N>`（由 JS 侧 buildSaveFileName 单源生成），目录恒为各落盘链基座（图片链 `Pictures/Pictelio`，非图片导出链 `Downloads/Pictelio`）。批量保存多个作品后，相册与文件管理器里全是不可读的 id 串——无法辨认内容、无法按作者归类。主流三方客户端（Pixeval 命名宏、gallery-dl `filename_fmt`/`directory_fmt`、PixivBatchDownloader 目录模板）均已支持自定义命名，差距明确且用户可感。

## Solution

两个独立的设备级设置：**下载命名模板**（默认 `Pictelio_{id}`，占位符 `{id}` `{title}` `{author}` `{p}`）与**按作者建目录**开关（默认关）。模板在 galleryDownload 纯函数模块中展开（**文件名单一事实源**不分散），替换值与模板字面量按段净化（镜像 Java sanitizeFileName 规则）+ 双层截断（单段 ≤64、最终文件名 ≤120）；模板不含 `{p}` 时多页自动追加既有 `_p<N>` 后缀——默认配置产物与现状**逐字节一致**（零默认行为变化）。按作者建目录开启时**相对目录** = 既有基座 + 净化作者段，只动目录段、不动文件名。模板与开关同时作用于保存与下载两条链；Java 侧只新增可选 subPath 参数（空串 = 字节不变）；Capacitor 桥契约同步但 webview UI 不接线（本批 lynx-only）。

## User Stories

1. As a 未改动任何设置的 Pictelio 用户, I want 保存与下载的文件名保持 `Pictelio_<id>` / `Pictelio_<id>_p<N>` 与现状逐字节一致, so that 升级不扰动既有文件与使用习惯（零默认行为变化）
2. As a 批量收藏的用户, I want 在设置中自定义命名模板（如 `{author}_{title}`）, so that 相册里不再是一串不可读 id
3. As a 用户, I want `{id}` 展开为作品 id, so that 文件名始终可回溯到原作品
4. As a 用户, I want `{title}` 展开为净化截断后的作品标题, so that 文件可直接辨认
5. As a 用户, I want `{author}` 展开为净化截断后的作者名, so that 能按画师辨识文件
6. As a 用户, I want 多页作品的 `{p}` 以 0-based 页号就地展开（`{id}_p{p}` → `<id>_p0`）, so that 页序与 Pixiv 原始 `_p0` 命名对齐
7. As a 用户, I want 模板不含 `{p}` 时多页产物自动追加 `_p<页号>`, so that 多页批量保存不互相覆盖
8. As a 用户, I want 单页作品模板中的 `{p}` 展开为空、残留的尾随连接符（如 `{id}_{p}` 的 `_`）被剥离, so that 单页文件名不带空页号尾巴
9. As a 用户, I want 模板里写错的占位符（如 `{date}`）原样保留、不被吞, so that 输错可发现可改正（warn 恰一次，不刷屏）
10. As a 用户, I want 标题/作者名中的路径分隔符与控制字符被替换为 `_`, so that 产物文件名在任何设备上都合法
11. As a 用户, I want 模板字面量里误写的 `/` 同样被净化为 `_`, so that 模板永远不能注入目录结构（目录只由开关决定）
12. As a 用户, I want 超长标题/作者名按段截断（单段 ≤64、最终 ≤120 且扩展名完整）, so that 不触顶文件系统名长限制
13. As a 用户, I want 开启「按作者建目录」后产物落入 基座/作者段 两级目录, so that 相册与文件管理器按画师自然归类
14. As a 用户, I want 关闭该开关后目录回到基座、与现状完全一致, so that 随时可回退且无残留
15. As a 下载动图的用户, I want ugoira 导出产物同样应用命名模板与作者目录（`Downloads/Pictelio` 基座）, so that 保存与下载两条链体验一致
16. As a 用户, I want 作者名含特殊字符（`/`、控制字符、首尾空白）时作者段与文件名段仍合法, so that 按作者归类不因极端昵称失败
17. As a 用户, I want 单存相册与下载队列对同一作品产出相同的文件名与目录段, so that 不出现两套命名体系
18. As a 用户, I want 模板保存时看到净化后的示例预览回显, so that 确认前就知道最终产物长什么样
19. As a 用户, I want 模板清空或净化后为空时回落默认值并有可见提示, so that 不会静默得到坏的命名（禁静默回落）

## Implementation Decisions

**D1 两个设备级设置键**：`download_file_template`（字符串，默认 `Pictelio_{id}`）与 `download_by_author_dir`（布尔，默认 false），走 settingsStore 既有设备级键定义模式（无 uid 后缀、无跨账号同步语义，与动图导出格式同类——文件命名偏好属设备习惯）。

**D2 模板展开纯函数（galleryDownload 模块扩展）**：与既有 buildSaveFileName 同模块新增纯函数——输入 = 模板串 + 作品上下文（id / title / author / 页号 / 页数）+ 扩展名，输出 = 最终文件名与可选目录段；保持该模块的**文件名单一事实源**地位。占位符集合固定 `{id}` `{title}` `{author}` `{p}`；`{p}` = 多页 0-based 页号，仅页数 > 1 时非空，单页展开为空串。未知占位符原样保留 + `console.warn`（模块前缀；同一未知名仅首次命中 warn 一次，模块级去重——禁静默吞，也不制造批量保存的告警噪音）。

**D3 净化与截断（按段）**：替换值与模板字面量段分别净化——路径分隔符（`/` `\`）与控制字符（`\x00-\x1f`）→ `_`，随后 trim；规则**镜像 Java sanitizeFileName**，双端对同一字符串得出同一结果（differential 用例钉住）。模板字面量中的分隔符同样净化——模板不可注入路径，目录结构只能由作者目录开关产生。截断：title / author 单段 ≤64 字符；展开 + 扩展名拼装后的最终文件名 ≤120 字符（超限按段回退截断，保证 `.ext` 完整）。Java 侧 sanitizeFileName 保持不动（第二道防御仍在）。

**D4 多页语义（`{p}` 缺省追加）**：模板不含 `{p}` 且页数 > 1 → 展开结果自动追加 `_p<页号>`（0-based，与既有 buildSaveFileName 的 `_p<N>` 后缀逐字节同形）；模板含 `{p}` → 就地展开、不再追加。默认模板 `Pictelio_{id}` 走缺省追加路径，必须逐字节复现现状 `Pictelio_<id>` / `Pictelio_<id>_p<N>`——**零默认行为变化是硬验收项**。含 `{p}` 的模板在单页作品上展开为空串，净化后剥离纯连接符残段（推荐写法 `{id}_p{p}` 由用例矩阵钉住）。

**D5 目录语义（相对目录 = 基座 + 可选作者段）**：基座恒为各落盘链既有常量——图片链（单存相册与下载队列图片任务）= `Pictures/Pictelio`；非图片导出链（ugoira 导出产物等）= `Downloads/Pictelio`。开启按作者建目录时，基座后追加净化后的作者名段（与文件名段同一净化规则）；作者名缺失或净化后为空 → 作者段取空串、目录退化为基座，并 `console.warn`（禁静默）。关闭开关时空段 = 现行为不变。作者目录只动目录段，不影响文件名；API 28 回退目录在应用专属目录下按同规则拼子目录。

**D6 双链一致**：单存相册链与下载队列链都消费同一模板纯函数取名取目录（各自传入作品上下文），产物文件名与目录段天然一致；禁止任何链路私拼第二套命名/净化逻辑。

**D7 原生落盘与桥透传（可选参数 + 空串字节不变）**：Java GallerySaver 的 save / saveFile 增加可选 subPath 参数（默认空串 = 现行为字节不变，老调用点零改动），追加到基座常量之后（MediaStore RELATIVE_PATH 与 API 28 回退两条路同规则）；下载队列任务载荷（DownloadTask）增加可选 `dir` 字段，由 JS 侧任务构建（buildImageTasks / buildUgoiraTask）填入**已展开的目录段**（非模板），经 PictelioDownloaderModule.start 新增可选参数透传至 Java 执行器落盘；单存相册链 gallerySaver → PictelioGalleryModule.saveImage 载荷增加可选 `dir` 参数（空缺省 = 现行为）。`dir` 入队即快照——入队后改设置不影响已入队任务。否决「fileName 携带路径」与「Java 侧解析模板」（ADR-0192 D1/D4）。

**D8 Capacitor 契约先行、webview 不接线**：GallerySaverPlugin.saveImage 同步增加同形可选参数（保持双 flavor 桥契约同形），但 webview UI 不接线——本批 lynx-only，webview 零行为变化。

**D9 设置 UI（Me 页下载卡两行）**：在既有动图导出格式组所在设置区新增两行——① 命名模板文本输入行（提示默认值，支持一键恢复默认）；② 「按作者建目录」开关行（M3Switch）。模板输入在保存时以净化规则回显预览示例（默认模板 → `Pictelio_12345678.jpg`；`{author}_{title}` → 净化后示例）；非法输入（空串 / 全净化为空）回落默认值 + 可见提示（禁静默回落）。文本输入使用 lynx 现有 input 能力（无 date 等特殊 type 依赖）。

## Testing Decisions

- **seam 分层与断言面**：纯函数单测 + Java Robolectric 契约测试 + 桥字面量漂移契约测试 + 设置 UI template 测试四层；一律断言**外部行为**（产物文件名字符串、目录段字符串、RELATIVE_PATH 字面量），不断言内部调用次数。唯一例外是未知占位符 warn 恰一次——该 warn 本身是被 D2 钉住的外部可观测行为（测试硬约束 #3）。
- **纯函数层单测（先例 = 既有 galleryDownload 单测）**，用例矩阵逐条：
  - T1 默认模板单页 → `Pictelio_<id>.<ext>`，与现状基线逐字节 diff 为空；
  - T2 默认模板多页 → `Pictelio_<id>_p0/_p1/_p2.<ext>`（0-based）；
  - T3 各占位符展开（`{id}`/`{title}`/`{author}` 单独与组合）；
  - T4 含 `{p}` 模板多页就地展开（`{id}_p{p}` → `<id>_p0.._p2`）且不二次追加；
  - T5 含 `{p}` 模板单页 → 空串展开 + 尾随连接符剥离（`{id}_{p}` → `<id>`）；
  - T6 不含 `{p}` 模板多页自动追加 `_p<N>`；
  - T7 未知占位符原样保留 + warn 恰一次（同串重复名不重复告警）；
  - T8 替换值净化：`/` `\` 控制字符 → `_` + trim，differential 断言（JS 结果 === Java sanitizeFileName 对同一输入的结果，oracle = Java 源码规则）；
  - T9 模板字面量含 `/` → 净化为 `_`（路径注入不可行）；
  - T10 截断：title/author 64 字符边界；最终 120 字符截断后 `.ext` 完整；
  - T11 目录段矩阵：{图片链基座, Downloads 基座} × {开关关, 开关开 + 作者段} 四象限；
  - T12 作者名缺失/净化后为空 → 作者段空串 + warn（目录退化为基座）。
- **Java Robolectric 契约测试（先例 = 既有 GallerySaver MediaStore 契约测试）**：subPath 非空 → RELATIVE_PATH = 基座 + `/` + 作者段；subPath 缺省/空串 → RELATIVE_PATH 与既有断言逐字节一致（默认调用字节不变）；API 28 回退目录拼子目录的路径断言。
- **桥字面量漂移契约测试（ADR-0174 模式）**：PictelioGalleryModule.saveImage 与 PictelioDownloaderModule.start 的载荷键名、可选参数形状、空缺省语义钉死；既有 gallery 契约测试存在则扩展既有套件，不另立门户。
- **设置 UI template 测试（lynx template 测试先例）**：两行渲染、预览回显文案、非法输入回落 + 可见提示、开关初始态与切换持久化。
- **oracle 溯源**：文件名基线 = 既有 buildSaveFileName 行为（`_p<N>` 0-based 后缀，见 image-save 术语表页号辨析）；净化规则 oracle = Java sanitizeFileName；目录基座 = GallerySaver 既有常量字面量。

## Out of Scope

- webview UI 接线（桥契约本批已同步，接线挂账后续批次）
- 小说导出（NovelExporter）产物命名——本批只覆盖图片与 ugoira 导出链
- 冲突自增序号（MediaStore 原生重名改名 ` (1)` 族语义维持不变，ADR-0192 D5）
- 任意用户路径 / 嵌套目录模板（目录固定 = 基座 + 至多一段；模板内嵌路径分隔符已被 ADR-0192 D1 否决）
- 模板导入导出 / 多套模板预设管理
- 新设置键纳入 WebDAV 备份显式清单——跟随设备级键既有备份语义，不单独处理

## Further Notes

- **seam 决策声明（无人值守）**：本 spec 于无人值守模式产出，seam 选择（上述四层测试分层与断言面）沿用仓库最高可用 seam 惯例，供事后审阅。
- **零默认行为变化是硬验收项**：默认模板 `Pictelio_{id}` 经缺省追加路径必须逐字节复现现状文件名；任何偏差（`_p` 后缀多出/缺失、大小写、分隔符差异）均按回归处理（T1/T2 钉住）。
- **`{p}` 缺省追加与既有 `_p` 后缀的等价性**：现状 buildSaveFileName 对多页追加 0-based `_p<N>`；新逻辑「模板不含 `{p}` 且多页 → 追加 `_p<N>`」是该行为的推广，默认模板下两者输出重合——默认路径不是新行为，是既有行为的模板化表达。
- **双锚**：ADR-0192（本 spec 的架构决策源）、ADR-0145（文件名单一事实源边界）、ADR-0146（下载队列任务载荷契约）、「lynx 四功能统一术语表」（术语红线）。
