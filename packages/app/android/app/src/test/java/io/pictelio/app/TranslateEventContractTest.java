package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * 交付事件名的跨端契约守卫（ADR-0170「跨端信封契约」）。
 *
 * <p>为什么需要：Java 侧 {@code PictelioTranslateModule.EVENT_FRAME} 与 JS 侧
 * {@code attachTranslateFrameListener} 订阅的事件名必须逐字一致。任何一侧改名都不会
 * 编译失败、不会让现有单测变红，只会让译文**静默不达**（UI 停在翻译中）。
 *
 * <p>Oracle 溯源（测试硬约束 #6）：期望值来自 ADR-0170 契约表登记的字符串
 * {@code pictelioTranslateFrame}，**不是**从 Java 常量反推 —— 改常量而不改 ADR 会让本测试红。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class TranslateEventContractTest {

    /** ADR-0170「跨端信封契约」登记的事件名（独立来源）。 */
    private static final String ADR_EVENT_NAME = "pictelioTranslateFrame";

    @Test
    public void eventNameMatchesTheAdrContract() {
        assertEquals(ADR_EVENT_NAME, PictelioTranslateModule.EVENT_FRAME);
    }

    @Test
    public void jsAdapterSubscribesToTheSameEventName() throws IOException {
        // 反向守卫：JS 侧文件里必须出现同名订阅（改名/漏改一侧即红）。
        // 用定位脚本的真实路径：测试工作目录随 Gradle 任务变化，靠相对层级不可靠；
        // 从 user.dir 向上找仓库根（含 packages/app-lynx 的那一级）。
        Path resolved = null;
        Path cursor = Paths.get("").toAbsolutePath();
        for (int i = 0; i < 8 && cursor != null; i++) {
            Path candidate = cursor.resolve("packages/app-lynx/src/api/nativeTranslate.ts");
            if (Files.exists(candidate)) {
                resolved = candidate;
                break;
            }
            candidate = cursor.resolve("app-lynx/src/api/nativeTranslate.ts");
            if (Files.exists(candidate)) {
                resolved = candidate;
                break;
            }
            cursor = cursor.getParent();
        }
        assertTrue("从 " + Paths.get("").toAbsolutePath() + " 向上未找到 app-lynx/src/api/nativeTranslate.ts", resolved != null);
        String source = new String(Files.readAllBytes(resolved), StandardCharsets.UTF_8);
        assertTrue(
                "JS 适配器未订阅 " + ADR_EVENT_NAME + "（跨端契约断裂）",
                source.contains("\"" + ADR_EVENT_NAME + "\"") || source.contains("'" + ADR_EVENT_NAME + "'"));
    }
}
