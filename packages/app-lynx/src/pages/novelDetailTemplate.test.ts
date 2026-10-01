// NovelDetail 覆盖层布局流回归（issue #139 / SearchSheet 注释同族）。
// oracle = IllustDetail 的既定正确结构（flex flex-col relative 根 + flex-1 min-h-0 滚动容器 +
// absolute inset-0 覆盖层宿主）与仓库记录的原生 LynxView 现象（web-core 不暴露该差异，
// 故用模板源级断言做机器防线，对齐 downloadManagerTemplate.test.ts / ugoiraViewerTemplate.test.ts 模式）。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "NovelDetail.vue"), "utf-8");

describe("NovelDetail 覆盖层布局流（issue #139 同族）", () => {
  it("根 view 为 flex flex-col relative（absolute 覆盖层的定位锚点 + 让出高度）", () => {
    expect(source).toContain('class="w-full h-full flex flex-col relative bg-surface"');
  });

  it("正文 list 用 flex-1 min-h-0（满高会把覆盖层顶出视口）", () => {
    // list 起始标签后的首个 class 必须含 flex-1 min-h-0
    // <list\s 要求标签名后是空白（排除 <list-item 与注释里的 <list> 字样）
    const listTag = source.match(/<list\s[\s\S]*?>/)?.[0] ?? "";
    expect(listTag).toContain("flex-1 min-h-0");
    expect(listTag).not.toContain('class="w-full h-full"');
  });

  it("评论 / 导出弹层均包裹在 absolute inset-0 离流宿主内", () => {
    expect(source).toContain('<view v-if="showComments" class="absolute inset-0">');
    expect(source).toContain('<view v-if="exportOpen" class="absolute inset-0">');
  });

  it("两个弹层组件不再是文档流内直接子节点", () => {
    expect(source).not.toMatch(/<CommentOverlay\s+v-if=/);
    expect(source).not.toMatch(/<NovelExportSheet\s+v-if=/);
  });
});

// ─── 头部精简（spec #585 / 票 #589；oracle = 地图决策 #578：正文页 = 标题+作者+评论/导出）───
describe("正文页头部精简（spec #585 / 票 #589）", () => {
  it("统计行（字数·收藏）与系列行（含已追更 chip）已移除——信息由介绍页（NovelIntro）承载", () => {
    expect(source).not.toContain("t('novelDetail.charCount'");
    expect(source).not.toContain("t('novelDetail.seriesTitle'");
    expect(source).not.toContain("t('novelDetail.watchAdded'");
  });

  it("标题 + 作者 + 评论入口 + 导出入口保留（票 #578：评论两端都留、导出不动）", () => {
    // #893：标题经 utils/artworkTitle 归一化（Pixiv 对无标题作品返回未本地化的
      // 字面串 "no title"，裸插值会把该串直接显示给用户）。此处顺带把「走归一化出口」
      // 钉进判据，而不是只钉「标题行存在」。
      expect(source).toContain('{{ artworkTitle(novel?.title) }}');
    expect(source).toContain('by {{ novel?.user.name }}');
    expect(source).toContain('@tap="showComments = true"');
    expect(source).toContain('@tap="exportOpen = true"');
  });
});
