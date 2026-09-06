package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.CountDownLatch;

/**
 * ImageHostConfig 单测（#377 T1）——全部从 {@code resolve()} 单口进出（spec：接口即测试面），
 * RawProvider/Clock/Random/ProbeFn/Executor 全注入：不触 SharedPreferences、不发真 HTTP、不用真时钟。
 *
 * <p><b>Oracle 溯源（spec #376 测试硬约束 #6：期望值出处可追溯）</b>——期望值全部来自独立来源，
 * 禁止从被测实现反推：
 * <ul>
 *   <li>URL 改写 / {path} 模板 / weighted 抽样规则 / fastest-ip TTL 判定 / 探测样本 URL /
 *       官方域写入侧防线：JS 源码
 *       {@code packages/app/src/services/imageHostService.ts} 的
 *       {@code transformUrl} / {@code selectWeightedHost} / {@code getEffectiveImageUrl} /
 *       {@code buildProbeSampleUrl} / {@code validateHostInput}，
 *       以及 {@code packages/app/src/stores/imageHostStore.ts} 的 {@code getFastestHost}；</li>
 *   <li>配置 JSON 形状与内置 host 取值（pixiv-re / pixiv-nl / pixivel）：
 *       {@code imageHostStore.ts} 的 ImageHostState 持久化形态 / BUILT_IN_HOSTS（真实形状 fixture，
 *       含 probeResults / fastestHostExpiresAt 字段）；</li>
 *   <li>fixed Random 的确定性断言：按 selectWeightedHost 的累计边界规则（roll = u*total，
 *       逐个减，roll&lt;=0 选中）对注入的 u 值<b>手推</b>期望 host，推导见各用例注释；</li>
 *   <li>统计抽样断言容差带：70/30 权重 1000 次，均值 ±10 个百分点（σ≈1.4pp，容差 ≈ ±7σ）。</li>
 * </ul>
 * race 模式断言与 weighted 同规则（native 从未实现 race，显式降级——ADR-0143 D3）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class ImageHostConfigTest {

    /** 真实形状的官方 sample 图 URL（i.pximg.net CDN 路径形态） */
    private static final String OFFICIAL =
            "https://i.pximg.net/img-master/img/2021/03/15/00/00/00/87905934_p0.jpg";
    private static final String OFFICIAL_PATH = "/img-master/img/2021/03/15/00/00/00/87905934_p0.jpg";

    /** MutableClock 初始时刻（fastest-ip 过期时刻均相对此值构造） */
    private static final long NOW = 1_000_000L;

    // ── 注入桩 ──────────────────────────────────────────────

    private static final class MutableClock implements ImageHostConfig.Clock {
        long now = NOW;

        @Override
        public long nowMillis() {
            return now;
        }
    }

    private static final class CountingRaw implements ImageHostConfig.RawProvider {
        String raw;
        int calls;

        CountingRaw(String raw) {
            this.raw = raw;
        }

        @Override
        public String get() {
            calls++;
            return raw;
        }
    }

    /** Random 非 final，可覆写 nextDouble 返回固定值（确定性边界断言用） */
    private static Random fixedRandom(final double value) {
        return new Random() {
            @Override
            public double nextDouble() {
                return value;
            }
        };
    }

    /** 记录探测 URL 与按 URL 子串匹配的延迟（单飞保证探测串行，单探测线程写） */
    private static final class RecordingProbe implements ImageHostConfig.ProbeFn {
        final List<String> urls = Collections.synchronizedList(new ArrayList<String>());
        final Map<String, Long> latencyByUrlContains = new HashMap<>();
        long defaultLatency = 100L;

        @Override
        public long probe(String probeUrl) {
            urls.add(probeUrl);
            for (Map.Entry<String, Long> e : latencyByUrlContains.entrySet()) {
                if (probeUrl.contains(e.getKey())) {
                    return e.getValue();
                }
            }
            return defaultLatency;
        }
    }

    // ── 真实形状 fixture（oracle = imageHostStore.ts 持久化形态 + BUILT_IN_HOSTS）──

    private static String host(String id, String baseUrl, boolean enabled, int weight) {
        return "{\"id\":\"" + id + "\",\"name\":\"" + id + "-name\",\"baseUrl\":\"" + baseUrl
                + "\",\"enabled\":" + enabled + ",\"weight\":" + weight
                + ",\"isBuiltIn\":true,\"edited\":false}";
    }

    private static String config(boolean masterEnabled, String mode, String selectedHostId,
                                 String hostsJson, String fastestHostId, Long fastestExpiresAt) {
        return "{\"masterEnabled\":" + masterEnabled
                + ",\"mode\":\"" + mode + "\""
                + ",\"selectedHostId\":" + (selectedHostId == null ? "null" : "\"" + selectedHostId + "\"")
                + ",\"hosts\":[" + hostsJson + "]"
                + ",\"probeResults\":[]"
                + ",\"fastestHostId\":" + (fastestHostId == null ? "null" : "\"" + fastestHostId + "\"")
                + ",\"fastestHostExpiresAt\":" + (fastestExpiresAt == null ? "null" : fastestExpiresAt)
                + "}";
    }

    /** oracle: imageHostStore.ts BUILT_IN_HOSTS（pixiv-re/pixiv-nl 启用 weight=100，pixivel 停用 weight=50） */
    private static final String BUILT_IN_HOSTS =
            host("pixiv-re", "https://i.pixiv.re", true, 100) + ","
                    + host("pixiv-nl", "https://i.pixiv.nl", true, 100) + ","
                    + host("pixivel", "https://api.pixiv.cat/v1/generate", false, 50);

    /** 70/30 双镜像（weighted 统计与边界断言用） */
    private static final String WEIGHTED_70_30 =
            host("mirror-a", "https://mirror-a.example", true, 70) + ","
                    + host("mirror-b", "https://mirror-b.example", true, 30);

    /** 单飞一轮 = 对每个可用 host 各一次 ProbeFn 调用；BUILT_IN fixture 可用 host = 2（pixiv-re、pixiv-nl） */
    private static final int PROBE_CALLS_PER_ROUND = 2;

    private static ImageHostConfig newConfig(String raw, ImageHostConfig.Clock clock,
                                             Random random, RecordingProbe probe) {
        return new ImageHostConfig(new CountingRaw(raw), clock, random, probe, Runnable::run);
    }

    private static ImageHostConfig newConfig(String raw) {
        return newConfig(raw, new MutableClock(), fixedRandom(0.5), new RecordingProbe());
    }

    // ── 契约 1：透传路径 ────────────────────────────────────

    @Test
    public void resolve_masterDisabled_returnsOfficialUrl() {
        // probeResults/fastestHostExpiresAt 恒在（真实持久化形态）
        RecordingProbe probe = new RecordingProbe();
        ImageHostConfig c = newConfig(config(false, "weighted", null, BUILT_IN_HOSTS, null, null),
                new MutableClock(), fixedRandom(0.5), probe);
        assertEquals(OFFICIAL, c.resolve(OFFICIAL));
        assertEquals("图床关不得触发探测", 0, probe.urls.size());
    }

    @Test
    public void resolve_degenerateRaw_returnsOfficialUrl() {
        // null = 无存储条目（缺省状态，图床关）；损坏 JSON / 空串 = 解析异常（图床视为关）。
        // 均为 resolve 透传：返回 officialUrl 原值（null 入参透传见 resolve_nonHttpInput_passthrough）
        assertEquals(OFFICIAL, newConfig(null).resolve(OFFICIAL));
        assertEquals(OFFICIAL, newConfig("{not-json").resolve(OFFICIAL));
        assertEquals(OFFICIAL, newConfig("").resolve(OFFICIAL));
    }

    @Test
    public void resolve_shapeValidationFailure_returnsOfficialUrl() {
        // 形状校验（masterEnabled boolean / mode ∈ 4 值 / hosts 数组）失败 → 图床视为关
        assertEquals(OFFICIAL, newConfig("[1,2]").resolve(OFFICIAL));
        assertEquals(OFFICIAL, newConfig(
                config(true, "turbo", null, BUILT_IN_HOSTS, null, null)).resolve(OFFICIAL));
        assertEquals(OFFICIAL, newConfig(
                config(true, "weighted", null, BUILT_IN_HOSTS, null, null)
                        .replace("\"masterEnabled\":true", "\"masterEnabled\":\"true\""))
                .resolve(OFFICIAL));
        assertEquals(OFFICIAL, newConfig(
                "{\"masterEnabled\":true,\"mode\":\"weighted\",\"hosts\":{}}").resolve(OFFICIAL));
    }

    @Test
    public void resolve_nonHttpInput_passthrough() {
        ImageHostConfig c = newConfig(config(true, "single", "\"pixiv-re\"", BUILT_IN_HOSTS, null, null));
        assertEquals("ftp://i.pximg.net/a.jpg", c.resolve("ftp://i.pximg.net/a.jpg"));
        assertEquals("i.pximg.net/a.jpg", c.resolve("i.pximg.net/a.jpg"));
        assertEquals("", c.resolve(""));
        assertNull(c.resolve(null));
    }

    @Test
    public void resolve_noUsableHost_returnsOfficialUrl() {
        // 全部停用 → 无 enabled host → 透传
        String allDisabled = host("pixiv-re", "https://i.pixiv.re", false, 100);
        ImageHostConfig c = newConfig(config(true, "weighted", null, allDisabled, null, null));
        assertEquals(OFFICIAL, c.resolve(OFFICIAL));
    }

    // ── single 模式（oracle = getEffectiveImageUrl single 分支） ──

    @Test
    public void resolve_single_usesSelectedHost() {
        ImageHostConfig c = newConfig(config(true, "single", "pixiv-nl", BUILT_IN_HOSTS, null, null));
        assertEquals("https://i.pixiv.nl" + OFFICIAL_PATH, c.resolve(OFFICIAL));
    }

    @Test
    public void resolve_single_selectedMissingOrDisabled_fallsBackToFirstEnabled() {
        // selectedHostId 不存在 / 指向停用 host（pixivel）/ 为 null → 第一个 enabled（pixiv-re）
        assertEquals("https://i.pixiv.re" + OFFICIAL_PATH,
                newConfig(config(true, "single", "nope", BUILT_IN_HOSTS, null, null)).resolve(OFFICIAL));
        assertEquals("https://i.pixiv.re" + OFFICIAL_PATH,
                newConfig(config(true, "single", "pixivel", BUILT_IN_HOSTS, null, null)).resolve(OFFICIAL));
        assertEquals("https://i.pixiv.re" + OFFICIAL_PATH,
                newConfig(config(true, "single", null, BUILT_IN_HOSTS, null, null)).resolve(OFFICIAL));
    }

    @Test
    public void resolve_single_mirrorPathIgnored_officialPathKept() {
        // oracle = transformUrl host 替换分支：仅取 baseUrl 的 protocol/hostname/port，
        // 镜像自身 path（/v1/generate）不参与改写，officialUrl path 保留
        String pixivelOnly = host("pixivel", "https://api.pixiv.cat/v1/generate", true, 50);
        ImageHostConfig c = newConfig(config(true, "single", "pixivel", pixivelOnly, null, null));
        assertEquals("https://api.pixiv.cat" + OFFICIAL_PATH, c.resolve(OFFICIAL));
    }

    // ── host 替换的逐字节保留与 port 语义（oracle = transformUrl） ──

    @Test
    public void resolve_hostReplace_keepsPathQueryByteForByte_takesMirrorProtocolPort() {
        ImageHostConfig c = newConfig(config(true, "single", "m",
                host("m", "http://m.example:8443", true, 1), null, null));
        String official = "https://i.pximg.net/a/b.jpg?size=medium&x=%20s";
        assertEquals("http://m.example:8443/a/b.jpg?size=medium&x=%20s", c.resolve(official));
    }

    @Test
    public void resolve_hostReplace_mirrorWithoutPort_dropsOfficialPort() {
        // JS: source.port = proxy.port（proxy 无显式端口 → 置空）→ official 显式端口被移除
        ImageHostConfig c = newConfig(config(true, "single", "m",
                host("m", "https://m.example", true, 1), null, null));
        assertEquals("https://m.example/a.jpg", c.resolve("https://i.pximg.net:8443/a.jpg"));
    }

    @Test
    public void resolve_pathTemplate_substitutesPathWithoutLeadingSlash() {
        // oracle = transformUrl {path} 分支：baseUrl.replace("{path}", pathname.slice(1))
        ImageHostConfig c = newConfig(config(true, "single", "m",
                host("m", "https://m.example/{path}", true, 1), null, null));
        assertEquals("https://m.example/" + OFFICIAL_PATH.substring(1), c.resolve(OFFICIAL));
    }

    @Test
    public void resolve_pathTemplate_queryNotSubstituted() {
        // JS {path} 分支只替换 pathname（不含 query）——与 host 替换分支（保留 query）语义不同
        ImageHostConfig c = newConfig(config(true, "single", "m",
                host("m", "https://m.example/{path}", true, 1), null, null));
        assertEquals("https://m.example/a/b.jpg", c.resolve("https://i.pximg.net/a/b.jpg?q=1&r=2"));
    }

    // ── weighted 模式（oracle = selectWeightedHost + getEffectiveImageUrl 末行兜底） ──

    @Test
    public void resolve_weighted_fixedRandom_boundaryDerivation() {
        // 手推（oracle = selectWeightedHost：roll = u*total；逐个减 weight；roll<=0 选中；末尾兜底）
        // hosts: mirror-a(weight 70) → mirror-b(weight 30)，total=100
        // u=0.0       → roll=0      → a: -70<=0   → mirror-a（roll<=0 取先者）
        // u=0.7       → roll=70     → a: 0<=0     → mirror-a（恰在累计边界仍先者）
        // u=0.7000001 → roll=70.00001 → a: 0.00001>0 → b: -29.99999<=0 → mirror-b
        // u=0.999     → roll=99.9   → a: 29.9>0   → b: -0.1<=0  → mirror-b
        assertEquals("https://mirror-a.example" + OFFICIAL_PATH, resolveWeighted(0.0));
        assertEquals("https://mirror-a.example" + OFFICIAL_PATH, resolveWeighted(0.7));
        assertEquals("https://mirror-b.example" + OFFICIAL_PATH, resolveWeighted(0.7000001));
        assertEquals("https://mirror-b.example" + OFFICIAL_PATH, resolveWeighted(0.999));
    }

    private String resolveWeighted(double u) {
        ImageHostConfig c = newConfig(
                config(true, "weighted", null, WEIGHTED_70_30, null, null),
                new MutableClock(), fixedRandom(u), new RecordingProbe());
        return c.resolve(OFFICIAL);
    }

    @Test
    public void resolve_weighted_statisticalDistribution_withinTolerance() {
        // 70/30 权重 1000 次抽样：各占 ±10pp 容差带（70 侧 [600,800]，30 侧 [200,400]）。
        // 固定种子 → 完全确定，无 flake；容差 ≈ ±7σ（σ≈1.4pp），均匀 PRNG 必然落入。
        ImageHostConfig c = newConfig(
                config(true, "weighted", null, WEIGHTED_70_30, null, null),
                new MutableClock(), new Random(20260906L), new RecordingProbe());
        int aCount = 0;
        for (int i = 0; i < 1000; i++) {
            String url = c.resolve(OFFICIAL);
            if (url.startsWith("https://mirror-a.example")) {
                aCount++;
            }
        }
        assertTrue("weight 70 侧应占 60%-80%，实际 " + aCount, aCount >= 600 && aCount <= 800);
        int bCount = 1000 - aCount;
        assertTrue("weight 30 侧应占 20%-40%，实际 " + bCount, bCount >= 200 && bCount <= 400);
    }

    @Test
    public void resolve_weighted_noPositiveWeight_fallsBackToFirstUsable() {
        // oracle = getEffectiveImageUrl 末行：selectWeightedHost 返回 undefined 时回退 enabled[0]。
        // JS migrate 对负权重保持原值（Number(-5)||1 → -5，真值），故 weight>0 过滤后为空是可达状态。
        String negativeWeight = host("solo", "https://m.example", true, -5);
        ImageHostConfig c = newConfig(config(true, "weighted", null, negativeWeight, null, null));
        assertEquals("https://m.example" + OFFICIAL_PATH, c.resolve(OFFICIAL));
    }

    // ── race 模式：显式降级 weighted（native 从未实现 race，ADR-0143 D3） ──

    @Test
    public void resolve_race_degradesToWeighted() {
        // 与 weighted 同一推导：u=0.999 → roll=99.9 → mirror-b
        ImageHostConfig c = newConfig(
                config(true, "race", null, WEIGHTED_70_30, null, null),
                new MutableClock(), fixedRandom(0.999), new RecordingProbe());
        assertEquals("https://mirror-b.example" + OFFICIAL_PATH, c.resolve(OFFICIAL));
    }

    // ── fastest-ip 模式（TTL 判定 oracle = getFastestHost） ──

    @Test
    public void resolve_fastestIp_seededFresh_usesFastestHost_withoutProbing() {
        // 持久化种子（JS 设置页探测写入）未过期 → 直接用最快 host，不触发探测
        RecordingProbe probe = new RecordingProbe();
        ImageHostConfig c = newConfig(
                config(true, "fastest-ip", null, BUILT_IN_HOSTS, "pixiv-nl", NOW + 20_000L),
                new MutableClock(), fixedRandom(0.5), probe);
        assertEquals("https://i.pixiv.nl" + OFFICIAL_PATH, c.resolve(OFFICIAL));
        assertEquals(0, probe.urls.size());
    }

    @Test
    public void resolve_fastestIp_seededExpired_fallsBackToWeighted_thenProbeCacheTakesOver() {
        // 种子过期 → 立即回退 weighted（u=0.0 → roll=0 → pixiv-re）+ 惰性探测单飞。
        // 探测延迟：pixiv.re=200ms、pixiv.nl=50ms → 最小者 pixiv-nl 缓存 30s →
        // 第二次 resolve（raw 未变，复用已解析配置）改用探针缓存，不再探测。
        RecordingProbe probe = new RecordingProbe();
        probe.latencyByUrlContains.put("i.pixiv.re", 200L);
        probe.latencyByUrlContains.put("i.pixiv.nl", 50L);
        ImageHostConfig c = newConfig(
                config(true, "fastest-ip", null, BUILT_IN_HOSTS, "pixiv-nl", NOW - 1L),
                new MutableClock(), fixedRandom(0.0), probe);
        assertEquals("https://i.pixiv.re" + OFFICIAL_PATH, c.resolve(OFFICIAL));
        assertEquals("https://i.pixiv.nl" + OFFICIAL_PATH, c.resolve(OFFICIAL));
        assertEquals("两次 resolve 只允许一轮探测", PROBE_CALLS_PER_ROUND, probe.urls.size());
    }

    @Test
    public void resolve_fastestIp_seededDisabledHost_fallsBackToWeighted() {
        // 命中还需该 host 仍 enabled（ADR-0143 D3）——种子指向停用的 pixivel → weighted 回退 + 探测
        RecordingProbe probe = new RecordingProbe();
        ImageHostConfig c = newConfig(
                config(true, "fastest-ip", null, BUILT_IN_HOSTS, "pixivel", NOW + 20_000L),
                new MutableClock(), fixedRandom(0.0), probe);
        assertEquals("https://i.pixiv.re" + OFFICIAL_PATH, c.resolve(OFFICIAL));
        assertEquals(PROBE_CALLS_PER_ROUND, probe.urls.size());
    }

    @Test
    public void resolve_fastestIp_seededNullExpiry_neverExpires() {
        // oracle = getFastestHost：fastestHostExpiresAt 为 null（falsy）→ 不过期判定不触发 → 恒有效
        MutableClock clock = new MutableClock();
        ImageHostConfig c = newConfig(
                config(true, "fastest-ip", null, BUILT_IN_HOSTS, "pixiv-nl", null),
                clock, fixedRandom(0.0), new RecordingProbe());
        assertEquals("https://i.pixiv.nl" + OFFICIAL_PATH, c.resolve(OFFICIAL));
        clock.now = NOW + 999_999L;
        assertEquals("https://i.pixiv.nl" + OFFICIAL_PATH, c.resolve(OFFICIAL));
    }

    @Test
    public void probe_usesSampleUrlTransformedPerHost() {
        // oracle = buildProbeSampleUrl（固定官方 sample 图）+ transformUrl 改写；逐可用 host 依次探测
        RecordingProbe probe = new RecordingProbe();
        ImageHostConfig c = newConfig(
                config(true, "fastest-ip", null, BUILT_IN_HOSTS, null, null),
                new MutableClock(), fixedRandom(0.0), probe);
        assertEquals("https://i.pixiv.re" + OFFICIAL_PATH, c.resolve(OFFICIAL)); // 回退 weighted（u=0.0 → pixiv-re）
        assertEquals(2, probe.urls.size());
        assertEquals("https://i.pixiv.re/c/360x360_70/img-master/img/2020/01/01/00/00/00/0_p0_master1200.jpg",
                probe.urls.get(0));
        assertEquals("https://i.pixiv.nl/c/360x360_70/img-master/img/2020/01/01/00/00/00/0_p0_master1200.jpg",
                probe.urls.get(1));
    }

    @Test
    public void resolve_fastestIp_concurrent_singleFlight_probeOnce() throws Exception {
        // 10 线程同时 resolve（种子过期）：单飞（volatile 快路径 + synchronized 双检 + 缓存双检）
        // 保证探测恰好一次；所有 resolve 仍各产出可用镜像 URL（weighted/探针缓存均选 pixiv-re：
        // u=0.5 → roll=100 → pixiv-re 边界 0<=0；探针等延迟 tie 也取先者 pixiv-re）。
        final RecordingProbe probe = new RecordingProbe();
        final ImageHostConfig c = newConfig(
                config(true, "fastest-ip", null, BUILT_IN_HOSTS, "pixiv-nl", NOW - 1L),
                new MutableClock(), fixedRandom(0.5), probe);
        final int threads = 10;
        final String[] results = new String[threads];
        final CountDownLatch start = new CountDownLatch(1);
        Thread[] workers = new Thread[threads];
        for (int i = 0; i < threads; i++) {
            final int idx = i;
            workers[i] = new Thread(() -> {
                try {
                    start.await();
                    results[idx] = c.resolve(OFFICIAL);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
            });
            workers[i].start();
        }
        start.countDown();
        for (Thread t : workers) {
            t.join(5000);
        }
        for (String r : results) {
            assertEquals("https://i.pixiv.re" + OFFICIAL_PATH, r);
        }
        assertEquals("并发 resolve 只允许一轮探测", PROBE_CALLS_PER_ROUND, probe.urls.size());
    }

    // ── 配置复用（raw equals）与重解析 ──────────────────────

    @Test
    public void resolve_unchangedRaw_reusesParsedConfig() {
        // raw 每次读取（calls==resolve 次数），但 equals 相同 → 复用已解析配置：
        // 探测缓存不被过期种子重置（否则第二次 resolve 会再触发一轮探测，调用数翻倍为 4）
        RecordingProbe probe = new RecordingProbe();
        probe.latencyByUrlContains.put("i.pixiv.re", 200L);
        CountingRaw raw = new CountingRaw(config(true, "fastest-ip", null, BUILT_IN_HOSTS, "pixiv-nl", NOW - 1L));
        ImageHostConfig c = new ImageHostConfig(raw, new MutableClock(), fixedRandom(0.0), probe, Runnable::run);
        c.resolve(OFFICIAL);
        c.resolve(OFFICIAL);
        assertEquals(2, raw.calls);
        assertEquals("两次 resolve 共一轮探测", PROBE_CALLS_PER_ROUND, probe.urls.size());
    }

    @Test
    public void resolve_changedRaw_reparsesConfig() {
        CountingRaw raw = new CountingRaw(config(true, "single", "pixiv-re", BUILT_IN_HOSTS, null, null));
        ImageHostConfig c = new ImageHostConfig(raw, new MutableClock(), fixedRandom(0.5),
                new RecordingProbe(), Runnable::run);
        assertEquals("https://i.pixiv.re" + OFFICIAL_PATH, c.resolve(OFFICIAL));
        raw.raw = config(true, "single", "pixiv-nl", BUILT_IN_HOSTS, null, null);
        assertEquals("raw 变化（equals 不等）→ 重解析生效", "https://i.pixiv.nl" + OFFICIAL_PATH,
                c.resolve(OFFICIAL));
    }

    // ── hosts 条目容错（ticket：缺字段跳过非法条目） ─────────

    @Test
    public void resolve_malformedHostEntries_skipped() {
        String malformed = "\"just-a-string\","
                + "{\"id\":\"h2\",\"name\":\"no-baseUrl\",\"enabled\":true,\"weight\":1},"
                + "{\"id\":\"\",\"baseUrl\":\"https://x.example\",\"enabled\":true,\"weight\":1},"
                + host("good", "https://m.example", true, 10);
        ImageHostConfig c = newConfig(config(true, "single", null, malformed, null, null));
        assertEquals("https://m.example" + OFFICIAL_PATH, c.resolve(OFFICIAL));
    }

    // ── 防自环：官方域 host 跳过（ADR-0143 D4，oracle = validateHostInput） ──

    @Test
    public void resolve_officialDomainHost_skipped_fallsBackToUsable() {
        // 选中的 host 为官方域（i.pximg.net）→ 跳过 → 回退第一个可用
        String hosts = host("self", "https://i.pximg.net", true, 100) + ","
                + host("good", "https://m.example", true, 100);
        ImageHostConfig c = newConfig(config(true, "single", "self", hosts, null, null));
        assertEquals("https://m.example" + OFFICIAL_PATH, c.resolve(OFFICIAL));
    }

    @Test
    public void resolve_allOfficialDomainHosts_officialUrlReturned() {
        String hosts = host("self", "https://i.pximg.net", true, 100) + ","
                + host("self2", "https://s.pximg.net", true, 100);
        ImageHostConfig c = newConfig(config(true, "weighted", null, hosts, null, null));
        assertEquals(OFFICIAL, c.resolve(OFFICIAL));
    }

    @Test
    public void resolve_officialDomainSuffixPrecision_notOvermatched() {
        // 后缀匹配精度：notpximg.net / pixiv.net.evil.com 不是官方域（.pximg.net/.pixiv.net 子域判定），
        // 必须照常可用——若误判跳过，resolve 将回退/透传而非返回该镜像
        String fake = host("fake", "https://notpximg.net", true, 10);
        assertEquals("https://notpximg.net" + OFFICIAL_PATH,
                newConfig(config(true, "single", "fake", fake, null, null)).resolve(OFFICIAL));
        String evil = host("evil", "https://pixiv.net.evil.com", true, 10);
        assertEquals("https://pixiv.net.evil.com" + OFFICIAL_PATH,
                newConfig(config(true, "single", "evil", evil, null, null)).resolve(OFFICIAL));
    }

}
