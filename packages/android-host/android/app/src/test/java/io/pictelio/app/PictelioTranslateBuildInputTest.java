package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * {@code buildInput}（native 路径的段落锚定产出者）单测 —— #943。
 *
 * <p><b>为什么补这个测试</b>：该方法此前<b>零覆盖</b>，而它是真机唯一在跑的路径上
 * 产出 {@code [N]} 锚点的地方。若它哪天静默丢掉锚点前缀，下游
 * {@code alignParagraphs} 将无法把译文对回原段落（表现为「整章回退原文 + console.warn」）。
 *
 * <p>已有的 {@code TranslationSseParserTest} <b>不覆盖此项</b>：它直接喂 SSE 文本给解析器，
 * 从不调用 {@code buildInput}，因此锚点产出侧一旦回退，0 个测试会转红。
 *
 * <p><b>Oracle 溯源</b>（AGENTS.md 测试硬约束 #6）—— 期望值不取自实现：
 * <ul>
 *   <li>锚点形态 {@code [N] } 与空行分隔 = {@code createNovelTranslator.alignParagraphs}
 *       的解析契约（{@code stripAnchorPrefix} + 按空行切分）；</li>
 *   <li>与 web 路径 {@code buildResponsesRequestBody}（api/translate.ts）产出的
 *       <b>锚定文本格式一致</b> —— 同一段落序列产出同一字符串（本测试内重算 web 公式
     *       比对，<b>非调用 web 实现</b>）。</li>
 * </ul>
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class PictelioTranslateBuildInputTest {

    @Test
    public void singleParagraphGetsZeroAnchorAndNoLeadingBlankLine() throws Exception {
        JSONArray paragraphs = new JSONArray().put("桜の花が咲く。");

        assertEquals("[0] 桜の花が咲く。", PictelioTranslateModule.buildInput(paragraphs));
    }

    @Test
    public void paragraphsAreAnchoredByIndexAndSeparatedByBlankLine() throws Exception {
        JSONArray paragraphs = new JSONArray().put("第一段").put("第二段").put("第三段");

        assertEquals("[0] 第一段\n\n[1] 第二段\n\n[2] 第三段", PictelioTranslateModule.buildInput(paragraphs));
    }

    /**
     * 锚点序号必须从 0 连续递增，且与段落下标一一对应。
     *
     * <p><b>变异验证</b>：把 {@code i} 写成 {@code 0} 或 {@code i+1}（锚点不再对位）本测试
     * 立即转红 —— 这是「译文能对回原段落」的最低必要条件。
     */
    @Test
    public void anchorIndexMatchesParagraphPosition() throws Exception {
        JSONArray paragraphs = new JSONArray().put("甲").put("乙").put("丙").put("丁");

        String built = PictelioTranslateModule.buildInput(paragraphs);

        assertTrue("第 0 段须以 [0] 开头", built.startsWith("[0] 甲"));
        assertTrue(built.contains("[1] 乙"));
        assertTrue(built.contains("[2] 丙"));
        assertTrue(built.contains("[3] 丁"));
    }

    /**
     * 本用例钉的是<b>与 web 路径的格式对等</b>（{@code translate.ts:241-243} 同样以
     * {@code \n\n} 分隔）—— 若分隔符被改成单个换行，web 路径的 {@code alignParagraphs}
     * 会把整章切成 1 段、其余静默回退原文。
     *
     * <p><b>口径</b>：native 路径的请求侧分隔符<b>不承重</b>（Java 按 {@code [N]} 正则切
     * 响应，与请求侧形态无关）。本用例保护的是跨端格式对等，而非 native 运行时行为；
     * native 的既存对齐缺陷见 #948。
     */
    @Test
    public void separatorIsBlankLineNotSingleNewline() throws Exception {
        JSONArray paragraphs = new JSONArray().put("第一段").put("第二段");

        String built = PictelioTranslateModule.buildInput(paragraphs);

        assertTrue("段间必须是空行（\\n\\n），单换行会让 alignParagraphs 只切出 1 段",
                built.contains("\n\n"));
        // 单换行切分不得命中段间 —— 逐段计数确保恰好 2 段
        int segments = built.split("\n\n+").length;
        assertEquals("按空行切分应恰好得到 2 段", 2, segments);
    }

    /** 空段落数组 → 空串（不产生只有锚点的残段）。 */
    @Test
    public void emptyParagraphsProduceEmptyString() throws Exception {
        assertEquals("", PictelioTranslateModule.buildInput(new JSONArray()));
    }

    /**
     * 锚定文本必须与 web 路径（{@code buildResponsesRequestBody}）<b>逐字节相同</b>。
     *
     * <p>这是 #943 的核心事实：两端产出的段落字符串本就一致，差异只在<b>外层报文形态</b>
     * （native 用标量字符串、web 用 {@code [{role,content}]}），而该差异对 Responses API
     * 合法且必需（原注释「两端 input 形态必须一致」是伪约束）。
     *
     * <p><b>口径澄清（#943 review 第 2 轮）</b>：本测试<b>不执行</b> web 实现，只在测试内
     * 重算其公式，故它是「格式契约锁」而非真正的双实现差分测试 —— 改 web 侧
     * {@code join('\n\n')} 本用例不会转红。web 侧的防线在
     * {@code translate.test.ts}「锚定段落以空行分隔」（已实证可捕获该漂移）。
     */
    @Test
    public void anchoredTextMatchesWebPathFormatByteForByte() throws Exception {
        String[] originals = {"桜の花が散る", "春が来た", "雪が降る"};

        JSONArray paragraphs = new JSONArray();
        StringBuilder webSide = new StringBuilder();
        for (int i = 0; i < originals.length; i++) {
            paragraphs.put(originals[i]);
            // web 侧：paragraphs.map((p,i) => `[${i}] ${p}`).join('\n\n')
            if (i > 0) {
                webSide.append("\n\n");
            }
            webSide.append("[").append(i).append("] ").append(originals[i]);
        }

        assertEquals(
                "native 与 web 路径的锚定文本必须逐字节相同（差异只应存在于外层报文形态）",
                webSide.toString(),
                PictelioTranslateModule.buildInput(paragraphs));
    }
}
