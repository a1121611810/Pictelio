// Mock OpenAI Responses-compatible SSE server for on-device E2E verification.
// Replays a deterministic translation so the app-side chain can be verified without
// depending on the emulator's flaky route to api.deepseek.com.
import http from "node:http";

const PORT = 8811;

function sse(res, event, obj) {
  res.write("event: " + event + "\n");
  res.write("data: " + JSON.stringify(obj) + "\n\n");
}

/** Deterministic pseudo-translation: mark each paragraph so the UI text proves the round-trip. */
function translate(paragraph, idx) {
  return "【译" + idx + "】" + paragraph;
}

const server = http.createServer((req, res) => {
  if (!req.url.includes("/responses")) {
    res.writeHead(404).end("not found");
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    let parsed = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      /* ignore */
    }
    const input = typeof parsed.input === "string" ? parsed.input : "";
    const paragraphs = input.split("\n\n").map((line) => line.replace(/^\[\d+\]\s*/, ""));
    console.log(
      "[mock] request model=" +
        parsed.model +
        " paragraphs=" +
        paragraphs.length +
        " stream=" +
        parsed.stream,
    );

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    sse(res, "response.created", { type: "response.created", response: { id: "resp_mock" } });
    sse(res, "response.in_progress", {
      type: "response.in_progress",
      response: { id: "resp_mock" },
    });
    sse(res, "response.output_item.added", { type: "response.output_item.added", output_index: 0 });
    sse(res, "response.content_part.added", {
      type: "response.content_part.added",
      output_index: 0,
    });
    const TINY = process.env.MOCK_TINY === "1";
    const count = TINY ? Math.min(3, paragraphs.length) : paragraphs.length;
    for (let i = 0; i < count; i++) {
      const text = `\n\n[${i}] ${translate(paragraphs[i], i)}`;
      for (const piece of text.match(/.{1,24}/gu) ?? []) {
        sse(res, "response.output_text.delta", {
          type: "response.output_text.delta",
          output_index: 0,
          delta: piece,
        });
      }
      await new Promise((r) => setTimeout(r, TINY ? 300 : 20));
    }
    sse(res, "response.output_text.done", { type: "response.output_text.done", output_index: 0 });
    sse(res, "response.completed", {
      type: "response.completed",
      response: { id: "resp_mock", usage: { input_tokens: 1, output_tokens: 2 } },
    });
    res.end();
  });
});

server.listen(PORT, "0.0.0.0", () => console.log("[mock] listening on " + PORT));
