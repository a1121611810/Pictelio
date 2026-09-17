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

describe("NovelIntro 信息架构与受限/AI 态（#587）", () => {
  it("谓词与正文页同源（票 #580 差分对齐：settings.isRestricted / isAiRestricted）", () => {
    expect(source).toContain("const isRestricted = settings.isRestricted");
    expect(source).toContain("const isAiRestricted = settings.isAiRestricted");
  });

  it("受限遮罩顺序同正文页：R-18 优先（v-if）、AI mask 次之（v-else-if），level 由 x_restrict 派生", () => {
    expect(source).toContain(
      '<RestrictOverlay v-if="r18Masked" :level="novel.x_restrict === 2 ? 2 : 1" />',
    );
    expect(source).toContain('<AiOverlay v-else-if="aiMasked"');
  });

  it("CTA「开始阅读」：masked 置灰类绑定 + 处理器守卫（置灰=不可点，非仅视觉）", () => {
    expect(source).toContain("function startReading(): void {");
    expect(source).toMatch(/if \(masked\.value\) return/);
    expect(source).toContain("void navigate(`/novel/${novelId.value}`)");
    expect(source).toContain("? 'bg-white/20' : 'bg-primary");
  });

  it("简介展开入口与 CTA 同判定（#584：受限态入口置灰）", () => {
    expect(source).toMatch(/function openCaption\(\): void \{[\s\S]*?if \(masked\.value\) return/);
  });

  it("信息架构完整（票 #577）：AI 徽章/系列行+已追更/作者行/标签行/统计行/评论入口齐备", () => {
    expect(source).toContain("<AdaptiveTagRow");
    expect(source).toContain("t('novelDetail.seriesTitle'");
    expect(source).toContain("t('novelDetail.watchAdded')");
    expect(source).toMatch(/@tap="openAuthor"/);
    expect(source).toContain("void navigate(`/user/${id}`)");
    expect(source).toMatch(/novel\.total_view != null/); // 可选字段缺省显式降级（段隐藏）
    expect(source).toContain("t('aiOverlay.pure')");
    expect(source).toContain('type="novel"');
  });

  it("收藏按钮 target-kind='novel'（端点分派）+ 按 :key remount（init-only props 契约 ADR-0163）", () => {
    const tag = source.match(/<BookmarkButton\s[\s\S]*?>/)?.[0] ?? "";
    expect(tag).toContain('target-kind="novel"');
    expect(tag).toContain(":key=\"novel.id\"");
    expect(tag).toContain(':initial-bookmarked="novel.is_bookmarked"');
  });

  it("弹层挂载契约：评论/简介全文均 absolute inset-0 宿主脱离文档流（issue #139 同族）", () => {
    expect(source).toContain('<view v-if="showComments" class="absolute inset-0">');
    expect(source).toContain('<view v-if="captionOpen" class="absolute inset-0">');
    expect(source).toContain("<NovelCaptionSheet");
  });
});
