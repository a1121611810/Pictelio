package io.pictelio.app;

import org.json.JSONObject;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * OpenAI Responses API 的 SSE 行解析器（纯逻辑，无 IO、无 Lynx 依赖）。
 *
 * <p>从 PictelioTranslateModule 抽出：最高风险的解析逻辑必须能在 CI 内被单测覆盖
 * （该模块此前零防线；真机定位的三个缺陷里有两个本该在这里被拦下）。
 *
 * <p>状态**每次流一个实例**：anchorIndex（最近出现的 [N] 锚标记）与 anchorCarry
 * （被切断的锚标记前缀）跨行保持。
 */
class TranslationSseParser {

    /** 段落锚标记：模型按 [N] 前缀逐段输出（与 api/translate.ts 的 input 形态同源）。 */
    private static final Pattern PARAGRAPH_ANCHOR = Pattern.compile("\\[(\\d+)\\]");

    /** 帧回调（chunkJson / doneJson / 第二参错误串）。 */
    interface Sink {
        void emit(String payload, String error);
    }

    private int anchorIndex = 0;
    private final StringBuilder anchorCarry = new StringBuilder();
    /**
     * 段落文本累积（index → text）。
     *
     * <p>为什么累积而不是逐帧下发：lynx 的 NativeModule 回调在「一次流内连续 invoke 多帧」
     * 时只投递其中一帧（模拟器实测：Java 入队 9 帧、JS store 只消费 1 帧；拉模式逐帧派发
     * 同样如此）。改为一帧交付整章译文，绕过该限制 —— 代价是失去逐段增量，但保证译文能到。
     */
    private final java.util.TreeMap<Integer, StringBuilder> paragraphText = new java.util.TreeMap<>();

    /** 若无终态事件即断流，也要把已累积的译文交付（DeepSeek 常见形态） */
    void flushIfAny(Sink sink) {
        if (!paragraphText.isEmpty()) {
            emitConsolidated(sink);
            paragraphText.clear();
        }
    }

    /** 是否已产出过任何译文段 */
    boolean hasText() {
        return !paragraphText.isEmpty();
    }

    /**
     * 把累积的段落译文作为**单帧**下发（一帧 = 一次回调 = 不会被桥丢弃）。
     * 形态与逐帧 delta 同构：{@code {type:"delta", paragraphIndex:N, text:"..."}}，
     * 只是每段只发一次、内容为该段全文。
     */
    void emitConsolidated(Sink sink) {
        for (java.util.Map.Entry<Integer, StringBuilder> e : paragraphText.entrySet()) {
            try {
                JSONObject chunk = new JSONObject();
                chunk.put("type", "delta");
                chunk.put("paragraphIndex", String.valueOf(e.getKey()));
                // 段落级裁剪：锚标记前的 "\n\n" 段落分隔空白不属于译文
                chunk.put("text", e.getValue().toString().trim());
                sink.emit(chunk.toString(), "");
            } catch (Exception ignored) {
                // JSONObject.put 对 String 不抛；防御性忽略
            }
        }
    }

    /**
     * 处理单行 SSE。
     *
     * @return null = 继续读；TRUE = 出现成功终态（done）；FALSE = 出现失败终态
     */
    Boolean accept(String line, Sink sink) {
        if (line == null || line.isEmpty()) {
            return null; // SSE 帧分隔（空行）
        }
        if (!line.startsWith("data: ")) {
            return null; // event: / id: / 注释行（事件类型在 data 载荷里）
        }
        String payload = line.substring("data: ".length());
        try {
            JSONObject event = new JSONObject(payload);
            String type = event.optString("type");
            switch (type) {
                case "response.output_text.delta": {
                    String delta = event.optString("delta");
                    String window = anchorCarry.toString() + delta;
                    anchorCarry.setLength(0);
                    Matcher m = PARAGRAPH_ANCHOR.matcher(window);
                    int lastEnd = 0;
                    boolean matched = false;
                    while (m.find()) {
                        anchorIndex = Integer.parseInt(m.group(1));
                        lastEnd = m.end();
                        matched = true;
                    }
                    String text = window.substring(matched ? lastEnd : 0);
                    // 锚标记后的单个空格是分隔符，不属于译文（Java 侧 input 形态为 "[N] 文本"）
                    if (matched && text.startsWith(" ")) {
                        text = text.substring(1);
                    }
                    if (!matched && window.length() > 0 && window.charAt(window.length() - 1) == '[') {
                        anchorCarry.append('[');
                        text = window.substring(0, window.length() - 1);
                    }
                    paragraphText
                            .computeIfAbsent(anchorIndex, k -> new StringBuilder())
                            .append(text);
                    return null;
                }
                case "response.reasoning_text.delta": {
                    JSONObject chunk = new JSONObject();
                    chunk.put("type", "reasoning_delta");
                    chunk.put("text", event.optString("delta"));
                    sink.emit(chunk.toString(), "");
                    return null;
                }
                case "response.completed": {
                    emitConsolidated(sink);
                    JSONObject done = new JSONObject();
                    done.put("type", "done");
                    JSONObject resp = event.optJSONObject("response");
                    if (resp != null) {
                        JSONObject usage = resp.optJSONObject("usage");
                        if (usage != null) {
                            done.put("usage", usage);
                        }
                    }
                    sink.emit(done.toString(), "");
                    return Boolean.TRUE;
                }
                case "response.failed": {
                    JSONObject resp = event.optJSONObject("response");
                    JSONObject errObj = resp != null ? resp.optJSONObject("error") : null;
                    String code = errObj != null ? errObj.optString("code", "server") : "server";
                    String message = errObj != null ? errObj.optString("message", "stream failed") : "stream failed";
                    sink.emit("", "LLM stream failed [" + code + "]: " + message);
                    return Boolean.FALSE;
                }
                case "response.incomplete": {
                    JSONObject resp = event.optJSONObject("response");
                    JSONObject incomplete = resp != null ? resp.optJSONObject("incomplete_details") : null;
                    String reason = incomplete != null ? incomplete.optString("reason", "truncated") : "truncated";
                    sink.emit("", "LLM output truncated: " + reason);
                    return Boolean.FALSE;
                }
                case "error": {
                    sink.emit("", "LLM error: " + event.optString("message", "server error"));
                    return Boolean.FALSE;
                }
                default:
                    return null; // 未识别事件（created / in_progress / item.done…）跳过
            }
        } catch (Exception e) {
            // 单帧解析失败 → 跳过该帧，不中断流（ADR-0170 §D6 后段）
            return null;
        }
    }
}
