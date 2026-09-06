package io.pictelio.app.directaccess;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * IpTableMerger 单测（#387）。
 *
 * <p><b>Oracle 溯源（spec #376 测试硬约束 #6）</b>——期望值全部来自独立来源：
 * <ul>
 *   <li>三层优先级 手动 &gt; 远端 &gt; 内置、逐条覆盖（非整层替换）、缺层跳过：
 *       spec #385 实施决策「IP 表三层来源：合并优先级 手动编辑 &gt; 远端 JSON &gt; APK 内置；
 *       按域名分条目」+ ticket #387 验收标准；</li>
 *   <li>非法条目判定样例（空 host / 空 IP / 非法 IP 字面量）：ticket #387 枚举；
 *       前导零拒绝与 4 段约束：IPv4 点分十进制的规范定义（RFC 791 形态 + 解析歧义防御，
 *       InetAddress 系解析器对 {@code 01} 形态存在八进制歧义——钉定表禁歧义）；</li>
 *   <li>非法条目跳过 + 告警（禁静默）：AGENTS.md 测试硬约束 #3（降级路径必须可见），
 *       告警经注入 warn sink 收集断言；</li>
 *   <li>内置层真实条目：DirectIpTableDefaults（探针实测值，见其测试文件溯源）。</li>
 * </ul>
 */
public class IpTableMergerTest {

    /** 收集告警的 sink（禁静默降级的可见性断言面） */
    private static List<String> warns() {
        return Collections.synchronizedList(new ArrayList<String>());
    }

    private static IpTableMerger merger(List<String> warns) {
        return new IpTableMerger(warns::add);
    }

    private static IpTableMerger.Entry e(String host, String ip) {
        return new IpTableMerger.Entry(host, ip);
    }

    // ── 优先级：逐条覆盖 ─────────────────────────────────────

    @Test
    public void merge_precedence_manualOverRemoteOverBuiltIn_sameHost() {
        // 同一 host 三层各给不同 IP → 手动胜出（spec：手动编辑是最后兜底，优先级最高）
        IpTableMerger.Snapshot s = merger(warns()).merge(
                Collections.singletonList(e("i.pximg.net", "10.0.0.1")),
                Collections.singletonList(e("i.pximg.net", "10.0.0.2")),
                Collections.singletonList(e("i.pximg.net", "10.0.0.3")));
        assertEquals("10.0.0.1", s.ipFor("i.pximg.net"));
    }

    @Test
    public void merge_perEntryOverride_lowerLayersSurviveForOtherHosts() {
        // 逐条覆盖语义：手动只改 oauth 一条，i.pximg.net 由远端决定，app-api 由内置决定
        // （oracle = spec「按域名分条目」——禁止整层替换语义）
        IpTableMerger.Snapshot s = merger(warns()).merge(
                Collections.singletonList(e("oauth.secure.pixiv.net", "10.0.0.9")),
                Arrays.asList(
                        e("i.pximg.net", "210.140.139.131"),
                        e("oauth.secure.pixiv.net", "10.0.0.8")),
                DirectIpTableDefaults.builtIn());
        assertEquals("手动覆盖 oauth", "10.0.0.9", s.ipFor("oauth.secure.pixiv.net"));
        assertEquals("远端决定 i.pximg.net", "210.140.139.131", s.ipFor("i.pximg.net"));
        assertEquals("内置决定 app-api（远端/手动均未给）", "210.140.139.155",
                s.ipFor("app-api.pixiv.net"));
        assertEquals("三 host 齐", 3, s.entries().size());
    }

    @Test
    public void merge_withinLayerLaterEntryWins() {
        // 同层重复 host：后者覆盖前者（list 顺序即确定性 tie-break，不告警）
        IpTableMerger.Snapshot s = merger(warns()).merge(
                null,
                Arrays.asList(e("i.pximg.net", "10.0.0.1"), e("i.pximg.net", "10.0.0.2")),
                null);
        assertEquals("10.0.0.2", s.ipFor("i.pximg.net"));
        assertTrue(warns().isEmpty());
    }

    // ── 缺层跳过 ─────────────────────────────────────────────

    @Test
    public void merge_nullLayers_skippedSilently_builtinSurvives() {
        // 缺层 = 正常状态（从未配置手动表 / 未拉取远端），不告警不抛异常
        List<String> warns = warns();
        IpTableMerger.Snapshot s = merger(warns).merge(null, null, DirectIpTableDefaults.builtIn());
        assertEquals(3, s.entries().size());
        assertTrue("缺层非异常，不得告警", warns.isEmpty());
    }

    @Test
    public void merge_allLayersNull_emptySnapshot() {
        IpTableMerger.Snapshot s = merger(warns()).merge(null, null, null);
        assertTrue(s.isEmpty());
        assertNull(s.ipFor("i.pximg.net"));
    }

    @Test
    public void merge_emptyListLayers_equivalentToNull() {
        IpTableMerger.Snapshot s = merger(warns()).merge(
                Collections.<IpTableMerger.Entry>emptyList(),
                Collections.<IpTableMerger.Entry>emptyList(),
                DirectIpTableDefaults.builtIn());
        assertEquals(3, s.entries().size());
    }

    // ── 非法条目：跳过 + 告警（禁静默） ──────────────────────

    @Test
    public void merge_invalidEntries_skippedWithWarn_validOnesSurvive() {
        // 非法样例（oracle = ticket #387 枚举：空 host / 空 IP / 非法 IP 字面量）
        List<IpTableMerger.Entry> manual = Arrays.asList(
                e("", "10.0.0.1"),              // 空 host
                e("  ", "10.0.0.2"),            // 空白 host
                e("i.pximg.net", ""),           // 空 IP
                e("i.pximg.net", "   "),        // 空白 IP
                null,                           // null 条目
                e("i.pximg.net", "999.1.1.1"),  // 段越界
                e("i.pximg.net", "1.2.3"),      // 段数不足
                e("i.pximg.net", "1.2.3.4.5"),  // 段数超出
                e("i.pximg.net", "01.2.3.4"),   // 前导零（八进制歧义）
                e("i.pximg.net", "abc"),        // 非数字
                e("i.pximg.net", "1.2.3.-4"),   // 负号
                e("i.pximg.net", "1..2.3"),     // 空段
                e("i.pximg.net", "210.140.139.131")); // 合法条目压轴
        List<String> warns = warns();
        IpTableMerger.Snapshot s = merger(warns).merge(manual, null, null);
        assertEquals("非法条目全跳过，唯一合法条目存活", "210.140.139.131", s.ipFor("i.pximg.net"));
        assertEquals("每条非法条目各告警一次（禁静默）", 12, warns.size());
        for (String w : warns) {
            assertTrue("告警必须含层名便于定位: " + w, w.contains("manual["));
        }
    }

    @Test
    public void merge_invalidRemoteEntry_skipped_builtinStillWinsThatHost() {
        // 远端层非法条目跳过后，该 host 落回内置层（降级语义：坏条目不顶掉内置值）
        List<String> warns = warns();
        IpTableMerger.Snapshot s = merger(warns).merge(
                null,
                Arrays.asList(e("app-api.pixiv.net", "10.0.0.99"), e("i.pximg.net", "not-an-ip")),
                DirectIpTableDefaults.builtIn());
        assertEquals("远端合法条目生效", "10.0.0.99", s.ipFor("app-api.pixiv.net"));
        assertEquals("远端非法条目跳过 → 内置值存活", "210.140.139.131", s.ipFor("i.pximg.net"));
        assertEquals(1, warns.size());
    }

    @Test
    public void ipv4Literal_strictAcceptance() {
        // 合法形态（oracle = IPv4 点分十进制规范）
        assertTrue("0.0.0.0", IpTableMerger.isValidIpv4Literal("0.0.0.0"));
        assertTrue("255.255.255.255", IpTableMerger.isValidIpv4Literal("255.255.255.255"));
        assertTrue("210.140.139.131", IpTableMerger.isValidIpv4Literal("210.140.139.131"));
        assertTrue("8.8.8.8", IpTableMerger.isValidIpv4Literal("8.8.8.8"));
        // 非法形态（歧义/越界/形状错）
        assertFalse("", IpTableMerger.isValidIpv4Literal(""));
        assertFalse("999.x", IpTableMerger.isValidIpv4Literal("999.1.1.1"));
        assertFalse("256.1.1.1", IpTableMerger.isValidIpv4Literal("256.1.1.1"));
        assertFalse("三位以上", IpTableMerger.isValidIpv4Literal("1234.1.1.1"));
        assertFalse("前导零", IpTableMerger.isValidIpv4Literal("010.1.1.1"));
        assertFalse("段数少", IpTableMerger.isValidIpv4Literal("1.2.3"));
        assertFalse("段数多", IpTableMerger.isValidIpv4Literal("1.2.3.4.5"));
        assertFalse("尾点", IpTableMerger.isValidIpv4Literal("1.2.3.4."));
        assertFalse("双点", IpTableMerger.isValidIpv4Literal("1..2.3"));
        assertFalse("非数字", IpTableMerger.isValidIpv4Literal("a.b.c.d"));
        assertFalse("十六进制形态", IpTableMerger.isValidIpv4Literal("0x7f.1.1.1"));
        assertFalse("IPv6 不支持（跳过+告警语义）", IpTableMerger.isValidIpv4Literal("::1"));
    }

    // ── 规范化 ───────────────────────────────────────────────

    @Test
    public void merge_whitespaceAndCase_normalized() {
        IpTableMerger.Snapshot s = merger(warns()).merge(
                Collections.singletonList(e("  I.PXIMG.NET  ", "  210.140.139.131  ")),
                null, null);
        assertEquals("大小写与空白规范化", "210.140.139.131", s.ipFor("i.pximg.net"));
    }

    // ── Snapshot 语义 ────────────────────────────────────────

    @Test
    public void snapshot_lookup_nullSafeAndCaseInsensitive() {
        IpTableMerger.Snapshot s = merger(warns()).merge(null, null, DirectIpTableDefaults.builtIn());
        assertNull("null host → null（缺条目语义）", s.ipFor(null));
        assertNull("未知 host → null", s.ipFor("s.pximg.net"));
        assertNull("空白 host → null", s.ipFor("   "));
        assertEquals("大写查询命中", "210.140.139.131", s.ipFor("I.PXIMG.NET"));
        assertEquals("带空白查询命中", "210.140.139.155", s.ipFor(" app-api.pixiv.net "));
    }

    @Test
    public void snapshot_immutable() {
        IpTableMerger.Snapshot s = merger(warns()).merge(null, null, DirectIpTableDefaults.builtIn());
        try {
            s.entries().put("evil.example", "6.6.6.6");
            throw new AssertionError("快照必须不可变");
        } catch (UnsupportedOperationException expected) {
            // 预期
        }
    }

    @Test
    public void snapshot_valueSemantics_equalsHashCode() {
        // 重放审计依赖值语义：同输入合并两次 → 相等快照
        IpTableMerger.Snapshot a = merger(warns()).merge(null, null, DirectIpTableDefaults.builtIn());
        IpTableMerger.Snapshot b = merger(warns()).merge(null, null, DirectIpTableDefaults.builtIn());
        assertEquals(a, b);
        assertEquals(a.hashCode(), b.hashCode());
        // 确定性迭代序（内置表首插序）
        java.util.Iterator<Map.Entry<String, String>> it = a.entries().entrySet().iterator();
        assertEquals("i.pximg.net", it.next().getKey());
        assertEquals("app-api.pixiv.net", it.next().getKey());
        assertEquals("oauth.secure.pixiv.net", it.next().getKey());
    }
}
