# ADR-0161: webview 原生 POST 载荷改走表单体（修复所有原生写操作）

- 状态：accepted
- 日期：2026-09
- 关联：spec `docs/specs/bookmark-tags.md`（发现场景）、ADR-0037（PixivApiPlugin 网关架构）、ADR-0100（URL 重写与令牌边界）、ADR-0159（桥线程卸载）

## 背景

实现「收藏加标签」（ADR-0160）并在 Android 模拟器上做真机验收时发现：**webview 端所有写操作（收藏/取消收藏、关注、评论、小说追更与收藏）在原生构建下全部失败**，而读操作（推荐流、详情、搜索）正常。

证据链（双重实证，2026-09-14）：

1. **真机观测**：详情页单击心形（设备级 `adb shell input tap`）后 25s 内 UI 不变、服务端 `bookmark/detail` 仍 `is_bookmarked=false`；长按打开收藏面板正常（说明点击命中、渲染与读路径无恙）。
2. **host 侧直连 Pixiv**（绕过 app，仅改请求形态）：
   - `POST /v2/illust/bookmark/add?illust_id=…&restrict=public`（query 承载 + 空 body）→ **HTTP 400** `不正なリクエストです`；
   - 同 URL、参数改为 `application/x-www-form-urlencoded` 表单体 → **HTTP 200**，随即 `bookmark/detail` 返回 `is_bookmarked=true`；
   - `POST /v1/illust/bookmark/delete?illust_id=…`（query 承载）→ 同样被拒（404 + 同一错误体）。
3. **源码定位**：`packages/app/src/api/client.ts` 的 `request()` 对 POST 调用
   `nativeExecuteRequest(method, path, data)`，而 `data` 在原生分支被写入插件的 `params`
   （→ `PixivApiPlugin` 用 `jsObjectToQuery` 拼进 **query string**），`body` 恒为 `undefined`
   （`PixivApiCore` 于是 `RequestBody.create("", mediaType)` = 空 body）。该函数名为 `body`
   的形参从未被任何调用方传入——是从「POST 走 body」重构中掉队的死参数。
4. **同仓一致性佐证**：同文件的 web 分支（`new URLSearchParams(data).toString()` 作为 fetch 的
   `body`）与 `packages/app-lynx/src/api/client.ts` 的原生分支（同样以 `URLSearchParams` 编码后
   经桥 `api.request` 发送）**都以表单体发送 POST**；webview 原生分支是唯一不一致的通道。

即：**web 开发模式与 agent-browser E2E 全绿，掩盖了原生写路径的长期失效**（原生写路径此前没有
任何自动化覆盖——Android E2E 既有 spec 只覆盖启动、切换引擎、网络自检与命中测试）。

## 决策

**D1. 原生 POST 的载荷一律作为 `application/x-www-form-urlencoded` 表单体发送**：`body` =
`new URLSearchParams(data).toString()`，`params` 置 `undefined`；GET 保持走 query。改动落在
`packages/app/src/api/client.ts` 的原生分支（一处），与 web 分支、lynx 原生分支口径统一。

**D2. 删除 `nativeExecuteRequest` 从未被使用的 `body` 形参**，消除「以为 POST 走 body」的
误导性残留（TypeScript 的 `noUnusedParameters` 亦要求清理）。

**D3. 由宿主（Java 侧）继续持有 `Content-Type`**：`OAuthConfig.CONTENT_TYPE` 已是
`application/x-www-form-urlencoded`，`PixivApiCore` 以该 media type 构造 `RequestBody`——
故本决策**无需改 Java**，只改 JS 线形态。

**D4. 契约测试固化线形态**：`packages/app/tests/unit/api/client.test.ts` 新增一组用例，断言
「POST ⇒ `params` 为空且 `body` 为表单编码串」「GET ⇒ `params` 照旧、无 body」，并在测试头
注明 oracle 出处（上述 host 侧实测 + 双端分支一致性），避免再次退化为「自洽 mock」。

## 备选与否决理由

- **在 Java 侧把 `params` 转成 POST body**：多一层隐式转换、与 TS 侧 web 分支语义分叉；且会让
  「GET 的 params」与「POST 的 params」在桥上承担两种含义，反而更难推理。
- **每个写端点自建 fetch/显式 body**：绕过统一客户端，重复实现 401 刷新与错误分类，散点化。
- **不改（只在本功能内绕过）**：本功能的收藏写入依赖该通道；且这是既有缺陷，绕过等于把「收藏
  加标签在安卓上不可用」固化。

## 后果

- **修复面大于本 effort**：原生构建下的收藏/关注/评论/小说追更等所有写操作一并恢复。这是**行为
  变化**（此前在原生构建下失败，现按预期成功），需在 release 说明中标注。
- **风险与边界**：`URLSearchParams` 对空格编码为 `+`、对 `[]` 编码为 `%5B%5D`，且服务端按空格
  切分 tags（ADR-0160 D1）；含空格标签的既有语义不变。空载荷 POST 发送空字符串 body，仍带
  正确的 form content-type。
- **回归保护**：新增契约测试覆盖线形态；Android 真机验收（`bookmark-tags.spec.ts`）以服务端
  真值（host 侧直读 Pixiv）兜底，避免再次出现「读路径全绿掩盖写路径失效」。
- **既有 E2E 未覆盖的盲区已记录**：原生写路径此前无自动化覆盖，本次以「真机验收 + 契约测试」
  两级补齐；其余写端点（关注/评论/追更）仍缺专项真机用例，记为后续候选。
