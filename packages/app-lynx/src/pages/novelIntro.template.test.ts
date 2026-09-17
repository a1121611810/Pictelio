// 介绍页源级守卫（地图 #575 / spec #585 / 票 #586；对齐 novelDetailTemplate.test.ts 模式）。
// oracle：spec 决策（D 案全屏封面 + scrim、骨架/错误/成功三态、代闸防竞态、返回键语义）
// + 正文页既有范式（CoverImage 三态 / scrim token / 代闸）；web-core 预览不暴露真机差异，
// 模板源级断言做机器防线（仓库「模板/源码断言」约定）。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "NovelIntro.vue"), "utf-8");

describe("NovelIntro 三态与数据链路（#586）", () => {
  it("根 view 为 relative 全高（CoverImage full 布局 absolute inset-0 的定位锚点）", () => {
    expect(source).toContain('class="w-full h-full relative');
  });

  it("加载态：全屏封面位骨架（shimmer 铺满，D 案页内不滚动 → 无内容区骨架）", () => {
    expect(source).toMatch(/v-if="loading"[\s\S]*?shimmer/);
  });

  it("错误态：统一错误文案 + 重试按钮接回 loadNovel（IO 失败可恢复）", () => {
    expect(source).toMatch(/v-else-if="errorMsg"[\s\S]*?@tap="loadNovel"/);
  });

  it("成功态：全屏 CoverImage（layout=full + retry）承载 D 案封面", () => {
    const tag = source.match(/<CoverImage\s[\s\S]*?>/)?.[0] ?? "";
    expect(tag).toContain('layout="full"');
    expect(tag).toContain("retry");
  });

  it("scrim 用 M3 渐变 token（与推荐轮播同源，禁硬编码渐变）", () => {
    expect(source).toContain('style="background: var(--md-scrim-overlay)"');
  });

  it("数据链路：loadNovelDetail + 代闸 loadGeneration + presentError 兜底（非静默降级）", () => {
    expect(source).toContain("loadNovelDetail(novelId.value)");
    expect(source).toContain("loadGeneration");
    expect(source).toContain("presentError(err, t('error.fallback.loadFailed'))");
  });

  it("返回键接 goBack（介绍页返回不注册守卫——追更询问只在正文页触发，#582）", () => {
    expect(source).toMatch(/@tap="goBack"/);
    expect(source).not.toContain("registerBackGuard");
  });
});
