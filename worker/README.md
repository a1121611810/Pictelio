# Pictelio API 反代（用户自建 Cloudflare Worker）

ADR-0146 主路径：部署你自己的 API 反代 Worker（免费额度 10 万请求/天，远超单用户用量），获得形如 `https://pictelio-api-proxy.<你的子域>.workers.dev` 的私有端点，填入 Pictelio 设置「API 反代地址」即可在无代理环境稳定使用。

信任边界：Worker 部署在**你自己的** Cloudflare 账号——流量凭据不经过任何第三方。

## 部署方式 A：Cloudflare Dashboard（无需本地环境）

1. 登录 [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create Worker**（名字随意，如 `pictelio-api-proxy`）→ **Deploy**
2. 点 **Edit code**，把本目录 `src/worker.js` 的全部内容粘贴进去替换默认代码 → **Deploy**
3. 复制 Worker 的 URL（形如 `https://pictelio-api-proxy.<子域>.workers.dev`）

## 部署方式 B：wrangler CLI

```bash
npm i -g wrangler
wrangler login
cd worker/            # 本目录
wrangler deploy
```

## App 侧配置

设置 → 「API 反代地址」填入 Worker URL（形如 `https://pictelio-api-proxy.<子域>.workers.dev`）。清空 = 关闭反代。

## 合约（App ↔ Worker）

| App 请求 | Worker 转发到 |
| --- | --- |
| `<base>/api/*` | `https://app-api.pixiv.net/*` |
| `<base>/oauth/*` | `https://oauth.secure.pixiv.net/*` |

- 请求头/体/查询串透传（Authorization、X-Client-Time/Hash、App-OS、UA 原样上行）
- 响应原样回传；上游错误带状态码透传
- 图片不在本合约内：走 App 的图床镜像体系（可叠加）

## 已知边界

- 免费额度 10 万请求/天；超限 Cloudflare 会限流（个人使用几乎不可能触达）
- `workers.dev` 域名在部分地区可能被干扰——如遇此情况，可在 Cloudflare 绑定自己的自定义域名（免费）后填入该域名
- Worker 源码即本目录，可自行审计；后续版本若有合约变更会在此 README 同步
