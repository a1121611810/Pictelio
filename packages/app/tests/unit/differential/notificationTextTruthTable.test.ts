/**
 * notificationPlainText 双端 differential 真值表（ADR-0188 D4 / spec 测试决策）。
 *
 * 双端一致性声明：本用例集与 lynx 侧
 * `packages/app-lynx/src/utils/notificationText.test.ts`（#728 交付）**等价镜像**——
 * 用例输入与期望值逐字同构、独立拷贝（禁跨包 import，类型双端字面量重复是该仓一贯形态）。
 * 任一端语义漂移（标签剔除 / 实体解码 / trim / null 宽容）在本端变红；
 * 跨端漂移由两侧真值表人工对照钉住（注释级契约，无跨包机器通道）。
 */
import { describe, expect, it } from "vitest";
import { notificationPlainText } from "@/utils/notificationText";

/** 双端共享真值表（与 lynx notificationText.test.ts 用例集逐字同构） */
const TRUTH_TABLE: { input: string | null | undefined; expected: string }[] = [
  {
    // 真实抓包样本（フォロー通知）
    input: "<b>ユーザーA</b>さんがあなたをフォローしました。",
    expected: "ユーザーAさんがあなたをフォローしました。",
  },
  {
    // 真实抓包样本（すき！通知：两段加粗 + emoji）
    input: "<b>ユーザーB</b>さんが<b>第 1 章：🌈 森林奇遇！神秘的彩虹蘑菇</b>にすき！しました。",
    expected: "ユーザーBさんが第 1 章：🌈 森林奇遇！神秘的彩虹蘑菇にすき！しました。",
  },
  { input: '<a href="x"><b>deep</b></a> text', expected: "deep text" },
  { input: 'a <span class="x">b</span><br/>c', expected: "a bc" },
  { input: "A &amp; B", expected: "A & B" },
  { input: "&lt;tag&gt;", expected: "<tag>" },
  { input: "&quot;q&quot;&#39;apos&nbsp;!", expected: '"q"\'apos !' },
  { input: "&amp;lt;", expected: "&lt;" },
  { input: " plain text ", expected: "plain text" },
  { input: "", expected: "" },
  { input: null, expected: "" },
  { input: undefined, expected: "" },
  { input: "  <b> x </b>  ", expected: "x" },
];

describe("notificationText 双端 differential 真值表（webview ↔ lynx 镜像）", () => {
  it("用例集与 lynx 等价：全部输入输出逐字一致", () => {
    for (const { input, expected } of TRUTH_TABLE) {
      expect(notificationPlainText(input)).toBe(expected);
    }
  });

  it("语义四支柱抽查（标签剔除 / 实体解码 / trim / null 宽容各一）", () => {
    expect(notificationPlainText("<b>名前</b>さん")).toBe("名前さん");
    expect(notificationPlainText("&amp;")).toBe("&");
    expect(notificationPlainText("  x  ")).toBe("x");
    expect(notificationPlainText(null)).toBe("");
  });
});
