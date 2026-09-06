package io.pictelio.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;
import java.util.Random;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/**
 * 图床下载源决策深模块（ADR-0143 D1 / spec #377 T1）：官方 URL 进 → 实际下载 URL 出。
 *
 * <p><b>接口契约</b>——{@link #resolve(String)} 不变量（违反视为架构违规）：
 * <ol>
 *   <li>图床关（masterEnabled=false）/ 配置 JSON 解析或形状校验失败 / 无可用 host /
 *       入参 null 或非 http(s) 开头 → <b>原样返回 officialUrl</b>；</li>
 *   <li>改写仅替换 host：officialUrl 的 path+query 逐字节保留，protocol/port 取镜像 baseUrl 的；
 *       baseUrl 含 {@code {path}} 模板时替换为 officialUrl 的 path 去掉前导 {@code /}
 *       （语义对齐 JS {@code transformUrl}，oracle 见 {@code packages/app/src/services/imageHostService.ts}）；</li>
 *   <li><b>缓存键恒官方 URL</b>（ADR-0143 D2 源无关命中不变量）：调用方必须用
 *       <b>officialUrl 入参</b>（而非本方法返回值）计算缓存键——下载源跟随图床，缓存键不跟随，
 *       切源/开关图床/换镜像均不使已缓存条目失效；</li>
 *   <li>线程安全；热路径无磁盘 IO、无自有锁竞争（SharedPreferences 读取为加载后的内存查询；
 *       配置解析无锁、良性竞态——不可变 {@link Parsed} + volatile 持有）；</li>
 *   <li>镜像 host 的 baseUrl hostname 属于 pximg.net / pixiv.net 域 → 跳过该 host（防自环，
 *       与 JS {@code validateHostInput} 写入侧防线对称）。</li>
 * </ol>
 *
 * <p><b>四模式映射</b>（oracle = JS {@code imageHostService.ts} / {@code imageHostStore.ts}）：
 * <ul>
 *   <li>single：selectedHostId 对应且可用的 host，无效回退第一个可用；</li>
 *   <li>weighted：weight&gt;0 的可用 host 按权重每请求独立抽样（逐规则复刻 {@code selectWeightedHost}）；</li>
 *   <li>fastest-ip：内存探针结果 30s TTL 内用最快（TTL 判定 oracle = {@code getFastestHost}）；
 *       过期/缺失<b>立即</b>回退 weighted 不阻塞，同时惰性触发单飞探测；</li>
 *   <li>race：降级 weighted——<b>native 从未实现 race</b>，此为显式化而非行为缩减（ADR-0143 D3），
 *       设置页（webview）应标注「仅 Web」。</li>
 * </ul>
 *
 * <p><b>配置来源</b>：{@link RawProvider} 接缝（生产 = SharedPreferences {@code "CapacitorStorage"}
 * 的 {@code image_host_settings} 字符串，先例：{@code ImageIntercept} 读 {@code image_cache_disk}）。
 * 返回字符串与上次相同（equals）→ 复用已解析配置；不同 → 重解析。解析异常/形状校验失败 →
 * 图床视为关 + {@code Log.w}（禁静默降级）。未知字段忽略；hosts 条目缺 id/baseUrl → 跳过该条目。
 *
 * <p><b>测试面</b>：RawProvider/Clock/Random/ProbeFn/Executor 全部构造器注入（接口即测试面），
 * 决策逻辑不发真 HTTP、不触真时钟。仅 {@link #resolve} 为 public（T2-T4 跨源集调用），
 * {@link #get} 包可见（调用方同包 io.pictelio.app）。
 */
public final class ImageHostConfig {

    private static final String TAG = "[ImageHostConfig]";
    /** Capacitor Preferences 落盘的默认 SharedPreferences 名（先例：ImageIntercept） */
    private static final String PREFS_NAME = "CapacitorStorage";
    /** 图床设置 JSON 的存储键（oracle = imageHostStore.ts 的 PREF_KEY） */
    private static final String PREF_KEY = "image_host_settings";
    /** 探测样本 URL（oracle = JS buildProbeSampleUrl：固定一张官方 sample 图，任意 2xx/响应均视为在线） */
    static final String PROBE_SAMPLE_URL =
            "https://i.pximg.net/c/360x360_70/img-master/img/2020/01/01/00/00/00/0_p0_master1200.jpg";
    /** fastest-ip 探针结果 TTL（oracle = JS setProbeResults 的 Date.now() + 30_000） */
    static final long PROBE_TTL_MS = 30_000L;
    /** 生产探针调用超时（ADR-0143 D3：5s） */
    private static final long PROBE_TIMEOUT_MS = 5_000L;

    // ── 函数式接缝（包可见：注入面 = 包可见构造器，ADR-0143「接口即测试面」） ──

    /** 原始配置提供者（生产 = SharedPreferences 读取；返回 null 表示无存储条目） */
    interface RawProvider {
        String get();
    }

    /** 毫秒时钟（生产 = System.currentTimeMillis；oracle 对齐 JS Date.now()） */
    interface Clock {
        long nowMillis();
    }

    /**
     * 单 host 探测：入参为该 host baseUrl 与 {@link #PROBE_SAMPLE_URL} 组合后的探测 URL，
     * 返回延迟 ms；&lt;0（或抛异常）= 不可达/超时（显式错误暴露，非静默）。
     */
    interface ProbeFn {
        long probe(String probeUrl);
    }

    // ── 生产单例 ─────────────────────────────────────────────

    private static volatile ImageHostConfig instance;
    /** 单例绑定的 ApplicationContext。生产进程内 getApplicationContext() 恒为同一对象（绑定永不触发重建）；
     *  Robolectric 每用例新建 Application → 绑定失效自动重建，保证测试间无静态配置泄漏（跨类密闭）。 */
    private static volatile Context instanceApp;

    /** 生产入口（包可见：调用方同包）。单例，接线真实 RawProvider/时钟/探针/专用单线程 executor。 */
    static ImageHostConfig get(Context ctx) {
        Context app = ctx.getApplicationContext();
        ImageHostConfig c = instance;
        if (c == null || instanceApp != app) {
            synchronized (ImageHostConfig.class) {
                if (instance == null || instanceApp != ctx.getApplicationContext()) {
                    // 探针客户端：复用共享连接池，仅调用级 5s 超时（探测与下载预算隔离）
                    final OkHttpClient probeClient = PixivApiCore.getSharedClient().newBuilder()
                            .callTimeout(PROBE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                            .build();
                    final Context appCtx = ctx.getApplicationContext();
                    instance = new ImageHostConfig(
                            () -> appCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                                    .getString(PREF_KEY, null),
                            System::currentTimeMillis,
                            new Random(),
                            // 生产探针：HEAD 请求。oracle = JS probeHosts 的 reachable 判定——
                            // no-cors 下任意响应（status 0）都视为可达，仅网络层异常判为不可达
                            url -> {
                                long startNanos = System.nanoTime();
                                try (Response response = probeClient
                                        .newCall(new Request.Builder().url(url).head().build())
                                        .execute()) {
                                    return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos);
                                } catch (Exception e) {
                                    Log.w(TAG, "fastest-ip 探测失败（视为不可达）: " + url);
                                    return -1L;
                                }
                            },
                            probeExecutor());
                    instanceApp = appCtx;
                }
                c = instance;
            }
        }
        return c;
    }

    /** 专用单线程 executor（ADR-0143 D3：探针串行单飞，不占用下载线程池） */
    private static Executor probeExecutor() {
        return Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "ImageHostProbe");
            t.setDaemon(true);
            return t;
        });
    }

    // ── 注入构造（包可见：测试注入面） ────────────────────────

    private final RawProvider rawProvider;
    private final Clock clock;
    private final Random random;
    private final ProbeFn probe;
    private final Executor probeExecutor;
    /** 单飞锁（仅探针触发路径使用；resolve 热路径不经过） */
    private final Object probeLock = new Object();
    /** 探测在飞标志（volatile：锁外快路径判断） */
    private volatile boolean probing;
    /** 已解析配置（raw equals 复用；不可变对象 + volatile 持有，解析竞态良性） */
    private volatile Parsed parsed;
    /** fastest-ip 内存探针结果（含持久化种子；volatile） */
    private volatile ProbeCache probeCache;

    ImageHostConfig(RawProvider raw, Clock clock, Random random, ProbeFn probe, Executor probeExecutor) {
        this.rawProvider = raw;
        this.clock = clock;
        this.random = random;
        this.probe = probe;
        this.probeExecutor = probeExecutor;
    }

    // ── 唯一接口方法 ─────────────────────────────────────────

    /**
     * 官方 URL 进 → 实际下载 URL 出。完整契约见类 javadoc（尤其不变量 3：
     * 调用方必须用 officialUrl 入参而非本返回值计算缓存键）。
     */
    public String resolve(String officialUrl) {
        if (officialUrl == null) {
            return null;
        }
        if (!officialUrl.startsWith("http://") && !officialUrl.startsWith("https://")) {
            return officialUrl;
        }
        Parsed p = current();
        if (!p.masterEnabled) {
            return officialUrl;
        }
        List<Host> usable = p.usableHosts;
        if (usable.isEmpty()) {
            return officialUrl;
        }
        Host chosen;
        switch (p.mode) {
            case SINGLE:
                chosen = findById(usable, p.selectedHostId);
                if (chosen == null) {
                    chosen = usable.get(0); // 选中缺失/不可用 → 第一个可用（oracle = getEffectiveImageUrl single 分支）
                }
                break;
            case WEIGHTED:
            case RACE: // race 降级 weighted：native 从未实现 race（ADR-0143 D3，显式降级非行为缩减）
                chosen = selectWeighted(p);
                if (chosen == null) {
                    chosen = usable.get(0); // 无 weight>0 host → 第一个可用（oracle = getEffectiveImageUrl 末行兜底）
                }
                break;
            case FASTEST_IP:
                chosen = fastestIfValid(usable);
                if (chosen == null) {
                    kickProbe(usable); // 惰性探针：立即回退 weighted，不阻塞等探测结果
                    chosen = selectWeighted(p);
                    if (chosen == null) {
                        chosen = usable.get(0);
                    }
                }
                break;
            default:
                chosen = null;
                break;
        }
        if (chosen == null) {
            // 理论不可达：usable 非空 ⇒ single/weighted 必产出 chosen
            return officialUrl;
        }
        return transform(officialUrl, chosen.baseUrl);
    }

    // ── 配置解析（raw equals 复用） ───────────────────────────

    private Parsed current() {
        Parsed p = parsed;
        String raw = rawProvider.get();
        if (p != null && Objects.equals(raw, p.raw)) {
            return p; // 复用已解析配置（热路径零解析零分配）
        }
        Parsed fresh = parse(raw, clock);
        parsed = fresh;
        probeCache = seedProbeCache(fresh);
        return fresh;
    }

    /**
     * 解析图床配置 JSON（oracle = imageHostStore.ts 的 ImageHostState 持久化形态）。
     * 形状校验失败 / JSON 语法错误 → 图床视为关 + warn（禁静默降级）；raw == null（无存储条目）
     * = 缺省状态（图床关），非异常不 warn。未知字段忽略；hosts 条目缺 id/baseUrl → 跳过并 warn。
     */
    private static Parsed parse(String raw, Clock clock) {
        if (raw == null) {
            return Parsed.off(raw);
        }
        try {
            JSONObject root = new JSONObject(raw);
            Object master = root.get("masterEnabled");
            if (!(master instanceof Boolean)) {
                throw new JSONException("形状校验失败: masterEnabled 非 boolean");
            }
            Object modeVal = root.get("mode");
            if (!(modeVal instanceof String)) {
                throw new JSONException("形状校验失败: mode 非字符串");
            }
            Mode mode = parseMode((String) modeVal);
            if (mode == null) {
                throw new JSONException("形状校验失败: mode 非法值 " + modeVal);
            }
            Object hostsVal = root.get("hosts");
            if (!(hostsVal instanceof JSONArray)) {
                throw new JSONException("形状校验失败: hosts 非数组");
            }
            JSONArray hosts = (JSONArray) hostsVal;
            List<Host> usable = new ArrayList<>(hosts.length());
            for (int i = 0; i < hosts.length(); i++) {
                Object entry = hosts.opt(i);
                if (!(entry instanceof JSONObject)) {
                    Log.w(TAG, "hosts[" + i + "] 非对象，跳过该条目");
                    continue;
                }
                JSONObject h = (JSONObject) entry;
                String id = h.optString("id", "");
                String baseUrl = h.optString("baseUrl", "");
                if (id.isEmpty() || baseUrl.isEmpty()) {
                    Log.w(TAG, "hosts[" + i + "] 缺 id/baseUrl，跳过该条目");
                    continue;
                }
                if (!h.optBoolean("enabled", false)) {
                    continue; // 停用 host 不参与决策（正常状态，非异常）
                }
                if (isOfficialDomain(hostnameOf(baseUrl))) {
                    continue; // 防自环：官方域镜像 host 跳过（ADR-0143 D4，oracle = validateHostInput）
                }
                double weight = h.optDouble("weight", 1d);
                if (weight == 0d) {
                    weight = 1d; // JS migrate Number(weight) || 1：0 归一为 1
                }
                usable.add(new Host(id, baseUrl, weight));
            }
            String selectedHostId = root.isNull("selectedHostId") ? null : root.optString("selectedHostId", null);
            String fastestHostId = root.isNull("fastestHostId") ? null : root.optString("fastestHostId", null);
            long fastestExpiresAt = root.isNull("fastestHostExpiresAt") ? 0L : root.optLong("fastestHostExpiresAt", 0L);
            return new Parsed(raw, (Boolean) master, mode, selectedHostId,
                    Collections.unmodifiableList(usable), fastestHostId, fastestExpiresAt);
        } catch (JSONException e) {
            Log.w(TAG, "image_host_settings 解析/形状校验失败，图床视为关闭", e);
            return Parsed.off(raw);
        }
    }

    private static Mode parseMode(String s) {
        switch (s) {
            case "single":
                return Mode.SINGLE;
            case "weighted":
                return Mode.WEIGHTED;
            case "fastest-ip":
                return Mode.FASTEST_IP;
            case "race":
                return Mode.RACE;
            default:
                return null;
        }
    }

    // ── 模式选择逻辑 ─────────────────────────────────────────

    private static Host findById(List<Host> hosts, String id) {
        if (id == null) {
            return null;
        }
        for (Host h : hosts) {
            if (h.id.equals(id)) {
                return h;
            }
        }
        return null;
    }

    /**
     * weighted 抽样（逐规则复刻 JS selectWeightedHost）：候选 = weight&gt;0 的可用 host
     * （解析期已预计算）→ roll = random()*total → 逐个减 → roll&lt;=0 选中 → 末尾兜底最后一个。
     * 返回 null 仅当无 weight&gt;0 候选（调用方按 getEffectiveImageUrl 末行回退第一个可用）。
     */
    private Host selectWeighted(Parsed p) {
        List<Host> weighted = p.weightedHosts;
        if (weighted.isEmpty()) {
            return null;
        }
        double roll = random.nextDouble() * p.weightedTotal;
        for (Host h : weighted) {
            roll -= h.weight;
            if (roll <= 0) {
                return h;
            }
        }
        return weighted.get(weighted.size() - 1);
    }

    /**
     * fastest-ip 内存探针命中判定（TTL 判定 oracle = JS getFastestHost：
     * now &gt; expiresAt → 过期；无过期时刻 → 永不过期）。命中还需该 host 仍可用
     * （enabled ∧ 非官方域，ADR-0143 D3/D4）。
     */
    private Host fastestIfValid(List<Host> usable) {
        ProbeCache pc = probeCache;
        if (pc == null) {
            return null;
        }
        if (clock.nowMillis() > pc.expiresAt) {
            return null;
        }
        return findById(usable, pc.hostId);
    }

    /**
     * 解析期播种：持久化 fastestHostId/fastestHostExpiresAt（JS 设置页探测写入）→ 内存探针缓存。
     * oracle = getFastestHost 的 TTL 判定：无过期时刻 → 永不过期；已过期 → 弃用。
     * Java 自身探测完成后覆盖此种子（内存探针结果 = 最新的决策事件）。
     */
    private ProbeCache seedProbeCache(Parsed p) {
        if (p.fastestHostId == null) {
            return null;
        }
        if (p.fastestHostExpiresAt != 0 && clock.nowMillis() > p.fastestHostExpiresAt) {
            return null;
        }
        return new ProbeCache(p.fastestHostId,
                p.fastestHostExpiresAt == 0 ? Long.MAX_VALUE : p.fastestHostExpiresAt);
    }

    // ── 惰性探针（单飞） ─────────────────────────────────────

    /**
     * 触发惰性探测（单飞：synchronized 双检，避免并发重复探测）。探测在注入的
     * probeExecutor 上执行，不阻塞当前 resolve（调用方已立即回退 weighted）。
     */
    private void kickProbe(final List<Host> usable) {
        if (probing) {
            return; // 快路径：探测进行中（volatile 读，无锁）
        }
        synchronized (probeLock) {
            if (probing) {
                return; // 双检
            }
            if (fastestIfValid(usable) != null) {
                return; // 等锁期间别的线程已探测完成
            }
            probing = true;
        }
        probeExecutor.execute(() -> {
            try {
                runProbe(usable);
            } finally {
                probing = false;
            }
        });
    }

    /**
     * 对每个可用 host 用注入的 ProbeFn 测延迟（入参 = 样本 URL 经该 host baseUrl 改写后的探测 URL），
     * 取最小者缓存 30s。全部不可达 → 不写缓存（下次 resolve 再触发单飞探测）。
     * oracle = JS probeHosts / setProbeResults 的决策语义。
     */
    private void runProbe(List<Host> targets) {
        String bestId = null;
        long best = Long.MAX_VALUE;
        for (Host h : targets) {
            long latency;
            try {
                latency = probe.probe(transform(PROBE_SAMPLE_URL, h.baseUrl));
            } catch (Exception e) {
                latency = -1L; // 探测异常 = 不可达（ProbeFn 契约的显式错误暴露）
            }
            if (latency >= 0 && latency < best) {
                best = latency;
                bestId = h.id;
            }
        }
        if (bestId != null) {
            probeCache = new ProbeCache(bestId, clock.nowMillis() + PROBE_TTL_MS);
        }
    }

    // ── URL 改写（oracle = JS transformUrl） ─────────────────

    /**
     * URL 改写（oracle = JS {@code transformUrl}，imageHostService.ts）：
     * <ul>
     *   <li>baseUrl 含 {@code {path}}：纯字符串替换，模板替换为 officialUrl 的 path 去掉前导
     *       {@code /}（<b>query 不参与</b>——JS pathname.slice(1) 语义，与 host 替换分支不同）；</li>
     *   <li>否则：仅取镜像 protocol/hostname/port，officialUrl 的 path+query 逐字节保留
     *       （镜像无显式端口时 officialUrl 的显式端口被移除——JS source.port = proxy.port 语义）。</li>
     * </ul>
     * 解析失败 → 原样返回 officialUrl（JS err 分支）+ warn。
     */
    static String transform(String officialUrl, String baseUrl) {
        int tpl = baseUrl.indexOf("{path}");
        if (tpl >= 0) {
            try {
                URI official = new URI(officialUrl);
                String path = official.getRawPath();
                if (path != null && path.startsWith("/")) {
                    path = path.substring(1);
                } else if (path == null) {
                    path = "";
                }
                // 仅替换首个 {path}（对齐 JS String.replace 的单次替换语义）
                return baseUrl.substring(0, tpl) + path + baseUrl.substring(tpl + "{path}".length());
            } catch (URISyntaxException e) {
                Log.w(TAG, "officialUrl 解析失败（{path} 模式），透传官方 URL: " + officialUrl);
                return officialUrl;
            }
        }
        try {
            URI official = new URI(officialUrl);
            URI mirror = new URI(baseUrl);
            if (mirror.getScheme() == null || mirror.getHost() == null) {
                Log.w(TAG, "镜像 baseUrl 无 scheme/host，透传官方 URL: " + baseUrl);
                return officialUrl;
            }
            StringBuilder sb = new StringBuilder(officialUrl.length() + 16);
            sb.append(mirror.getScheme()).append("://").append(mirror.getHost());
            if (mirror.getPort() != -1) {
                sb.append(':').append(mirror.getPort());
            }
            String path = official.getRawPath();
            sb.append(path == null || path.isEmpty() ? "/" : path);
            if (official.getRawQuery() != null) {
                sb.append('?').append(official.getRawQuery());
            }
            if (official.getRawFragment() != null) {
                sb.append('#').append(official.getRawFragment());
            }
            return sb.toString();
        } catch (URISyntaxException e) {
            Log.w(TAG, "URL 解析失败，透传官方 URL: " + officialUrl);
            return officialUrl;
        }
    }

    // ── 官方域判定（防自环，ADR-0143 D4） ────────────────────

    /**
     * 从 baseUrl 提取 hostname（小写）。容忍 {@code {path}} 模板等 URI 语法外字符——
     * JS {@code new URL()} 对其百分号编码后照样能取 hostname，此处以宽松字符串提取对齐。
     */
    static String hostnameOf(String baseUrl) {
        int schemeEnd = baseUrl.indexOf("://");
        String rest = schemeEnd >= 0 ? baseUrl.substring(schemeEnd + 3) : baseUrl;
        int end = rest.length();
        for (int i = 0; i < rest.length(); i++) {
            char c = rest.charAt(i);
            if (c == '/' || c == '?' || c == '#') {
                end = i;
                break;
            }
        }
        String authority = rest.substring(0, end);
        int at = authority.lastIndexOf('@');
        if (at >= 0) {
            authority = authority.substring(at + 1);
        }
        if (!authority.startsWith("[")) {
            int colon = authority.indexOf(':');
            if (colon >= 0) {
                authority = authority.substring(0, colon);
            }
        }
        return authority.toLowerCase();
    }

    /** 官方域判定：等于或属于 *.pximg.net / *.pixiv.net（oracle = validateHostInput 写入侧防线 + D4 防自环） */
    static boolean isOfficialDomain(String hostname) {
        return equalsOrSubdomainOf(hostname, "pximg.net") || equalsOrSubdomainOf(hostname, "pixiv.net");
    }

    private static boolean equalsOrSubdomainOf(String host, String domain) {
        return host.equals(domain) || host.endsWith("." + domain);
    }

    // ── 内部模型（不可变） ───────────────────────────────────

    private enum Mode {
        SINGLE, WEIGHTED, FASTEST_IP, RACE
    }

    private static final class Host {
        final String id;
        final String baseUrl;
        final double weight;

        Host(String id, String baseUrl, double weight) {
            this.id = id;
            this.baseUrl = baseUrl;
            this.weight = weight;
        }
    }

    /** 已解析配置（不可变；raw 供 equals 复用比对） */
    private static final class Parsed {
        final String raw;
        final boolean masterEnabled;
        final Mode mode;
        final String selectedHostId;
        /** 可用 host：enabled ∧ 非官方域（防自环过滤后），顺序保持 hosts 数组顺序 */
        final List<Host> usableHosts;
        /** weighted 候选：usableHosts 中 weight&gt;0 者（预计算，热路径零分配） */
        final List<Host> weightedHosts;
        final double weightedTotal;
        final String fastestHostId;
        /** 持久化种子过期时刻；0 = null（JS getFastestHost 语义：无过期时刻 → 永不过期） */
        final long fastestHostExpiresAt;

        Parsed(String raw, boolean masterEnabled, Mode mode, String selectedHostId,
               List<Host> usableHosts, String fastestHostId, long fastestHostExpiresAt) {
            this.raw = raw;
            this.masterEnabled = masterEnabled;
            this.mode = mode;
            this.selectedHostId = selectedHostId;
            this.usableHosts = usableHosts;
            List<Host> weighted = new ArrayList<>(usableHosts.size());
            double total = 0;
            for (Host h : usableHosts) {
                if (h.weight > 0) {
                    weighted.add(h);
                    total += h.weight;
                }
            }
            this.weightedHosts = Collections.unmodifiableList(weighted);
            this.weightedTotal = total;
            this.fastestHostId = fastestHostId;
            this.fastestHostExpiresAt = fastestHostExpiresAt;
        }

        /** 图床视为关（解析失败/无存储的兜底形态，masterEnabled=false ⇒ resolve 原样透传） */
        static Parsed off(String raw) {
            return new Parsed(raw, false, Mode.WEIGHTED, null,
                    Collections.<Host>emptyList(), null, 0L);
        }
    }

    /** fastest-ip 内存探针结果；expiresAt = Long.MAX_VALUE 表示无过期（持久化种子为 null 时） */
    private static final class ProbeCache {
        final String hostId;
        final long expiresAt;

        ProbeCache(String hostId, long expiresAt) {
            this.hostId = hostId;
            this.expiresAt = expiresAt;
        }
    }
}
