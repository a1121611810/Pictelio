package io.pictelio.app.directaccess;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * DirectAccessPolicy 单测（#387）——路由判定纯函数全分支。
 *
 * <p><b>Oracle 溯源（spec #376 测试硬约束 #6）</b>——期望值全部来自独立来源：
 * <ul>
 *   <li>白名单 = {@code *.pixiv.net} / {@code *.pximg.net}：spec #385「白名单边界」原文；
 *       复用 {@code ImageHostConfig.isOfficialDomain} 的语义边界由其既有测试
 *       （resolve_officialDomainSuffixPrecision_notOvermatched）与本次伪装后缀用例双向钉死；</li>
 *   <li>伪装后缀样例 evil-pximg.net / pximg.net.evil.com：ticket #387 验收标准原文列举
 *       （.{@code .} 边界后缀匹配，防 {@code endsWith} 前缀粘连）；notpximg.net 取自
 *       ImageHostConfigTest 既有先例；</li>
 *   <li>开关默认关 / 三态：spec「独立开关（默认关）」+ ticket #387「开关三态」
 *       （ON / OFF 显式关 / UNSET 未配置或解析失败兜底）；</li>
 *   <li>钉定 IP 期望值（131 / 155）：探针报告实测矩阵（见 DirectIpTableDefaultsTest 溯源）；
 *       s.pximg.net 手动表用例取 210.140.139.134——探针报告 §3.3 点名的同段 pximg 边缘 IP；</li>
 *   <li>镜像（i.pixiv.re，探针 I5）/ GitHub（更新检查）/ jsDelivr（#385 远端表可选镜像源）
 *       恒 SYSTEM：spec「镜像 URL / GitHub / OTA 源不在白名单，天然走系统路线」；</li>
 *   <li>门序（IP 表门先于熔断门）：类 javadoc「半开单探授凭不得被表缺条目路径白白消耗」
 *       ——用熔断相位可观测断言钉死（详见 sequencing 用例注释）。</li>
 * </ul>
 */
public class DirectAccessPolicyTest {

    private static final long T0 = 1_000_000L;

    private static final class MutableClock implements ChannelCircuitBreaker.Clock {
        long now = T0;

        @Override
        public long nowMillis() {
            return now;
        }
    }

    private static IpTableMerger.Snapshot table(IpTableMerger.Entry... entries) {
        List<String> warns = Collections.synchronizedList(new java.util.ArrayList<String>());
        IpTableMerger.Snapshot s = new IpTableMerger(warns::add)
                .merge(entries.length == 0 ? null : Arrays.asList(entries), null,
                        DirectIpTableDefaults.builtIn());
        assertTrue("测试表构造不允许告警: " + warns, warns.isEmpty());
        return s;
    }

    private static ChannelCircuitBreaker breaker(MutableClock clock) {
        return new ChannelCircuitBreaker(clock);
    }

    /** 3 连败驱动熔断（字面量 3 = spec 阈值） */
    private static void trip(ChannelCircuitBreaker breaker, ChannelCircuitBreaker.Channel ch) {
        breaker.recordFailure(ch);
        breaker.recordFailure(ch);
        breaker.recordFailure(ch);
    }

    // ── 白名单命中 + 全门通过 → PINNED ──────────────────────

    @Test
    public void decide_imageHost_pinnedToImageEdgeIp() {
        // oracle: 探针 I4（i.pximg.net 钉 210.140.139.133）+ spec 判定链
        MutableClock clock = new MutableClock();
        ChannelCircuitBreaker.Channel ch = ChannelCircuitBreaker.Channel.IMAGE;
        DirectAccessPolicy.Decision d = DirectAccessPolicy.decide("i.pximg.net",
                DirectAccessPolicy.SwitchState.ON, breaker(clock), table());
        assertTrue(d.isDirect());
        assertEquals(DirectAccessPolicy.Decision.Kind.PINNED, d.kind());
        assertEquals(ch, d.channel());
        assertEquals("210.140.139.133", d.ip());
    }

    @Test
    public void decide_apiAndOauthHosts_pinnedToApiRefreshChannel() {
        // oracle: 探针 A2/H2（155 双 vhost）+ 通道分类（pixiv.net 系 = API+刷新通道）
        MutableClock clock = new MutableClock();
        DirectAccessPolicy.Decision api = DirectAccessPolicy.decide("app-api.pixiv.net",
                DirectAccessPolicy.SwitchState.ON, breaker(clock), table());
        assertEquals(ChannelCircuitBreaker.Channel.API_REFRESH, api.channel());
        assertEquals("210.140.139.155", api.ip());
        DirectAccessPolicy.Decision oauth = DirectAccessPolicy.decide("oauth.secure.pixiv.net",
                DirectAccessPolicy.SwitchState.ON, breaker(clock), table());
        assertEquals("OAuth 刷新同属 API+刷新通道（401 静默刷新免梯契约）",
                ChannelCircuitBreaker.Channel.API_REFRESH, oauth.channel());
        assertEquals("210.140.139.155", oauth.ip());
    }

    @Test
    public void decide_nonBuiltInPximgHost_classifiedToImageChannel_viaManualEntry() {
        // s.pximg.net 不在内置表（报告 §3.2 证伪换 host 取图）——但手动层可加条目；
        // 210.140.139.134 = 探针报告 §3.3 点名的同段 pximg 边缘 IP（真实样例非自造）
        IpTableMerger.Snapshot t = table(new IpTableMerger.Entry("s.pximg.net", "210.140.139.134"));
        DirectAccessPolicy.Decision d = DirectAccessPolicy.decide("s.pximg.net",
                DirectAccessPolicy.SwitchState.ON, breaker(new MutableClock()), t);
        assertTrue(d.isDirect());
        assertEquals(ChannelCircuitBreaker.Channel.IMAGE, d.channel());
        assertEquals("210.140.139.134", d.ip());
    }

    // ── 开关三态（ticket 验收：开关三态） ────────────────────

    @Test
    public void decide_switchOff_unset_null_allSystem() {
        // OFF（用户显式关）/ UNSET（未配置或解析失败兜底）/ null（防御）行为一致：
        // 其余三门全过也必须 SYSTEM——直连永远默认关（spec user story 5）
        MutableClock clock = new MutableClock();
        for (DirectAccessPolicy.SwitchState sw : new DirectAccessPolicy.SwitchState[]{
                DirectAccessPolicy.SwitchState.OFF, DirectAccessPolicy.SwitchState.UNSET, null}) {
            DirectAccessPolicy.Decision d = DirectAccessPolicy.decide("i.pximg.net", sw,
                    breaker(clock), table());
            assertFalse(sw + " 必须走系统路线", d.isDirect());
            assertEquals(DirectAccessPolicy.Decision.Kind.SYSTEM, d.kind());
        }
    }

    // ── 白名单未命中（镜像 / GitHub / OTA 恒 SYSTEM） ────────

    @Test
    public void decide_outsideWhitelist_alwaysSystem() {
        MutableClock clock = new MutableClock();
        IpTableMerger.Snapshot t = table();
        String[] outsiders = {
                "i.pixiv.re",                   // 社区镜像（探针 I5）——图床域，永不直连化
                "mirror.example",               // 任意镜像 host
                "evil-pximg.net",               // 伪装后缀：- 连接非 . 边界（ticket 列举）
                "pximg.net.evil.com",           // 伪装后缀：官方域仅是右端子串（ticket 列举）
                "notpximg.net",                 // 粘连前缀（ImageHostConfigTest 先例）
                "sub.pximg.net.evil.com",       // 子域伪装
                "github.com",                   // 更新检查（GitHub API）
                "raw.githubusercontent.com",    // GitHub 资产
                "cdn.jsdelivr.net",             // OTA/远端表 jsDelivr 镜像源（#385）
                "objects.githubusercontent.com" // release 资产下载
        };
        for (String host : outsiders) {
            DirectAccessPolicy.Decision d = DirectAccessPolicy.decide(host,
                    DirectAccessPolicy.SwitchState.ON, breaker(clock), t);
            assertFalse(host + " 必须恒走系统路线", d.isDirect());
        }
    }

    // ── 大小写规范化 ─────────────────────────────────────────

    @Test
    public void decide_hostCaseNormalized_whitelistAndLookupHit() {
        MutableClock clock = new MutableClock();
        DirectAccessPolicy.Decision d = DirectAccessPolicy.decide("I.PXIMG.NET",
                DirectAccessPolicy.SwitchState.ON, breaker(clock), table());
        assertTrue("大小写不敏感（isOfficialDomain 契约前提为小写，Policy 负责规范化）", d.isDirect());
        assertEquals("210.140.139.133", d.ip());
    }

    // ── IP 表缺条目 / 无表 ───────────────────────────────────

    @Test
    public void decide_whitelistedButNoTableEntry_system() {
        // s.pximg.net：白名单内但内置表无条目（报告只实测了 i.pximg.net）→ 不瞎猜边缘
        MutableClock clock = new MutableClock();
        DirectAccessPolicy.Decision d = DirectAccessPolicy.decide("s.pximg.net",
                DirectAccessPolicy.SwitchState.ON, breaker(clock), table());
        assertFalse(d.isDirect());
    }

    @Test
    public void decide_nullTable_system() {
        MutableClock clock = new MutableClock();
        DirectAccessPolicy.Decision d = DirectAccessPolicy.decide("i.pximg.net",
                DirectAccessPolicy.SwitchState.ON, breaker(clock), null);
        assertFalse(d.isDirect());
    }

    // ── 装配缺失 / 入参防御 ──────────────────────────────────

    @Test
    public void decide_nullBreaker_system_noException() {
        // spec：装配缺失（provider 未装配 / JVM 测试环境）= 纯系统路线零异常
        DirectAccessPolicy.Decision d = DirectAccessPolicy.decide("i.pximg.net",
                DirectAccessPolicy.SwitchState.ON, null, table());
        assertFalse(d.isDirect());
    }

    @Test
    public void decide_nullOrBlankHost_system() {
        MutableClock clock = new MutableClock();
        DirectAccessPolicy.Decision nullHost = DirectAccessPolicy.decide(null,
                DirectAccessPolicy.SwitchState.ON, breaker(clock), table());
        DirectAccessPolicy.Decision blankHost = DirectAccessPolicy.decide("   ",
                DirectAccessPolicy.SwitchState.ON, breaker(clock), table());
        assertFalse(nullHost.isDirect());
        assertFalse(blankHost.isDirect());
    }

    // ── 熔断门（ticket 验收：熔断三态） ──────────────────────

    @Test
    public void decide_breakerOpen_system_channelIndependent() {
        // 图片通道熔断 → 图片 host 系统路线；API+刷新通道 closed 不受牵连（user story 9）
        MutableClock clock = new MutableClock();
        ChannelCircuitBreaker breaker = breaker(clock);
        trip(breaker, ChannelCircuitBreaker.Channel.IMAGE);
        assertFalse(DirectAccessPolicy.decide("i.pximg.net",
                DirectAccessPolicy.SwitchState.ON, breaker, table()).isDirect());
        DirectAccessPolicy.Decision api = DirectAccessPolicy.decide("app-api.pixiv.net",
                DirectAccessPolicy.SwitchState.ON, breaker, table());
        assertTrue("API 通道独立存活", api.isDirect());
        assertEquals(ChannelCircuitBreaker.Channel.API_REFRESH, api.channel());
    }

    @Test
    public void decide_breakerHalfOpen_probeAwardedThroughDecide_thenBusy() {
        // 冷却到期后第一次 decide = 单探授凭（PINNED），第二次同刻 decide 按 open 处理
        MutableClock clock = new MutableClock();
        ChannelCircuitBreaker breaker = breaker(clock);
        trip(breaker, ChannelCircuitBreaker.Channel.IMAGE);
        clock.now = T0 + 60_000L;
        DirectAccessPolicy.Decision probe = DirectAccessPolicy.decide("i.pximg.net",
                DirectAccessPolicy.SwitchState.ON, breaker, table());
        assertTrue("半开探针经 decide 授予", probe.isDirect());
        DirectAccessPolicy.Decision second = DirectAccessPolicy.decide("i.pximg.net",
                DirectAccessPolicy.SwitchState.ON, breaker, table());
        assertFalse("探针在飞，其余按 open", second.isDirect());
        // 探针成功 → 恢复 → decide 恒 PINNED
        breaker.recordSuccess(ChannelCircuitBreaker.Channel.IMAGE);
        assertTrue(DirectAccessPolicy.decide("i.pximg.net",
                DirectAccessPolicy.SwitchState.ON, breaker, table()).isDirect());
    }

    @Test
    public void decide_breakerFullLifecycle_throughDecide() {
        // 全生命周期经 decide 驱动：closed → open（SYSTEM）→ 冷却半开（PINNED）
        // → 探针失败重开（SYSTEM）→ 再冷却（PINNED）→ 探针成功恢复（恒 PINNED）
        MutableClock clock = new MutableClock();
        ChannelCircuitBreaker breaker = breaker(clock);
        ChannelCircuitBreaker.Channel image = ChannelCircuitBreaker.Channel.IMAGE;

        trip(breaker, image); // T0 open
        assertFalse(DirectAccessPolicy.decide("i.pximg.net",
                DirectAccessPolicy.SwitchState.ON, breaker, table()).isDirect());

        clock.now = T0 + 60_000L; // 半开单探
        assertTrue(DirectAccessPolicy.decide("i.pximg.net",
                DirectAccessPolicy.SwitchState.ON, breaker, table()).isDirect());
        clock.now = T0 + 100_000L;
        breaker.recordFailure(image); // 探针失败重开，冷却起点 = 失败时刻
        assertFalse(DirectAccessPolicy.decide("i.pximg.net",
                DirectAccessPolicy.SwitchState.ON, breaker, table()).isDirect());

        clock.now = T0 + 160_000L; // 新冷却到期
        assertTrue(DirectAccessPolicy.decide("i.pximg.net",
                DirectAccessPolicy.SwitchState.ON, breaker, table()).isDirect());
        breaker.recordSuccess(image); // 探针成功恢复
        assertTrue(DirectAccessPolicy.decide("i.pximg.net",
                DirectAccessPolicy.SwitchState.ON, breaker, table()).isDirect());
        assertTrue("恢复后恒 PINNED", DirectAccessPolicy.decide("i.pximg.net",
                DirectAccessPolicy.SwitchState.ON, breaker, table()).isDirect());
    }

    @Test
    public void decide_gateOrdering_tableMissNeverTouchesBreaker() {
        // 门序钉死（IP 表门必须先于熔断门）：
        // 熔断 open 且冷却已过（下一次 allowDirect 必授半开探针）时，
        // 对「白名单内但表缺条目」的 host decide —— 若实现先问熔断，单探资格会被
        // 无请求回收地消耗（相位变 HALF_OPEN 且永久滞留）。断言相位仍 OPEN：
        // 表缺条目路径零接触熔断器。
        MutableClock clock = new MutableClock();
        ChannelCircuitBreaker breaker = breaker(clock);
        trip(breaker, ChannelCircuitBreaker.Channel.IMAGE);
        clock.now = T0 + 60_000L; // 冷却已过：allowDirect 一旦被调即授凭迁移
        IpTableMerger.Snapshot noEntryForS = table(); // 内置表无 s.pximg.net
        assertFalse(DirectAccessPolicy.decide("s.pximg.net",
                DirectAccessPolicy.SwitchState.ON, breaker, noEntryForS).isDirect());
        assertEquals("表缺条目不得触碰熔断器（相位保持 OPEN）",
                ChannelCircuitBreaker.Phase.OPEN, breaker.phase(ChannelCircuitBreaker.Channel.IMAGE));
        // 对照组：有条目 host 经同一位点 decide → 熔断门被正常经过（单探授予 → HALF_OPEN）
        assertTrue(DirectAccessPolicy.decide("i.pximg.net",
                DirectAccessPolicy.SwitchState.ON, breaker, noEntryForS).isDirect());
        assertEquals(ChannelCircuitBreaker.Phase.HALF_OPEN, breaker.phase(ChannelCircuitBreaker.Channel.IMAGE));
    }

    // ── 决策值语义（可重放审计） ─────────────────────────────

    @Test
    public void decision_valueSemantics_forReplay() {
        // 同输入恒同输出：closed 态连续两次 decide 结果相等（值语义 equals）
        MutableClock clock = new MutableClock();
        ChannelCircuitBreaker breaker = breaker(clock);
        DirectAccessPolicy.Decision d1 = DirectAccessPolicy.decide("i.pximg.net",
                DirectAccessPolicy.SwitchState.ON, breaker, table());
        DirectAccessPolicy.Decision d2 = DirectAccessPolicy.decide("i.pximg.net",
                DirectAccessPolicy.SwitchState.ON, breaker, table());
        assertEquals(d1, d2);
        assertEquals(d1.hashCode(), d2.hashCode());
        // SYSTEM 判定间相等（无论来自哪个门短路）
        assertEquals(DirectAccessPolicy.decide("i.pximg.net",
                DirectAccessPolicy.SwitchState.OFF, breaker, table()),
                DirectAccessPolicy.decide("github.com",
                        DirectAccessPolicy.SwitchState.ON, breaker, table()));
        // PINNED 与 SYSTEM 不等；不同通道/IP 不等
        assertNotEquals(d1, DirectAccessPolicy.Decision.systemRoute());
        assertNotEquals(d1, DirectAccessPolicy.Decision.pinned(
                ChannelCircuitBreaker.Channel.API_REFRESH, "210.140.139.155"));
        // toString 审计面
        assertEquals("SYSTEM", DirectAccessPolicy.Decision.systemRoute().toString());
        assertEquals("PINNED(IMAGE, 210.140.139.133)", d1.toString());
        assertFalse(DirectAccessPolicy.Decision.systemRoute().isDirect());
    }

    // ── 通道分类（自实现后缀判定，直接面） ───────────────────

    @Test
    public void classifyChannel_suffixBoundary() {
        // 裸域 / 子域 / 大小写（ticket 列举边界）
        assertEquals(ChannelCircuitBreaker.Channel.IMAGE,
                DirectAccessPolicy.classifyChannel("pximg.net"));
        assertEquals(ChannelCircuitBreaker.Channel.IMAGE,
                DirectAccessPolicy.classifyChannel("i.pximg.net"));
        assertEquals(ChannelCircuitBreaker.Channel.IMAGE,
                DirectAccessPolicy.classifyChannel("I.PXIMG.NET"));
        assertEquals(ChannelCircuitBreaker.Channel.API_REFRESH,
                DirectAccessPolicy.classifyChannel("pixiv.net"));
        assertEquals(ChannelCircuitBreaker.Channel.API_REFRESH,
                DirectAccessPolicy.classifyChannel("app-api.pixiv.net"));
        assertEquals(ChannelCircuitBreaker.Channel.API_REFRESH,
                DirectAccessPolicy.classifyChannel("oauth.secure.pixiv.net"));
        // 伪装后缀不误判（.{@code .} 边界）
        assertNull(DirectAccessPolicy.classifyChannel("evil-pximg.net"));
        assertNull(DirectAccessPolicy.classifyChannel("pximg.net.evil.com"));
        assertNull(DirectAccessPolicy.classifyChannel("notpximg.net"));
        assertNull(DirectAccessPolicy.classifyChannel("i.pixiv.re"));
        assertNull(DirectAccessPolicy.classifyChannel(null));
    }
}
