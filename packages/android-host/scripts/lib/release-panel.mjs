// 上传面板渲染模块（ADR-0065）
//
// 接口（外部 seam）：
//   createUploadPanel({ tty?, out? }) → { onEvent(event), finish() }
//
// - TTY：每个变体 APK 固定一行，原地刷新（\r + ESC[K，必要时光标上移）；上传中的行 1Hz 刷新耗时。
// - 非 TTY：每个事件输出一行纯文本（无 ANSI），可追溯日志。
// - 不引入 ora：手写最小 ANSI 控制，避免 Node 24 下 ora 刷屏（release-utils 有历史坑记录）。

const SIZE_MB = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
const SECS = (ms) => `${(ms / 1000).toFixed(0)}s`;
const MAX_TAIL = 120;

function fmtTail(tail) {
  return String(tail || "")
    .replace(/\s+/gu, " ")
    .slice(0, MAX_TAIL);
}

// 纯格式化：单行事件 → 文本行（可独立单测）。
export function formatEventLine(event) {
  switch (event.type) {
    case "started":
      return `[${event.name}] 上传中 · ${SIZE_MB(event.size)}`;
    case "retry":
      return `[${event.name}] 第 ${event.attempt + 1} 次尝试 · ${event.delayMs / 1000}s 后重试`;
    case "succeeded":
      return `[${event.name}] ✓ 成功 (${SECS(event.elapsedMs)}, ${event.avgMBps.toFixed(2)} MB/s)`;
    case "failed":
      return `[${event.name}] ✗ 失败: ${fmtTail(event.stderrTail)}`;
    default:
      return "";
  }
}

// 纯格式化：总结块（可独立单测）。
export function formatSummary(report) {
  const lines = ["─ 上传总结 ─"];
  for (const s of report.succeeded) lines.push(`  ✓ ${s.name}`);
  for (const f of report.failed) lines.push(`  ✗ ${f.name}（尝试 ${f.attempts} 次）`);
  lines.push(`  总耗时: ${SECS(report.totalElapsedMs)}`);
  return lines;
}

function rowLine(row, now) {
  if (row.status === "uploading") {
    return `[${row.name}] 上传中 ⏱ ${SECS(now - row.startedAt)} · ${SIZE_MB(row.size)}`;
  }
  return row.line;
}

export function createUploadPanel({
  tty = process.stderr?.isTTY === true,
  out = process.stderr,
} = {}) {
  const rows = new Map();
  let summary = null;
  let painted = false;
  let interval = null;

  const paint = () => {
    if (rows.size === 0) return;
    const lines = [...rows.values()].map((r) => rowLine(r, Date.now()));
    const n = lines.length;
    if (painted) out.write(`\x1b[${n}A`);
    for (const line of lines) out.write(`\r\x1b[K${line}\n`);
    painted = true;
  };

  const onEvent = (event) => {
    if (event.type === "summary") {
      summary = event.report;
      return;
    }
    if (event.type === "started") {
      rows.set(event.name, {
        status: "uploading",
        name: event.name,
        size: event.size,
        startedAt: Date.now(),
      });
    } else if (event.type === "retry") {
      const row = rows.get(event.name);
      if (row) {
        rows.set(event.name, {
          ...row,
          status: "uploading",
          startedAt: Date.now(),
          line: formatEventLine(event),
        });
      }
    } else if (event.type === "succeeded") {
      rows.set(event.name, {
        status: "done",
        result: "succeeded",
        name: event.name,
        size: event.size,
        line: formatEventLine(event),
      });
    } else if (event.type === "failed") {
      rows.set(event.name, {
        status: "done",
        result: "failed",
        name: event.name,
        size: 0,
        attempts: event.attempts,
        line: formatEventLine(event),
      });
    }
    if (tty) paint();
    else if (event.type !== "summary") out.write(`${formatEventLine(event)}\n`);
  };

  const finish = () => {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    if (tty && painted) {
      const n = rows.size;
      out.write(`\x1b[${n}A`);
      for (let i = 0; i < n; i++) out.write(`\r\x1b[K`);
    }
    const report = summary ?? {
      succeeded: [...rows.values()]
        .filter((r) => r.status === "done" && r.result === "succeeded")
        .map((r) => ({ name: r.name })),
      failed: [...rows.values()]
        .filter((r) => r.status === "done" && r.result === "failed")
        .map((r) => ({ name: r.name, attempts: r.attempts ?? 3 })),
      totalElapsedMs: 0,
    };
    for (const line of formatSummary(report)) out.write(`${line}\n`);
    painted = false;
  };

  if (tty) interval = setInterval(paint, 1000);

  return { onEvent, finish };
}
