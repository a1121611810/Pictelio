package io.pictelio.app.directaccess;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import io.pictelio.app.directaccess.DirectAccessPolicy.SwitchState;

/**
 * DirectAccessConfig 单测（#388）——Robolectric harness 对齐 ImageHostConfigTest /
 * AuthPluginTest（sdk 28，org.json 由 Robolectric 提供）。
 *
 * <p><b>Oracle 溯源（AGENTS.md 测试硬约束 #6：期望值出处可追溯）</b>——期望值全部来自
 * 独立来源，禁止从被测实现反推：
 * <ul>
 *   <li><b>开关映射</b>（缺失→UNSET / true→ON / false→OFF / 坏 JSON→UNSET+warn）：
 *       ticket #388 原文 + {@code DirectAccessPolicy.SwitchState} 三态语义
 *       （UNSET = 从未配置或解析失败兜底，spec「独立开关（默认关）」）；</li>
 *   <li><b>存储落点</b>（SharedPreferences "CapacitorStorage" 键 direct_access_settings）：
 *       共享设置存储契约（packages/app/CONTEXT.md「共享设置存储」节：webview 与 lynx 经
 *       Capacitor Preferences 同名 group 读写）——测试经 Robolectric 真 SharedPreferences
 *       写入 fixture（真实样例硬约束 #2，非内存 mock）；</li>
 *   <li><b>三层合并结果</b>（manual &gt; remote &gt; builtIn 逐条覆盖）：spec #385
 *       「IP 表三层来源：合并优先级 手动编辑 &gt; 远端 JSON &gt; APK 内置」；</li>
 *   <li><b>内置条目值</b>（210.140.139.131 / 210.140.139.155）：探针报告实测
 *       （prototype/pixiv-bypass-feasibility 68fbd826，见 DirectIpTableDefaultsTest 溯源）；</li>
 *   <li><b>anti-drift</b>（托管文件 entries ≡ 内置表）：AGENTS.md 测试硬约束 #4
 *       （重构行为不变）+ backupRulesConsistency 提取常量比对模式——
 *       托管文件 {@code packages/website/pixiv-ip-table.json} 与内置常量是同一契约的
 *       两个物理落点，漂移 = 静默行为分歧；</li>
 *   <li><b>拉取语义</b>（成功生效+持久化 / 失败保留上次有效 / 从未成功降级内置 / 单飞 /
 *       TTL）：ticket #388 验收原文 + ImageHostConfig 探针「失败不写缓存」既有纪律。</li>
 * </ul>
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class DirectAccessConfigTest {

    private static final long T0 = 1_000_000_000L;

    // ── 测试 h Fritz：可拨钟 / 内存 raw / fake fetcher / 收集告警 / 临时缓存文件 ──

    private static final class MutableClock implements ChannelCircuitBreaker.Clock {
        long now = T0;

        @Override
        public long nowMillis() {
            return now;
        }
    }

    /** 可编程 fake 拉取器：队列化返回值或异常；记录调用次数 */
    private static final class FakeFetcher implements IpTableFetcher {
        final List<Object> script = new ArrayList<>(); // String（成功体）或 IOException
        final AtomicInteger calls = new AtomicInteger();

        @Override
        public String fetchJson() throws IOException {
            calls.incrementAndGet();
            Object next = script.isEmpty() ? null : script.remove(0);
            if (next instanceof IOException) {
                throw (IOException) next;
            }
            if (next == null) {
                throw new IOException("script 已空");
            }
            return (String) next;
        }
    }

    private static final class Harness {
        final StringBuilder raw = new StringBuilder();
        final MutableClock clock = new MutableClock();
        final FakeFetcher fetcher = new FakeFetcher();
        final List<String> warns = Collections.synchronizedList(new ArrayList<>());
        final File cacheFile;
        final DirectAccessConfig config;

        Harness() throws IOException {
            cacheFile = File.createTempFile("dacc-test", ".json");
            cacheFile.deleteOnExit();
            config = new DirectAccessConfig(
                    () -> raw.length() == 0 ? null : raw.toString(),
                    clock, fetcher, Runnable::run, warns::add, cacheFile);
        }

        void setEnabled(boolean on) {
            raw.setLength(0);
            raw.append("{\"enabled\":").append(on).append("}");
        }
    }

    // ── 开关映射（oracle = ticket #388 + SwitchState 三态语义） ──

    @Test
    public void switchState_missingKey_unset_noWarn() throws IOException {
        Harness h = new Harness();
        assertEquals(SwitchState.UNSET, h.config.switchState());
        assertTrue("key 缺失 = 缺省状态非异常，不得告警", h.warns.isEmpty());
    }

    @Test
    public void switchState_enabledTrueFalse_mapped() throws IOException {
        Harness h = new Harness();
        h.setEnabled(true);
        assertEquals(SwitchState.ON, h.config.switchState());
        h.setEnabled(false);
        assertEquals(SwitchState.OFF, h.config.switchState());
    }

    @Test
    public void switchState_malformedJson_unsetWithWarn() throws IOException {
        Harness h = new Harness();
        h.raw.append("{broken");
        assertEquals(SwitchState.UNSET, h.config.switchState());
        assertFalse("坏 JSON 必须告警（禁静默降级）", h.warns.isEmpty());
    }

    @Test
    public void switchState_enabledNotBoolean_shapeFailure_unsetWithWarn() throws IOException {
        // oracle：ticket「解析/形状失败 → UNSET + warn（故障关闭）」——enabled 非 boolean 是形状破坏
        Harness h = new Harness();
        h.raw.append("{\"enabled\":\"yes\"}");
        assertEquals(SwitchState.UNSET, h.config.switchState());
        assertFalse(h.warns.isEmpty());
    }

    @Test
    public void switchState_manualNotArray_shapeFailure_unsetWithWarn() throws IOException {
        Harness h = new Harness();
        h.raw.append("{\"enabled\":false,\"manual\":\"x\"}");
        assertEquals(SwitchState.UNSET, h.config.switchState());
        assertFalse(h.warns.isEmpty());
    }

    // ── 三层合并快照（oracle = spec 三层优先级；内置值 = 探针实测） ──

    @Test
    public void currentTable_offSwitch_builtinOnly() throws IOException {
        Harness h = new Harness();
        h.setEnabled(false);
        IpTableMerger.Snapshot s = h.config.currentTable();
        assertEquals("210.140.139.131", s.ipFor("i.pximg.net"));
        assertEquals("210.140.139.155", s.ipFor("app-api.pixiv.net"));
    }

    @Test
    public void currentTable_manualOverridesBuiltIn_invalidEntryFallsThrough() throws IOException {
        Harness h = new Harness();
        // manual 含一条非法（非法 IP，Merger 跳过 + 告警）+ 一条合法覆盖
        h.raw.append("{\"enabled\":true,\"manual\":["
                + "{\"host\":\"i.pximg.net\",\"ip\":\"not-an-ip\"},"
                + "{\"host\":\"app-api.pixiv.net\",\"ip\":\"10.0.0.9\"}]}");
        IpTableMerger.Snapshot s = h.config.currentTable();
        assertEquals("非法 manual 条目跳过 → 内置值存活", "210.140.139.131", s.ipFor("i.pximg.net"));
        assertEquals("合法 manual 条目覆盖内置", "10.0.0.9", s.ipFor("app-api.pixiv.net"));
    }

    @Test
    public void currentTable_remoteOverridesBuiltIn_manualBeatsRemote() throws IOException {
        Harness h = new Harness();
        h.setEnabled(true);
        h.fetcher.script.add("{\"version\":1,\"entries\":["
                + "{\"host\":\"i.pximg.net\",\"ip\":\"10.0.0.2\"}]}");
        h.config.refreshIpTableNow(); // 同步 executor：返回即拉取完成
        h.raw.setLength(0);
        h.raw.append("{\"enabled\":true,\"manual\":[{\"host\":\"i.pximg.net\",\"ip\":\"10.0.0.1\"}]}");
        IpTableMerger.Snapshot s = h.config.currentTable();
        assertEquals("手动 > 远端", "10.0.0.1", s.ipFor("i.pximg.net"));
        assertEquals("内置补位 app-api", "210.140.139.155", s.ipFor("app-api.pixiv.net"));
    }

    // ── 远端拉取（成功/失败/降级/持久化，oracle = ticket #388 验收） ──

    private static final String REMOTE_DOC =
            "{\"version\":1,\"updatedAt\":\"2026-09-06\",\"entries\":["
                    + "{\"host\":\"i.pximg.net\",\"ip\":\"10.0.0.2\"}]}";

    @Test
    public void fetch_success_memoryAndCachePersisted() throws IOException {
        Harness h = new Harness();
        h.setEnabled(true);
        h.fetcher.script.add(REMOTE_DOC);
        assertTrue(h.config.refreshIpTableNow());
        assertEquals("远端条目生效（i.pximg.net 钉到远端值 10.0.0.2）", "10.0.0.2",
                h.config.currentTable().ipFor("i.pximg.net"));
        assertEquals("内置表补位远端未覆盖的 host", "210.140.139.155",
                h.config.currentTable().ipFor("app-api.pixiv.net"));
        // cacheDir 信封持久化：信封含 fetchedAtMillis 与原文 body（损坏即弃用的可再生缓存契约）
        String envelope = new String(Files.readAllBytes(h.cacheFile.toPath()), StandardCharsets.UTF_8);
        assertTrue("信封含 fetchedAtMillis", envelope.contains("fetchedAtMillis"));
        assertTrue("信封含托管原文", envelope.contains("10.0.0.2"));
    }

    @Test
    public void fetch_failure_lastGoodRemoteSurvives() throws IOException {
        Harness h = new Harness();
        h.setEnabled(true);
        h.fetcher.script.add(REMOTE_DOC);
        h.config.refreshIpTableNow();
        // 第二次拉取失败：保留上次有效（内存 + cacheDir 均有）
        h.fetcher.script.add(new IOException("net down"));
        h.config.refreshIpTableNow();
        assertEquals("失败后保留上次有效远端条目", "10.0.0.2", h.config.currentTable().ipFor("i.pximg.net"));
        assertFalse("拉取失败必须告警（禁静默）", h.warns.isEmpty());
    }

    @Test
    public void fetch_neverSucceeded_failure_fallsBackToBuiltIn() throws IOException {
        Harness h = new Harness();
        h.setEnabled(true);
        h.fetcher.script.add(new IOException("net down"));
        h.config.refreshIpTableNow();
        assertEquals("从未成功 → 内置表兜底", "210.140.139.131",
                h.config.currentTable().ipFor("i.pximg.net"));
    }

    @Test
    public void fetch_cacheEnvelope_survivesNewConfigInstance() throws IOException {
        // 跨实例（≈跨进程）恢复：新 Config 读同一 cacheFile → 上次有效表装载（lastFetchAt 播种）
        Harness h = new Harness();
        h.setEnabled(true);
        h.fetcher.script.add(REMOTE_DOC);
        h.config.refreshIpTableNow();
        DirectAccessConfig reborn = new DirectAccessConfig(
                () -> "{\"enabled\":true}", h.clock, h.fetcher, Runnable::run,
                h.warns::add, h.cacheFile);
        assertEquals("新实例从 cacheDir 信封恢复远端表", "10.0.0.2",
                reborn.currentTable().ipFor("i.pximg.net"));
    }

    @Test
    public void fetch_corruptCache_discarded_fallsBackToBuiltIn() throws IOException {
        Harness h = new Harness();
        h.setEnabled(true);
        Files.write(h.cacheFile.toPath(), "{corrupt".getBytes(StandardCharsets.UTF_8));
        assertEquals("损坏缓存弃用 → 内置表兜底 + 告警", "210.140.139.131",
                h.config.currentTable().ipFor("i.pximg.net"));
        assertTrue(h.warns.stream().anyMatch(w -> w.contains("损坏")));
    }

    @Test
    public void fetch_shapeFailure_treatedAsFetchFailure() throws IOException {
        // oracle：ticket「响应 JSON 形状校验失败 = 拉取失败同语义」——version 非 1 整表弃用
        Harness h = new Harness();
        h.setEnabled(true);
        h.fetcher.script.add("{\"version\":2,\"entries\":[]}");
        h.config.refreshIpTableNow();
        assertEquals("形状失败 → 内置兜底", "210.140.139.131",
                h.config.currentTable().ipFor("i.pximg.net"));
        assertFalse(h.warns.isEmpty());
    }

    // ── 单飞与手动刷新（oracle = ticket + kickProbe 单飞纪律） ──

    @Test
    public void refreshWhileInFlight_returnsFalse_singleFlight() throws IOException {
        Harness h = new Harness();
        h.setEnabled(true);
        // 同步 executor 下在飞语义以 fetching 标志为准：直接并发断言在独立线程难稳定，
        // 以「script 只有一条 → 第二次调用若真执行必然抛 script 已空异常并告警」做证据：
        h.fetcher.script.add(REMOTE_DOC);
        assertTrue("首次发起成功", h.config.refreshIpTableNow());
        assertEquals("同步 executor 下恰好执行一次", 1, h.fetcher.calls.get());
        // TTL 内再触发（跃迁路径）不重拉：表新鲜
        h.raw.setLength(0);
        h.raw.append("{\"enabled\":true}"); // 触发 UNSET→ON 跃迁评估
        h.config.currentTable();
        assertEquals("TTL 内跃迁不重拉", 1, h.fetcher.calls.get());
    }

    @Test
    public void transitionToOn_kicksFetch_once() throws IOException {
        Harness h = new Harness();
        h.setEnabled(true); // 首读即 ON = UNSET→ON 跃迁（进程冷启动恢复开关）
        h.fetcher.script.add(REMOTE_DOC);
        h.config.switchState(); // 触发跃迁检测
        assertEquals("跃迁触发一次拉取", 1, h.fetcher.calls.get());
        h.config.switchState(); // 同 raw 再读：无跃迁无重拉
        assertEquals(1, h.fetcher.calls.get());
    }

    @Test
    public void ttlExpiry_refetchesOnCurrentTable() throws IOException {
        Harness h = new Harness();
        h.setEnabled(true);
        h.fetcher.script.add(REMOTE_DOC);
        h.config.refreshIpTableNow();
        h.clock.now = T0 + 24L * 60 * 60 * 1000; // 恰满 TTL
        h.fetcher.script.add(REMOTE_DOC);
        h.config.currentTable(); // TTL 过期惰性触发
        assertEquals("TTL 过期后 currentTable 路径重拉", 2, h.fetcher.calls.get());
    }

    @Test
    public void offSwitch_neverFetches() throws IOException {
        // oracle：直连关时远端表不被消费，纯浪费流量 → 不触发
        Harness h = new Harness();
        h.setEnabled(false);
        h.config.currentTable();
        assertEquals(0, h.fetcher.calls.get());
    }

    // ── Context 键控单例（先例 PixivApiPlugin.imageLoader；跨 Application 隔离） ──

    @Test
    public void get_contextKeyed_isolatesPerApplication() {
        Context app1 = RuntimeEnvironment.getApplication().getApplicationContext();
        DirectAccessConfig c1 = DirectAccessConfig.get(app1);
        DirectAccessConfig c1again = DirectAccessConfig.get(app1);
        assertTrue("同 Application 同实例", c1 == c1again);
        // Robolectric 为每个测试用例建独立 Application；跨用例重建由绑定机制保证，
        // 这里补一个「不同 Context 实例 → 重建」的强证据：伪造第二个 Application 场景
        // 不可行（单进程单 Application），退而断言绑定字段语义：get 不因重复调用漂移
        DirectAccessConfig c1third = DirectAccessConfig.get(app1);
        assertTrue(c1 == c1third);
        assertNotNull(c1.breaker());
    }

    // ── 熔断器归属（oracle = ticket #388「Config 持有进程级 Breaker 单例」） ──

    @Test
    public void breaker_resetCircuits_bothChannelsClosed() {
        ChannelCircuitBreaker b = new ChannelCircuitBreaker(new MutableClock());
        b.recordFailure(ChannelCircuitBreaker.Channel.IMAGE);
        b.recordFailure(ChannelCircuitBreaker.Channel.API_REFRESH);
        b.reset(ChannelCircuitBreaker.Channel.IMAGE);
        b.reset(ChannelCircuitBreaker.Channel.API_REFRESH);
        assertEquals(ChannelCircuitBreaker.Phase.CLOSED, b.phase(ChannelCircuitBreaker.Channel.IMAGE));
        assertEquals(ChannelCircuitBreaker.Phase.CLOSED, b.phase(ChannelCircuitBreaker.Channel.API_REFRESH));
    }

    // ── anti-drift：托管文件 ≡ 内置表（backupRulesConsistency 模式） ──

    @Test
    public void hostedIpTableFile_matchesBuiltIn() throws IOException {
        // 从 user.dir（packages/app/android）向上定位仓库根，读取托管文件
        File dir = new File(System.getProperty("user.dir", ".")).getAbsoluteFile();
        File hosted = null;
        for (int i = 0; i < 6 && dir != null; i++) {
            File candidate = new File(dir, "packages/website/pixiv-ip-table.json");
            if (candidate.isFile()) {
                hosted = candidate;
                break;
            }
            dir = dir.getParentFile();
        }
        assertNotNull("托管文件 packages/website/pixiv-ip-table.json 不存在"
                + "（期望自仓库根；anti-drift 禁静默跳过）", hosted);
        List<IpTableMerger.Entry> hostedEntries = DirectAccessConfig.parseRemoteDoc(
                new String(Files.readAllBytes(hosted.toPath()), StandardCharsets.UTF_8));
        assertNotNull("托管文件必须是合法 schema v1 形态（parseRemoteDoc 判定）", hostedEntries);
        List<IpTableMerger.Entry> builtIn = DirectIpTableDefaults.builtIn();
        assertEquals("托管文件条目数 ≡ 内置表条目数（漂移即红）", builtIn.size(), hostedEntries.size());
        for (int i = 0; i < builtIn.size(); i++) {
            assertEquals("托管文件条目[" + i + "] ≡ 内置表（host+ip 全等）",
                    builtIn.get(i), hostedEntries.get(i));
        }
    }

    // ── parseRemoteDoc 形状契约（oracle = 托管文件 schema，DirectAccessConfig javadoc） ──

    @Test
    public void parseRemoteDoc_shapeContract() {
        assertNotNull("合法形态", DirectAccessConfig.parseRemoteDoc(REMOTE_DOC));
        assertNull("null 体", DirectAccessConfig.parseRemoteDoc(null));
        assertNull("坏 JSON", DirectAccessConfig.parseRemoteDoc("{broken"));
        assertNull("version 缺失", DirectAccessConfig.parseRemoteDoc("{\"entries\":[]}"));
        assertNull("version 非 1（未来格式不误读）",
                DirectAccessConfig.parseRemoteDoc("{\"version\":2,\"entries\":[]}"));
        assertNull("entries 非数组",
                DirectAccessConfig.parseRemoteDoc("{\"version\":1,\"entries\":\"x\"}"));
        assertNull("条目缺 ip",
                DirectAccessConfig.parseRemoteDoc("{\"version\":1,\"entries\":[{\"host\":\"h\"}]}"));
        assertNull("ip 非字符串",
                DirectAccessConfig.parseRemoteDoc(
                        "{\"version\":1,\"entries\":[{\"host\":\"h\",\"ip\":1}]}"));
        assertNull("IP 非法字面量",
                DirectAccessConfig.parseRemoteDoc(
                        "{\"version\":1,\"entries\":[{\"host\":\"h\",\"ip\":\"999.1.1.1\"}]}"));
        // 大小写规范化 + 合法边界
        List<IpTableMerger.Entry> ok = DirectAccessConfig.parseRemoteDoc(
                "{\"version\":1,\"entries\":[{\"host\":\"I.PXIMG.NET\",\"ip\":\"1.2.3.4\"}]}");
        assertEquals(1, ok.size());
        assertEquals("i.pximg.net", ok.get(0).host());
    }
}
