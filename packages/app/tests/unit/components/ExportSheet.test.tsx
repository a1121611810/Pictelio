// @vitest-environment happy-dom
// ExportSheet 组件测试（oracle = spec docs/specs/novel-export.md §7.1：
// 9 格式齐全、默认预选设置页格式、临时覆盖、确认回调携带所选格式、内容摘要只读反映开关）。
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import ExportSheet from "@/components/ExportSheet";
import {
  DEFAULT_NOVEL_EXPORT_OPTIONS,
  NOVEL_EXPORT_FORMATS,
  NOVEL_EXPORT_FORMAT_LABELS,
} from "@pictelio/novel-export";

afterEach(cleanup);

// Solid 2.0 微任务批处理：点击后 await Promise.resolve() 再断言 DOM（对齐 PagePickerSheet.test.tsx）
const flush = () => Promise.resolve();

function renderSheet(over: Record<string, unknown> = {}) {
  const onExport = vi.fn();
  const onClose = vi.fn();
  render(() => (
    <ExportSheet
      isOpen
      onClose={onClose}
      defaultFormat="epub"
      options={DEFAULT_NOVEL_EXPORT_OPTIONS}
      onExport={onExport}
      {...over}
    />
  ));
  return { onExport, onClose };
}

describe("ExportSheet（spec novel-export §7.1）", () => {
  it("渲染全部 9 种格式的按钮（真实格式字面量为 oracle）", () => {
    renderSheet();
    expect(NOVEL_EXPORT_FORMATS).toHaveLength(9);
    for (const fmt of NOVEL_EXPORT_FORMATS) {
      const btns = screen.getAllByRole("button", {
        name: `导出格式 ${NOVEL_EXPORT_FORMAT_LABELS[fmt]}`,
      });
      expect(btns).toHaveLength(1);
    }
  });

  it("默认预选 defaultFormat（设置页全局默认）", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: "导出格式 EPUB" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "导出格式 PDF" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("点击格式为临时覆盖：切换选中态但不触发导出", async () => {
    const { onExport } = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "导出格式 PDF" }));
    await flush();
    expect(screen.getByRole("button", { name: "导出格式 PDF" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "导出格式 EPUB" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(onExport).not.toHaveBeenCalled();
  });

  it("确认导出回调携带所选格式", async () => {
    const { onExport } = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "导出格式 Markdown" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
    await flush();
    expect(onExport).toHaveBeenCalledWith("md");
  });

  it("内容摘要反映传入的开关（只读，不在面板内改）", () => {
    renderSheet({
      options: { includeMetadata: true, includeCover: false, includeInlineImages: true },
    });
    expect(screen.getByText(/正文（必含）/)).toBeTruthy();
    expect(screen.getByText(/元数据 开/)).toBeTruthy();
    expect(screen.getByText(/封面 关/)).toBeTruthy();
    expect(screen.getByText(/正文插图 开/)).toBeTruthy();
  });

  it("关闭态不渲染面板", () => {
    render(() => (
      <ExportSheet
        isOpen={false}
        onClose={() => {}}
        defaultFormat="txt"
        options={DEFAULT_NOVEL_EXPORT_OPTIONS}
        onExport={() => {}}
      />
    ));
    expect(screen.queryByRole("button", { name: "开始导出" })).toBeNull();
  });
});
