# ADR-0170: app-lynx Native bridge 与 PictelioTranslate Java 模块

- 状态: accepted
- 日期: 2026-09-19
- 关联: wayfinder 地图 [#617](https://github.com/a1121611810/Pictelio/issues/617)（决策 Q5/Q15/Q17/Q18）；spec [docs/specs/app-lynx-novel-translation.md](../specs/app-lynx-novel-translation.md) §4 领域模型 + §5 数据流；调研 `research/openai-responses-api.md`（#622，commit `85ca33b4`，777 行；流式事件 Q2/Q3/Q4/Q5）；ADR-0037（字节零进 JS 堆 / PixivApiPlugin 网关）；ADR-0053（Lynx NativeModule 契约 / 双通道探测 / callback 去 null）；ADR-0167（app-lynx novel intro 三段式导航，姊妹 ADR）；ADR-0161（Native POST form body 范式）

## 背景

app-lynx 客户端需要新增小说翻译功能（wayfinder #617）。用户自填 LLM endpoint（base URL + API key + model name），所有 LLM 调用统一走 OpenAI Responses API（`POST /v1/responses`，流式 SSE）。与 webview 端已有的 DeepSeek 翻译栈（`packages/app/src/services/novel/createNovelTranslator.ts`）完全独立、不复用（spec §2 Out of scope #1）。

API key 是用户私人凭据，**必须**不进入 JS heap（理由与 refresh_token / access_token 同源——Android WebView XSS / Lynx JS bridge 反序列化攻击都可能泄漏 JS 侧明文）。地图 #617 Q5（网络通路）+ Q15（Native 模块命名）已收敛：**新建独立 Java NativeModule `PictelioTranslate`**，与 `PictelioAuth` / `PictelioApi` / `PictelioSecureStorage` 同级。

### 现状对比

| 维度 | webview 端（不参与本 ADR） | app-lynx 端（本 ADR） |
|------|-------------------------|---------------------|
| 翻译栈 | `createNovelTranslator` + DeepSeek 直连 fetch | **完全从零**，新建 `OpenAIResponsesProvider` |
| API key 存放 | JS 模块作用域（webview 信 V8 隔离） | Android Keystore via `PictelioTranslate` Java 堆 |
| 协议 | DeepSeek chat/completions | OpenAI Responses API `/v1/responses` |
| Native bridge | `PixivApiPlugin`（Capacitor bridge） | **`PictelioTranslate` Lynx NativeModule** |

### 与现有 NativeModule 的差异

`PictelioApi`（Pixiv API 转发）和 `PictelioAuth`（OAuth 登录）都是**同步调用 + 一次性回调**形态：

- `PictelioApi.request(method, path, body, cb)` → `cb(status, data, rotatedToken)`
- `PictelioAuth.loginWithRefreshToken(token, cb)` → `cb(userInfoJson, "")`

**翻译是流式场景**（SSE 增量推送 `response.output_text.delta`，可能持续 30s+），需要：
1. **多次回调**：每次 chunk 到达 Java 侧就回调 JS 一次（不等流结束）；或
2. **单次回调 + JS 侧从 Java 拉**（拉模式，类似 `PictelioApi.ugoiraExtractStreamPoll`）

两种模式各有取舍（详见决策 §5）。本 ADR 选择**「多次回调 + 终态回调」混合**（推送为主、单次 array 终态为辅），原因见 §5.4。

## 决策

### D1. 新建独立 Java NativeModule `PictelioTranslateModule`

**Q15 决策**：与 `PictelioAuth` / `PictelioApi` 同级。**不复用** `PictelioApi`（语义边界不同——Pixiv API 是「应用内已有 access_token 的内部请求」，翻译是「用户自填凭据的外部 LLM 调用」），**不**新建「translate-auth」二级模块（API key 一字段一职责，无需拆分）。

**类签名**（参考 `PictelioApiModule.java:58` / `PictelioAuthModule.java:26` / `PictelioSecureStorageModule.java:23`）：

```java
package io.pictelio.app;

public class PictelioTranslateModule extends LynxModule {
    private static final String TAG = "PictelioTranslateModule";
    public PictelioTranslateModule(Context context) { super(context); }
}
```

**LynxActivity 注册**（per-view 模式，参考 `LynxActivity.java:199-204`）：

```java
builder.registerModule("PictelioTranslate", PictelioTranslateModule.class);
```

**注册位置**：插入 `PictelioApi` 注册之后（`LynxActivity.java:202`），与现有 6 个 NativeModule 同款模式（PictelioSecureStorage / PictelioApp / PictelioAuth / PictelioApi / PictelioPrefs / NetDiag），不引入新的注册范式。

### D2. API key 存储：Android Keystore + SharedPreferences 密文

**Q5 决策**：API key 走 Android Keystore（端到端加密），与 `PictelioSecureStorageModule` 同源——后者已实现 `SecureStorageCompat`（对齐主项目 `@aparajita/capacitor-secure-storage` / ADR-0050），可直接复用。

**存储键命名**（避免与 webview 端共享存储冲突——参考 `LynxActivity.java:72` `SYSTEMBARS_PREFS = "CapacitorStorage"`）：

| 键名 | 内容 | 用途 |
|------|------|------|
| `translate_llm_base_url` | `https://api.openai.com/v1` | LLM endpoint base URL |
| `translate_llm_api_key` | `sk-...`（密文） | API key 明文 |
| `translate_llm_model` | `gpt-5` | 模型 ID |
| `translate_llm_target_lang` | `zh-CN` | 目标语言 BCP-47 |
| `translate_llm_source_lang` | `ja` | 源语言 BCP-47 |

**所有键走 Keystore 加密存储**，**不**走明文 SharedPreferences（虽然 base URL / model 不是凭据，但同键命名空间保持一致性；且未来如需加密 base URL 防泄漏，统一入口更简单）。

### D3. Java 端 HTTP 调用形态

**复用 `PixivApiCore.executeRequest` 模式**——不新建 HTTP 客户端：

- 共用 OkHttp client `PixivApiCore.getSharedClient()`（连接池 / DNS 缓存 / 代理配置复用）
- 共用 budget（`OAuthConfig.TIMEOUT_CONNECT` 15s + `OAuthConfig.TIMEOUT_READ` 30s）
- 共用 DNS override / `https_proxy` 自动读取（项目级代理配置）

**与 `PixivApiCore.executeRequest` 的差异**：

| 维度 | `PixivApiCore.executeRequest` | `PictelioTranslate.executeRequest` |
|------|----------------------------|--------------------------------|
| 鉴权头 | `Authorization: Bearer <access_token>` + 401 自动刷新 | `Authorization: Bearer <api_key>`（**无刷新逻辑**——LLM API key 不轮换） |
| Referer / UA | `Referer: https://www.pixiv.net/` + Pixiv UA | **无** Referer（LLM endpoint 不需要）；User-Agent 保留（兼容代理日志） |
| Base URL | `https://app-api.pixiv.net` 固定 | 用户自填 base URL（运行时拼 `/v1/responses`） |
| Body | `application/json` | `application/json` |
| 流式支持 | 否（一次性返回完整 body） | **是**（OkHttp `Response.body().byteStream()` + SSE 帧解析） |

**为什么不复用 `PixivApiCore` 直接扩展**（保留独立 HTTP 调用层）：
1. 鉴权头不同（access_token vs api_key；混用会导致 401 刷新逻辑误伤 LLM 端点）
2. 流式 vs 一次性响应处理路径不同（chunk 解析 vs 完整 body 解析）
3. Base URL 动态 vs 硬编码（拼 URL 路径时机不同）

新方法 `PictelioTranslateCore.executeTranslate(baseUrl, apiKey, body)` 独立存在，与 `PixivApiCore` 平级（同包 `io.pictelio.app`，不引入子包）。

### D4. Lynx 回调契约（去 null，参考 ADR-0053 §2）

`com.lynx.react.bridge.CallbackImpl` 对 null 参数抛异常（真机 99900 实证）；统一遵循「首参空串 = 无错误」约定（`err` 为空串 / undefined 视为成功）。

#### D4.1 `setApiKey(baseUrl, apiKey, model, targetLang, sourceLang, cb)` —— 设置 endpoint 配置

| 场景 | 回调 |
|------|------|
| 成功 | `cb("", "")` |
| 失败（参数非法 / Keystore 写入失败） | `cb("", errMsg)` |

- **参数校验**：baseUrl 必须 `https://` 前缀；apiKey 长度 ≥ 20；model 非空；lang 匹配 BCP-47 简式（`^[a-z]{2,3}(-[A-Z]{2})?$`）。
- **JS 侧只拿到脱敏镜像**（`LlmEndpointPublic`）——通过 `getEndpoint(cb)` 拿回 `{baseURL, model, targetLang, sourceLang, hasKey: true, updatedAt}`；**apiKey 字段永不返回**。

#### D4.2 `getEndpoint(cb)` —— 拿 endpoint 脱敏镜像

| 场景 | 回调 |
|------|------|
| 成功 | `cb(endpointJson, "")` |
| 失败 / 未配置 | `cb("", errMsg)` |

返回 JSON 形态：`{"baseURL":"...", "model":"...", "targetLang":"zh-CN", "sourceLang":"ja", "hasKey":true, "updatedAt":1726...}`。

#### D4.3 `clearEndpoint(cb)` —— 清空 endpoint

| 场景 | 回调 |
|------|------|
| 成功 | `cb("", "")` |
| 失败 | `cb("", errMsg)` |

清空所有 5 个 SecureStorage 键。**不**自动清翻译缓存（spec §9.5：用户主动在「清除翻译缓存」入口清）。

#### D4.4 `translateStream(requestJson, cb)` —— 流式翻译核心

**签名**：JS 传**单个** callback，回调形态由载荷 `type` 字段判别（见本文末「实现期修订」）。

**回调契约**：

| 事件 | Java 侧触发 | 回调形态 |
|------|------------|---------|
| 收到 `response.output_text.delta` | 解析 SSE 帧 → 累加到当前 paragraphIndex | `onChunk(chunkJson, "")` —— `chunkJson = {"type":"delta","paragraphIndex":N,"text":"..."}` |
| 收到 `response.reasoning_text.delta` | 解析 SSE 帧 | `onChunk(chunkJson, "")` —— `chunkJson = {"type":"reasoning_delta","text":"..."}`（埋点用，不展示） |
| 收到 `response.completed` | 流终止 | `onDone(usageJson, "")` —— `usageJson = {"inputTokens":N,"outputTokens":N,"cachedTokens":N}` |
| 收到 `response.failed` / `response.incomplete` | 流终止 | `onError(errorJson, "")` —— `errorJson = {"code":"...","message":"...","retryable":bool}` |
| 收到裸 `error` 事件 | 流中断 | `onError(errorJson, "")` |
| 连接级错误（DNS / 5xx / 401 / 429 等） | OkHttp execute 失败 | `onError(errorJson, "")` —— `errorJson` 含 HTTP status 字段 |
| 用户主动 abort（`abortStream(cb)`） | OkHttp call.cancel() | **不回调 onError**；调 `abortStream` 自身的 `cb("", "")` |

**AbortController 包装**：JS 侧每次 `translateStream` 前生成 `AbortController`，传给 Java 侧 token（如 `requestJson._abortToken = "uuid-..."`）；Java 侧维护 `Map<String, Call>`，`abortStream(token, cb)` 调 `Call.cancel()` 并 remove。

#### D4.5 `probeEndpoint(baseUrl, cb)` —— 设置页 inline probe

设置页输入 base URL 后 debounce 600ms 探测 endpoint 是否兼容 `/v1/responses`（spec §6.1）。

**探测策略**：构造一次最小 POST（`max_output_tokens: 1` + dummy api key）→ 看 HTTP 状态码：
- `401` / `403` → ✅ endpoint 存在（认证失败 = endpoint 在）
- `400` + `"invalid_api_key"` 类 → ✅ endpoint 存在（同上）
- `404` + `"Unknown URL"` → ❌ 不兼容（OpenRouter / 智谱 / Qwen / 文心 / LocalAI 特征）
- `405` Method Not Allowed → ⚠ 仅 chat/completions 兼容

| 场景 | 回调 |
|------|------|
| 成功探测 | `cb(probeJson, "")` —— `probeJson = {"status":"ok\|azure\|deepseek\|vllm\|partial\|unknown","detail":"..."}` |
| 网络错误 | `cb("", errMsg)` |

### D5. JS 侧 TS 接口 + native bridge 探测

#### D5.1 TS 接口（`packages/app-lynx/src/native/pictelioTranslate.ts`）

参考 `packages/app/src/native/` 现有 NativeModule 包装层（`pictelioApi.ts` / `pictelioAuth.ts`）：

```ts
import { isNativeMode } from "@/utils/nativeBridge";

interface TranslateModule {
  setApiKey(
    baseUrl: string, apiKey: string, model: string,
    targetLang: string, sourceLang: string,
  ): Promise<void>;
  getEndpoint(): Promise<LlmEndpointPublic | null>;
  clearEndpoint(): Promise<void>;
  translateStream(
    request: TranslationRequest, signal: AbortSignal,
  ): AsyncIterable<TranslationChunk>;
  probeEndpoint(baseUrl: string): Promise<ProbeResult>;
}

export function getPictelioTranslate(): TranslateModule | null {
  if (!isNativeMode()) return null;
  // NativeModules 是 Lynx 全局内置对象（ADR-0053 §1）
  return (NativeModules as any).PictelioTranslate ?? null;
}
```

#### D5.2 双通道探测（ADR-0053 §1）

`isNativeMode()` 复用 `packages/app/src/utils/nativeBridge.ts`：

```ts
export function isNativeMode(): boolean {
  return typeof NativeModules !== "undefined" || !!globalThis.NativeModules;
}
```

#### D5.3 Provider 层集成

`OpenAIResponsesProvider.translate(request, signal)` 内部：
1. 调 `getPictelioTranslate()` 拿模块实例；null → 抛 `endpoint_unconfigured` 错误（不静默降级到 web fetch）
2. 调 `translateStream(request, signal)` 返回 `AsyncIterable<TranslationChunk>`（Lynx `Symbol.asyncIterator` polyfill 已验证，调研 #623）
3. `for-await-of` 消费 chunk → 映射到 `TranslationChunk` 5 类型（spec §4.4）
4. AbortSignal 触发时调 `abortStream(token)` 取消 OkHttp call

### D6. 流式 chunk 回调实现（多次 cb + 终态单次 cb）

**选型**：本 ADR 采用「**多次回调（推送）**」模式，**不**采用 ADR-0128 拉模式（`streamEngine.poll()`）。

| 模式 | 优点 | 缺点 |
|------|------|------|
| **推送：每次 chunk 一次 cb** | 实时性最好（段落实时增量）；JS 侧代码线性简单（for-await） | callback 调用频繁（30s 流可能触发 200+ cb）；Lynx callback 派发开销需评估 |
| 拉模式（ADR-0128） | callback 调用少（每 batch 一次）；poll 控制消费节奏 | JS 侧需自旋 poll；与 AsyncIterator 集成需 Promise wrapper |
| **单次 array cb** | callback 调用 1 次；JS 侧最简单 | 失去流式语义；用户感知 30s 黑屏后才出译文 |

**为什么选推送**：
1. spec §4.2 Provider 接口已声明返回 `AsyncIterator<TranslationChunk>`（Lynx `Symbol.asyncIterator` 已验证可用，#623）；推送模式直接对应 `for-await-of`。
2. 翻译场景的实时增量（段落边生成边展示）是核心 UX 价值（spec §6.2 翻译按钮显示「翻译中 N%」进度）；拉模式或单次 cb 无法支撑。
3. 推模式 callback 派发频率 ≈ 5-20 次/s（GPT-5 流速），Lynx 单 callback 派发 ~0.5ms（参考 `PictelioApiModule` 真机 benchmark），单章流（30s）总开销 < 300ms，可接受。

**回调实现核心**（参考 `PictelioApiModule.executeRequest` + ADR-0128 `streamEngine`）：

```java
private final ExecutorService TRANSLATE_EXECUTOR = Executors.newCachedThreadPool();

@LynxMethod
public void translateStream(String requestJson, Callback onChunk, Callback onDone, Callback onError) {
    try {
        JSONObject req = new JSONObject(requestJson);
        String baseUrl = SecureStorageCompat.get(...).baseUrl();
        String apiKey = SecureStorageCompat.get(...).apiKey(); // Java 堆解密
        String model = ...;
        String abortToken = req.optString("_abortToken");
        // 拼 URL：baseUrl 已含 /v1 时只补 /responses（见本文末「实现期修订」）
        URL url = new URL(responsesUrl(baseUrl));
        Request httpReq = new Request.Builder()
            .url(url)
            .addHeader("Authorization", "Bearer " + apiKey)
            .addHeader("Content-Type", "application/json")
            .post(RequestBody.create(JSON_MEDIA_TYPE, buildBody(req, model)))
            .build();

        Call call = TRANSLATE_EXECUTOR.submit(() -> {
            try (Response resp = PixivApiCore.getSharedClient().newCall(httpReq).execute()) {
                if (!resp.isSuccessful()) {
                    handleHttpError(resp, onError);
                    return;
                }
                parseSseStream(resp.body().byteStream(), onChunk, onDone, onError);
            } catch (IOException e) {
                String errMsg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                onError.invoke("{\"code\":\"network\",\"message\":\"" + errMsg + "\",\"retryable\":true}", "");
            } finally {
                ACTIVE_CALLS.remove(abortToken);
            }
        });
        ACTIVE_CALLS.put(abortToken, call);
    } catch (Throwable e) {
        onError.invoke("{\"code\":\"unknown\",\"message\":\"" + e.getMessage() + "\"}", "");
    }
}
```

**SSE 帧解析**（参考调研 Q2 / Q3 / Q4）：

```java
private void parseSseStream(InputStream in, Callback onChunk, Callback onDone, Callback onError) throws IOException {
    BufferedReader reader = new BufferedReader(new InputStreamReader(in, UTF_8));
    String line;
    String currentParagraphIdx = "0"; // 由 input 数组结构推导；本 ADR 不细化
    while ((line = reader.readLine()) != null) {
        if (line.isEmpty()) continue; // SSE 帧分隔
        if (!line.startsWith("data: ")) continue;
        String json = line.substring(6);
        try {
            JSONObject event = new JSONObject(json);
            String type = event.optString("type");
            switch (type) {
                case "response.output_text.delta":
                    onChunk.invoke(
                        new JSONObject()
                            .put("type", "delta")
                            .put("paragraphIndex", currentParagraphIdx)
                            .put("text", event.optString("delta"))
                            .toString(),
                        "");
                    break;
                case "response.reasoning_text.delta":
                    onChunk.invoke(
                        new JSONObject().put("type", "reasoning_delta").put("text", event.optString("delta")).toString(),
                        "");
                    break;
                case "response.completed":
                    JSONObject usage = event.getJSONObject("response").optJSONObject("usage");
                    onDone.invoke(usage != null ? usage.toString() : "{}", "");
                    break;
                case "response.failed":
                    JSONObject err = event.getJSONObject("response").optJSONObject("error");
                    onError.invoke(new JSONObject()
                        .put("code", err != null ? err.optString("code", "server") : "server")
                        .put("message", err != null ? err.optString("message") : "流失败")
                        .put("retryable", true).toString(), "");
                    break;
                case "response.incomplete":
                    JSONObject incomplete = event.getJSONObject("response").optJSONObject("incomplete_details");
                    onError.invoke(new JSONObject()
                        .put("code", "incomplete")
                        .put("message", incomplete != null ? incomplete.optString("reason") : "输出截断")
                        .put("retryable", true).toString(), "");
                    break;
                case "error":
                    onError.invoke(new JSONObject()
                        .put("code", "server")
                        .put("message", event.optString("message"))
                        .put("retryable", true).toString(), "");
                    break;
            }
        } catch (JSONException e) {
            Log.w(TAG, "SSE 帧解析失败: " + json, e);
            // 单帧失败不中断流；继续读下一帧
        }
    }
}
```

**DeepSeek 兼容**（spec §9.3）：DeepSeek 无 `[DONE]` 哨兵，按 `response.completed` / `incomplete` / `failed` 三态处理即可（已收敛于上述 switch），无额外分支。

### D7. AbortController 包装

JS 侧 `AbortController` → Java 侧 `Map<String, Call>`：

```ts
// JS 侧
const controller = new AbortController();
const token = crypto.randomUUID();
const stream = translateModule.translateStream({ ...req, _abortToken: token }, controller.signal);
controller.signal.addEventListener("abort", () => translateModule.abortStream(token));
```

```java
// Java 侧
private static final Map<String, Call> ACTIVE_CALLS = new ConcurrentHashMap<>();

@LynxMethod
public void abortStream(String token, Callback cb) {
    Call call = ACTIVE_CALLS.remove(token);
    if (call != null) call.cancel();
    cb.invoke("", "");
}
```

`Call.cancel()` 触发 `IOException("Canceled")` → `translateStream` catch 块检查 `call.isCanceled()` 后**不回调 onError**（用户主动中断 vs 失败语义区分，对应 spec §7.2 `aborted` 状态）。

### D8. 测试策略

- **Java 单测**：参考 `PictelioApiModule.executeRequest` 单测模式（Robolectric + mock OkHttp client）：
  - 成功路径：mock SSE 帧序列 → 验证 onChunk 调用次数 + 终态 onDone 触发
  - 流中断路径：mock 流读到一半断流 → 验证 onError 触发且 error.code = "network"
  - abort 路径：mock 慢流 → 调 abortStream → 验证无 onError 回调
  - 参数校验：baseUrl 非 https → cb("", errMsg)
  - Keystore 写入失败：mock SecureStorageCompat 抛 → cb("", errMsg)
- **契约测试**：JS 侧 `pictelioTranslate.test.ts`：
  - 探测：mock NativeModules.PictelioTranslate → 验证 Provider 调用形态
  - 双通道探测：`isNativeMode()` 在 web-core / Lynx 双端行为（参考 `novelIntroEntryGuards.test.ts` 模式）
- **不写 agent-browser E2E**（ADR-0084 入门禁）；端到端靠 android-e2e（spec §10.3）。

## 后果

### 正面

- **API key 字节零进 JS heap**（ADR-0037 原则）：SecureStorageCompat 加密 + Java 堆解密 + 回调永不返回明文 apiKey；XSS / Lynx bridge 反序列化攻击都无法窃取。
- **Java 堆隔离 + 类型隔离**：translation HTTP 调用与 Pixiv API 调用走不同方法栈（不共享 token 刷新逻辑），未来翻译流独立演进（流式 SSE 解析、AbortController）不影响 Pixiv API 模块。
- **可独立测试**：Java 单测覆盖流式解析各路径；JS Provider 单测覆盖 chunk 规约（与 web fetch mock 解耦）。
- **复用基础设施**：OkHttp 连接池 / DNS override / 代理配置 / Keystore 路径均复用，零增量维护。
- **流式 UX 实时性**：推送回调支撑段落边生成边展示（spec §6.2 进度条 + 增量渲染）。

### 负面 / 成本

- **新增 ~600 行 Java 代码**：`PictelioTranslateModule.java` + `PictelioTranslateCore.java` + 测试；与 `PictelioApiModule` 同量级。
- **新增 LynxActivity 注册 1 行**：`builder.registerModule("PictelioTranslate", ...)`，维护成本可忽略。
- **回调频率**：30s 流 × 5-20 chunks/s ≈ 150-600 次 callback 派发；Lynx bridge 派发 ~0.5ms（真机基准），单章总开销 < 300ms，可接受；如未来成为热点可降频到每 50ms 批量一次（spec §N10 留作后续 ticket）。
- **流式错误分类责任在 Java 侧**：错误码 `unauthorized` / `rate_limit` / `insufficient_balance` / `model_not_found` / `endpoint_not_responses` / `server` / `network` / `content_filter` 需在 Java 侧根据 HTTP status / SSE 事件分流；这部分 spec §4.4 已定义，Java 侧按表实现即可。
- **内存占用**：每个 in-flight 流持有 OkHttp `Call` + SSE buffer（默认 8KB）+ Java 堆 JSON 解析中间对象，单流 < 100KB；与 `PictelioApi.ugoiraExtractStream` 同量级。

### 风险与遗留

- **web-core preview 缺失 NativeModule**：web-core 预览时 `isNativeMode()` 返回 false → `getPictelioTranslate()` 返回 null → Provider 抛 `endpoint_unconfigured` 错误。**翻译功能仅 Android 真机可用**（与 webview 端隔离，不影响 lynx-only 编辑流）；web-core 仅作 UI 调试入口。
- **DeepSeek prompt cache 字段命名差异**（调研 #622 §Q8）：DeepSeek 用 `prompt_cache_hit_tokens`，OpenAI 用 `input_tokens_details.cached_tokens`；Java 侧只把 `usage` 原文回传 JS（onDone callback），字段映射收敛于 ADR-0169（#619）。
- **Azure URL 模板特殊处理**（spec §9.2）：baseURL `*.openai.azure.com` 需自动补 `/openai/v1` 段 + 加 `api-version: preview` header；本 ADR 仅决定「探测在 Java 侧做」，具体逻辑收敛于 ADR-0169。
- **续翻整批回退路径**：流中断时 `onError(retryable=true)` → Provider 决定整批重试（spec §7.2）；整批重试用 `stream: false` + `max_output_tokens` 调高（spec §9.6 + ADR-0169 收敛细节）。本 ADR 不细化。

## 否决的替代方案

### A. 复用 `PictelioApiModule` 加 `translate` 方法 —— **已否决**

**理由**：语义边界破坏。
- `PictelioApi` 走 `PixivApiCore.executeRequest`，自动注入 Bearer access_token + 401 自动刷新；**该机制是 Pixiv 端点专用**，不适用于通用 LLM endpoint。
- 强行扩展将导致：(a) `executeRequest` 需加 `boolean useAccessToken` 形参污染主路径；(b) 401 刷新误伤 LLM 端点（LLM 401 是「API key 错」，不该触发 refresh_token 刷新）；(c) SSE 流式解析逻辑无法嵌入 `executeRequest` 的同步 body 解析路径。
- 独立模块边界清晰：Pixiv API 调用 = 一组，LLM 翻译调用 = 一组，各自演进不互相干扰。

### B. 双模块（`PictelioTranslate` + `PictelioTranslateAuth`）拆分 —— **已否决**

**理由**：API key 一字段一职责，无需拆分。
- 双模块意味着：(a) JS 侧要先后调两个模块才能完成 endpoint 设置；(b) Java 侧双模块共享 SecureStorage 读写逻辑（重复代码）；(c) 维护成本翻倍。
- 单模块（`PictelioTranslate.setApiKey` / `getEndpoint` / `clearEndpoint` / `translateStream` / `probeEndpoint` / `abortStream`）已能完整覆盖所有职责；模块内部方法分组即可，无需拆类。

### C. JS web fetch 直连 DeepSeek —— **已否决**

**理由**：直接违反 Q5「API key 不进 JS heap」。
- web fetch 需要 JS 侧持有 API key 明文（`fetch(url, { headers: { Authorization: "Bearer sk-..." } })`）；即使设「用完即删」也无法防 XSS / Lynx bridge 反序列化攻击。
- 与 webview 端历史方案（DeepSeek 在 JS 模块作用域）同源风险——webview 端在 web-core 浏览器中可接受（DOM 隔离边界强），但 Android LynxView / WebView 的 JS bridge 是攻击面（参考 ADR-0037 背景 #1）。
- 一票否决；Q5 是用户决策优先级最高项。

### D. 复用主项目 `PixivApiPlugin`（Capacitor bridge）—— **已否决**

**理由**：架构边界不匹配。
- `PixivApiPlugin` 是 **Capacitor 插件**（`@capacitor/core` + `registerPlugin`），依赖 Capacitor bridge；app-lynx 是**纯 LynxView 无 Capacitor**（参考 `LynxActivity.java` 注释：BridgeActivity 无法跳过 bridge 初始化，故采用双 Activity 方案）。
- Lynx NativeModule 与 Capacitor Plugin 是两套独立机制（前者 `LynxModule` + `LynxMethod`，后者 `@CapacitorPlugin` + `PluginCall`），不可互用。
- 必须新建独立 Lynx `LynxModule`（与现有 `PictelioApiModule` 等同形态）。

## References

- wayfinder 地图 #617（app-lynx 端小说翻译）
- spec #618 `docs/specs/app-lynx-novel-translation.md`（939 行 / 16 sections；本 ADR 收敛其 Q5/Q15 决策 + §4 领域模型 + §5 数据流 + §6.1 设置页 + §9.6 流中断）
- 调研 #622 `research/openai-responses-api.md`（commit `85ca33b4`，777 行；本 ADR §D6 引用 Q2 流式事件 / Q3 reasoning 双通道 / Q4 错误终止三态 / Q5 取消语义）
- 调研 #623 `research/lynx-async-iterator-support.md`（Lynx `Symbol.asyncIterator` polyfill 验证）
- 调研 #625 `research/llm-endpoint-compatibility.md`（spec §9.1 inline probe 决策依据）
- ADR-0037（字节零进 JS 堆 / PixivApiPlugin 网关）—— 本 ADR §D2/D3 复用其安全原则与 OkHttp 客户端
- ADR-0050（Lynx 登录持久化 SecureStorage）—— 本 ADR §D2 复用其 `SecureStorageCompat` 抽象
- ADR-0053（Lynx NativeModule 契约 / 双通道探测 / callback 去 null）—— 本 ADR §D4/D5 引用其 callback 契约
- ADR-0128（ugoira 流式渐进拉模式）—— 本 ADR §D6 引用其 `streamEngine` 设计思路作为对照（不直接复用）
- ADR-0161（Native POST form body 范式）—— 本 ADR §D3 复用其 HTTP body 构造模式
- ADR-0167（app-lynx novel intro 三段式导航）—— 姊妹 ADR，命名 / 状态格式对齐
- `PictelioApiModule.java`（`packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioApiModule.java:58`）
- `PictelioAuthModule.java`（`packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioAuthModule.java:26`）
- `PictelioSecureStorageModule.java`（`packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioSecureStorageModule.java:23`）
- `LynxActivity.java:199-204`（per-view NativeModule 注册入口）

## 术语表

| 术语 | 定义 |
|------|------|
| `PictelioTranslate` | app-lynx 端 LLM 翻译 Java NativeModule（与 PictelioApi / PictelioAuth 同级） |
| `SecureStorageCompat` | app-lynx 端 SecureStorage 适配层（对齐 `@aparajita/capacitor-secure-storage` / ADR-0050；Keystore 加密 SharedPreferences 密文） |
| `LlmEndpointPublic` | endpoint 脱敏镜像类型（spec §4.1）：含 baseURL / model / targetLang / sourceLang / hasKey / updatedAt，**不含 apiKey** |
| `TranslationChunk` | 流式 chunk 5 类型（spec §4.4）：delta / reasoning_delta / cached / done / error |
| 推送模式 | Java 侧每次 chunk 到达立即调 JS callback（vs 拉模式：JS 侧周期性 poll） |
| inline probe | 设置页输入 base URL 后 debounce 600ms 探测 endpoint 是否兼容 `/v1/responses`（spec §6.1）；探测带 dummy key（ADR-0173 D2） |
---

## 实现期修订（2026-09-19，真机 + code-review 后）

本节记录**实现与本文早期描述不一致**的地方及原因（以代码为准，本文其余部分按此修订阅读）：

| 早期描述 | 实际实现 | 原因 |
|---|---|---|
| `new URL(baseUrl + "/v1/responses")`（D4.2 示例） | `responsesUrl(baseUrl)`：baseURL 已以 `/v1` / `/openai/v1` 结尾则只补 `/responses`，否则补 `/v1/responses` | 用户按 UI 提示填 `https://api.openai.com/v1`，早期写法实际请求 `/v1/v1/responses` → 100% 404（真机实测） |
| JS 传 4 个 callback（chunk / done / error） | 单个 callback + `type` 判别（`delta` / `reasoning_delta` / `done`；错误走第二参） | 与 ADR-0053 §2 双参契约统一；lynx 侧同一 handler 多次回调实测稳定 |
| `probeEndpoint(baseUrl, cb)`（D4.5） | `probeEndpoint(baseURL, apiKey, model, cb)` | 探测需向真实端点发最小 POST；前端传 **dummy key**，与凭据无关（ADR-0173 D2） |
| 探测值域 `ok/azure/deepseek/vllm/partial/unknown` | 原生只发 `ok/partial/incompatible/unknown`（+`keyInvalid` 布尔） | 原生只能从 HTTP 状态码判「通不通」；provider 归属由 JS 按 hostname 判定（ADR-0173 D3）。404 由 `partial` 改判 `incompatible`（spec §9.1） |
| 流式复用 `PixivApiCore.getSharedClient()`（D3） | 流式走**专用 OkHttp 客户端**（`callTimeout=0` / `readTimeout=45s`） | 共享客户端带 45s `callTimeout`，会掐断正常长流；掐断后 `call.isCanceled()` 又被当成「用户取消」而静默不回调 → JS promise 永不 settle（真机「永久 N% 翻译中」）。用户中断改由显式 `USER_ABORTED` 集合标记。<br>**实现期修订**：`readTimeout` 由 120s 收紧到 **45s** —— 帧间静默超过它视为链路已断；否则「连上了但正文永不送达」会让 UI 永久停在「N% 翻译中」（模拟器实测形态） |
| 终态只认 `response.completed` | 流结束时若未见终态事件 → **合成 done** | 真机实测 DeepSeek 只发到 `output_item.done` 就断流（无 `response.completed`）；不合成则 promise 永不 settle。另：`response.output_text.done` 是 item 级事件，**不得**当流终态 |
| `instructions` 由调用方传（spec §9.4） | 调用方传，段落以 `[N]` 前缀锚定；增量按最近锚点归属段落 | 段落回填需要按段对齐；web 与 native 两侧共用同一 `buildSystemInstructions` |
| 多次 callback 逐帧推送（本文 D6 全节） | **交付主通道 = `sendGlobalEvent`（全局事件总线）**，callback 通道不再用于交付；轮询（`translatePoll`）保留为**候选**兜底（见下：其实测回调 0 次，当前不构成有效兜底） | 见下「交付通道实测」 |

### 交付通道实测（2026-09-20，模拟器 emulator-5554）

本模块的 `Callback` 通道在**一条流内不可靠**，四组对照实验（全部用 mock SSE 服务、逐次确认点击落点）：

| 交付策略 | Java 侧 | JS 侧 |
|---|---|---|
| 解析期逐段 `callback.invoke` | 11 帧 | 1 帧 |
| 同上 + 帧间 25ms 节流 | 11 帧 | 1 帧 |
| 解析入队 + 主线程每 tick 派发一帧 | `queued=9` 全部派发 | 1 帧 |
| 每段一次回调（累积式） | `queued=4` | 1 帧 |
| 整章一帧 `delta_all` | `queued=2` | 0 帧 |
| `translatePoll` 轮询（每次调用独立回调） | 158 次调用到达原生 | 适配器回调 **0 次** |

上表 6 行 = 6 组策略（前 4 组为 callback 通道的对照实验，后 2 组为「合并单帧」与「轮询」两条替代路线）。

结论：**该 Callback 通道对「一条流内多次投递」不可靠，且对部分调用完全不投递**；轮询路线在同一批实测里回调 0 次，因此**不能**被当作可用兜底 —— 当前唯一可用的交付路径是事件总线。

改为 `LynxView.sendGlobalEvent("pictelioTranslateFrame", [frameJson])`（与 benchNav 同一通道）后，模拟器端到端跑通：按钮变「重译」、正文渲染出译文段落。代价是交付形态从「逐段增量推送」变为「整章就绪后一次性推送」（解析期累积、收尾单帧），因为单帧事件才可靠。

#### 跨端信封契约（单一事实源）

Java 解析器与 JS 适配器之间的帧信封是本功能的**跨端契约**，以本节为准（两端实现与测试都锚这里，禁止各自从实现反推）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `type` | `"delta_all"` | 整章译文帧（每段只出现一次，携带该段全文） |
| `paragraphs` | `{index:number, text:string}[]` | 段落数组；`index` 为 `[N]` 锚点序号，`text` 已做段落级 `trim`（锚前分隔空白不属于译文） |
| `type` | `"done"` | 流终态（可带 `usage`，透传自 `response.completed`） |
| `type` | `"error"` | 失败终态，`message` 为可读原因 |
| `type` | `"pending"` | 仅轮询通道：暂无帧，继续轮询 |
| `streamId` | `string` | 帧归属键 = 原生实际使用的 `_abortToken`（**两端同值**：transport 复用调用方 token，Java 回显）。接收侧据此丢弃非本流帧 —— 陈旧流不得写进当前翻译 |
| `seq` | `number` | per-stream 单调序号。**两条交付路径都必须注入**（事件总线与 `translatePoll` 共用同一计数器）—— 只给一路注入会让去重单向失效（实测同帧两路交付 → 译文重复 2~3 次）。接收侧按 `(streamId, seq)` 去重 |

事件名：`pictelioTranslateFrame`；载荷：**帧 JSON 字符串**（本仓库 `sendGlobalEvent` 字符串载荷可达性由本 ADR 的端到端验收确认；此前 README 记载的「字符串不可用」已按其「实测修正」条目更新）。JS 侧对非法载荷（类型不符 / 无法解析）**必须 warn 并丢弃**，禁止静默。

**验证探针（归因证据）**：JS 侧 `console.warn` 落 logcat（tag `lynx`, `lynx_console.cc`）—— 交付归因以 JS 侧探针为准，Java 侧 `事件总线交付 frames=N` 只证明发送次数，不证明到达。
