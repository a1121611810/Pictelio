package io.pictelio.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.app.Application;
import android.content.Context;
import android.content.ContextWrapper;
import android.util.Log;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowLog;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * {@link UiTreeDump} 的机器防线（T0 最小验证；spec {@code docs/specs/app-lynx-ui-tree-dump-t0.md}）。
 *
 * <p><b>测什么</b>：只测<b>外部行为</b>——「该不该抓」「抓到哪里」「文件叫什么」「写盘失败会不会被吞」。
 * 不测实现细节（不测 Handler 调度、不测线程池）。
 *
 * <p><b>为什么必须有这些用例</b>（测试硬约束 #1：IO 边界必须有成功 + 失败双路径）：
 * <ul>
 *   <li><b>触发判定</b>：extra 缺失/空串/非空串三种输入 + release 闸门。判错的后果是
 *       「该抓没抓」（诊断通道静默失灵，取证时无从判断是没触发还是失败），
 *       或「不该抓却抓」（release 包里泄漏导出能力）。</li>
 *   <li><b>写盘失败路径</b>：落盘是外部 IO。失败若被吞，用户看到的是「目录里没有文件」，
 *       而真相是「写盘失败」——两者指向完全不同的排查方向。</li>
 * </ul>
 *
 * <p><b>已知失效面（显式登记，非缺陷）</b>：
 * <ul>
 *   <li><b>证不到 release 变体的真实行为</b>：本测试跑在 debug 变体，
 *       {@code BuildConfig.DEBUG} 为 true。release 下「恒 false ⇒ 整块被 R8 移除」那一半
 *       <b>只由取值门禁承担</b>（{@code verifyReleaseBuildConfig} 证「release 侧 DEBUG 是
 *       字面量 false」）；<b>「R8 确实移除了本类」没有任何机器防线</b>（无 dex 级断言），
 *       这一层是代码级推论：常量表达式内联 + {@code proguard-rules.pro} 无本类 keep 规则。</li>
 *   <li><b>证不到引擎真的回调</b>：{@code getLynxElementRoot} / {@code toJSONString}
 *       需要真实 LynxView 与引擎，本测试不覆盖——那正是 T0 的模拟器实测部分。</li>
 *   <li><b>证不到连拍调度</b>：{@code SAMPLE_DELAYS_MS} 的三份采样由 Handler 驱动，
 *       本测试只断言该常量本身的取值，不验证调度时序。</li>
 *   <li><b>证不到产物名的跨端可解析性</b>：产物名要被 Node 侧诊断脚本反解（采样点 + 档位），
 *       那是<b>跨端接缝</b>，由 {@code UiTreeDumpProtocolContractTest} 的
 *       「Java 产出 ↔ Node 解析」共享 fixture 钉住，不在本测试范围。</li>
 * </ul>
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = Application.class)
public class UiTreeDumpTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private static Context appContext() {
        return ApplicationProvider.getApplicationContext();
    }

    // ── 触发判定 ──────────────────────────────────────────────────────────

    /**
     * 判定真值表：extra 非空 + debug 构建 ⇒ 触发；其余一律不触发。
     *
     * <p>「空串不触发」是刻意的：{@code --es uiTreeDump ""} 是误操作（命令行空值），
     * 应当与「没传」同义，而不是触发一次没人要的抓取。
     */
    @Test
    public void shouldDump_onlyWhenDebugBuildAndNonEmptyTrigger() {
        assertTrue("debug 构建 + 非空 extra ⇒ 触发", UiTreeDump.shouldDump(true, "1"));
        assertTrue("任意非空串都触发（值本身不参与判定）", UiTreeDump.shouldDump(true, "yes"));

        assertFalse("extra 缺失（null）⇒ 不触发", UiTreeDump.shouldDump(true, null));
        assertFalse("extra 为空串 ⇒ 不触发", UiTreeDump.shouldDump(true, ""));
        assertFalse("release 构建 ⇒ 恒不触发（哪怕 extra 非空）", UiTreeDump.shouldDump(false, "1"));
        assertFalse("release 构建 + 空 extra ⇒ 不触发", UiTreeDump.shouldDump(false, ""));
        assertFalse("release 构建 + 缺失 extra ⇒ 不触发", UiTreeDump.shouldDump(false, null));
    }

    // ── 连拍档位 ──────────────────────────────────────────────────────────

    /**
     * 连拍档位 = 0 / 1500 / 4000ms（spec「Implementation Decisions · 连拍」）。
     *
     * <p>为什么单独钉：这组档位同时是<b>跨端协议</b>——诊断脚本按它判断「哪一份才是完整树」
     * （4000ms 那份，实测 8KB → 9KB → 61KB）。档位一改而脚本没跟上 ⇒ 脚本等齐判据失准，
     * 又变成「静默丢掉最完整那份」。
     */
    @Test
    public void sampleDelays_areTheThreeAgreedTiers() {
        assertArrayEquals(
                "连拍档位必须是 0 / 1500 / 4000ms（spec Implementation Decisions）",
                new long[] {0L, 1500L, 4000L},
                UiTreeDump.SAMPLE_DELAYS_MS);
        assertEquals("CSV 形态（跨端协议比对面）", "0,1500,4000", UiTreeDump.SAMPLE_DELAYS_CSV);
    }

    // ── 落盘位置与文件名 ────────────────────────────────────────────────

    /**
     * 落盘目录 = 应用专属外部目录下的 {@code ui-tree/}。
     *
     * <p>为什么是专属外部目录而不是 app 私有目录：私有目录要 {@code run-as} 才能读
     * （仅 debug 包），真机取证不便；专属外部目录 {@code adb pull} 直接可拉。
     */
    @Test
    public void resolveOutputDir_isUnderAppSpecificExternalDir() {
        File dir = UiTreeDump.resolveOutputDir(appContext());
        assertNotNull("专属外部目录在 Robolectric 下应可用", dir);
        // 字面量而非实现常量：常量与由它构造出的名字互比只能证「还在用 DIR_NAME」（自证）
        assertEquals("子目录名（spec「落盘位置」逐字）", "ui-tree", dir.getName());
        assertEquals(
                "父目录必须是 app 专属外部目录本身（adb pull 直拉的前提）",
                appContext().getExternalFilesDir(null),
                dir.getParentFile());
    }

    /**
     * 文件名互不覆盖：采样点 / 档位 / 序号 / 时间戳任一不同 ⇒ 名不同。
     *
     * <p>为什么重要：一次触发会连拍多份（0/1.5/4s），多份必须各自独立成文件——
     * 覆盖会让「挑那份渲染完整的」这件事失效。
     */
    @Test
    public void fileName_isUniqueAcrossPointDelaySequenceAndTimestamp() {
        String a = UiTreeDump.fileName(UiTreeDump.POINT_COLD, 0L, 1, 1_700_000_000_000L);
        String b = UiTreeDump.fileName(UiTreeDump.POINT_COLD, 0L, 2, 1_700_000_000_000L);
        String c = UiTreeDump.fileName(UiTreeDump.POINT_COLD, 0L, 1, 1_700_000_000_001L);
        String d = UiTreeDump.fileName(UiTreeDump.POINT_COLD, 1500L, 1, 1_700_000_000_000L);
        String e = UiTreeDump.fileName(UiTreeDump.POINT_HOT, 0L, 1, 1_700_000_000_000L);

        assertNotEquals("序号不同 ⇒ 文件名不同", a, b);
        assertNotEquals("时间戳不同 ⇒ 文件名不同", a, c);
        assertNotEquals("档位不同 ⇒ 文件名不同", a, d);
        assertNotEquals("采样点不同 ⇒ 文件名不同", a, e);
        assertTrue("以 .json 结尾（脚本按扩展名筛文件）", a.endsWith(".json"));
        assertTrue("带 ui-tree- 前缀（脚本按前缀筛产物）", a.startsWith("ui-tree-"));
    }

    /**
     * 产物名带采样点与采样档位（供 Node 侧诊断脚本反解）。
     *
     * <p>为什么：① 冷启动同时命中 cold 与 hot 两个采样点（各 3 份，共 6 份），
     * 没有标识就分不清哪份属于哪一轮；② 实测 4s 那份才是完整树，没有档位就只能靠体积猜。
     */
    @Test
    public void fileName_encodesSamplingPointAndDelay() {
        String name = UiTreeDump.fileName(UiTreeDump.POINT_COLD, 4000L, 7, 1_700_000_000_000L);
        assertTrue("含采样点：" + name, name.contains("cold"));
        assertTrue("含档位（ms）：" + name, name.contains("4000ms"));
        assertTrue("含序号：" + name, name.contains("-7-"));
    }

    // ── 写盘：成功路径 ──────────────────────────────────────────────────

    /**
     * 成功路径：内容逐字节一致，且<b>不残留临时文件</b>。
     *
     * <p>临时文件残留不是洁癖：它同样以 {@code .json.tmp} 落在同一目录，
     * 而脚本按 {@code .json} 结尾筛文件——一旦临时文件命名规则将来放宽，残留就会被当成产物。
     */
    @Test
    public void writeAtomically_writesExactContentAndLeavesNoTempFile() throws Exception {
        File dir = tmp.newFolder("ui-tree");
        File target = new File(dir, UiTreeDump.fileName(UiTreeDump.POINT_COLD, 0L, 1, 1_700_000_000_000L));
        String content = "{\"tag\":\"view\",\"children\":[{\"tag\":\"text\"}]}";

        UiTreeDump.writeAtomically(target, content);

        assertTrue("目标文件应存在", target.exists());
        assertEquals(
                "内容必须逐字节一致",
                content,
                new String(Files.readAllBytes(target.toPath()), StandardCharsets.UTF_8));

        File[] leftovers = dir.listFiles((d, n) -> n.endsWith(".tmp"));
        assertNotNull("目录应可列举", leftovers);
        assertEquals("不应残留临时文件", 0, leftovers.length);
    }

    /**
     * 成功路径的补充：空内容也要落盘（空树是<b>有效观测</b>，不是失败）。
     *
     * <p>为什么单独钉：空串是「引擎给了空内容」与「引擎没给内容」的唯一区别；
     * 若实现把空串当失败丢弃，用户会以为「没抓到」，而真相是「抓到了，是空的」。
     */
    @Test
    public void writeAtomically_emptyContentStillProducesFile() throws Exception {
        File dir = tmp.newFolder("ui-tree-empty");
        File target = new File(dir, "ui-tree-empty.json");

        UiTreeDump.writeAtomically(target, "");

        assertTrue("空内容也应产出文件", target.exists());
        assertEquals("空内容 ⇒ 零字节", 0L, target.length());
    }

    // ── 写盘：失败路径 ──────────────────────────────────────────────────

    /**
     * 失败路径：rename 失败时必须<b>抛错</b>，且清理临时文件。
     *
     * <p>怎么制造 rename 失败：把目标位置预先占成一个<b>非空目录</b>——
     * POSIX {@code rename(2)} 不能用文件覆盖非空目录，必然失败。
     *
     * <p>为什么必须抛而不是吞：落盘失败若被静默吞掉，用户看到的是「目录里没有文件」，
     * 而真相是「写盘失败」——两者指向完全不同的排查方向。禁静默降级（测试硬约束 #3）。
     */
    @Test
    public void writeAtomically_renameFails_throwsAndCleansTempFile() throws Exception {
        File dir = tmp.newFolder("ui-tree-conflict");
        File target = new File(dir, "ui-tree-conflict.json");
        assertTrue("占位：目标位置预置为非空目录", target.mkdirs());
        File blocker = new File(target, "blocker");
        Files.write(blocker.toPath(), new byte[] {1});

        try {
            UiTreeDump.writeAtomically(target, "{\"tag\":\"view\"}");
            fail("rename 失败时必须抛出 IOException（不得静默吞掉）");
        } catch (IOException expected) {
            assertTrue("异常信息应指向 rename 失败", expected.getMessage().contains("rename"));
        }

        File[] leftovers = dir.listFiles((d, n) -> n.endsWith(".tmp"));
        assertNotNull("目录应可列举", leftovers);
        assertEquals("失败后不得残留临时文件", 0, leftovers.length);
    }

    /**
     * 写盘失败必须<b>既返回失败原因、又打出 WARN</b>（禁静默降级的双重要求）。
     *
     * <p>怎么制造失败：让目标目录的<b>父路径是一个普通文件</b> ⇒ {@code mkdirs} 必然失败。
     *
     * <p>为什么两件事都要断言：返回原因让调用方能判；WARN 日志让<b>人</b>能看见。
     * 只做前者 ⇒ 用户在 logcat 里看不到任何线索；只做后者 ⇒ 调用方以为成功了。
     */
    @Test
    public void writeArtifact_directoryCreationFails_reportsReasonAndWarns() throws Exception {
        File blocker = tmp.newFile("blocker-file");
        File impossibleDir = new File(blocker, "ui-tree");
        ShadowLog.clear();

        String reason = UiTreeDump.writeArtifact(
                impossibleDir, "{\"tag\":\"view\"}", 4000L, 7L, UiTreeDump.POINT_COLD);

        assertNotNull("目录创建失败必须返回失败原因（不得静默）", reason);
        assertTrue("原因应指向目录创建：" + reason, reason.contains("目录创建失败"));
        assertTrue("必须打出 WARN（人也要看得见）", warnedOnUiTreeDumpTag());
        String[] listed = impossibleDir.list();
        assertEquals("失败时不应产出任何文件", 0, listed == null ? 0 : listed.length);
    }

    /**
     * 写盘成功路径：产出文件 + 返回 {@code null}（无失败原因）+ 打出 INFO 度量日志。
     *
     * <p>度量日志里的字段是 spec US4 的承诺（体积 / 耗时 / <b>节点数</b>），少一个字段就等于
     * 「真机上没法判断这条通道可不可用」。此处钉住<b>字段名</b>而非具体数值
     * （数值随页面而变，不是契约）。
     */
    @Test
    public void writeArtifact_succeeds_returnsNullAndLogsMetrics() throws Exception {
        File dir = new File(tmp.newFolder("ui-tree-ok"), "nested");
        ShadowLog.clear();

        String reason = UiTreeDump.writeArtifact(
                dir, "{\"tag\":\"view\"}", 4000L, 7L, UiTreeDump.POINT_COLD);

        assertNull("成功时不应返回失败原因", reason);
        assertTrue("目录应被创建", dir.isDirectory());
        File[] produced = dir.listFiles((d, n) -> n.endsWith(".json"));
        assertNotNull("目录应可列举", produced);
        assertEquals("应产出 1 份产物", 1, produced.length);
        assertTrue(
                "产物名应含采样点与档位：" + produced[0].getName(),
                produced[0].getName().contains("cold") && produced[0].getName().contains("4000ms"));

        String log = allUiTreeDumpLogs();
        assertTrue("日志应含体积：[" + log + "]", log.contains("字节="));
        assertTrue("日志应含节点数：[" + log + "]", log.contains("节点数="));
        assertTrue("日志应含耗时：[" + log + "]", log.contains("抓取往返耗时="));
        assertTrue("日志应含采样点：[" + log + "]", log.contains("采样点="));
        assertTrue("日志应含采样延迟：[" + log + "]", log.contains("采样延迟="));
    }

    // ── 节点计数（spec US4 的「节点数」承诺） ────────────────────────────

    /**
     * 计数口径：根算 1，只沿 {@code children} 下探。
     *
     * <p>期望值来自**结构**而非实现：一棵 4 节点的小树，节点数就是 4。
     * 这是性质/不变量型断言（口径），不是从实现输出抄回来的数字。
     */
    @Test
    public void countNodes_countsRootAndDescendants() {
        String tree = "{\"tag\":\"page\",\"children\":["
                + "{\"tag\":\"view\",\"children\":[{\"tag\":\"text\",\"children\":[]}]},"
                + "{\"tag\":\"image\",\"children\":[]}]}";
        assertEquals("根 + view + text + image = 4", 4, UiTreeDump.countNodes(tree));
    }

    /** 单节点树（无 children 字段）也要计 1——引擎的根节点就是这种形态。 */
    @Test
    public void countNodes_singleNodeTree_returnsOne() {
        assertEquals("单节点树 = 1", 1, UiTreeDump.countNodes("{\"tag\":\"view\"}"));
    }

    /** 失败路径：非法 JSON ⇒ 返回 -1（让调用方打「解析失败」而不是假数字）。 */
    @Test
    public void countNodes_invalidJson_returnsMinusOne() {
        assertEquals("非法 JSON ⇒ -1", -1, UiTreeDump.countNodes("{not json"));
    }

    /** 失败路径：空串 ⇒ 同样 -1，不抛异常。 */
    @Test
    public void countNodes_emptyString_returnsMinusOne() {
        assertEquals("空串 ⇒ -1", -1, UiTreeDump.countNodes(""));
    }

    // ── 落盘：取不到外部存储目录（IO 失败双路径的另一半） ──────────────────

    /**
     * 「拿不到外部存储目录」这条失败路径必须<b>既返回失败原因、又打出 WARN</b>。
     *
     * <p>为什么必须覆盖：它原先藏在后台任务里 ⇒ 测不到 ⇒ 「什么都没发生」是静默的
     * （测试硬约束 #1：IO 边界必须有成功 + 失败双路径）。
     *
     * <p>怎么制造：把 Robolectric 的外部文件目录列表置空 ⇒
     * {@code getExternalFilesDir(null)} 返回 null（Android 契约：空数组 ⇒ 取不到目录）。
     */
    @Test
    public void writeArtifactTo_externalDirUnavailable_reportsReasonAndWarns() {
        // 用一个「取不到外部存储目录」的 Context 制造失败（不依赖 Robolectric 影子 API：
        // 4.14 的 ShadowContextImpl 只有 protected 的 getter，没有公开 setter）。
        Context noExternalDir = new ContextWrapper(appContext()) {
            @Override
            public File getExternalFilesDir(String type) {
                return null;
            }
        };
        ShadowLog.clear();

        String reason = UiTreeDump.writeArtifactTo(
                noExternalDir, "{\"tag\":\"view\"}", 4000L, 7L, UiTreeDump.POINT_COLD);

        assertNotNull("取不到外部存储目录必须返回失败原因（不得静默）", reason);
        assertTrue("原因应指向外部存储：" + reason, reason.contains("getExternalFilesDir"));
        assertTrue("必须打出 WARN（人也要看得见）", warnedOnUiTreeDumpTag());
    }

    /** 本用例窗口内是否出现 UiTreeDump tag 的 WARN（禁静默降级的机器防线）。 */
    private static boolean warnedOnUiTreeDumpTag() {
        for (ShadowLog.LogItem item : ShadowLog.getLogsForTag(UiTreeDump.TAG)) {
            if (item.type == Log.WARN) return true;
        }
        return false;
    }

    /** 本用例窗口内 UiTreeDump tag 的全部日志文本（拼成一行便于多子串断言）。 */
    private static String allUiTreeDumpLogs() {
        StringBuilder sb = new StringBuilder();
        for (ShadowLog.LogItem item : ShadowLog.getLogsForTag(UiTreeDump.TAG)) {
            sb.append(item.msg).append('\n');
        }
        return sb.toString();
    }
}
