package io.pictelio.app.directaccess;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

import io.pictelio.app.directaccess.DirectAccessPolicy.SwitchState;

/**
 * 直连配置边界（spec #385 / ticket #388 T3）：直连开关三态、手动 IP 表、远端 IP 表拉取、
 * 三层合并快照与进程级熔断器的唯一归属。消费方：T4 传输层（{@link DirectAccessPolicy#decide}
 * 的装配面）与 T6 设置卡命令面（{@link #resetCircuits} / {@link #refreshIpTableNow}）。
 *
 * <p><b>存储契约</b>（共享 CapacitorStorage，先例：ImageHostConfig / ImageIntercept）：
 * SharedPreferences 文件名 {@value #PREFS_NAME}，独立键 {@value #PREF_KEY}，JSON 形态
 * {@code {"enabled": true|false, "manual": [{"host":"...","ip":"..."}]}}。
 * 开关映射（oracle = ticket #388 原文 + DirectAccessPolicy.SwitchState 三态语义）：
 * <ul>
 *   <li>key 缺失（raw == null）→ {@link SwitchState#UNSET}（缺省状态，不告警）；</li>
 *   <li>enabled = true → {@link SwitchState#ON}；false → {@link SwitchState#OFF}；</li>
 *   <li>解析/形状失败（坏 JSON、enabled 非 boolean、manual 非数组）→
 *       {@link SwitchState#UNSET} + warn（经注入 warnSink，禁静默）——直连视为未配置（故障关闭）；</li>
 *   <li>manual 条目逐条转 {@link IpTableMerger.Entry}（构造即规范化），<b>合法性校验不在此层</b>：
 *       非法条目由 {@link IpTableMerger#merge} 跳过 + 告警（ticket 指定归属）。</li>
 * </ul>
 *
 * <p><b>远端拉取契约</b>（托管文件 = {@code packages/website/pixiv-ip-table.json}，
 * raw.githubusercontent 直读 main，与 update-check 的 version.json 同机制）：
 * <ol>
 *   <li><b>触发</b>（后台 executor 单飞，绝不阻塞调用方）：开关 OFF/UNSET→ON 跃迁
 *       （配置解析时检测，含进程首读即 ON：视为 UNSET→ON）；TTL {@value #IP_TABLE_TTL_MS}
 *       过期后的惰性触发（{@link #currentTable()} 路径上评估，仅 ON 生效——直连关时远端表
 *       不被消费，纯浪费流量）；{@link #refreshIpTableNow()} 手动触发（设置页 T6，忽略开关
 *       与 TTL，已在飞返回 {@code false}）。跃迁/TTL 触发统一收敛到同一谓词：
 *       ON ∧（从未成功拉取 ∨ 距上次成功拉取 ≥ TTL）；</li>
 *   <li><b>结果</b>：解析成功 → 内存生效 + 持久化 cacheDir 信封文件（可再生缓存，损坏即弃用）
 *       + 更新 lastFetchAt（仅成功拉取更新，TTL 由此计量并随信封跨进程持久化）；
 *       失败（IOException / 响应形状校验失败）→ 保留上次有效（cacheDir 有则装载，否则内置表
 *       兜底）+ warn。lastFetchAt 失败不更新 → 下次触发点重试（对齐 ImageHostConfig
 *       探针失败不写缓存的既有纪律）；</li>
 *   <li><b>拉取器</b>：{@link IpTableFetcher} 端口注入；生产实现用<b>专用不路由</b> OkHttp
 *       client（自举安全，见端口 javadoc）；URL 构造注入（测试 = MockWebServer / fake）。</li>
 * </ol>
 *
 * <p><b>对外快照</b>：{@link #currentTable()} 恒返回非 null 三层合并快照
 * （manual &gt; remote &gt; builtIn，{@link IpTableMerger} 单一事实源）；快照按
 * （parsed 实例, remote 列表引用）缓存——raw 不变且未拉到新表时热路径零重解析零重合并。
 * {@link #switchState()} 返回当前三态。
 *
 * <p><b>熔断器归属</b>：进程级 {@link ChannelCircuitBreaker} 单例由本类持有（Clock 注入），
 * {@link #breaker()} 访问 + {@link #resetCircuits()} 双通道全重置（T6 设置卡消费）——
 * T4 传输层与 T6 命令面都经本类取得，熔断态与配置生命周期同源。
 *
 * <p><b>单例纪律</b>（Context 键控绑定重建，先例照抄 {@code PixivApiPlugin.imageLoader} /
 * {@code ImageHostConfig.get}）：生产 ApplicationContext 恒同一对象 → 恒同一实例；
 * Robolectric 每用例新建 Application → 绑定失效自动重建，测试间无静态配置泄漏。
 * 构造器包可见全注入：RawProvider / Clock / IpTableFetcher / Executor / warnSink / cacheFile
 * （cacheFile 为值注入——持久化路径可测，不触真 Context）。
 *
 * <p><b>线程安全</b>：所有公开方法可并发调用。volatile + 锁双检（单飞）+ 良性竞态
 * （解析/合并缓存重建，不可变值对象持有）。
 */
public final class DirectAccessConfig {

    private static final String TAG = "[DirectAccessConfig]";
    /** Capacitor Preferences 落盘的默认 SharedPreferences 名（先例：ImageHostConfig / ImageIntercept） */
    private static final String PREFS_NAME = "CapacitorStorage";
    /** 直连设置 JSON 的存储键（ticket #388 指定；JS 侧 T6 写入同一契约） */
    private static final String PREF_KEY = "direct_access_settings";
    /**
     * 托管 IP 表默认 URL（oracle = ticket #388 + packages/website/pixiv-ip-table.json 落点；
     * raw.githubusercontent 直读 main，与 update-check version.json 同机制）
     */
    static final String DEFAULT_REMOTE_URL =
            "https://raw.githubusercontent.com/a1121611810/Pictelio/main/packages/website/pixiv-ip-table.json";
    /** cacheDir 可再生缓存文件名（信封格式见 {@link #readCacheIntoMemory}） */
    private static final String CACHE_FILE_NAME = "pixiv-ip-table.json";
    /** 远端表 TTL（spec：24h 惰性重拉） */
    static final long IP_TABLE_TTL_MS = 24L * 60 * 60 * 1000;
    /** 生产拉取调用超时（后台拉取非延迟敏感，宽于 ImageHostConfig 探针的 5s） */
    private static final long FETCH_TIMEOUT_MS = 10_000L;
    /** 当前支持的托管文件 schema 版本（version 当前恒 1，预留演进；见 {@link #parseRemoteDoc}） */
    static final int SUPPORTED_REMOTE_VERSION = 1;

    // ── 函数式接缝（包可见：注入面 = 包可见构造器，ADR-0143「接口即测试面」先例） ──

    /** 原始配置提供者（生产 = SharedPreferences 读取；返回 null 表示无存储条目） */
    interface RawProvider {
        String get();
    }

    // ── 生产单例（Context 键控绑定重建，先例照抄 PixivApiPlugin.imageLoader） ────

    private static volatile DirectAccessConfig instance;
    /** 单例绑定的 ApplicationContext。生产进程内 getApplicationContext() 恒为同一对象（绑定永不触发重建）；
     *  Robolectric 每用例新建 Application → 绑定失效自动重建，保证测试间无静态配置泄漏（跨类密闭）。 */
    private static volatile Context instanceApp;

    /**
     * 单例是否已实例化（#390：PixivApiCore.getClient 接线探测用）——<b>不触发实例化</b>。
     * getClient 可能在 DirectAccessInitProvider.onCreate 之前被调（如 JVM 单测/极端时序），
     * 该处只能探测不能 {@link #get}（get 需要 Context）。未实例化 = install(null) = no-op
     * 纯系统路线（降级契约）。public：跨包调用方 = PixivApiCore.getClient（#390）。
     */
    public static boolean isInstantiated() {
        return instance != null;
    }

    /** 已实例化单例（调用前必须 {@link #isInstantiated()} 为真；否则 null——调用方按降级契约处理）。
     *  public 理由同 {@link #isInstantiated()}；返回引用的消费仅限传给 install（null 安全）。 */
    public static DirectAccessConfig peekInstance() {
        return instance;
    }

    /** 生产入口。单例，接线真实 RawProvider / 时钟 / 专用不路由拉取器 / 单线程 executor / Log.w。
     *  public：跨包调用方为 webview 源集（PixivApiPlugin 设置页命令面，T6 消费）——
     *  ImageHostConfig.get 为包可见（调用方恒同包），本类消费方跨包故放宽。 */
    public static DirectAccessConfig get(Context ctx) {
        Context app = ctx.getApplicationContext();
        DirectAccessConfig c = instance;
        if (c == null || instanceApp != app) {
            synchronized (DirectAccessConfig.class) {
                app = ctx.getApplicationContext();
                if (instance == null || instanceApp != app) {
                    final Context appCtx = app;
                    instance = new DirectAccessConfig(
                            () -> appCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                                    .getString(PREF_KEY, null),
                            System::currentTimeMillis,
                            defaultFetcher(DEFAULT_REMOTE_URL),
                            fetchExecutor(),
                            msg -> Log.w(TAG, msg),
                            new File(appCtx.getCacheDir(), CACHE_FILE_NAME));
                    instanceApp = appCtx;
                }
                c = instance;
            }
        }
        return c;
    }

    /**
     * 生产拉取器：专用<b>不路由</b> OkHttp client（自举安全硬约束——绝不复用
     * {@code PixivApiCore.getSharedClient()}：未来直连路由装在共享 client 上时，
     * 本拉取器不得被路由，否则 IP 表拉取自身走直连 → 自举死锁）。包可见供测试以
     * MockWebServer 验证 HTTP 语义（URL 构造注入）。
     */
    static IpTableFetcher defaultFetcher(String url) {
        final OkHttpClient client = new OkHttpClient.Builder()
                .callTimeout(FETCH_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                .build();
        return () -> {
            try (Response resp = client.newCall(new Request.Builder().url(url).get().build()).execute()) {
                if (!resp.isSuccessful()) {
                    throw new IOException("HTTP " + resp.code());
                }
                ResponseBody body = resp.body();
                if (body == null) {
                    throw new IOException("空响应体");
                }
                return body.string();
            }
        };
    }

    /** 专用单线程 executor（先例：ImageHostConfig.probeExecutor——拉取串行单飞，不占请求线程池） */
    private static Executor fetchExecutor() {
        return Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "DirectAccessFetch");
            t.setDaemon(true);
            return t;
        });
    }

    // ── 注入构造（包可见：测试注入面） ────────────────────────

    private final RawProvider rawProvider;
    private final ChannelCircuitBreaker.Clock clock;
    private final IpTableFetcher fetcher;
    private final Executor fetchExecutor;
    /** 告警出口（禁静默降级：解析失败/拉取失败/缓存损坏/executor 拒绝必须可见；生产 = Log.w） */
    private final Consumer<String> warnSink;
    /** cacheDir 可再生缓存文件（测试注入临时文件；持久化路径不触真 Context） */
    private final File cacheFile;
    private final IpTableMerger merger;
    /** 进程级双通道熔断器（Clock 注入；T4 传输层记账 / T6 设置卡命令共同消费） */
    private final ChannelCircuitBreaker breaker;

    /** 单飞锁（仅拉取触发路径使用；热路径不经过） */
    private final Object fetchLock = new Object();
    /** 拉取在飞标志（volatile：锁外快路径判断；ImageHostConfig.kickProbe 纪律） */
    private volatile boolean fetching;
    /** 缓存装载锁 + 已装载标志（cacheDir 信封一次性装载，含跨进程 lastFetchAt 播种） */
    private final Object cacheLock = new Object();
    private volatile boolean cacheLoaded;
    /** 已解析配置（raw equals 复用；不可变对象 + volatile 持有，解析竞态良性） */
    private volatile Parsed parsed;
    /** 远端表（内存最新有效；引用换出即失效合并缓存；volatile） */
    private volatile List<IpTableMerger.Entry> remoteTable;
    /** 最近一次<b>成功</b>拉取时刻 ms（0 = 从未成功；随 cacheDir 信封跨进程持久化） */
    private volatile long lastFetchAtMillis;
    /** 合并快照缓存（parsed 实例 + remote 引用为键；volatile 持有，重建竞态良性） */
    private volatile TableCache tableCache;

    DirectAccessConfig(RawProvider raw, ChannelCircuitBreaker.Clock clock, IpTableFetcher fetcher,
                       Executor fetchExecutor, Consumer<String> warnSink, File cacheFile) {
        this.rawProvider = Objects.requireNonNull(raw, "rawProvider 不得为 null");
        this.clock = Objects.requireNonNull(clock, "clock 不得为 null");
        this.fetcher = Objects.requireNonNull(fetcher, "fetcher 不得为 null");
        this.fetchExecutor = Objects.requireNonNull(fetchExecutor, "fetchExecutor 不得为 null");
        this.warnSink = Objects.requireNonNull(warnSink, "warnSink 不得为 null——禁静默降级");
        this.cacheFile = cacheFile;
        this.merger = new IpTableMerger(warnSink);
        this.breaker = new ChannelCircuitBreaker(clock);
    }

    // ── 对外快照（T4 传输层消费） ────────────────────────────

    /**
     * 当前直连开关三态（null 防御由解析兜底为 UNSET；消费方传给 {@link DirectAccessPolicy#decide}）。
     * 每次读取 RawProvider（raw equals 复用解析）；OFF/UNSET→ON 跃迁在此路径检测并触发拉取。
     */
    public SwitchState switchState() {
        return currentParsed().switchState;
    }

    /**
     * 三层合并快照（manual &gt; remote &gt; builtIn；恒非 null）。raw 不变且未拉到新表时
     * 复用缓存快照（热路径零重解析零重合并）。TTL 过期的惰性拉取在本路径评估触发，
     * <b>绝不阻塞</b>：拉取在后台 executor 单飞执行，本调用立即返回当前快照。
     */
    public IpTableMerger.Snapshot currentTable() {
        Parsed p = currentParsed();
        ensureFreshTable();
        List<IpTableMerger.Entry> remote = remoteTable;
        TableCache tc = tableCache;
        if (tc == null || tc.parsed != p || tc.remote != remote) {
            tc = new TableCache(p, remote,
                    merger.merge(p.manual, remote, DirectIpTableDefaults.builtIn()));
            tableCache = tc;
        }
        return tc.snapshot;
    }

    // ── 设置页命令面（T6 消费） ──────────────────────────────

    /**
     * 手动刷新远端 IP 表（设置页「立即更新」）：忽略开关与 TTL；已在飞返回 {@code false}。
     *
     * @return {@code true} = 本次调用发起了拉取（结果异步生效）；{@code false} = 已在飞（单飞语义）
     */
    public boolean refreshIpTableNow() {
        if (fetching) {
            return false; // 快路径
        }
        synchronized (fetchLock) {
            if (fetching) {
                return false; // 双检
            }
            fetching = true;
        }
        try {
            fetchExecutor.execute(this::runFetch);
        } catch (RejectedExecutionException e) {
            // executor 拒绝（如已关闭）→ 复位在飞标志并可见告警（ImageHostConfig.kickProbe 纪律），
            // 避免 fetching 永真导致远端表静默冻结
            fetching = false;
            warnSink.accept(TAG + " IP 表手动拉取任务提交失败（executor 拒绝）: " + e);
            return false;
        }
        return true;
    }

    /** 进程级熔断器（T4 传输层记账 recordSuccess/recordFailure 消费；会话级内存态） */
    public ChannelCircuitBreaker breaker() {
        return breaker;
    }

    /** 双通道熔断全重置（设置卡「熔断重置」命令）：图片与 API+刷新通道立即回 closed 清零。 */
    public void resetCircuits() {
        breaker.reset(ChannelCircuitBreaker.Channel.IMAGE);
        breaker.reset(ChannelCircuitBreaker.Channel.API_REFRESH);
    }

    // ── 配置解析（raw equals 复用）与跃迁检测 ─────────────────

    private Parsed currentParsed() {
        Parsed p = parsed;
        String raw = rawProvider.get();
        if (p != null && Objects.equals(raw, p.raw)) {
            return p; // 复用已解析配置（热路径零解析零分配）
        }
        Parsed fresh = parse(raw);
        parsed = fresh;
        // 跃迁检测（解析时检测，ticket）：OFF/UNSET→ON 触发拉取；
        // 首读即 ON（prev == null）视为 UNSET→ON（进程冷启动恢复开关 = 跃迁语义）
        SwitchState prev = p == null ? SwitchState.UNSET : p.switchState;
        if (prev != SwitchState.ON && fresh.switchState == SwitchState.ON) {
            ensureFreshTable();
        }
        return fresh;
    }

    /**
     * 解析直连设置 JSON（形态契约见类 javadoc「存储契约」）。未知字段忽略；
     * manual 数组内的<b>非法条目不在此层拦截</b>（逐条转 Entry，由 Merger 跳过 + 告警），
     * 但 manual 本身非数组 = 形状失败（整段 UNSET + warn，故障关闭）。
     */
    private Parsed parse(String raw) {
        if (raw == null) {
            return Parsed.unset(raw); // key 缺失 = 缺省状态，非异常不告警
        }
        try {
            JSONObject root = new JSONObject(raw);
            Object enabled = root.opt("enabled");
            if (!(enabled instanceof Boolean)) {
                throw new JSONException("形状校验失败: enabled 缺失或非 boolean");
            }
            List<IpTableMerger.Entry> manual = null;
            Object manualVal = root.opt("manual");
            if (manualVal instanceof JSONArray) {
                JSONArray arr = (JSONArray) manualVal;
                manual = new ArrayList<>(arr.length());
                for (int i = 0; i < arr.length(); i++) {
                    Object o = arr.opt(i);
                    // 非对象条目 / 缺键条目一律转 Entry(null/缺省)透传——Merger 统一跳过 + 告警
                    String host = o instanceof JSONObject ? ((JSONObject) o).optString("host", null) : null;
                    String ip = o instanceof JSONObject ? ((JSONObject) o).optString("ip", null) : null;
                    manual.add(new IpTableMerger.Entry(host, ip));
                }
            } else if (manualVal != null && manualVal != JSONObject.NULL) {
                // JSON 显式 null（org.json NULL 哨兵）与缺失同义：视为未配置；其余非数组 = 形状失败
                throw new JSONException("形状校验失败: manual 非数组");
            }
            return new Parsed(raw, (Boolean) enabled ? SwitchState.ON : SwitchState.OFF, manual);
        } catch (JSONException e) {
            warnSink.accept(TAG + " " + PREF_KEY + " 解析/形状校验失败，直连视为未配置（UNSET）: " + e);
            return Parsed.unset(raw);
        }
    }

    // ── 远端拉取（单飞 + TTL 惰性 + 降级） ────────────────────

    /**
     * TTL 惰性触发评估（{@link #currentTable()} 路径调用，绝不阻塞）：仅开关 ON 且
     * 表过期（从未成功拉取，或距上次成功 ≥ {@value #IP_TABLE_TTL_MS}）才 kick。
     * 直连关时远端表不被消费，不触发。
     */
    private void ensureFreshTable() {
        if (currentParsed().switchState != SwitchState.ON) {
            return;
        }
        loadCacheOnce(); // 先装载可再生缓存（lastFetchAt 随之播种，跨进程 TTL 正确）
        long last = lastFetchAtMillis;
        if (last != 0L && clock.nowMillis() - last < IP_TABLE_TTL_MS) {
            return; // 表仍然新鲜
        }
        kickFetch();
    }

    /** 惰性拉取触发（单飞：volatile 快路径 + synchronized 双检，先例 ImageHostConfig.kickProbe） */
    private void kickFetch() {
        if (fetching) {
            return; // 快路径：在飞（volatile 读，无锁）
        }
        synchronized (fetchLock) {
            if (fetching) {
                return; // 双检
            }
            fetching = true;
        }
        try {
            fetchExecutor.execute(this::runFetch);
        } catch (RejectedExecutionException e) {
            // executor 拒绝 → 复位在飞标志并可见告警，避免远端表静默冻结至进程重启
            fetching = false;
            warnSink.accept(TAG + " IP 表拉取任务提交失败（executor 拒绝）: " + e);
        }
    }

    /** 拉取执行体（executor 上串行运行）：成功生效并持久化，失败保留上次有效（禁静默）。 */
    private void runFetch() {
        try {
            String body;
            try {
                body = fetcher.fetchJson();
            } catch (Exception e) {
                onFetchFailure("拉取失败（IOException 或拉取器异常）", e);
                return;
            }
            List<IpTableMerger.Entry> entries = parseRemoteDoc(body);
            if (entries == null) {
                onFetchFailure("响应形状校验失败（视为拉取失败同语义）", null);
                return;
            }
            // 成功：先内存生效 + 更新 lastFetchAt（仅成功更新，TTL 计量锚点），再持久化
            // （持久化失败不影响内存生效，warn 可见；缓存可再生，损坏即弃用）
            remoteTable = entries;
            lastFetchAtMillis = clock.nowMillis();
            persistCache(body, lastFetchAtMillis);
        } finally {
            fetching = false;
        }
    }

    /** 拉取失败降级：保留上次有效（cacheDir 有则装载），否则维持内置表兜底；warn 可见。 */
    private void onFetchFailure(String what, Exception e) {
        loadCacheOnce(); // 失败 → 保留上次有效：cacheDir 有则装载（可能尚未装载过）
        String msg = TAG + " IP 表" + what + "，保留上次有效表"
                + (lastFetchAtMillis == 0L ? "（无历史有效表 → 内置表兜底）" : "");
        warnSink.accept(e == null ? msg : msg + ": " + e);
    }

    // ── cacheDir 可再生缓存（信封：{"fetchedAtMillis": long, "body": "<托管文件原文>"}） ──

    /** 一次性装载 cacheDir 信封（幂等；任何损坏 → 弃用 + warn，不删除文件——下次成功拉取覆盖） */
    private void loadCacheOnce() {
        if (cacheLoaded) {
            return; // volatile 快路径
        }
        synchronized (cacheLock) {
            if (cacheLoaded) {
                return; // 双检
            }
            cacheLoaded = true;
            readCacheIntoMemory();
        }
    }

    private void readCacheIntoMemory() {
        if (cacheFile == null || !cacheFile.isFile()) {
            return; // 从未拉取过：正常状态，非异常不告警
        }
        try {
            String content = new String(Files.readAllBytes(cacheFile.toPath()), StandardCharsets.UTF_8);
            JSONObject envelope = new JSONObject(content);
            long at = envelope.optLong("fetchedAtMillis", 0L);
            String body = envelope.optString("body", null);
            if (at <= 0L || body == null) {
                throw new JSONException("信封缺 fetchedAtMillis/body");
            }
            List<IpTableMerger.Entry> entries = parseRemoteDoc(body);
            if (entries == null) {
                throw new JSONException("缓存正文形状校验失败");
            }
            remoteTable = entries;
            lastFetchAtMillis = at;
        } catch (Exception e) {
            warnSink.accept(TAG + " cacheDir IP 表缓存损坏，弃用（内置表/下次拉取兜底）: "
                    + cacheFile + " (" + e + ")");
        }
    }

    /** 信封写盘（写失败仅告警——内存已生效，缓存可再生，下次成功拉取重试覆盖） */
    private void persistCache(String body, long atMillis) {
        if (cacheFile == null) {
            return;
        }
        try {
            String envelope = new JSONObject()
                    .put("fetchedAtMillis", atMillis)
                    .put("body", body)
                    .toString();
            Files.write(cacheFile.toPath(), envelope.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            warnSink.accept(TAG + " IP 表缓存写盘失败（内存已生效）: " + e);
        }
    }

    // ── 托管文件解析（远端响应与 cacheDir 正文同一契约） ──────

    /**
     * 托管 IP 表 JSON 解析（oracle = {@code packages/website/pixiv-ip-table.json} 托管形态；
     * 字段语义——版本演进预留）：
     * <ul>
     *   <li><b>version</b>：int，当前恒 {@value #SUPPORTED_REMOTE_VERSION}（唯一受支持版本；
     *       缺失 / 非整数 / 非 1 → 形状失败）——旧客户端不误读未来格式，宁弃新表不误用，预留演进；</li>
     *   <li><b>updatedAt</b>：信息性元数据（ISO 日期字符串），不参与路由决策，缺失容忍；</li>
     *   <li><b>entries</b>：JSON 数组，每条形如 {@code {"host": "i.pximg.net", "ip": "210.140.139.131"}}
     *       ——host 为官方域名（解析即规范化小写；大小写不敏感），ip 为 IPv4 字面量。</li>
     * </ul>
     * 任何形状偏离（root 非对象 / version 非 1 / entries 非数组 / 条目缺 host-ip /
     * host 或 ip 非字符串 / host 空白 / IP 非法 IPv4 字面量）→ 返回 {@code null} =
     * 拉取失败同语义（整表弃用，保留上次有效，调用方 warn）——托管文件由本仓库机器管理，
     * 宁全弃不部分采纳，保证可见性。
     *
     * @return 合法条目列表（构造即规范化；不可供外部修改假设），{@code null} = 形状失败
     */
    static List<IpTableMerger.Entry> parseRemoteDoc(String body) {
        if (body == null) {
            return null;
        }
        try {
            JSONObject root = new JSONObject(body);
            Object version = root.opt("version");
            if (!(version instanceof Integer) || (Integer) version != SUPPORTED_REMOTE_VERSION) {
                return null;
            }
            Object entriesVal = root.opt("entries");
            if (!(entriesVal instanceof JSONArray)) {
                return null;
            }
            JSONArray arr = (JSONArray) entriesVal;
            List<IpTableMerger.Entry> out = new ArrayList<>(arr.length());
            for (int i = 0; i < arr.length(); i++) {
                Object o = arr.opt(i);
                if (!(o instanceof JSONObject)) {
                    return null;
                }
                JSONObject e = (JSONObject) o;
                Object host = e.opt("host");
                Object ip = e.opt("ip");
                if (!(host instanceof String) || !(ip instanceof String)) {
                    return null;
                }
                String h = ((String) host).trim().toLowerCase();
                String ipv = ((String) ip).trim();
                if (h.isEmpty() || !IpTableMerger.isValidIpv4Literal(ipv)) {
                    return null;
                }
                out.add(new IpTableMerger.Entry(h, ipv));
            }
            return out;
        } catch (JSONException e) {
            return null; // 语法错误 = 形状失败同语义
        }
    }

    // ── 内部模型（不可变） ───────────────────────────────────

    /** 已解析配置（不可变；raw 供 equals 复用比对） */
    private static final class Parsed {
        final String raw;
        final SwitchState switchState;
        /** 手动层条目（可能含非法条目——Merger 跳过 + 告警）；null = 未配置（manual 缺失/显式 null） */
        final List<IpTableMerger.Entry> manual;

        Parsed(String raw, SwitchState switchState, List<IpTableMerger.Entry> manual) {
            this.raw = raw;
            this.switchState = switchState;
            this.manual = manual;
        }

        /** 直连视为未配置（解析失败/无存储的兜底形态，UNSET ⇒ decide 恒系统路线） */
        static Parsed unset(String raw) {
            return new Parsed(raw, SwitchState.UNSET, null);
        }
    }

    /** 合并快照缓存条目（parsed 实例 + remote 引用为键，引用不等即重建） */
    private static final class TableCache {
        final Parsed parsed;
        final List<IpTableMerger.Entry> remote;
        final IpTableMerger.Snapshot snapshot;

        TableCache(Parsed parsed, List<IpTableMerger.Entry> remote, IpTableMerger.Snapshot snapshot) {
            this.parsed = parsed;
            this.remote = remote;
            this.snapshot = snapshot;
        }
    }
}
