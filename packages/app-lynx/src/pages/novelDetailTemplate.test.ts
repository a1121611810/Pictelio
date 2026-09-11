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
