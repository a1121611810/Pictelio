package io.pictelio.app;

import android.content.Context;
import android.util.Log;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import okhttp3.Call;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * LLM 翻译 Native Module（#617 + ADR-0170）—— 用户自填 LLM endpoint 的 OpenAI Responses API
 * 流式调用 + API key Keystore 隔离。
 *
 * <p>JS 侧访问：{@code NativeModules.PictelioTranslate}。
 * 6 个 LynxMethod 契约（Callback.invoke 双参，第二参区分错误；成功/失败均不用 null）：
 * <ul>
 *   <li>{@code setApiKey(apiKey, cb)}：cb("", "") 成功；cb("", errMsg) 失败。apiKey 走 Keystore
 *       加密（与 refresh_token 同源，ADR-0050 / SecureStorageCompat），不进 JS heap。</li>
 *   <li>{@code getEndpoint(cb)}：cb(endpointJson, "") 成功；cb("", errMsg) 失败。返回脱敏镜像
 *       JSON（含 baseURL / model / targetLang / sourceLang 默认值 + hasKey + updatedAt）；
 *       当前实现 baseURL/model/targetLang/sourceLang 取 Java 侧硬编码默认（用户未持久化），与
 *       ADR-0170 §D4.2 形态一致；apiKey 永不返回。</li>
 *   <li>{@code clearEndpoint(cb)}：cb("", "") 成功；cb("", errMsg) 失败。清空所有 endpoint
 *       键（当前实现 = 清 apiKey；未来 baseURL/model/targetLang/sourceLang 持久化时一并清）。</li>
 *   <li>{@code translateStream(requestJson, cb)}：流式 Responses API（POST baseURL/v1/responses，
 *       stream=true）。每收一帧 SSE → cb(chunkJson, "")；终止 cb(doneJson, "") 或 cb("", errMsg)。
 *       单一 callback 多次触发（推送模式，ADR-0170 §D6）；chunk 内含 type / text / paragraphIndex
 *       字段。AbortStream 主动中断时不调 cb，仅调 abortStream 自身的 cb。</li>
 *   <li>{@code probeEndpoint(baseURL, apiKey, model, cb)}：最小请求（max_output_tokens=1）→
 *       cb(okJson, "") 成功（HTTP 2xx / 401 / 403 / 400-「invalid_api_key」 → endpoint 存在；404 /
 *       "unknown url" → 不兼容；405 → 仅 chat/completions；其它 5xx → unknown）；cb("", errMsg)
 *       网络错误。</li>
 *   <li>{@code abortStream(streamId, cb)}：cb("", "") 成功（无活动流也算成功，幂等）；取消
 *       OkHttp Call（触发 call.isCanceled() → translateStream 不回调 onError 终结态）。
 *       streamId 由 JS 端生成（UUID 或纯 JS 会话内唯一串——真机 PrimJS 无 crypto，见 nativeTranslate.ts），与 translateStream 的请求一一对应。</li>
 * </ul>
 *
 * <p>约束（ADR-0170 §D3）：
 * <ul>
 *   <li>复用 {@link PixivApiCore#getSharedClient()} OkHttp 单例（连接池 / DNS override / 代理配置复用）；
 *       预算 15s connect + 30s read（同 {@code PixivApiCore}）。</li>
 *   <li>不复用 {@code PixivApiCore.executeRequest}：鉴权头不同（Bearer api_key vs access_token +
 *       401 自动刷新；LLM 401 不该触发 refresh_token 刷新）+ 流式响应处理路径不同（chunk 解析 vs
 *       完整 body）。</li>
 *   <li>Referer 不注入（LLM endpoint 不需要），User-Agent 保留（兼容代理日志）。</li>
 *   <li>模块级线程池 {@link #TRANSLATE_EXECUTOR}（newCachedThreadPool，无固定上限、按请求伸缩），
 *       与 {@link PictelioApiModule#API_EXECUTOR} 同款模式；网络请求与 SSE 解析均在 worker 线程，
 *       完成直接回调（Lynx Callback 自行派发回 JS 线程）。</li>
 * </ul>
 */
public class PictelioTranslateModule extends LynxModule {

    private static final String TAG = "PictelioTranslateModule";

    /** Keystore alias：与 ADR-0170 §D2 表格对齐。SecureStorageCompat 会自动加 "capacitor-storage_" 前缀。 */
    private static final String KEY_API_KEY = "translate_llm_api_key";

    /** 硬编码默认 endpoint（ADR-0170 §D2 表格默认行）。用户当前不在 JS/Java 双端持久化
     * baseURL/model/targetLang/sourceLang——本 ADR 阶段 deliverable 仅落地 6 个方法骨架；
     * 后续 ticket 可扩展 setEndpoint(baseUrl, model, targetLang, sourceLang, cb) 把默认值持久化。 */
    private static final String DEFAULT_BASE_URL = "https://api.openai.com/v1";
    private static final String DEFAULT_MODEL = "gpt-5";
    private static final String DEFAULT_TARGET_LANG = "zh-CN";
    private static final String DEFAULT_SOURCE_LANG = "ja";

    /** 自定义 User-Agent（不复用 OAuthConfig.USER_AGENT——OAuthConfig 由 sync-credentials 脚本生成，
     * 本模块不依赖 Pixiv 凭据；直接硬编码避免交叉依赖）。 */
    private static final String USER_AGENT = "PictelioTranslate/1.0 (Android; Lynx)";

    private static final MediaType JSON_MEDIA_TYPE = MediaType.get("application/json; charset=utf-8");

    /** 段落锚标记：模型按 `[N]` 前缀逐段输出（与 api/translate.ts 的 input 形态同源）。 */
    private static final Pattern PARAGRAPH_ANCHOR = Pattern.compile("\\[(\\d+)\\]");

    /** 流式 + probe 共用线程池（ADR-0170 §D3 后段）；与 PictelioApiModule.API_EXECUTOR 同款。 */
    private static final ExecutorService TRANSLATE_EXECUTOR = Executors.newCachedThreadPool();

    /** in-flight 流注册表（streamId → OkHttp Call）。abortStream 按 token 取消；translateStream
     * 终止时（done / error / 异常）remove。线程安全（translateStream / abortStream 跨线程调用）。 */
    private static final Map<String, Call> ACTIVE_CALLS = new ConcurrentHashMap<>();

    /**
     * 用户显式 abort 的 streamId 集合。
     *
     * <p>为什么需要它：OkHttp 的 {@code call.isCanceled()} 无法区分「用户点了停止」与
     * 「客户端自己取消」（{@code callTimeout} 到期 / 连接中断）。历史实现一律当作前者而
     * 静默 return → JS 侧 Promise 永不 settle → store 永久 translating（真机表现为按钮
     * 卡在「N% 翻译中」，无错误、无日志）。现在只有出现在本集合里的 streamId 才静默退出，
     * 其余取消一律走 error 回调。
     */
    private static final java.util.Set<String> USER_ABORTED = ConcurrentHashMap.newKeySet();

    // ── SSE 解析状态（每次 translateStream 新建一个解析器实例，见 SseParser） ──
    /** 当前段落号（由最近出现的 [N] 锚标记决定） */
    private int anchorIndex = 0;
    /** 跨帧截断的锚标记暂存（"

[" 被切成两帧时的 "["） */
    private final StringBuilder anchorCarry = new StringBuilder();

    /**
     * 流式专用 OkHttp 客户端：**不带 callTimeout**。
     *
     * <p>共享客户端（{@link PixivApiCore#getSharedClient()}）带 15s connect + 30s read +
     * 45s callTimeout —— 那是为一次性 JSON 请求调的；流式响应天然可能长时间只发 keepalive
     * 或 reasoning 帧，45s 上限会把正常长流掐断。这里保留 connect 超时（连接建立必须有界），
     * read 放宽到 120s（帧间静默上限），callTimeout = 0（不限总时长，由 abortStream / 服务端收尾）。
     */
    private static final OkHttpClient STREAM_CLIENT = PixivApiCore.getSharedClient()
            .newBuilder()
            .callTimeout(0, java.util.concurrent.TimeUnit.MILLISECONDS)
            .readTimeout(120, java.util.concurrent.TimeUnit.SECONDS)
            .build();

    public PictelioTranslateModule(Context context) {
        super(context);
    }

    private Context appContext() {
        return ((LynxContext) mContext).getContext();
    }

    /**
     * 写 API key 到 Keystore（端到端加密，与 refresh_token 同源，ADR-0050）。同一 alias 反复写入覆盖
     * 旧值；updatedAt 取写入时刻（epoch ms），由 getEndpoint 返回。
     */
    @LynxMethod
    public void setApiKey(String apiKey, Callback callback) {
        if (apiKey == null || apiKey.isEmpty()) {
            callback.invoke("", "apiKey 不能为空");
            return;
        }
        // apiKey 长度下限 20（spec §6.1「保存时三字段一并校验」；此处仅校验 apiKey，baseURL/model
        // 当前走 JS 端存储 + requestJson 传入，不经此入口）
        if (apiKey.length() < 20) {
            callback.invoke("", "apiKey 长度过短（>= 20）");
            return;
        }
        TRANSLATE_EXECUTOR.execute(() -> {
            try {
                new SecureStorageCompat(appContext()).setItem(KEY_API_KEY, apiKey);
                Log.i(TAG, "setApiKey 成功（长度=" + apiKey.length() + "）");
                callback.invoke("", "");
            } catch (Throwable e) {
                Log.w(TAG, "setApiKey 失败", e);
                String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                callback.invoke("", "Keystore 写入失败：" + msg);
            }
        });
    }

    /**
     * 读 endpoint 脱敏镜像：baseURL/model/targetLang/sourceLang（当前均取 Java 硬编码默认）+ hasKey +
     * updatedAt。apiKey 永不返回（ADR-0037 字节零进 JS 堆）。
     */
    @LynxMethod
    public void getEndpoint(Callback callback) {
        TRANSLATE_EXECUTOR.execute(() -> {
            try {
                Context ctx = appContext();
                if (ctx == null) {
                    throw new IOException("上下文不可用");
                }
                SecureStorageCompat storage = new SecureStorageCompat(ctx);
                String apiKey = readApiKeyQuietly(storage);
                boolean hasKey = apiKey != null && !apiKey.isEmpty();
                long updatedAt = readUpdatedAtQuietly(ctx);
                JSONObject endpoint = new JSONObject();
                endpoint.put("baseURL", DEFAULT_BASE_URL);
                endpoint.put("model", DEFAULT_MODEL);
                endpoint.put("targetLang", DEFAULT_TARGET_LANG);
                endpoint.put("sourceLang", DEFAULT_SOURCE_LANG);
                endpoint.put("hasKey", hasKey);
                endpoint.put("updatedAt", updatedAt);
                // 成功路径也打点：此前只有失败分支有日志，导致「无 logcat 输出」被误读为
                // 「原生方法从未被调用」（#617 真机排查踩坑）。不打印 apiKey（仅 hasKey 布尔）。
                Log.i(TAG, "getEndpoint 成功 hasKey=" + hasKey + " baseURL=" + DEFAULT_BASE_URL
                        + " model=" + DEFAULT_MODEL);
                callback.invoke(endpoint.toString(), "");
            } catch (Throwable e) {
                Log.w(TAG, "getEndpoint 失败", e);
                String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                callback.invoke("", "读 endpoint 失败：" + msg);
            }
        });
    }

    /** 清空 endpoint：移除 Keystore 中 apiKey 密文 + 密钥条目。当前实现只清 apiKey（baseURL/model/
     * targetLang/sourceLang 暂无持久化）；后续扩展 setEndpoint 后此处一并清 5 键。 */
    @LynxMethod
    public void clearEndpoint(Callback callback) {
        TRANSLATE_EXECUTOR.execute(() -> {
            try {
                new SecureStorageCompat(appContext()).removeItem(KEY_API_KEY);
                Log.i(TAG, "clearEndpoint 成功");
                callback.invoke("", "");
            } catch (Throwable e) {
                Log.w(TAG, "clearEndpoint 失败", e);
                String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                callback.invoke("", "清 endpoint 失败：" + msg);
            }
        });
    }

    /**
     * 流式翻译（POST baseURL/v1/responses，stream=true）。
     *
     * <p>{@code requestJson} 形态：{@code { baseURL, model, input: string[],
     * max_output_tokens?, reasoning?: { effort? }, stream: true, _abortToken?: string,
     * instructions?: string }}。baseURL / model 必填（throw → cb("", errMsg)）；
     * input 必填非空。
     *
     * <p>回调契约（单 callback 多次触发）：
     * <ul>
     *   <li>每帧 SSE（{@code response.output_text.delta} / {@code response.reasoning_text.delta}）→
     *       {@code cb(chunkJson, "")}，chunkJson 含 {@code type / text / paragraphIndex?}；</li>
     *   <li>终态成功（{@code response.completed}）→ {@code cb(doneJson, "")}，doneJson 含
     *       {@code type:"done", usage?: {...}}；</li>
     *   <li>终态失败（{@code response.failed} / {@code response.incomplete} / 裸 {@code error}
     *       事件 / OkHttp 异常 / HTTP 非 2xx）→ {@code cb("", errMsg)}；</li>
     *   <li>用户主动 abort（{@code abortStream} 触发 {@code Call.cancel()}）→ 不回调本 cb，仅
     *       abortStream 自身的 {@code cb("", "")}。</li>
     * </ul>
     */
    @LynxMethod
    public void translateStream(String requestJson, Callback callback) {
        final String streamId;
        final String apiKey;
        final Request httpReq;
        try {
            JSONObject req = new JSONObject(requestJson);
            String baseUrl = req.optString("baseURL", "").trim();
            String model = req.optString("model", "").trim();
            // 入口打点：字段名/长度可见，便于区分「JS 未发请求」与「字段契约不符」
            // （此前 JS↔Java 载荷字段名不一致导致静默失败；不打印 apiKey 与正文）
            Log.i(TAG, "translateStream 入口 baseURL=" + (baseUrl.isEmpty() ? "(empty)" : baseUrl)
                    + " model=" + (model.isEmpty() ? "(empty)" : model)
                    + " input=" + (req.optJSONArray("input") == null ? "null" : String.valueOf(req.optJSONArray("input").length()))
                    + " abortToken=" + req.has("_abortToken"));
            if (baseUrl.isEmpty()) {
                callback.invoke("", "baseURL 不能为空");
                return;
            }
            if (model.isEmpty()) {
                callback.invoke("", "model 不能为空");
                return;
            }
            // 允许 http:// 仅当指向本机回环/宿主别名（端到端测试窗口：emulator 的 10.0.2.2
            // 映射宿主 mock SSE 服务）。真实 endpoint 仍强制 https（apiKey 明文不进网络）。
            boolean loopback = baseUrl.startsWith("http://127.0.0.1")
                    || baseUrl.startsWith("http://localhost")
                    || baseUrl.startsWith("http://10.0.2.2");
            if (!baseUrl.startsWith("https://") && !loopback) {
                callback.invoke("", "baseURL 必须为 https:// 前缀");
                return;
            }
            JSONArray inputArr = req.optJSONArray("input");
            if (inputArr == null || inputArr.length() == 0) {
                callback.invoke("", "input 不能为空数组");
                return;
            }

            Context ctx = appContext();
            if (ctx == null) {
                throw new IOException("上下文不可用");
            }
            // API key 仅在 Java 堆解密（不进 callback 链，ADR-0037）
            String read = new SecureStorageCompat(ctx).getItem(KEY_API_KEY);
            if (read == null || read.isEmpty()) {
                callback.invoke("", "尚未配置 API key");
                return;
            }
            apiKey = read;

            streamId = req.optString("_abortToken", UUID.randomUUID().toString());
            JSONObject body = buildRequestBody(req, model, inputArr);
            String url = responsesUrl(baseUrl);
            httpReq = new Request.Builder()
                    .url(url)
                    .addHeader("Authorization", "Bearer " + apiKey)
                    .addHeader("Content-Type", "application/json; charset=utf-8")
                    .addHeader("User-Agent", USER_AGENT)
                    .post(RequestBody.create(JSON_MEDIA_TYPE, body.toString()))
                    .build();
        } catch (Throwable e) {
            String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
            callback.invoke("", "请求构造失败：" + msg);
            return;
        }

        // 入注册表——必须在 execute 前，否则 abort 早于网络发起就 race
        OkHttpClient client = STREAM_CLIENT;
        Call call = client.newCall(httpReq);
        ACTIVE_CALLS.put(streamId, call);

        TRANSLATE_EXECUTOR.execute(() -> {
            try (Response resp = call.execute()) {
                if (USER_ABORTED.contains(streamId)) {
                    // 用户主动中断 → 不回调（与失败语义区分，ADR-0170 §D6 末段）。
                    // 注意：这里**只**认显式 abort 集合，不能再用 call.isCanceled()——
                    // 那会把超时/连接中断也当成用户取消而静默挂起（真机「永久 0%」缺陷）。
                    return;
                }
                if (!resp.isSuccessful()) {
                    String errMsg = parseHttpError(resp);
                    // 打点：HTTP 失败原因（状态码 + 原始错误体，供真机排查；不打印 apiKey / 正文）
                    Log.w(TAG, "translateStream HTTP " + resp.code() + " body=" + errMsg);
                    callback.invoke("", errMsg);
                    return;
                }
                ResponseBody body = resp.body();
                Log.i(TAG, "translateStream HTTP " + resp.code() + " 开始读流 bodyBytes="
                        + (body == null ? "null" : body.contentLength()));
                if (body == null) {
                    callback.invoke("", "响应体为空");
                    return;
                }
                boolean terminalEmitted = parseSseStream(body.byteStream(), callback);
                if (!terminalEmitted) {
                    // 流在无终态事件时结束（真机实测 DeepSeek：只有 in_progress → …delta…
                    // → output_item.done，无 response.completed，连接即结束）。
                    // 契约（ADR-0170 §D6）：translateStream **必须**以 done chunk 或 error 终结——
                    // 否则 JS 侧 Promise 永不 settle，store 卡在 translating（按钮永久「N% 翻译中」）。
                    Log.i(TAG, "SSE 流结束未见终态事件 → 合成 done（DeepSeek 无 response.completed）");
                    JSONObject done = new JSONObject();
                    done.put("type", "done");
                    callback.invoke(done.toString(), "");
                }
            } catch (Throwable e) {
                if (USER_ABORTED.contains(streamId)) {
                    return; // 用户主动中断：静默
                }
                Log.w(TAG, "translateStream 异常", e);
                String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                callback.invoke("", "网络错误：" + msg);
            } finally {
                ACTIVE_CALLS.remove(streamId);
                USER_ABORTED.remove(streamId);
            }
        });
    }

    /**
     * 探测 endpoint 是否兼容 {@code /v1/responses}（spec §6.1 inline probe + §9.1 兼容性矩阵）：
     * 构造最小 POST（max_output_tokens=1 + dummy apiKey），看 HTTP 状态码分流。
     *
     * <p>判定（与调研 #625 §Q7 对齐）：
     * <ul>
     *   <li>HTTP 2xx → status=ok（endpoint 存在且兼容）</li>
     *   <li>HTTP 401 / 403 → status=ok（endpoint 存在，认证失败 = endpoint 在）</li>
     *   <li>HTTP 400 + body 含 "invalid_api_key" / "Incorrect API key" 等 → status=ok</li>
     *   <li>HTTP 404 + body 含 "Unknown URL" / "unknown url" / "not found" → status=partial
     *       （仅 chat/completions 兼容：OpenRouter / 智谱 / Qwen / 文心 / LocalAI / LM Studio 特征）</li>
     *   <li>HTTP 405 → status=partial</li>
     *   <li>其它 4xx → status=unknown（detail = status code）</li>
     *   <li>5xx → status=unknown（detail = status code）</li>
     *   <li>OkHttp 异常 → cb("", errMsg)</li>
     * </ul>
     *
     * <p>baseURL 校验：必须是 https:// 前缀（与 translateStream 一致）。
     *
     * <p>成功回调：{@code cb(probeJson, "")}，probeJson 形态 {@code {"status":"ok|partial|unknown","detail":"...","httpStatus":int}}。
     */
    @LynxMethod
    public void probeEndpoint(String baseURL, String apiKey, String model, Callback callback) {
        if (baseURL == null || baseURL.isEmpty()) {
            callback.invoke("", "baseURL 不能为空");
            return;
        }
        if (!baseURL.startsWith("https://")) {
            callback.invoke("", "baseURL 必须为 https:// 前缀");
            return;
        }
        if (apiKey == null || apiKey.isEmpty()) {
            callback.invoke("", "apiKey 不能为空");
            return;
        }
        if (model == null || model.isEmpty()) {
            callback.invoke("", "model 不能为空");
            return;
        }

        TRANSLATE_EXECUTOR.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("model", model);
                body.put("input", new JSONArray().put("ping"));
                body.put("max_output_tokens", 1);
                body.put("stream", false);
                String url = responsesUrl(baseURL);
                Request req = new Request.Builder()
                        .url(url)
                        .addHeader("Authorization", "Bearer " + apiKey)
                        .addHeader("Content-Type", "application/json; charset=utf-8")
                        .addHeader("User-Agent", USER_AGENT)
                        .post(RequestBody.create(JSON_MEDIA_TYPE, body.toString()))
                        .build();
                OkHttpClient client = PixivApiCore.getSharedClient();
                try (Response resp = client.newCall(req).execute()) {
                    int code = resp.code();
                    String respBody = "";
                    ResponseBody rb = resp.body();
                    if (rb != null) {
                        respBody = rb.string();
                    }
                    JSONObject result = classifyProbe(code, respBody);
                    callback.invoke(result.toString(), "");
                }
            } catch (Throwable e) {
                Log.w(TAG, "probeEndpoint 异常: " + baseURL, e);
                String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                callback.invoke("", "探测失败：" + msg);
            }
        });
    }

    /**
     * 取消 in-flight 流（ADR-0170 §D7）。无活动流（streamId 不在注册表）也算成功，幂等。
     * 触发 {@link Call#cancel()} → translateStream worker 线程的 execute 抛 IOException 或
     * byteStream() 抛 InterruptedIOException；worker 线程检查 {@code call.isCanceled()} 后
     * <b>不回调</b> translateStream 的 cb（避免 abort 被当作失败上报，spec §7.2 `aborted` 状态）。
     */
    @LynxMethod
    public void abortStream(String streamId, Callback callback) {
        if (streamId == null || streamId.isEmpty()) {
            callback.invoke("", "streamId 不能为空");
            return;
        }
        // 先登记「用户主动中断」再取消：worker 线程据此静默退出（而不是把它当失败回调）
        USER_ABORTED.add(streamId);
        Call call = ACTIVE_CALLS.remove(streamId);
        if (call != null && !call.isCanceled()) {
            call.cancel();
            Log.i(TAG, "abortStream 取消: " + streamId);
        }
        callback.invoke("", "");
    }

    // ── 私有辅助 ─────────────────────────────────────────

    /**
     * 拼接 Responses API 端点 URL。
     *
     * <p>baseURL 语义与 JS 侧 api/translate.ts 对齐：用户填到 /v1 为止
     * （https://api.openai.com/v1）。历史上 Java 又追加了一段 v1，导致 /v1/v1/responses ——
     * 默认 endpoint 与文档给的填写形态 100% 404（真机 + mock 双双暴露）。
     * 现在：baseURL 已以 /v1（或 /openai/v1）结尾则只补 /responses，否则补 /v1/responses。
     */
    private static String responsesUrl(String baseUrl) {
        String base = baseUrl.replaceAll("/+$", "");
        if (base.endsWith("/v1") || base.endsWith("/openai/v1")) {
            return base + "/responses";
        }
        return base + "/v1/responses";
    }

    /**
     * 构造 Responses API 的 {@code input}：JS 侧传段落**字符串数组**，本方法把段落按
     * web 路径（{@code buildResponsesRequestBody}，api/translate.ts）同款形态拼装成单条
     * user 消息 —— 段落以 {@code [N]} 前缀锚定、空行分隔，供 SSE 侧按 N 对齐回填。
     *
     * <p>两端同形是硬约束：native 与 web 路径的指令 / input 形态必须一致，否则同一 endpoint
     * 换路径后译文结构不同（native 无 [N] 锚定 → 无法按段回填）。
     */
    private static String buildInput(JSONArray paragraphs) throws Exception {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < paragraphs.length(); i++) {
            if (i > 0) sb.append("\n\n");
            sb.append("[").append(i).append("] ").append(paragraphs.getString(i));
        }
        return sb.toString();
    }

    /**
     * 构造 Responses API 请求体：JS 端传入 input / max_output_tokens / reasoning / instructions，
     * Java 侧拼 model + stream=true。流式必传 stream=true（spec §9.3：DeepSeek 无 stream_options，
     * 但 stream=true 仍返回 SSE）。
     */
    private static JSONObject buildRequestBody(JSONObject req, String model, JSONArray inputArr) throws Exception {
        JSONObject body = new JSONObject();
        body.put("model", model);
        body.put("input", buildInput(inputArr));
        body.put("stream", true);
        if (req.has("max_output_tokens")) {
            body.put("max_output_tokens", req.get("max_output_tokens"));
        } else {
            // 不传时服务端可能按上下文上限预留 → 首 token 被拖到数十秒（真机实测卡死窗口）。
            // 与 JS 侧 estimateMaxOutput 同公式（≈ 输入字符数 / 2 × 2 + 512，clamp 256..16384）。
            int chars = 0;
            for (int i = 0; i < inputArr.length(); i++) {
                String p = inputArr.optString(i, "");
                chars += p.length();
            }
            long estimate = ((chars + 1) / 2) * 2 + 512;
            body.put("max_output_tokens", Math.max(256, Math.min(16384, estimate)));
        }
        if (req.has("reasoning")) {
            body.put("reasoning", req.getJSONObject("reasoning"));
        }
        if (req.has("instructions")) {
            body.put("instructions", req.getString("instructions"));
        }
        return body;
    }

    /**
     * SSE 帧解析（参考调研 #622 §Q2/Q3/Q4 + ADR-0170 §D6 决策）：
     * <ul>
     *   <li>{@code response.output_text.delta} → chunkJson {@code {type:"delta", paragraphIndex, text}}</li>
     *   <li>{@code response.reasoning_text.delta} → chunkJson {@code {type:"reasoning_delta", text}}</li>
     *   <li>{@code response.completed} → doneJson {@code {type:"done", usage?}}</li>
     *   <li>{@code response.failed} → cb("", errMsg)</li>
     *   <li>{@code response.incomplete} → cb("", errMsg)（输出截断）</li>
     *   <li>裸 {@code error} 事件 → cb("", errMsg)</li>
     * </ul>
     * 单帧 JSON 解析失败 → 跳过该帧（不中断流）；流末尾由 OkHttp Response close 触发
     * 底层 read() 返回 -1 时自然退出（手写行读，见下方注释）。
     */
    private boolean parseSseStream(InputStream in, Callback callback) throws IOException {
        // 逐字节按行读，**不用 BufferedReader**：BufferedReader 会预读填充缓冲，在
        // "服务端已发完但连接未关" 的长连接上可能把已到达的帧留在自己缓冲里不吐出
        // （真机实测：HTTP 200 后读循环再无事件、也无异常，翻译永不收敛）。
        // 手写行读只消费到 '\n' 为止，读到即处理。
        try (InputStream raw = in) {
            String line;
            final byte[] lineBuf = new byte[8192];
            int lineLen = 0;
            int b;
            while (true) {
                b = raw.read();
                if (b == -1) {
                    if (lineLen > 0) {
                        // 末尾无换行的残行也要处理（服务端可能不以 \n 收尾）
                        processSseLine(new String(lineBuf, 0, lineLen, StandardCharsets.UTF_8), callback);
                    }
                    break;
                }
                if (b == '\n') {
                    if (lineLen > 0) {
                        String l = new String(lineBuf, 0, lineLen, StandardCharsets.UTF_8);
                        Boolean terminal = processSseLine(l, callback);
                        if (terminal != null) return terminal;
                    }
                    lineLen = 0;
                    continue;
                }
                if (b == '\r') continue; // CRLF：忽略 CR
                if (lineLen < lineBuf.length) {
                    lineBuf[lineLen++] = (byte) b;
                } else {
                    // 超长行（异常服务端）：截断处理，避免无限增长
                    lineLen = 0;
                }
            }
            return false;
        }
    }

    /**
     * 处理单行 SSE：返回 null = 继续读；返回 true/false = 已出现终态（调用方据此收尾）。
     *
     * <p>抽成独立方法便于单测（Robolectric 不需要真实 socket）。
     */
    private Boolean processSseLine(String line, Callback callback) {
        {
            // 段落锚定：output_text.delta 是**跨段连续流**（模型按 [N] 前缀逐段输出），
            // 跟踪最近出现的 [N] 标记即切换当前段落号；标记本身不进译文（与 web 路径同语义）。
            // anchorIndex / anchorCarry 是实例字段：状态跨行保持（同一次流内）。
            if (line.isEmpty()) {
                return null; // SSE 帧分隔（空行）
            }
            if (!line.startsWith("data: ")) {
                return null; // SSE 的 event: / id: / 注释行（事件类型在 data 载荷里）
            }
            String payload = line.substring("data: ".length());
            try {
                    JSONObject event = new JSONObject(payload);
                    String type = event.optString("type");
                    switch (type) {
                        case "response.output_text.delta": {
                            String delta = event.optString("delta");
                            // 处理「跨帧截断的锚标记」：上一帧遗留的未完成前缀与本次拼接后再匹配
                            String window = anchorCarry.toString() + delta;
                            anchorCarry.setLength(0);
                            Matcher m = PARAGRAPH_ANCHOR.matcher(window);
                            int lastEnd = 0;
                            boolean matched = false;
                            while (m.find()) {
                                anchorIndex = Integer.parseInt(m.group(1));
                                lastEnd = m.end();
                                matched = true;
                            }
                            String text = window.substring(matched ? lastEnd : 0);
                            if (!matched && window.length() > 0 && window.charAt(window.length() - 1) == '[') {
                                // 可能是被截断的 "["（下一帧补数字）：暂存，避免把标记吐进译文
                                anchorCarry.append('[');
                                text = window.substring(0, window.length() - 1);
                            }
                            String currentParagraphIndex = String.valueOf(anchorIndex);
                            JSONObject chunk = new JSONObject();
                            chunk.put("type", "delta");
                            chunk.put("paragraphIndex", currentParagraphIndex);
                            chunk.put("text", text);
                            callback.invoke(chunk.toString(), "");
                            break;
                        }
                        case "response.reasoning_text.delta": {
                            JSONObject chunk = new JSONObject();
                            chunk.put("type", "reasoning_delta");
                            chunk.put("text", event.optString("delta"));
                            callback.invoke(chunk.toString(), "");
                            break;
                        }
                        case "response.completed": {
                            JSONObject done = new JSONObject();
                            done.put("type", "done");
                            JSONObject resp = event.optJSONObject("response");
                            if (resp != null) {
                                JSONObject usage = resp.optJSONObject("usage");
                                if (usage != null) {
                                    done.put("usage", usage);
                                }
                            }
                            callback.invoke(done.toString(), "");
                            return Boolean.TRUE;
                        }
                        case "response.failed": {
                            JSONObject resp = event.optJSONObject("response");
                            JSONObject errObj = resp != null ? resp.optJSONObject("error") : null;
                            String code = errObj != null ? errObj.optString("code", "server") : "server";
                            String message = errObj != null ? errObj.optString("message", "流失败") : "流失败";
                            callback.invoke("", "LLM 流失败 [" + code + "]：" + message);
                            return Boolean.TRUE;
                        }
                        case "response.incomplete": {
                            JSONObject resp = event.optJSONObject("response");
                            JSONObject incomplete = resp != null ? resp.optJSONObject("incomplete_details") : null;
                            String reason = incomplete != null ? incomplete.optString("reason", "输出截断") : "输出截断";
                            callback.invoke("", "LLM 输出截断：" + reason);
                            return Boolean.TRUE;
                        }
                        case "error": {
                            String message = event.optString("message", "服务端错误");
                            callback.invoke("", "LLM 错误：" + message);
                            return Boolean.TRUE;
                        }
                        default:
                            // 未识别事件（如 response.created / response.in_progress）→ 跳过
                            break;
                    }
            } catch (Exception e) {
                // 单帧解析失败 → 跳过该帧，继续读（不中断流；ADR-0170 §D6 后段）
                Log.w(TAG, "SSE 帧解析失败: " + payload, e);
            }
            return null;
        }
    }

    /**
     * HTTP 错误响应解析（translateStream 非 2xx）：读 body 摘要，拼可读错误消息。
     * 限 256 字防日志/回调膨胀（LLM 错误响应体可能很大）。
     */
    private static String parseHttpError(Response resp) {
        StringBuilder sb = new StringBuilder("HTTP ").append(resp.code()).append(": ");
        try {
            ResponseBody body = resp.body();
            if (body != null) {
                String text = body.string();
                if (text.length() > 256) {
                    text = text.substring(0, 256) + "...";
                }
                sb.append(text);
            } else {
                sb.append("(空 body)");
            }
        } catch (Exception ignored) {
            sb.append("(body 读取失败)");
        }
        return sb.toString();
    }

    /**
     * probeEndpoint 状态分流（参考调研 #625 §Q7）：
     * HTTP 状态码 + body 关键词 → status ok/partial/unknown。
     */
    private static JSONObject classifyProbe(int code, String respBody) throws Exception {
        JSONObject result = new JSONObject();
        result.put("httpStatus", code);
        String bodyLower = respBody == null ? "" : respBody.toLowerCase(Locale.ROOT);
        if (code >= 200 && code < 300) {
            result.put("status", "ok");
            result.put("detail", "responses api reachable");
        } else if (code == 401 || code == 403) {
            result.put("status", "ok");
            // 401/403：端点存在（地址层成立），密钥无效 —— 同样标记，供凭据层判定
            result.put("keyInvalid", true);
            result.put("detail", "authentication failed (endpoint reachable)");
        } else if (code == 400 && (bodyLower.contains("invalid_api_key")
                || bodyLower.contains("incorrect api key")
                || bodyLower.contains("invalid api key"))) {
            result.put("status", "ok");
            // 端点兼容性成立（地址对），但密钥无效 —— 显式标记，供「测试连接」区分凭据层失败
            result.put("keyInvalid", true);
            result.put("detail", "invalid api key (endpoint reachable)");
        } else if (code == 404) {
            // spec §9.1：404 / unknown url → 不兼容（此前误判为 partial）
            result.put("status", "incompatible");
            result.put("detail", "not a Responses API endpoint (HTTP 404)");
        } else if (code == 405) {
            result.put("status", "partial");
            result.put("detail", "method not allowed (chat/completions only)");
        } else {
            result.put("status", "unknown");
            result.put("detail", "HTTP " + code);
        }
        return result;
    }

    /**
     * 安静读 API key（不抛异常；首次启动未配置时返回 null）。与 {@code SecureStorageCompat.getItem}
     * 区别：getItem 在密钥条目缺失时返回 null、在解密失败时抛 GeneralSecurityException——
     * getEndpoint 不希望解密失败把整个调用搞崩（用户最常见场景是「未配置」，应平静返回 hasKey=false）。
     */
    private static String readApiKeyQuietly(SecureStorageCompat storage) {
        try {
            return storage.getItem(KEY_API_KEY);
        } catch (Throwable e) {
            Log.w(TAG, "readApiKeyQuietly 失败（按未配置处理）", e);
            return null;
        }
    }

    /**
     * 读取 API key 写入时间戳（updatedAt）：当前用 Keystore 别名 lastModified 不便，简化方案 = 读
     * SharedPreferences 中 {@code capacitor-storage_translate_llm_api_key} 键存在与否 + 当前时间。
     * 实际生产可改为写入时戳专用键；当前 ADR 阶段 deliverable 用 now() 简化（每次 getEndpoint 返回
     * 当前时间，UI 仅作「已配置」信号，不依赖精确写入时刻）。
     */
    private static long readUpdatedAtQuietly(Context ctx) {
        try {
            String existing = ctx.getSharedPreferences(SecureStorageCompat.PREFS_NAME, Context.MODE_PRIVATE)
                    .getString(SecureStorageCompat.prefixedKey(KEY_API_KEY), null);
            return existing == null ? 0L : System.currentTimeMillis();
        } catch (Throwable e) {
            return 0L;
        }
    }
}