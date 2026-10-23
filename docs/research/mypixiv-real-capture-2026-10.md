# 好P友端点（GET /v1/user/mypixiv）真实抓包取证（2026-10-23）

> 兑现 issue #755：「挂账: mypixiv 真实抓包 fixture 校准 schema」。
> 该票原写明端点形状是**六客户端交叉验证结论而非本仓抓包实证**；本文记录本仓的一手抓包、
> 逐项量测结果，以及与旧推断**不一致的两处**（已同步修正代码与类型注释）。

---

## 1. 结论先行

| 项 | 旧状态 | 本次实测 |
| --- | --- | --- |
| 端点形状 `{ user_previews, next_url }` | 六客户端交叉验证（推断） | **一手实测**（3 份真实响应） |
| 条目键 `user/illusts/novels/is_muted` | 推断 | **实测 28/28 齐全**，键序一致 |
| `user.is_accept_request` 位置与类型 | 推断（在 user 块内、布尔） | **实测 28/28 + 30/30 均在**，true/false 两侧都出现过（fixture 取前 9 项逐字未改 ⇒ 契约断言按 9/9 钉） |
| `novels` 元素形状 | **未独立验证**（旧 fixture 全是空数组，无元素可查） | **实测**：样本含 3 条非空 novels，元素字段类型与 `PixivNovel` 逐项一致 |
| `is_muted` 透传 | 透传不消费 | **实测**：布尔，28/28 存在 |
| `next_url` | 推断 | **实测**：服务端原文（带 `offset=30`）与空态 `null` 两种都拿到 |

**差异两处（本次修正）**

1. **「following/follower 响应无 `novels` 字段」——被实测推翻。**
   实测 `GET /v1/user/following`（30 条）与 `GET /v1/user/mypixiv`（28 条）**都带 `novels` 键**。
   ⇒ `PixivUserPreview.novels` 仍保持**可选**（`user.test.ts` 的「无 novels 也要能构造」是编译期防线，勿收紧），
   但注释从「某端点没这字段」订正为「**可选性是保守选择**」。
2. **`PixivUser` 类型缺 `is_accept_request` 字段声明** —— 真包里它一直存在（fixture 有真值、类型没有），
   已补为 `is_accept_request?: boolean`（可选是保守选择：其它端点的 user 块未逐一实测）。

---

## 2. 抓包通道（可复现；**不含任何 token 明文**）

前置：模拟器上已装并登录 debug 包（**取包时点为 ADR-0227 落地前** ⇒ 当时 debug 的
applicationId 仍是 `io.pictelio.app`；#1037 之后改为 `io.pictelio.app.debug`，release 不变）；
宿主侧已生成 `OAuthConfig.java`（`pnpm --filter @pictelio/android-host sync:credentials`）。

### 2.1 取明文 refresh_token（不落文件、不入仓）

`refresh_token` 在宿主侧存于 AndroidKeyStore 加密的 `WSSecureStorageSharedPreferences.xml`
（密文格式 `Base64(ct) + \u0010 + Base64(iv)`，宿主机**解不开**——密钥在设备 Keystore 内）。
但应用登录时打的 Lynx 方法标签里带**明文参数**：

```bash
adb logcat -d | grep -ao "loginWithRefreshToken\.[A-Za-z0-9_-]*" | tail -1
# → loginWithRefreshToken.<明文 token>
```

> 该 token 是**账号凭据**：只在本机内存中用，**不要写进仓、不要贴进 issue/聊天**。

### 2.2 OAuth 刷新（复刻宿主 `PixivApiCore.oauthTokenExchange` 的协议）

```
POST https://oauth.secure.pixiv.net/auth/token
Headers: X-Client-Time: <ISO8601 UTC>   X-Client-Hash: md5(<time> + hashSecret)
         App-OS / App-OS-Version / User-Agent（取自 OAuthConfig.java）
Body:    client_id / client_secret / grant_type=refresh_token / get_secure_url=1 / refresh_token
```

⇒ 200 且返回 `access_token`（有效期 1h）+ `user.id`。
⚠️ 端点必须带 `user_id`，否则 400 `Invalid request.`。

### 2.3 拉目标端点

```
GET https://app-api.pixiv.net/v1/user/mypixiv?user_id=<uid>
Headers: Authorization: Bearer <access_token> / Referer / User-Agent
```

`next_url` 是**服务端下发的完整 URL**，续页直接 GET 它即可。

---

## 3. 本次抓到的三份真实响应

| # | 端点 | 条目数 | `next_url` | 用途 |
| --- | --- | --- | --- | --- |
| A | `/v1/user/mypixiv?user_id=<本机账号>` | 0 | `null` | **真实空态**（该账号无好P友）→ `mypixiv-users.empty.json` |
| B | `/v1/user/mypixiv?user_id=220294` | 28 | `...?user_id=220294&offset=30` | **真实分页响应** → `mypixiv-users.json`（取前 9 项逐字未改，含 2 条非空 novels） |
| C | `/v1/user/following?user_id=<本机账号>` | 30 | `...?offset=30` | **同族端点**对照（UserPreview 形状同构），用于复核 `novels` 键是否普遍存在 |

> 抓包时间：2026-10-23 上午；设备：模拟器 `emulator-5556`（1080×2160@480dpi）。

---

## 4. 逐项量测（响应 B，28 条目）

**条目顶层键**（28/28 全齐，键序一致）：

| 键 | 出现 | 类型 |
| --- | --- | --- |
| `user` | 28/28 | object |
| `illusts` | 28/28 | array（合计 55 个作品） |
| `novels` | 28/28 | array（**3 条非空**，合计 7 个小说元素） |
| `is_muted` | 28/28 | boolean（全 false） |

**user 块键**（28/28 全齐）：`id`(number) / `name`(string) / `account`(string) /
`profile_image_urls`(object) / `is_followed`(boolean, 全 false) / `is_accept_request`(boolean，27 false + 1 true)。

**novels 元素**（7 个元素逐项类型）：`id` number / `title` string / `caption` string /
`restrict` number / `x_restrict` number / `is_original` bool / `page_count` number /
`text_length` number / `is_bookmarked` bool / `total_bookmarks` number / `total_view` number /
`visible` bool / `total_comments` number / `is_muted` bool / `is_mypixiv_only` bool /
`is_x_restricted` bool / `novel_ai_type` number / `request` null / `create_date` string /
`series` object / `tags` array / `image_urls` object / `user` object
⇒ 与仓内 `PixivNovel` 声明的字段**类型逐项一致**（仓内未声明的 `restrict`/`is_original`/
`visible`/`is_muted`/`is_mypixiv_only`/`is_x_restricted`/`request` 属未消费字段，不声明）。

---

## 5. 落点

| 落点 | 坐标 |
| --- | --- |
| 真实分页 fixture | `packages/app-lynx/src/api/__fixtures__/mypixiv-users.json` |
| 真实空态 fixture | `packages/app-lynx/src/api/__fixtures__/mypixiv-users.empty.json` |
| 契约断言（形状 / is_accept_request / novels 元素 / 空态 / 透传行为） | `packages/app-lynx/src/api/user.test.ts` |
| 类型订正（`is_accept_request` 补声明、`novels` 注释订正） | `packages/app-lynx/src/api/types.ts` |
| 端点证据来源注记订正 | `docs/specs/lynx-mypixiv.md` §端点证据来源注记 |
| ADR 风险节订正 | `docs/adr/ADR-0193-*.md` 风险节 |

---

## 6. 复现提示

- 抓包只读不写，**不动**应用登录态（本流程不轮换 refresh_token；服务端返回的
  `refresh_token` 与原值一致，未回灌设备）。
- 换账号抓包时，**空态是常态**：好P友 = 互相关注，双方都得关注对方；本机账号即为空态样本 A。
  想抓非空样本，取 `user_id` 需来自关注列表（本次 B 样本的 uid 220294 即由此挑出）。
- `GET /ajax/user/mypixiv` **不存在**（404「指定されたエンドポイントは存在しません」）。
