// Mock OpenAI Responses API：第一个 chunk (stream=true) 返 5 段正常 delta + 1 个
// response.failed event (code=network)，触发 JS 端 retryable=true 判定 →
// 整批回退路径；第二个 chunk (stream=false, max_output_tokens × 2) 返完整 JSON
// 含所有 [N] 锚点拆段 → success → status=completed → 写缓存。
//
// Oracle 锚定（spec §7.2 + ADR-0178 D2）：
// - 触发条件：`result.status === "partial" || "failed"` && `lastErrorRetryable === true`
// - retryable 子集：network / server / incomplete
// - 整批回退请求体：stream=false, max_output_tokens × 2
// - 整批回退响应：status=completed + output[0].content[0].type=output_text + text 内 [N] 锚点
//
// 用法：
//   node mock-fail-then-recover.mjs        # 默认：流 1 chunk 触发失败，整批回退成功
//   FAIL_FIRST_CHUNK=0 node ...             # 不触发失败（用于 sanity）
import http from "node:http";

const PORT = 8811;

function sse(res, event, obj) {
  res.write("event: " + event + "\n");
  res.write("data: " + JSON.stringify(obj) + "\n\n");
}

/** Deterministic pseudo-translation: mark each paragraph. */
function translate(paragraph, idx) {
  return "【译" + idx + "】" + paragraph;
}

const FAIL_FIRST_CHUNK = process.env.FAIL_FIRST_CHUNK !== "0";

const server = http.createServer((req, res) => {
  if (!req.url.includes("/responses")) {
    res.writeHead(404).end("not found");
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let parsed = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      /* ignore */
    }
    const input = typeof parsed.input === "string" ? parsed.input : "";
    const paragraphs = input.split("\n\n").map((line) => line.replace(/^\[\d+\]\s*/, ""));
    console.log(
      `[mock] request model=${parsed.model} paragraphs=${paragraphs.length} stream=${parsed.stream}`,
    );

    // ── 流式路径 (stream=true) ──
    if (parsed.stream === true) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      sse(res, "response.created", {
        type: "response.created",
        response: { id: "resp_mock_stream" },
      });
      sse(res, "response.in_progress", {
        type: "response.in_progress",
        response: { id: "resp_mock_stream" },
      });
      sse(res, "response.output_item.added", {
        type: "response.output_item.added",
        output_index: 0,
      });
      sse(res, "response.content_part.added", {
        type: "response.content_part.added",
        output_index: 0,
      });

      if (FAIL_FIRST_CHUNK) {
        // 前 5 段正常 delta（让 hasText 检测不立刻判空流；也证明流真的建起来了）
        const DELTA_COUNT = Math.min(5, paragraphs.length);
        for (let i = 0; i < DELTA_COUNT; i++) {
          const text = `\n\n[${i}] ${translate(paragraphs[i], i)}`;
          for (const piece of text.match(/.{1,24}/gu) ?? []) {
            sse(res, "response.output_text.delta", {
              type: "response.output_text.delta",
              output_index: 0,
              delta: piece,
            });
          }
        }
        console.log("[mock] 流式返 5 段后发 response.failed (code=network) → 触发整批回退");
        // response.failed event: code=network → classifyNativeError → "network"
        // → isRetryableNativeError("network") === true → store fallbackToWholeBatch
        sse(res, "response.failed", {
          type: "response.failed",
          response: {
            id: "resp_mock_stream",
            error: {
              code: "network",
              message: "mock 流中断（用于触发整批回退路径）",
            },
          },
        });
      } else {
        // sanity mode：完整返所有段
        console.log("[mock] FAIL_FIRST_CHUNK=0：完整流式返段");
        for (let i = 0; i < paragraphs.length; i++) {
          const text = `\n\n[${i}] ${translate(paragraphs[i], i)}`;
          for (const piece of text.match(/.{1,24}/gu) ?? []) {
            sse(res, "response.output_text.delta", {
              type: "response.output_text.delta",
              output_index: 0,
              delta: piece,
            });
          }
        }
        sse(res, "response.output_text.done", {
          type: "response.output_text.done",
          output_index: 0,
        });
        sse(res, "response.completed", {
          type: "response.completed",
          response: {
            id: "resp_mock_stream",
            usage: { input_tokens: paragraphs.length, output_tokens: paragraphs.length * 2 },
          },
        });
      }
      res.end();
      return;
    }

    // ── 整批回退路径 (stream=false) ──
    // 单次 POST + 完整 JSON：拼所有 output_text，按 [N] 锚点拆段
    // Java 端 deliverWholeBatchJson 用 (?m)^\[(\d+)\]\s* 正则拆
    const all = paragraphs.map((p, i) => `[${i}] ${translate(p, i)}`).join("\n\n");
    console.log(`[mock] 整批回退响应返 ${paragraphs.length} 段 / ${all.length} 字符`);
    const responseBody = {
      id: "resp_mock_whole",
      status: "completed",
      output: [
        {
          content: [{ type: "output_text", text: all }],
        },
      ],
      usage: { input_tokens: paragraphs.length, output_tokens: paragraphs.length * 2 },
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(responseBody));
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`[mock] listening on ${PORT}`));
