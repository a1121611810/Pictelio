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
    /** SSE 解析器（每次流新建一个，实例内保持段落锚定状态）。
     *  「本流是否产出过译文段」由 {@link TranslationSseParser#hasText()} 提供 —— 字段级判据
     *  已被 #654 删除（sink 看帧类型字符串会让 {@code response.completed} 自带的空 delta_all
     *  帧把空流判成 done，与字段注释「空流 = 失败」相矛盾）。 */
    private TranslationSseParser sseParser;
    // ── 帧交付（事件总线为主通道，轮询为候选兜底）───────────────────
    // 背景：解析线程若在一次 read 内连续 callback.invoke 多帧，Lynx 桥只投递其中一帧
    // （模拟器实测：Java 下发 11 帧、JS store 只收到 1 帧；加 25ms 睡眠也无效，因为
    // 桥接层在 JS 线程空闲前就已丢弃）。故解析只入队，交付**不走 callback** ——
    // 盖好归属章后由事件总线推送，消费节奏由 JS 可处理速率决定，不再丢帧。
    /**
     * 每流缓冲（streamId → 待交付帧队列 + 终态）。
     *
     * <p>交付主通道 = 全局事件总线（{@code sendGlobalEvent}，见 {@link #publishFramesViaEvent}）。
     * {@code translatePoll} 保留为**候选兜底**：实测其回调 0/158 次（ADR-0170「交付通道实测」），
     * 尚不构成有效兜底。两路读同一批已盖章字符串，同一帧在两侧 {@code seq} 一致（接收侧据此去重）。
     */
    private static final Map<String, java.util.concurrent.ConcurrentLinkedQueue<String>> STREAM_FRAMES =
            new ConcurrentHashMap<>();
    /**
     * streamId → 终态**已盖章 JSON 帧**（{@code type}/{@code streamId}/{@code seq}），
     * 由 {@link #registerTerminal} 构造，事件总线与轮询两路交付的是同一个字符串。
     *
     * <p>缺席 = 进行中。**禁放原始文本**：裸文本会让 JS 侧解析失败并静默丢弃终态，
     * UI 永久停在「n% 翻译中」（历史缺陷）。原始消息（{@code "done"} / 错误文本）另存
     * {@link #STREAM_TERMINAL_MSG}，只供日志。
     */
    private static final Map<String, String> STREAM_TERMINAL = new ConcurrentHashMap<>();
    /** streamId → 终态原始消息（{@code "done"} / 错误文本）；仅日志用，不参与交付 */
    private static final Map<String, String> STREAM_TERMINAL_MSG = new ConcurrentHashMap<>();

    /**
     * 本流的临时帧暂存：解析线程入队，流收尾时整体搬进 {@link #STREAM_FRAMES}。
     *
     * <p>**本身不携带归属**：它是实例字段，而模块是注册表单例 —— 两条流重叠时，后来的流
     * 会把自己的帧也塞进同一队列，谁先抽走谁就替对方盖章（串段）。已核实为**可达**风险，
     * 见 issue #649；任何新调用点都不得假设「这里只有本流的帧」。
     */
    private final java.util.concurrent.ConcurrentLinkedQueue<String> frameQueue =
            new java.util.concurrent.ConcurrentLinkedQueue<>();
    /**
     * 交付事件名（**跨端契约**，单一事实源 = ADR-0170「跨端信封契约」）。
     * JS 侧订阅同名事件（nativeTranslate.ts 的 attachTranslateFrameListener）；
     * 改名会让译文静默不达，故由 TranslationSseParserTest 之外的单测钉住取值。
     */
    static final String EVENT_FRAME = "pictelioTranslateFrame";

    /**
     * 流式专用 OkHttp 客户端：**不带 callTimeout**。
     *
     * <p>共享客户端（{@link PixivApiCore#getSharedClient()}）带 15s connect + 30s read +
     * 45s callTimeout —— 那是为一次性 JSON 请求调的；流式响应天然可能长时间只发 keepalive
     * 或 reasoning 帧，45s 上限会把正常长流掐断。这里保留 connect 超时（连接建立必须有界），
     * read = 45s（帧间静默上限；实现期由 120s 收紧 —— 超时即视为链路已断，
     * 否则「连上但正文永不送达」会让 UI 永久停在「N% 翻译中」），callTimeout = 0（不限总时长，
     * 由 abortStream / 服务端收尾）。
     */
    private static final OkHttpClient STREAM_CLIENT = PixivApiCore.getSharedClient()
            .newBuilder()
            .callTimeout(0, java.util.concurrent.TimeUnit.MILLISECONDS)
            // 帧间静默上限：流建立后若这么久没有任何字节，视为服务端/链路已断。
            // 必须有界：否则「连上了但正文永不送达」会让 UI 永久停在「N% 翻译中」
            // （真机 + 模拟器都实测过这种形态）。
            .readTimeout(45, java.util.concurrent.TimeUnit.SECONDS)
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
        // ADR-0178 D1 / ADR-0169 D5.3 整批回退开关：必须在 try 外声明 —— 后面的
        // TRANSLATE_EXECUTOR lambda 要读它（同一方法内的 lambda 才能构成 effectively final）
        final boolean wantStream;
        try {
            JSONObject req = new JSONObject(requestJson);
            // streamId 必须在任何校验分支之前确定：校验失败也要能被 JS 侧读到（否则轮询
            // 永远 pending → 用户永久「n% 翻译中」）。Java 用调用方的 _abortToken，两端一致。
            streamId = req.optString("_abortToken", UUID.randomUUID().toString());
            pruneFinishedStreams(streamId);
            String baseUrl = req.optString("baseURL", "").trim();
            String model = req.optString("model", "").trim();
            // 入口打点：字段名/长度可见，便于区分「JS 未发请求」与「字段契约不符」
            // （此前 JS↔Java 载荷字段名不一致导致静默失败；不打印 apiKey 与正文）
            Log.i(TAG, "translateStream 入口 baseURL=" + (baseUrl.isEmpty() ? "(empty)" : baseUrl)
                    + " model=" + (model.isEmpty() ? "(empty)" : model)
                    + " input=" + (req.optJSONArray("input") == null ? "null" : String.valueOf(req.optJSONArray("input").length()))
                    + " abortToken=" + req.has("_abortToken"));
            if (baseUrl.isEmpty()) {
                failStream(streamId, "baseURL 不能为空");
                return;
            }
            if (model.isEmpty()) {
                failStream(streamId, "model 不能为空");
                return;
            }
            // 允许 http:// 仅当指向本机回环/宿主别名（端到端测试窗口：emulator 的 10.0.2.2
            // 映射宿主 mock SSE 服务）。真实 endpoint 仍强制 https（apiKey 明文不进网络）。
            boolean loopback = baseUrl.startsWith("http://127.0.0.1")
                    || baseUrl.startsWith("http://localhost")
                    || baseUrl.startsWith("http://10.0.2.2");
            if (!baseUrl.startsWith("https://") && !loopback) {
                failStream(streamId, "baseURL 必须为 https:// 前缀");
                return;
            }
            JSONArray inputArr = req.optJSONArray("input");
            if (inputArr == null || inputArr.length() == 0) {
                failStream(streamId, "input 不能为空数组");
                return;
            }

            Context ctx = appContext();
            if (ctx == null) {
                throw new IOException("上下文不可用");
            }
            // API key 仅在 Java 堆解密（不进 callback 链，ADR-0037）
            String read = new SecureStorageCompat(ctx).getItem(KEY_API_KEY);
            if (read == null || read.isEmpty()) {
                failStream(streamId, "尚未配置 API key");
                return;
            }
            apiKey = read;

            // ADR-0178 D1 / ADR-0169 D5.3 整批回退：JS 侧 fallbackToWholeBatch 会传
            // stream=false，要求「单次 POST + 完整 JSON 响应」。此前 Java 侧忽略该字段、
            // 硬编码 stream=true → 真机上「整批回退」退化为「整章重发同一条 SSE」，
            // 正好落在 store 注释记载的 read timeout 形态（code-review P1 阻塞项）。
            wantStream = req.optBoolean("stream", true);
            JSONObject body = buildRequestBody(req, model, inputArr, wantStream);
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
                    registerTerminal(streamId, errMsg);
                    // 失败终态**必须**也走事件总线：轮询通道实测回调 0/158（ADR-0170），
                    // 只写 STREAM_TERMINAL 会让 UI 永久停在「n% 翻译中」（历史缺陷翻版）。
                    publishFramesViaEvent(streamId);
                    return;
                }
                ResponseBody body = resp.body();
                Log.i(TAG, "translateStream HTTP " + resp.code() + " 开始读流 bodyBytes="
                        + (body == null ? "null" : body.contentLength())
                        + " stream=" + wantStream);
                if (body == null) {
                    failStream(streamId, "响应体为空");
                    return;
                }
                // ── 整批回退（stream=false）：单次 POST + 完整 JSON，不走 SSE 拆帧 ──
                // ADR-0178 D1 / ADR-0169 D5.3 锁死形态。交付通道不变（frameQueue →
                // STREAM_FRAMES → 事件总线 + 轮询），只是帧来源从 SSE 解析改为 JSON 解析。
                if (!wantStream) {
                    frameQueue.clear();
                    STREAM_SEQ.remove(streamId);
                    deliverWholeBatchJson(streamId, body.string());
                    drainQueueToStreamBuffer(streamId);
                    publishFramesViaEvent(streamId);
                    return;
                }
                frameQueue.clear();
                // 每流新建解析器（回归 B）：模块是注册表单例，实例级 sseParser 会让
                // terminalError 等状态跨流残留 —— 一次失败后同页后续流全部被误判失败。
                sseParser = new TranslationSseParser();
                STREAM_SEQ.remove(streamId);
                boolean terminalEmitted = parseSseStream(body.byteStream(), callback);
                // 无终态事件即断流（DeepSeek 常见）：把已累积译文刷出，保证「有译文却没交付」不发生
                if (!terminalEmitted && sseParser != null) {
                    sseParser.flushIfAny((payload, error) -> {
                        if (payload != null && !payload.isEmpty()) frameQueue.offer(payload);
                    });
                }
                Log.i(TAG, "SSE 流结束 terminal=" + terminalEmitted + " hasText=" + (sseParser != null && sseParser.hasText())
                        + " queued=" + frameQueue.size());
                // 交付改由 JS 轮询拉取（translatePoll）：这里只把帧与终态登记进 per-stream 缓冲
                drainQueueToStreamBuffer(streamId);
                String parserError = sseParser == null ? null : sseParser.terminalError();
                boolean hasText = sseParser != null && sseParser.hasText();
                if (parserError != null) {
                    // 终态失败优先于「有译文」：否则半截译文会被判成功并写进缓存（spec §7.2）
                    Log.w(TAG, "SSE 终态为失败 → 报错（即使已产出 " + frameQueue.size() + " 帧）");
                    registerTerminal(streamId, parserError);
                    frameQueue.clear();
                } else if (!hasText) {
                    // 空流 = 失败（oracle: deltaSeen 字段注释「空流 = 失败」 + 收尾分支注释
                    // 「SSE 流结束但未产出任何译文段 → 报空流失败」 + 真机事实：DeepSeek 对
                    // R-18 正文 200 但零输出）。原实现用实例字段 deltaSeen，sink 看帧类型字符串
                    // 就置真（response.completed 自带的空 delta_all 帧），导致本分支永不触发
                    // → done 被错误写进缓存。改用 sseParser.hasText()（issue #654）。
                    Log.w(TAG, "SSE 流结束但未产出任何译文段 → 报空流失败");
                    registerTerminal(streamId, "LLM 未返回任何译文（可能被服务端内容策略拦截）");
                } else {
                    registerTerminal(streamId, "done");
                }
                Log.i(TAG, "SSE 流就绪待拉取 streamId=" + streamId
                        + " frames=" + STREAM_FRAMES.getOrDefault(streamId, new java.util.concurrent.ConcurrentLinkedQueue<>()).size()
                        + " terminal=" + STREAM_TERMINAL_MSG.get(streamId));
                // 交付通道：全局事件总线（**不经 callback**）。benchNav 证明该通道事件可达 JS，
                // 而本模块的 callback 通道实测「一条流至多 1 帧 / 有时完全不回调」。
                publishFramesViaEvent(streamId);
                return;
            } catch (Throwable e) {
                if (USER_ABORTED.contains(streamId)) {
                    registerTerminal(streamId, "aborted");
                    publishFramesViaEvent(streamId);
                    return; // 用户主动中断：交付 aborted 终态，UI 据此收尾
                }
                Log.w(TAG, "translateStream 异常", e);
                String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                registerTerminal(streamId, "网络错误：" + msg);
                // 同上：异常终态也必须交付（否则 UI 挂起）
                publishFramesViaEvent(streamId);
            } finally {
                ACTIVE_CALLS.remove(streamId);
                USER_ABORTED.remove(streamId);
            }
        });
    }

    /**
     * 失败终态的统一出口：登记终态 + 经事件总线交付。
     *
     * <p>为什么需要它：多个 early-return 路径（响应体为空、用户在请求前已中断等）此前只
     * 回调一次或直接 return，既不写终态也不发布 —— 轮询也救不回（实测回调 0/158），
     * 用户看到的是永久「n% 翻译中」。
     */
    /**
     * 清理已完结流的缓冲（保留窗口很短的握手余量）。
     *
     * <p>为什么不立刻删：发布保留缓冲是为了让轮询兜底能取回帧（见 publishFramesViaEvent）。
     * 但若永不清理，长时间使用会累积。策略：**开新流时清掉除自己以外的所有完结条目** ——
     * 同时满足「同一时刻只有一条流在跑」（store concurrency=1）与「无界增长」两侧约束。
     */
    private void pruneFinishedStreams(String keepStreamId) {
        for (String key : new java.util.HashSet<>(STREAM_FRAMES.keySet())) {
            if (!key.equals(keepStreamId)) STREAM_FRAMES.remove(key);
        }
        for (String key : new java.util.HashSet<>(STREAM_TERMINAL.keySet())) {
            if (!key.equals(keepStreamId)) STREAM_TERMINAL.remove(key);
        }
        for (String key : new java.util.HashSet<>(STREAM_TERMINAL_MSG.keySet())) {
            if (!key.equals(keepStreamId)) STREAM_TERMINAL_MSG.remove(key);
        }
        // seq 计数器也要清（否则每流遗留一个 AtomicInteger，无界累积）
        for (String key : new java.util.HashSet<>(STREAM_SEQ.keySet())) {
            if (!key.equals(keepStreamId)) STREAM_SEQ.remove(key);
        }
    }

    private void failStream(String streamId, String message) {
        registerTerminal(streamId, message);
        publishFramesViaEvent(streamId);
    }

    /**
     * 把 {@link #frameQueue} 内容搬进 per-stream 缓冲 {@link #STREAM_FRAMES}（入缓冲时盖章
     * streamId + seq）。
     *
     * <p>抽成独立方法供两条路径共用：SSE 流式（parseSseStream 之后）与整批回退
     * （{@link #deliverWholeBatchJson} 之后，ADR-0178 D1 / code-review P1）。
     * 两路交付同一字符串，接收侧按 (streamId, seq) 去重才能命中 —— 若在交付时才盖章，
     * 同帧经事件总线与轮询两路会拿到不同 seq，去重永不生效（导致重复译文）。
     */
    private void drainQueueToStreamBuffer(String streamId) {
        java.util.concurrent.ConcurrentLinkedQueue<String> buffer =
                new java.util.concurrent.ConcurrentLinkedQueue<>(frameQueue);
        while (!buffer.isEmpty()) {
            STREAM_FRAMES.computeIfAbsent(streamId,
                    k -> new java.util.concurrent.ConcurrentLinkedQueue<>())
                    .offer(withSeq(withStreamId(buffer.poll(), streamId), streamId));
        }
    }

    /**
     * 整批回退（stream=false）响应处理：解析完整 JSON → 产出一帧 {@code delta_all}
     * + 登记终态。交付通道与流式路径一致（frameQueue → STREAM_FRAMES → 事件总线 + 轮询）。
     *
     * <p>帧契约与 {@link TranslationSseParser#emitConsolidated} 保持同形
     * （{@code {type:"delta_all", paragraphs:[{index,text}]}}），JS 适配器无需区分来源。
     *
     * <p>终态判定（与 #654 同源，不得把截断/失败判成 done）：
     * <ul>
     *   <li>{@code status = failed} → error（error.message 优先）</li>
     *   <li>{@code status = incomplete} → error（截断；code-review P4 同源语义）</li>
     *   <li>零 output_text → error（空流 = 失败，与 #654 一致）</li>
     *   <li>否则 → delta_all 帧 + done</li>
     * </ul>
     *
     * <p>Oracle：ADR-0178 D1（整批回退形态）+ ADR-0169 D5.3 + #654（空流判定）
     * + code-review P1/P4（真机路径必须真的走非流式 + 截断不得当成功）。
     */
    private void deliverWholeBatchJson(String streamId, String rawBody) {
        try {
            JSONObject json = new JSONObject(rawBody);
            String status = json.optString("status", "completed");
            if ("failed".equals(status)) {
                JSONObject err = json.optJSONObject("error");
                String msg = err != null ? err.optString("message", "response failed") : "response failed";
                Log.w(TAG, "整批回退 status=failed → error：" + msg);
                registerTerminal(streamId, msg);
                return;
            }
            if ("incomplete".equals(status)) {
                JSONObject det = json.optJSONObject("incomplete_details");
                String reason = det != null ? det.optString("reason", "unknown") : "unknown";
                Log.w(TAG, "整批回退 status=incomplete reason=" + reason + " → error（截断不当成功）");
                registerTerminal(streamId, "整批回退输出被截断：" + reason);
                return;
            }
            // 拼接所有 output_text 并按 `[N]` 锚定拆段（与 JS parseNumberedSegments 同语义：
            // 模型按 spec 提示逐段输出，锚记为段首标记）
            StringBuilder sb = new StringBuilder();
            JSONArray output = json.optJSONArray("output");
            if (output != null) {
                for (int i = 0; i < output.length(); i++) {
                    JSONObject item = output.optJSONObject(i);
                    if (item == null) continue;
                    JSONArray content = item.optJSONArray("content");
                    if (content == null) continue;
                    for (int j = 0; j < content.length(); j++) {
                        JSONObject c = content.optJSONObject(j);
                        if (c == null) continue;
                        if ("output_text".equals(c.optString("type", ""))) {
                            sb.append(c.optString("text", ""));
                        }
                    }
                }
            }
            String all = sb.toString();
            if (all.trim().isEmpty()) {
                // 空流 = 失败（与 #654 同判定：不得把零译文判成 done 并写缓存）
                Log.w(TAG, "整批回退响应零译文段 → 报空流失败");
                registerTerminal(streamId, "LLM 未返回任何译文（可能被服务端内容策略拦截）");
                return;
            }
            // `[N]` 锚定拆段
            JSONArray paragraphs = new JSONArray();
            java.util.regex.Matcher m = java.util.regex.Pattern
                    .compile("(?m)^\\[(\\d+)\\]\\s*")
                    .matcher(all);
            java.util.List<int[]> marks = new java.util.ArrayList<>();
            while (m.find()) marks.add(new int[]{m.start(), m.end(), Integer.parseInt(m.group(1))});
            for (int i = 0; i < marks.size(); i++) {
                int textStart = marks.get(i)[1];
                int textEnd = (i + 1 < marks.size()) ? marks.get(i + 1)[0] : all.length();
                JSONObject one = new JSONObject();
                one.put("index", marks.get(i)[2]);
                one.put("text", all.substring(textStart, textEnd).trim());
                paragraphs.put(one);
            }
            if (paragraphs.length() == 0) {
                // 无锚记：整章作为第 0 段（保留原文可读，不因格式偏差丢译文）
                JSONObject one = new JSONObject();
                one.put("index", 0);
                one.put("text", all.trim());
                paragraphs.put(one);
            }
            JSONObject chunk = new JSONObject();
            chunk.put("type", "delta_all");
            chunk.put("paragraphs", paragraphs);
            frameQueue.offer(chunk.toString());
            Log.i(TAG, "整批回退 delta_all paragraphs=" + paragraphs.length());
            registerTerminal(streamId, "done");
        } catch (Exception e) {
            Log.w(TAG, "整批回退 JSON 解析失败", e);
            String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
            registerTerminal(streamId, "整批回退响应解析失败：" + msg);
        }
    }

    /**
     * 登记终态：**此刻**就构造并盖章终态帧，两路交付同一字符串。
     *
     * @param message {@code "done"} 或错误消息（错误消息原样保留在日志用的 {@link #STREAM_TERMINAL_MSG}）
     */
    private void registerTerminal(String streamId, String message) {
        STREAM_TERMINAL_MSG.put(streamId, message);
        String payload;
        try {
            if ("done".equals(message)) {
                JSONObject done = new JSONObject();
                done.put("type", "done");
                payload = done.toString();
            } else {
                JSONObject err = new JSONObject();
                err.put("type", "error");
                err.put("message", message);
                payload = err.toString();
            }
        } catch (Exception e) {
            payload = "{\"type\":\"error\",\"message\":\"terminal build failed\"}";
        }
        STREAM_TERMINAL.put(streamId,
                withSeq(withStreamId(payload, streamId), streamId));
    }

    /**
     * 给帧 JSON 注入 {@code streamId}。
     *
     * <p>为什么必须有：事件名全局唯一、载荷若不带归属键，陈旧流（页面切走、上一次翻译未完成）
     * 的帧会被**新一次翻译的监听器**消费 → 段落写到错误块偏移 + 提前 done（静默产出错译文）。
     * 接收侧按 streamId 过滤后可丢弃非本流帧。
     */
    private static String withStreamId(String frameJson, String streamId) {
        int close = frameJson.lastIndexOf('}');
        if (close < 0) return frameJson;
        return frameJson.substring(0, close)
                + ",\"streamId\":\"" + streamId.replace("\"", "'") + "\"}";
    }

    /** streamId → 下一个帧序号（发布与轮询共用，保证同一帧在两路拿到同一 seq） */
    private static final Map<String, java.util.concurrent.atomic.AtomicInteger> STREAM_SEQ =
            new ConcurrentHashMap<>();

    /**
     * 给帧打上 per-stream 单调 seq（含 termincal 帧）。
     *
     * <p>为什么需要：交付走「事件总线 + 轮询兜底」两路，保留缓冲后同一帧可能被两路都取到；
     * 接收侧按 (streamId, seq) 去重即可避免重复 append 出重复译文（复审 finding A）。
     */
    private static String withSeq(String frameJson, String streamId) {
        int close = frameJson.lastIndexOf('}');
        if (close < 0) return frameJson;
        int seq = STREAM_SEQ
                .computeIfAbsent(streamId, k -> new java.util.concurrent.atomic.AtomicInteger())
                .getAndIncrement();
        return frameJson.substring(0, close) + ",\"seq\":" + seq + "}";
    }

    /**
     * 经全局事件总线把该流的帧与终态推给 JS（事件名 {@code pictelioTranslateFrame}，载荷一帧 JSON）。
     *
     * <p>为什么不用 callback：实测 callback 通道「一条流至多投递 1 次」，且轮询调用也可能
     * 完全不回调；{@code sendGlobalEvent} 是 benchNav 的成熟通道（事件确实可达 JS）。
     */
    private void publishFramesViaEvent(String streamId) {
        try {
            com.lynx.tasm.behavior.LynxContext ctx =
                    (mContext instanceof com.lynx.tasm.behavior.LynxContext)
                            ? (com.lynx.tasm.behavior.LynxContext) mContext
                            : null;
            com.lynx.tasm.LynxView view = ctx != null ? ctx.getLynxView() : null;
            if (view == null) {
                Log.w(TAG, "全局事件通道不可用（无 LynxView）→ 翻译结果无法交付");
                return;
            }
            // **不 drain**（复审 finding）：此前一边发送一边 poll() 移除，若此刻 JS 没有监听器
            // （通道不可用 / 页面已销毁 / 时序窗口），帧就永久消失 —— 轮询兜底也只能读到 pending。
            // 改为「快照发送 + 保留缓冲」，由 translatePoll 的终态握手负责清理：事件送达则不会
            // 再轮询、缓冲随握手释放；事件未达则轮询仍能逐帧取回。
            java.util.concurrent.ConcurrentLinkedQueue<String> frames = STREAM_FRAMES.get(streamId);
            int sent = 0;
            if (frames != null) {
                // 缓冲内已是「盖过 streamId + seq 的成品」：两路发送**同一字符串**，
                // 接收侧按 (streamId, seq) 去重才能真正命中（复审实测：交付时盖章会让
                // 同一帧经两路拿到不同 seq，去重永不生效 → 重复译文）。
                for (String frame : frames) {
                    view.sendGlobalEvent(EVENT_FRAME,
                            com.lynx.react.bridge.JavaOnlyArray.of(frame));
                    sent++;
                }
            }
            String terminal = STREAM_TERMINAL.get(streamId);
            if (terminal != null) {
                view.sendGlobalEvent(EVENT_FRAME,
                        com.lynx.react.bridge.JavaOnlyArray.of(terminal));
                sent++;
                // 缓冲保留：若事件未达，轮询仍能取回帧与终态（直到握手清理）
            }
            Log.i(TAG, "事件总线交付 frames=" + sent);
        } catch (Throwable t) {
            Log.w(TAG, "事件总线交付失败", t);
        }
    }

    /**
     * 拉取一帧（JS 轮询入口；每次调用都是一次独立回调，规避「一流一回调」限制）。
     *
     * <p>返回 JSON 字符串：{@code {"type":"delta_all",...}} 有待交付帧 /
     * {@code {"type":"done"}} 已完结 / {@code {"type":"error","message":"..."}} 失败 /
     * {@code {"type":"pending"}} 暂无（继续轮询）。
     */
    @LynxMethod
    public void translatePoll(String streamId, Callback callback) {
        try {
            String terminal = STREAM_TERMINAL.get(streamId);
            java.util.concurrent.ConcurrentLinkedQueue<String> frames = STREAM_FRAMES.get(streamId);
            if (frames != null && !frames.isEmpty()) {
                // 缓冲内已盖章，直接透传（与总线发送的是同一字符串）
                callback.invoke(frames.poll(), "");
                return;
            }
            if (terminal == null) {
                JSONObject pending = new JSONObject();
                pending.put("type", "pending");
                callback.invoke(pending.toString(), "");
                return;
            }
            callback.invoke(terminal, "");
            // 终态握手完成 → 释放该流的缓冲（发布侧保留缓冲正是为了让这一步能取回帧）。
            // 幂等：重复 poll 仍会得到同一终态（缓冲已删则 terminal 仍在，见上分支），
            // 直到 pruneFinishedStreams 在开新流时统一清理。
        } catch (Throwable t) {
            Log.w(TAG, "translatePoll 异常", t);
            callback.invoke("", "轮询失败：" + t.getClass().getSimpleName());
        }
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
        } else {
            // 无活 worker（abortStream 比 translateStream 进入 ACTIVE_CALLS 更早到达，或 streamId
            // 本身未注册 —— JS 端 #653 修复后该窗口从「不可达」变成「可达」）→ 该 streamId 不会
            // 进入 translateStream 的 finally 清理，必须在此显式 remove，否则永久残留 → 内存泄漏。
            USER_ABORTED.remove(streamId);
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
     * Java 侧拼 model + stream。流式必传 stream=true（spec §9.3：DeepSeek 无 stream_options，
     * 但 stream=true 仍返回 SSE）；整批回退传 stream=false（ADR-0178 D1 / ADR-0169 D5.3）。
     *
     * @param wantStream true = SSE 流（默认）；false = 单次 POST 拿完整 JSON（整批回退）
     */
    private static JSONObject buildRequestBody(
            JSONObject req, String model, JSONArray inputArr, boolean wantStream) throws Exception {
        JSONObject body = new JSONObject();
        body.put("model", model);
        body.put("input", buildInput(inputArr));
        body.put("stream", wantStream);
        if (req.has("max_output_tokens")) {
            // 整批回退时把上限 ×2（ADR-0178 D1 / ADR-0169 D5.3 锁死形态）：回退是一次性
            // 提交整章，输出量比单块大；沿用块级估算会更容易触发 max_output_tokens 截断。
            int base = req.getInt("max_output_tokens");
            body.put("max_output_tokens", wantStream ? base : Math.min(16384, base * 2));
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
        // 解析逻辑抽到 TranslationSseParser（纯逻辑、可 Robolectric 单测；本模块此前零防线）
        if (sseParser == null) sseParser = new TranslationSseParser();
        return sseParser.accept(
                line,
                (payload, error) -> {
                    // 只入队：交付由事件总线 / 轮询完成，不进 callback（见 frameQueue 注释）。
                    // 注意：本 sink 不再做「流是否产出过译文段」的判据（issue #654）——
                    // 那条判据已迁到收尾分支的 sseParser.hasText()，避免 response.completed
                    // 自带的空 delta_all 帧把空流骗成 done。
                    if (error != null && !error.isEmpty()) {
                        // 错误是终态：走 callback 直接报错（单帧；一条流至多投递一次恰好够用）
                        callback.invoke("", error);
                        return;
                    }
                    if (payload != null && !payload.isEmpty()) {
                        frameQueue.offer(payload);
                    }
                });
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