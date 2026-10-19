package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.app.Application;
import android.content.Context;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

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
 *       由 release 变体的可执行门禁（{@code verifyReleaseBuildConfig} 一族）承担；
 *       本测试只证<b>判定函数</b>在 {@code debugBuild=false} 时返回 false。</li>
 *   <li><b>证不到引擎真的回调</b>：{@code getLynxElementRoot} / {@code toJSONString}
 *       需要真实 LynxView 与引擎，本测试不覆盖——那正是 T0 的模拟器实测部分。</li>
 *   <li><b>证不到连拍调度</b>：{@code SAMPLE_DELAYS_MS} 的三份采样由 Handler 驱动，
 *       本测试只断言该常量本身的取值，不验证调度时序。</li>
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
        assertEquals("子目录名", UiTreeDump.DIR_NAME, dir.getName());
        assertEquals(
                "父目录必须是 app 专属外部目录本身（adb pull 直拉的前提）",
                appContext().getExternalFilesDir(null),
                dir.getParentFile());
    }

    /**
     * 文件名互不覆盖：序号不同 ⇒ 名不同；序号相同但时间戳不同 ⇒ 名也不同。
     *
     * <p>为什么重要：一次触发会连拍多份（0/1.5/4s），多份必须各自独立成文件——
     * 覆盖会让「挑那份渲染完整的」这件事失效。
     */
    @Test
    public void fileName_isUniqueAcrossSequenceAndTimestamp() {
        String a = UiTreeDump.fileName(1, 1_700_000_000_000L);
        String b = UiTreeDump.fileName(2, 1_700_000_000_000L);
        String c = UiTreeDump.fileName(1, 1_700_000_000_001L);

        assertNotEquals("序号不同 ⇒ 文件名不同", a, b);
        assertNotEquals("时间戳不同 ⇒ 文件名不同", a, c);
        assertTrue("以 .json 结尾（脚本按扩展名筛文件）", a.endsWith(".json"));
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
        File target = new File(dir, UiTreeDump.fileName(1, 1_700_000_000_000L));
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
}
