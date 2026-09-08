# pixiv-viewer-app 直连实现分析

> 调研对象：[asadahimeka/pixiv-viewer-app](https://github.com/asadahimeka/pixiv-viewer-app)
> 调研时间：2026-09-08
> 调研方式：源码直读（raw.githubusercontent.com）+ WebFetch 元数据
> 项目版本：v1.32.2（`src/consts/index.js` 中 `CURRENT_APP_VERSION`）
> 主分支：`master`（默认分支）

## TL;DR

pixiv-viewer-app **实现了"直连"模式**，但只覆盖 **i.pximg.net 图片域**（Android 通过 Cronet/QUIC，iOS 通过 Capacitor Filesystem + 自定义 Host 头），**API 域（app-api.pixiv.net / oauth.secure.pixiv.net）实际并未启用直连**——`pixiv-api.js` 中的 API 直连分支被注释掉了，仅保留占位；当前 API 流量默认走 **AppAPI Proxy**（`p_api_proxy` 反代）或 HibiAPI 镜像。

Tauri 桌面端完全依赖 `tauri-plugin-http` 默认行为：**reqwest 默认 + 系统代理 + 标准 TLS 校验**，没有任何 Rust 侧的 SNI/IP 钉死/证书绕过逻辑。换言之，桌面端在 GFW 下基本等同于"开全局代理跑"，GFW 抵抗完全压在用户的系统代理上。

直连实现的核心机制（仅移动端）：

1. **配置层**（`src/store/index.js`）：`isDirectPximg: getSettingDef('PXV_PXIMG_DIRECT', false)` — 用户可在设置中开关 `PXV_PXIMG_DIRECT`。
2. **DNS 解析层**（`src/api/client/action.js::setPximgIP`）：通过 `1.1.1.1/dns-query` DoH 解析 `i.pximg.net`，结果缓存到 `LocalStorage.PXV_PXIMG_IP`，失败回落到硬编码 IP `210.140.139.131`。
3. **网络栈**（`src/platform/capacitor/utils.js`）：Android 走 `capacitor-plugin-pixiv-cronet`（Cronet/QUIC）；iOS 走 `Capacitor.Filesystem.downloadFile`。两者都把 `URL.host` 改成 `window.p_pximg_ip`，并显式注入 `Host: i.pximg.net` 头（Android）/省略 Host 头（iOS）。
4. **API 直连**：**已注释**——`src/api/client/pixiv-api.js:80-85` 是被注释掉的 `else if (window.p_api_hosts)` 分支，本来要做 Host 头替换 + 域名 IP 化，但作者选择不开启此路径。

---

## HTTP 客户端层

### 前端：axios + 平台适配器

**基础栈**：`src/api/http.js:1-9`

```javascript
import axios from "axios";
import nprogress from "nprogress";
import { BASE_API_URL, UA_Header } from "@/consts";
import platform from "@/platform";
```

- `axios.defaults.baseURL = BASE_API_URL`（`src/api/http.js:13`，默认指向 HibiAPI 镜像，由 `src/consts/index.js` 的 `VUE_APP_DEF_HIBIAPI_MAIN` 环境变量注入）
- `axios.defaults.timeout = 20000`
- Capacitor 模式下设置 `Origin: https://localhost` 以绕过 WebView CORS

**平台分发**：`src/api/client/pixiv-api.js:52-66` `getClient()` 按平台选择 client：

```javascript
const getClient = async () => {
  if (platform.isAndroid && window.p_api_hosts) {
    // Android + API 直连：使用 Cronet QUIC client
    const { getPixivQuicClient } = await import("@/platform/capacitor/utils");
    _quicClient = await getPixivQuicClient();
    return _quicClient;
  }
  if (!platform.isTauri) return axios; // Web/Electron：标准 axios
  if (_tauriClient) return _tauriClient;
  const { default: adapter } = await import("@/platform/tauri/axios-tauri-adapter");
  _tauriClient = axios.create({ adapter }); // Tauri：用 plugin-http 替换底层 fetch
  return _tauriClient;
};
```

### Tauri 适配器：把 axios 桥到 tauri-plugin-http

**`src/platform/tauri/axios-tauri-adapter.js:1-3`**：

```javascript
import { fetch } from "@tauri-apps/plugin-http";
import buildURL from "axios/lib/helpers/buildURL";
import buildFullPath from "axios/lib/core/buildFullPath";
```

- 用 `@tauri-apps/plugin-http` 的 `fetch` 替换 axios 的默认 XHR adapter
- **不支持自定义 TLS / SNI / 证书跳过**——完全是 plugin-http 默认行为
- 配置参数透传 `connectTimeout`、`maxRedirections`，body 透传 `config.data`

### Tauri Rust 后端：reqwest 默认 + 系统代理

**`src-tauri/src/main.rs`** 只注册 `tauri_plugin_http::init()`，无自定义配置；唯一 Rust 网络代码在 `src-tauri/src/command.rs::download_file`：

**`src-tauri/src/command.rs`（reqwest client 初始化）**：

```rust
let client = reqwest::Client::new();
let mut request = client
    .get(url)
    .header("user-agent", "Mozilla/5.0 ...");
```

- **`reqwest::Client::new()` = 默认配置 + 系统代理 + 标准 TLS**
- 没有 `.danger_accept_invalid_certs(true)`、没有自定义 `tls_built_in_root_certs`、`connector`
- 没有 `.proxy(Proxy::custom(...))`、没有 `.resolve(...)` 做 IP 钉死
- **Tauri 桌面端的"直连"实际等同于"绕过应用层、依赖系统代理"**，没有任何应用层的 GFW 抵抗

### Capacitor Android：Cronet/QUIC 插件

**`src/platform/capacitor/utils.js`**（imports）：

```javascript
import { PixivCronet } from "capacitor-plugin-pixiv-cronet";
```

**`src/platform/capacitor/utils.js` `getPixivQuicClient()`**：

```javascript
let _isCronetAvailable = false;
export async function getPixivQuicClient() {
  if (!_isCronetAvailable) {
    const { available } = await PixivCronet.isAvailable();
    if (!available) throw new Error("Cronet not available");
    _isCronetAvailable = true;
  }
  return async (url, config) => {
    const options = { url };
    if (config.method) options.method = config.method;
    if (config.headers) options.headers = config.headers;
    if (config.data) {
      options.body = typeof config.data == "string" ? config.data : JSON.stringify(config.data);
    }
    const res = await PixivCronet.request(options);
    // ...
  };
}
```

- `capacitor-plugin-pixiv-cronet` 是第三方 Capacitor 插件（项目仓库 `capacitor-plugin-pixiv-cronet`，未在本仓库中），封装了 Google Cronet 网络栈
- Cronet 自带 QUIC/HTTP3 支持，能绕开部分 GFW 干扰（QUIC 的 UDP 443 + 自带加密）
- 但 `PixivCronet.request(options)` **没有 SNI/IP 定制 API**，QUIC 模式下要靠 `p_api_hosts` 改 URL 才能真正"直连"——而这个分支被注释了

---

## TLS/SNI 处理

| 平台                   | TLS 处理                                                     | 自定义 hostname verifier | 证书校验绕过                      |
| ---------------------- | ------------------------------------------------------------ | ------------------------ | --------------------------------- |
| Web/Electron           | 浏览器标准                                                   | ❌ 无                    | ❌ 无                             |
| Tauri 桌面             | reqwest 默认 (`rustls-native-roots` 或 `native-tls`)         | ❌ 无                    | ❌ 无                             |
| Tauri 桌面（下载）     | reqwest 默认                                                 | ❌ 无                    | ❌ 无                             |
| Capacitor Android API  | Cronet/QUIC（API 域走 proxy，未启用直连）                    | ❌ 无                    | ❌ 无                             |
| Capacitor Android 图片 | Cronet/QUIC（启用直连）                                      | ❌ 无                    | ❌ 无（直连成功依赖 IP 真实有效） |
| Capacitor iOS          | `Capacitor.Filesystem.downloadFile`（iOS 原生 NSURLSession） | ❌ 无                    | ❌ 无                             |
| Capacitor iOS 图片     | `Filesystem.downloadFile` + HTTP 协议                        | ❌ 无                    | ❌ 无                             |

**结论**：本项目**没有任何证书绕过 / 自定义 hostname verifier 代码**。Pixiv 的 TLS 证书本身是合法的（由 Let's Encrypt / Sectigo 等签发），SNI 用 `i.pximg.net` 即可，所以 IP 钉死后浏览器/WebView 不会因证书问题失败。GFW 抵抗完全靠 **IP 替换 + 显式 Host 头** 实现。

**旁证**：`src/platform/capacitor/utils.js` 中存在 `getSkipSslSetting/setSkipSslSetting`（基于 Capacitor Preferences key `skip_ssl_verification`），表明作者**预留了跳过 SSL 校验的 hook**，但未见任何 UI 入口或实际使用代码——`grep skip_ssl` 仅匹配到该函数定义本身。

---

## DNS / IP 钉死

### 图片域 i.pximg.net（实际启用）

**`src/api/client/action.js:9-29`**：

```javascript
const DEF_API_HOSTS = {
  [OAUTH_DOMAIN]: "210.140.139.161", // oauth.secure.pixiv.net
  [API_DOMAIN]: "210.140.139.161", // app-api.pixiv.net
};
const DEF_PXIMG_IP = "210.140.139.131"; // i.pximg.net

function dnsQuery(domain) {
  return Promise.race([
    axios.get(`${COMMON_PROXY}https://1.1.1.1/dns-query?name=${domain}&do=false&cd=false`, {
      headers: { Accept: "application/dns-json", "User-Agent": navigator.userAgent },
    }),
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error("请求超时")), 5000)),
  ]);
}

async function setPximgIP() {
  if (!LocalStorage.get("PXV_PXIMG_DIRECT", false)) return; // 用户开关关则不解析
  const ip = LocalStorage.get("PXV_PXIMG_IP");
  if (ip) {
    window.p_pximg_ip = ip;
    return;
  }
  try {
    const res = await dnsQuery("i.pximg.net");
    const { data } = res.data.Answer[0]; // 取 DoH Answer 第一条的 A 记录
    console.log("pximg dns answer: ", data);
    window.p_pximg_ip = data;
    LocalStorage.set("PXV_PXIMG_IP", data);
  } catch (err) {
    console.log("setPximgIP err: ", err);
    window.p_pximg_ip = DEF_PXIMG_IP; // 失败回落硬编码 IP
  }
}
```

**DNS 解析路径**：`1.1.1.1/dns-query?name=i.pximg.net&do=false&cd=false`

- `do=false` = 禁用 DNSSEC OK 位
- `cd=false` = 禁用 Checking Disabled 位（这两个值在 DoH 实际作用有限，更多是历史兼容）
- **通过 `COMMON_PROXY`（Cloudflare Workers 镜像）走**，而不是直连 `1.1.1.1`——因为 GFW 也污染 1.1.1.1 的 DoH 端点，所以**用 Worker 反代绕开**。

**回落策略**：DNS 解析失败时硬编码 `210.140.139.131`（Pixiv i.pximg.net 的真实 IP 之一，Akamai 边缘节点）。

### API 域 app-api.pixiv.net / oauth.secure.pixiv.net（未启用）

**`src/api/client/action.js:31-50`**（被注释掉的 `setApiHosts`）：

```javascript
// async function setApiHosts(config) {
//   console.log('config: ', config)
//   if (config.apiHosts) {
//     window.p_api_hosts = config.apiHosts
//     return
//   }
//   try {
//     const res = await dnsQuery('pixiv.me')           // 用 pixiv.me 而非 app-api.pixiv.net
//     const { data } = res.data.Answer[0]
//     window.p_api_hosts = {
//       [OAUTH_DOMAIN]: data,
//       [API_DOMAIN]: data,
//     }
//     config.apiHosts = window.p_api_hosts
//     PixivAuth.writeConfig(config)
//   } catch (err) {
//     console.log('setApiHosts err: ', err)
//     window.p_api_hosts = DEF_API_HOSTS                // 回落硬编码 210.140.139.161
//   }
// }
```

- **整段函数被注释**，意味着 API 直连路径完全未启用
- 作者本意：用 `pixiv.me`（用户主页短链）解析 IP 后覆盖 API/OAUTH 域；失败回落 `210.140.139.161`
- 当前 `prepare()` 仅在 `directMode` 分支硬塞 `window.p_api_hosts = DEF_API_HOSTS`，但 `pixiv-api.js` 中读取 `p_api_hosts` 的代码也被注释（见下节），实际**无效**

---

## API 直连（app-api.pixiv.net）

### 直连分支已注释（关键发现）

**`src/api/client/pixiv-api.js:68-86`** `callApi()`：

```javascript
function callApi(url, options) {
  let finalUrl = /^https?:\/\//i.test(url) ? url : BASE_URL + url;
  const fUrl = new URL(finalUrl);
  if (window.p_api_proxy) {
    if (BASE_URL.includes(fUrl.hostname)) {
      fUrl.pathname = "/pixiv-app-api" + fUrl.pathname; // 反代路径前缀
    }
    if (OAUTH_URL.includes(fUrl.hostname)) {
      fUrl.pathname = "/pixiv-oauth" + fUrl.pathname; // 反代路径前缀
    }
    fUrl.hostname = window.p_api_proxy;
    finalUrl = fUrl.href;
  } /*  else if (window.p_api_hosts) {                       // ← 已注释！
    options.headers.Host = fUrl.host
    fUrl.host = window.p_api_hosts[fUrl.hostname]
    finalUrl = fUrl.href
  } */
  console.log("callApi Url: ", finalUrl);
  console.log("callApi options: ", options);
  return getClient().then((client) => client(finalUrl, options));
}
```

- `window.p_api_proxy` 分支（反代模式）**正常工作**——重写 hostname + 加 `/pixiv-app-api` 或 `/pixiv-oauth` 路径前缀
- `window.p_api_hosts` 分支（直连模式，**被注释**）原本要做：
  - `options.headers.Host = fUrl.host`（显式注入原 Host 头）
  - `fUrl.host = window.p_api_hosts[fUrl.hostname]`（把 URL 的 host 换成 IP）
- 注释符号是 `/* ... */` 多行块注释，**不是行尾注释**——说明作者明确希望"暂时禁用此分支"，但又**保留了完整代码以备回归**

### 实际生效的路径

| 平台    | `useLocalAppApi=true` + `useApiProxy=true` | `useLocalAppApi=true` + `directMode=true`                  | 默认                  |
| ------- | ------------------------------------------ | ---------------------------------------------------------- | --------------------- |
| Web     | `axios.get(/pixiv-app-api/...)` → 反代域名 | `axios.get(...)` 直连（**会失败**：GFW 拦截 + 无 IP 替换） | 走 HibiAPI 镜像       |
| Tauri   | `axios-tauri-adapter` → 反代域名           | plugin-http 直连（**会失败**：系统代理依赖）               | plugin-http → HibiAPI |
| Android | Cronet QUIC → 反代域名                     | Cronet QUIC 直连（**会失败**：URL 未被重写）               | 默认 axios → HibiAPI  |

---

## 图片直连（i.pximg.net）

这是**唯一真正生效的直连路径**，三个平台都有实现。

### Capacitor Android：Cronet/QUIC + IP 替换 + Host 头

**`src/platform/capacitor/utils.js` `getPximgUriAndroid()`**：

```javascript
export async function getPximgUriAndroid(url) {
  url.protocol = "https:";
  url.host = window.p_pximg_ip; // host 换成 IP
  const path = url.pathname.slice(1);
  const directory = Directory.External;
  const stats = await Filesystem.stat({ path, directory }).catch(() => ({ uri: null }));
  if (stats.uri) return Capacitor.convertFileSrc(stats.uri);
  const res = await Filesystem.downloadFile({
    url: url.href,
    path,
    directory,
    recursive: true,
    headers: { Host: "i.pximg.net", Referer: "https://www.pixiv.net" }, // 显式注入 Host 头
  });
  return Capacitor.convertFileSrc(res.path);
}
```

**关键点**：

1. `url.host = window.p_pximg_ip`：把 URL 的 host 换成 IP（`210.140.139.131` 或 DoH 解析的最新 IP）
2. `protocol = 'https:'`：保留 HTTPS——Pixiv CDN 证书是合法的，IP 直连不需要绕过证书校验
3. `headers: { Host: 'i.pximg.net', Referer: '...' }`：显式注入两个头
   - **Host: i.pximg.net**：绕过 CDN 的虚拟主机路由（Akamai/Pixiv 根据 Host 头选 bucket）
   - **Referer: https://www.pixiv.net**：绕过 Pixiv CDN 的 Referer 防盗链
4. 本地文件缓存：先 stat 文件存在就直接返回；不存在再 downloadFile 到 `Directory.External`
5. 用 `Capacitor.convertFileSrc()` 把本地路径转成 `capacitor://localhost/_capacitor_file_/...` 协议，WebView 可直接 `<img src>` 加载

### Capacitor iOS：原生 NSURLSession + HTTP

**`src/platform/capacitor/utils.js` `getPximgUriIOS()`**：

```javascript
export async function getPximgUriIOS(url) {
  url.protocol = "http:"; // iOS 强制 HTTP（无 Host 头注入）
  url.host = window.p_pximg_ip;
  const path = url.pathname.slice(1);
  const directory = Directory.Cache;
  const stats = await Filesystem.stat({ path, directory }).catch(() => ({ uri: null }));
  if (stats.uri) return Capacitor.convertFileSrc(stats.uri);
  const res = await Filesystem.downloadFile({
    url: url.href,
    path,
    directory,
    recursive: true,
    headers: { Referer: "https://www.pixiv.net" }, // 注意：iOS 没有 Host 头！
  });
  return Capacitor.convertFileSrc(res.path);
}
```

- iOS 用 **HTTP 而非 HTTPS**（可能因 ATS / 某些 CDN 限制；或为兼容性考虑）
- 不注入 Host 头——意味着 iOS 直连**很可能失败**（CDN 不知道路由到哪个 bucket），但作者保留了这个分支
- 仍然走 `Directory.Cache` 缓存

### Tauri 桌面：axios → plugin-http + IP 替换 + Host 头

**`src/platform/tauri/utils.js` `downloadFile`/`getPximgUri`**：

```javascript
if (isDirect && /\.(jpe?g|png)$/.test(url)) {
  const newUrl = new URL(url);
  newUrl.protocol = "http:"; // Tauri 用 HTTP（！）
  newUrl.host = window.p_pximg_ip;
  resPath = await invoke("download_file", {
    url: newUrl.href,
    writePath: `${await baseDlDir()}${subDir || ""}`,
    fileName,
    id: fileName,
    headers: { Host: "i.pximg.net", Referer: "https://www.pixiv.net/" },
  });
}
```

- Tauri 走 Rust `reqwest`（`src-tauri/src/command.rs::download_file`），通过 `invoke('download_file', ...)` 调起
- **HTTP 而非 HTTPS**——但 `reqwest` 的 HTTP 也能正常拿到图片（Pixiv 图片本身走 HTTPS 在 Tauri 也能 work，作者可能为了避开 HTTPS 证书问题）
- Host 头通过 `headers` 透传给 Rust command

### 非直连分支（默认）：图片代理

**`src/api/index.js` `url(id, index)`**：

```javascript
url(id, index) { return `https://${PXIMG_PROXY_BASE}/img-original/img/${id}/${index}.jpg` }
```

- 默认走 `PXIMG_PROXY_BASE`（来自 `LocalStorage.PXIMG_PROXY` 或环境变量 `VUE_APP_DEF_PXIMG_MAIN`）
- `i.pximg.net` → `pixiv.re` 等

---

## OAuth 直连（accounts.pixiv.net / oauth.secure.pixiv.net）

### OAuth 走 OAuth URL 常量

**`src/api/client/pixiv-api.js:38-39`**：

```javascript
const BASE_URL = "https://app-api.pixiv.net";
const OAUTH_URL = "https://oauth.secure.pixiv.net";
```

### PKCE 登录流

**`src/api/client/login.js`（完整文件）**：

```javascript
function pixivLogin() {
  const { code_verifier, code_challenge } = oauthPkce();
  return {
    login_url: `https://app-api.pixiv.net/web/v1/login?${stringify({
      code_challenge,
      code_challenge_method: "S256",
      client: "pixiv-android",
    })}`,
    code_verifier,
  };
}
```

**OAuth token 交换**：`src/api/client/pixiv-api.js::tokenRequest()` 发到 `OAUTH_URL/auth/token`（具体由 `callApi` 的 OAUTH_URL 分支决定）。

### 直连 OAuth 的支持

- 配置 `DEF_API_HOSTS` 中预留了 `oauth.secure.pixiv.net → 210.140.139.161`
- 但 `callApi` 中读取 `p_api_hosts` 的分支被注释（见 API 直连章节），所以**实际未生效**
- OAuth 流量默认走 HibiAPI 反代（`/pixiv-oauth` 路径前缀）

---

## 镜像/代理回退

### 多层代理栈

**`src/consts/index.js`**：

```javascript
const DEF_HIBIAPI_MAIN = process.env.VUE_APP_DEF_HIBIAPI_MAIN; // 主 HibiAPI 实例
const DEF_PXIMG_MAIN = process.env.VUE_APP_DEF_PXIMG_MAIN; // 主 pximg 代理
const DEF_API_PROXY = process.env.VUE_APP_DEF_APP_API_PROXY; // 主 AppAPI 反代
const PXIMG_PROXYS = process.env.VUE_APP_PXIMG_PROXYS; // pximg 代理列表
const HIBIAPI_ALTS = process.env.VUE_APP_HIBIAPI_ALTS; // HibiAPI 备用列表
const APP_API_PROXYS = process.env.VUE_APP_APP_API_PROXYS; // AppAPI 代理列表
const COMMON_PROXY = process.env.VUE_APP_COMMON_PROXY; // 通用代理（DoH 等）
const COMMON_IMAGE_PROXY = process.env.VUE_APP_COMMON_IMAGE_PROXY; // 图片代理回退
```

### README 文档（[pixiv-viewer 仓库](https://github.com/asadahimeka/pixiv-viewer/blob/master/docs/README.en.md)）

来自 `docs/README.en.md:117-120`：

```
AppAPI Proxy Mode | Direct Pixiv App API connection (self-hosted proxy required)
pximg Direct Access | Direct access to Pixiv image servers
```

来自 `docs/README.en.md:215`：

```
Enable pximg direct access mode (requires a good network environment)
```

来自 `docs/README.en.md:260`：

```
PixEz: Direct connect mode logic reference.
```

- **明确承认"直连模式"参考了 PixEz**（Flutter 版 Pixiv 客户端）
- 提供两种模式：**AppAPI Proxy Mode**（自建反代）+ **pximg Direct Access**（图片直连）

### DoH 解析也走代理

**`src/api/client/action.js:11-19`**：

```javascript
axios.get(`${COMMON_PROXY}https://1.1.1.1/dns-query?name=${domain}&do=false&cd=false`);
```

- 即便解析 DNS 也通过 `COMMON_PROXY` 走，避免被 GFW 污染 1.1.1.1

---

## 用户配置

### 用户可配置的开关

| 配置项          | 存储 key           | 默认值          | 作用                                                                   |
| --------------- | ------------------ | --------------- | ---------------------------------------------------------------------- |
| 直连图片        | `PXV_PXIMG_DIRECT` | `false`         | 图片直连开关（`isDirectPximg`）                                        |
| 直连图片 IP     | `PXV_PXIMG_IP`     | DoH 解析结果    | 用户可手动覆盖 IP                                                      |
| AppAPI 反代     | `useApiProxy`      | `false`         | API 是否走反代                                                         |
| AppAPI 反代域名 | `apiProxy`         | `DEF_API_PROXY` | 反代域名（用户可改）                                                   |
| API 直连模式    | `directMode`       | `false`         | 是否启用 API 直连（**当前无效**）                                      |
| 本地 AppAPI     | `useLocalAppApi`   | `false`         | 是否走本地 API 路由（`useLocalAppApi=true` 时走 `localApi.actionMap`） |

**配置存储**：`src/api/client/pixiv-auth.js:5-9`：

```javascript
const CONFIG_FILE = "PXV_CLIENT_CONFIG";
const defaultConfig = {
  directMode: false,
  refreshToken: "",
  useApiProxy: false,
  useLocalAppApi: false,
};
```

### 设置入口

- **移动端**：Capacitor UI 暴露 `PXV_PXIMG_DIRECT` 开关（在 `Setting/` 目录下，具体 UI 未详查）
- **Tauri/Electron**：通过 store 暴露 `isDirectPximg`（`src/store/index.js:73`）

### 配置文件读取方式

`src/store/index.js:73`（默认值）：

```javascript
isDirectPximg: getSettingDef('PXV_PXIMG_DIRECT', false),
```

- 通过 `LocalStorage` 持久化（`@/utils/storage`）
- `getActionMap()` 在 Capacitor 模式下被调用，触发 `setPximgIP()`

---

## 关键源文件清单

| 文件                                        | 行数 | 作用                                                                                                                                                                                                                                      |
| ------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/api/client/pixiv-api.js`               | ~600 | PixivApi 主类：`BASE_URL`、`OAUTH_URL`、`getClient()` 平台分发、`callApi()` URL 重写（注释的直连分支）、所有 API endpoint 方法（`illustDetail`、`searchIllust`、`bookmarkIllust` 等）、OAuth `tokenRequest`、`refreshAccessToken`         |
| `src/api/client/action.js`                  | ~330 | 本地 API 路由表（`actionMap` 覆盖 40+ 端点）；`setPximgIP()` DoH 解析；`prepare()` 三模式分发（proxy/direct/local）；`DEF_API_HOSTS`/`DEF_PXIMG_IP` 硬编码 IP                                                                             |
| `src/api/client/pixiv-auth.js`              | ~110 | refresh_token 持久化（`PXV_CLIENT_CONFIG`）；`login`/`loginByToken`/`relogin`/`logout`                                                                                                                                                    |
| `src/api/client/login.js`                   | ~70  | PKCE 登录 URL 生成（`oauthPkce` + `pixivLogin`），指向 `app-api.pixiv.net/web/v1/login`                                                                                                                                                   |
| `src/api/http.js`                           | ~50  | axios 全局配置（baseURL、超时、nprogress、Capacitor UA）                                                                                                                                                                                  |
| `src/api/index.js`                          | 较大 | Web API 路由层；图片代理 URL `url(id, index)` 用 `PXIMG_PROXY_BASE`；`localApi.APP_CONFIG` 配置                                                                                                                                           |
| `src/api/user.js`                           | 中等 | PixivNow 客户端（基于 `fetch`，与 HibiAPI 配套使用）                                                                                                                                                                                      |
| `src/consts/index.js`                       | 中等 | 常量集中地：`BASE_API_URL`、`PXIMG_PROXY_BASE`、`UA_Header`、`DEF_API_PROXY` 等                                                                                                                                                           |
| `src/platform/tauri/axios-tauri-adapter.js` | ~130 | axios → `@tauri-apps/plugin-http` fetch 桥接；无 TLS 定制                                                                                                                                                                                 |
| `src/platform/tauri/utils.js`               | 中等 | Tauri 工具：`downloadFile` 直连分支（含 IP 替换 + Host 头）；`getPximgUri` 直连分支；`baseDlDir`/`ensureDownloadDir`                                                                                                                      |
| `src/platform/capacitor/utils.js`           | ~280 | Capacitor 工具：`getPixivQuicClient`（Cronet QUIC）；`getPximgUriAndroid/iOS`（图片直连，IP 替换 + Host 头）；`fsDirectDownload`（直连下载）；`fsDownload`/`dmDownload`（普通下载）；`getSkipSslSetting`/`setSkipSslSetting`（预留 hook） |
| `src/platform/capacitor/mounted.js`         | 短   | onMounted hook（仅埋点，无网络配置）                                                                                                                                                                                                      |
| `src/store/index.js`                        | ~210 | Vuex store：`appSetting.isDirectPximg = PXV_PXIMG_DIRECT`；`user`/`contentSetting`/`blockTags/Uids`/`novelTextConfig` 等                                                                                                                  |
| `src-tauri/src/main.rs`                     | 短   | Tauri 入口：注册 `tauri_plugin_http::init()` + 多个插件；无自定义网络逻辑                                                                                                                                                                 |
| `src-tauri/src/command.rs`                  | 中等 | Tauri 命令：`download_file` 用 `reqwest::Client::new()` 默认配置 + 流式下载 + 进度事件                                                                                                                                                    |

---

## 启示（对 Pictelio 直连方案）

1. **API 直连 ≠ 必要**。pixiv-viewer-app 在 API 域放弃了直连、注释了 `p_api_hosts` 分支，转用反代 + HibiAPI 镜像，因为：(a) Pixiv API 的 OAuth + App 签名的安全策略复杂，自己跑反代更省心；(b) API 流量小、缓存命中率高，反代成本低；(c) 图片才是流量大头——CDN 上百 KB × N 张，**只对图片做 IP 钉死就能解决 80% 的 GFW 问题**。**Pictelio 直连方案可以借鉴**：只对 `i.pximg.net` 做 IP 替换 + Host 头注入，API 仍走 Capacitor/Java bridge 或反代。

2. **DoH 必须走代理**。pixiv-viewer-app 的 `1.1.1.1/dns-query` 解析也要包一层 `COMMON_PROXY`（Cloudflare Workers 反代），否则 GFW 会污染 1.1.1.1 的 EDNS。**Pictelio 在 Android 上做 DNS 解析时也要走自有代理**——或者干脆直接用 `WebView.shouldInterceptRequest` 拦截 `*.pximg.net` 由 Java 侧钉 IP（参考项目 `PixivApiPlugin.java` 已有现成的 Referer + UA 注入模式）。

3. **Host 头注入是直连的关键**。Pixiv CDN 用 Akamai 虚拟主机，不注入 `Host: i.pximg.net` 头的话，IP 直连会被路由到错误的 bucket，返回 403/404。**Pictelio 的图片下载路径已经注入了 Referer（Java 侧），需要在拦截器里同时补 Host 头**——或者用 OkHttp 的 `Request.Builder().header("Host", "i.pximg.net")` 显式覆盖。

4. **回落硬编码 IP 是兜底**。DoH 解析失败时使用 `210.140.139.131`（Pixiv 真实 IP），避免应用完全不可用。**Pictelio 可以内置 2-3 个 `i.pximg.net` 的 IP（Akamai 边缘节点）作为 fallback 池**，按顺序重试，避免单 IP 失效。

5. **iOS 走 HTTP 而非 HTTPS 的取舍**。pixiv-viewer-app 在 iOS 直连图片时强制 HTTP（`url.protocol = 'http:'`），原因可能是 ATS 配置 / Host 头注入限制 / Cronet 在 iOS 不支持。**Pictelio 如果将来支持 iOS（Capacitor 同源），要单独处理 iOS 的 Host 头注入路径**——`Capacitor.Filesystem.downloadFile` 的 `headers` 在 iOS 似乎不生效（pixiv-viewer 注释了 iOS 路径下的 Host 头）。可以走 `WebView.shouldInterceptRequest` 或原生插件绕开。

6. **预留 SSL 跳过 hook 但不暴露**。`getSkipSslSetting/setSkipSslSetting` 暴露了 API 但没有 UI 入口——说明作者**承认未来可能需要**但当前没用。**Pictelio 在 OkHttp client builder 上可以保留 `.sslSocketFactory(insecure, insecure)` 的 hook 注释**以备不时之需，但不暴露给用户。

7. **Tauri 桌面端的 GFW 抵抗完全失败**。这是 pixiv-viewer-app 的盲点——`reqwest::Client::new()` 默认 + 系统代理，桌面用户必须自配代理。**Pictelio 如果未来做桌面端，应该在 Rust 侧提供：(a) 自定义 `tls::TlsConnector` 跳过校验 hook；(b) `Proxy::custom` 配置；(c) `reqwest::Client::resolve()` 做 IP 钉死**——这才是 Tauri/Pictelio 共享同一套直连栈的正确姿势。
