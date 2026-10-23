package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import android.app.Application;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * 「宿主侧 ↔ 诊断脚本」协议契约门禁（spec {@code docs/specs/app-lynx-ui-tree-dump-t0.md}
 * 的「Testing Decisions · 跨端协议门禁」一条）。
 *
 * <p><b>为什么这道门禁必须存在</b>：触发协议的名字（intent extra 键）、落盘目录名、
 * 产物名前缀与后缀、采样档位、采样点标识**同时存在于两侧**，而两侧是<b>不同语言、不同运行时</b>
 * （Java 宿主 / Node 脚本）——没有共享代码可依赖，只能各写各的字面量。这正是「协议两侧逐字比对」
 * 的典型场景（先例：{@code TranslateEventContractTest} 的事件名两侧比对、
 * app-lynx 的 {@code darkModeJavaContract.test.ts} 的 JS/Java 字面量比对）。
 *
 * <p><b>不设门禁会怎样</b>：脚本把 extra 键写成 {@code uiTreeDump}、宿主改成
 * {@code uiTreeDumpV2}（或反之）——两边各自都能编译、单测各自全绿，
 * 而<b>真实后果是「触发永远不生效」</b>：脚本发 intent、宿主读不到 extra ⇒ 静默无文件。
 * 这与「能力不存在」在现象上不可区分，正是本仓最反感的静默失败形态。
 *
 * <p><b>抽取器自身的有效性（门禁纪律：抽取器必须断言集合非空且数量下界）</b>：
 * 本测试用正则从脚本源码里抽取常量声明，并<b>断言抽取到恰好 1 条</b>——
 * 若脚本改名/重构导致正则失配，抽取结果为空会让「两侧相等」变成<b>恒真断言</b>，
 * 门禁就此静默失效（ArchUnit {@code failOnEmptyShould} 同款教训）。
 * 故每次抽取都必须报出实际条数，条数不为 1 即判失败。
 *
 * <p><b>已知失效面（显式登记，非缺陷）</b>：
 * <ul>
 *   <li><b>只比对字面量，不比对行为</b>：本门禁证明「两侧写的名字一样」，
 *       不证明「宿主真的认这个 extra」——那一条由
 *       {@link UiTreeDumpTest#shouldDump_onlyWhenDebugBuildAndNonEmptyTrigger} 与
 *       模拟器实跑承担。</li>
 *   <li><b>不覆盖产物名里的动态部分</b>：产物名格式
 *       （{@code ui-tree-<采样点>-<档位>ms-<序号>-<时间戳>.json}）本门禁只比对<b>前缀与后缀</b>，
 *       中间的序号/时间戳是运行时变量，静态比不了；采样点与档位由另外两个常量
 *       （{@code POINT_IDS_CSV} / {@code SAMPLE_DELAYS_CSV}）逐字比对兜住。</li>
 *   <li><b>不覆盖路径中的包名</b>：脚本的远程目录里写死了包名（<b>debug 变体的
 *       applicationId</b>：{@code io.pictelio.app.debug}，ADR-0227 D2），
 *       而宿主侧用 {@code getExternalFilesDir(null)} 动态取——两者靠平台约定相等，
 *       不靠字面量相等。</li>
 * </ul>
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = Application.class)
public class UiTreeDumpProtocolContractTest {

    /**
     * 诊断脚本侧的协议常量所在文件（相对宿主包根）。
     *
     * <p>为什么指向 {@code scripts/lib/} 而不是 CLI 脚本本体：协议常量已抽进纯模块
     * （CLI 脚本顶层即调 adb、import 即产生副作用，不可单测——先例 release-version-json.mjs）。
     */
    private static final String SCRIPT_REL = "scripts/lib/ui-tree-dump-core.mjs";

    /** 从源码里抽 `const <名> = <值>;` 形式的常量声明值。 */
    private static List<String> extractConstValues(String source, String constName) {
        Pattern p = Pattern.compile(
                "^(?:export\\s+)?const\\s+" + Pattern.quote(constName) + "\\s*=\\s*(.+?);\\s*$",
                Pattern.MULTILINE);
        Matcher m = p.matcher(source);
        List<String> out = new ArrayList<>();
        while (m.find()) out.add(m.group(1).trim());
        return out;
    }

    /** 定位诊断脚本源码：从测试工作目录向上找含 {@code scripts/lib/ui-tree-dump-core.mjs} 的层。 */
    private static Path locateScript() {
        Path dir = Path.of(System.getProperty("user.dir")).toAbsolutePath();
        for (int i = 0; i < 8 && dir != null; i++) {
            Path candidate = dir.resolve(SCRIPT_REL);
            if (Files.isRegularFile(candidate)) return candidate;
            dir = dir.getParent();
        }
        throw new IllegalStateException(
                "定位诊断脚本失败：从 " + System.getProperty("user.dir") + " 向上 8 层内未找到 " + SCRIPT_REL);
    }

    private static String readScript() throws IOException {
        // ⚠️ 不能用 Files.readString(Path, Charset)：Android 的 java.nio.file 桩里没有该方法
        //   （compileDebugUnitTestJavaWithJavac 实测报「找不到符号」）——按仓库既有写法走 readAllBytes。
        return new String(Files.readAllBytes(locateScript()), StandardCharsets.UTF_8);
    }

    /** 断言抽取到恰好 1 条（抽取器有效性：非空 + 数量下界 = 1）。 */
    private static String exactlyOne(List<String> values, String what) {
        if (values.size() != 1) {
            fail("抽取器失效：期望从脚本抽到恰好 1 个 " + what + "，实际抽到 " + values.size()
                    + " 条（" + values + "）——正则已与脚本形态脱节，本门禁会静默恒真，必须先修抽取器");
        }
        return values.get(0);
    }

    /**
     * 触发协议：intent extra 键两侧逐字一致。
     *
     * <p>这是整道门禁里<b>最重要的一条</b>：键不一致 ⇒ 脚本发的 intent 宿主读不到
     * ⇒ 「触发永远不生效」且现象与「能力不存在」不可区分。
     */
    @Test
    public void triggerExtraKey_matchesBetweenHostAndScript() throws Exception {
        String scriptValue = exactlyOne(extractConstValues(readScript(), "EXTRA_TRIGGER"), "EXTRA_TRIGGER");
        assertEquals(
                "触发 extra 键两侧必须逐字一致（脚本常量 vs 宿主常量）",
                "\"" + UiTreeDump.EXTRA_TRIGGER + "\"",
                scriptValue);
    }

    /**
     * 落盘目录名两侧逐字一致。
     *
     * <p>目录名不一致 ⇒ 脚本 {@code adb pull} 的路径与宿主实际写入路径不同
     * ⇒ 「文件明明写了却拉不回来」。
     */
    @Test
    public void outputDirName_matchesBetweenHostAndScript() throws Exception {
        String scriptValue = exactlyOne(extractConstValues(readScript(), "OUT_DIR_NAME"), "OUT_DIR_NAME");
        assertEquals(
                "落盘目录名两侧必须逐字一致（脚本常量 vs 宿主常量）",
                "\"" + UiTreeDump.DIR_NAME + "\"",
                scriptValue);
    }

    /**
     * 产物文件名后缀两侧一致：宿主产出的文件名以 {@code .json} 结尾，脚本按 {@code .json} 筛文件。
     *
     * <p>两侧不一致 ⇒ 脚本拉回 0 个文件（宿主写的是别的后缀，或脚本筛错后缀）。
     */
    @Test
    public void artifactFileSuffix_matchesBetweenHostAndScript() throws Exception {
        String scriptValue = exactlyOne(extractConstValues(readScript(), "FILE_SUFFIX"), "FILE_SUFFIX");
        assertEquals(
                "产物文件名后缀两侧必须逐字一致（脚本常量 vs 宿主常量）",
                "\"" + UiTreeDump.FILE_SUFFIX + "\"",
                scriptValue);
        // 宿主产出的文件名确实以该后缀结尾（常量接错了也会在这里露出来）
        assertTrue(
                "宿主文件名必须以 " + UiTreeDump.FILE_SUFFIX + " 结尾（实际 "
                        + UiTreeDump.fileName(UiTreeDump.POINT_COLD, 0L, 1, 0L) + "）",
                UiTreeDump.fileName(UiTreeDump.POINT_COLD, 0L, 1, 0L).endsWith(UiTreeDump.FILE_SUFFIX));
    }

    /**
     * 产物文件名前缀两侧一致：脚本按 {@code ui-tree-} 认出「这是本通道的产物」。
     *
     * <p>前缀不一致 ⇒ 脚本把别的文件当产物拉回来，或反过来把产物当噪声忽略。
     */
    @Test
    public void artifactFilePrefix_matchesBetweenHostAndScript() throws Exception {
        String scriptValue = exactlyOne(extractConstValues(readScript(), "FILE_PREFIX"), "FILE_PREFIX");
        assertEquals(
                "产物文件名前缀两侧必须逐字一致（脚本常量 vs 宿主常量）",
                "\"" + UiTreeDump.FILE_PREFIX + "\"",
                scriptValue);
        assertTrue(
                "宿主文件名必须以 " + UiTreeDump.FILE_PREFIX + " 开头",
                UiTreeDump.fileName(UiTreeDump.POINT_COLD, 0L, 1, 0L).startsWith(UiTreeDump.FILE_PREFIX));
    }

    /**
     * 采样档位两侧一致：脚本据此判断「哪一份才是完整树」并等齐。
     *
     * <p>档位漂移 ⇒ 脚本的等齐判据失准 ⇒ 静默丢掉最完整的那一份（实测 4s 那份是唯一完整树，
     * 8KB → 9KB → 61KB；⚠️ 单次抓取口径，见 ADR-0223 §3.2）。这是 **T0 实测**阶段抓到过的真实缺陷。
     */
    @Test
    public void sampleDelayTiers_matchesBetweenHostAndScript() throws Exception {
        String scriptValue = exactlyOne(
                extractConstValues(readScript(), "SAMPLE_DELAYS_CSV"), "SAMPLE_DELAYS_CSV");
        assertEquals(
                "采样档位集合两侧必须逐字一致（脚本常量 vs 宿主常量）",
                "\"" + UiTreeDump.SAMPLE_DELAYS_CSV + "\"",
                scriptValue);
    }

    /**
     * 采样点标识两侧一致：脚本据此分组（**每次触发**命中几个采样点取决于进程怎么死的：App 在跑 ⇒ hot；
     * 进程死、任务记录还在 ⇒ cold + hot；force-stop ⇒ cold——**份数是「每次触发」口径**）。
     *
     * <p>标识漂移 ⇒ 脚本认不出采样点 ⇒ 「多份产物分不清哪份属于哪一轮」。
     */
    @Test
    public void samplingPointIds_matchesBetweenHostAndScript() throws Exception {
        String scriptValue = exactlyOne(
                extractConstValues(readScript(), "POINT_IDS_CSV"), "POINT_IDS_CSV");
        assertEquals(
                "采样点标识集合两侧必须逐字一致（脚本常量 vs 宿主常量）",
                "\"" + UiTreeDump.POINT_IDS_CSV + "\"",
                scriptValue);
    }

    /**
     * 宿主产出的产物名，必须能被脚本侧的解析规则反解出采样点与档位。
     *
     * <p>这是「两侧逐字比对」的<b>行为面</b>：常量各比各的还不够——
     * 产物名是宿主<b>造</b>、脚本<b>解</b>，格式漂移时两边常量仍可能各自一致。
     * 本用例用宿主真实产物名去撞脚本侧的正则（从脚本源码抽出的字面量），
     * 双方不一致时立刻打红。
     */
    @Test
    public void hostProducedArtifactNames_areParseableByScriptPattern() throws Exception {
        String source = readScript();
        String patternLiteral = exactlyOne(
                extractConstValues(source, "ARTIFACT_NAME_RE_SOURCE"), "ARTIFACT_NAME_RE_SOURCE");
        Pattern p = Pattern.compile(unescapeJsStringLiteral(patternLiteral));

        for (String point : UiTreeDump.POINT_IDS_CSV.split(",")) {
            for (String delay : UiTreeDump.SAMPLE_DELAYS_CSV.split(",")) {
                String name = UiTreeDump.fileName(point, Long.parseLong(delay), 3, 1_700_000_000_000L);
                Matcher m = p.matcher(name);
                assertTrue("宿主产物名必须能被脚本正则解析：" + name, m.matches());
                assertEquals("解析出的采样点：" + name, point, m.group("point"));
                assertEquals("解析出的档位：" + name, delay, m.group("delay"));
            }
        }
    }

    /**
     * 把脚本源码里的 JS 字符串字面量还原成「正则源码」。
     *
     * <p>脚本侧把正则写成 {@code "…\\d…\\.json$"}（JS 字符串里反斜杠要转义），
     * 而 {@code java.util.regex} 要的是 {@code \d…\.json$}。故先去引号再把
     * {@code \\} 还原成 {@code \}。
     */
    private static String unescapeJsStringLiteral(String literal) {
        String s = literal.trim();
        if (s.length() >= 2 && s.startsWith("\"") && s.endsWith("\"")) {
            s = s.substring(1, s.length() - 1);
        } else if (s.length() >= 2 && s.startsWith("'") && s.endsWith("'")) {
            s = s.substring(1, s.length() - 1);
        }
        return s.replace("\\\\", "\\");
    }

    /**
     * 协议常量清单本身不为空（防「整组常量被删光 ⇒ 抽取器全空 ⇒ 门禁恒真」）。
     *
     * <p>逐条断言都由上面各用例的 {@code exactlyOne} 兜着；本用例额外钉住
     * 「宿主侧这组协议常量确实存在且有内容」，避免宿主侧自己把它们删空时无人察觉。
     */
    @Test
    public void hostSideProtocolConstants_arePresentAndNonEmpty() {
        assertNotNull("extra 键", UiTreeDump.EXTRA_TRIGGER);
        assertTrue("目录名", UiTreeDump.DIR_NAME.length() > 0);
        assertTrue("文件名前缀", UiTreeDump.FILE_PREFIX.length() > 0);
        assertTrue("文件名后缀", UiTreeDump.FILE_SUFFIX.length() > 0);
        assertTrue("采样点集合", UiTreeDump.POINT_IDS_CSV.length() > 0);
        assertEquals("采样档位个数（spec：0/1.5/4s）", 3, UiTreeDump.SAMPLE_DELAYS_MS.length);
    }
}
