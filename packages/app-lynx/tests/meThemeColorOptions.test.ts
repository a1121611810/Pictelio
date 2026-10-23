// ─── Me.vue 主题色选项清单契约（#776：清单驱动收敛后的登记防线）───
//
// 背景：Me.vue 外观组原为 7 份近乎相同的手写色块模板（每块 ~15 行），主题色 id 字面量
// 散落 4 处（themeColor === 'x' / appearanceClasses('x', …) / ME_A11Y_LABELS.themeColorX /
// setThemeColor('x') / t('me.appearance.colorX')）。本票收敛为**清单驱动的单块 v-for**。
//
// 本文件钉住收敛后清单的三条不变量（期望值全部取自**独立真实事实源**，禁自洽反推）：
//   ① 清单的成员与顺序 = 主题色单一事实源（src/utils/themeColor.ts 的 THEME_COLOR_OPTIONS）
//      —— 第 8 支主题若漏登记清单（或登记顺序错、与 UI 顺序不符），本文件即红；
//   ② 每支主题的 i18n 键在**真实词条表**（zh-CN / en pages 字典）里真实存在；
//   ③ 每支主题的 a11y label 在**真实注册表**（ME_A11Y_LABELS）里存在。
// 另附两条反向覆盖断言：词条表里多出来的 me.appearance.color* 键、注册表里多出来的
// themeColor* 键，都必须已被清单登记（防「加了字典/标签却漏加色块」）。
//
// 抽取方式：清单在 Me.vue 的 <script setup> 里是源码文本（.vue 组件在 node 环境无法直接
// import 实例），故按源码形态抽取；抽取器有下界自检（抽不到条目即红，防正则失效恒真）。
//
// **已知失效面（不假装已覆盖）**：
//   - 本门禁只验**接线**（清单成员 / 顺序 / i18n 键存在 / a11y 键存在），**不渲染、不取像素**
//     ⇒ 「设置页实际渲染出 7 个色块、顺序与视觉正确」不在本门禁面内；
//   - i18n 断言只验**键的双向闭合**（字典 ⊆ 清单 ⊆ 字典），**不验文案内容本身正确**
//     ——「me.appearance.colorX 的显示文本是否恰当」是人工走查面；
//   - a11y 断言只验 `ME_A11Y_LABELS` 里**键存在**，不验读屏实际播报内容；
//   - 抽取器依赖 `const themeColorOptions = [` … `] as const` 的**源码形态** ⇒ 若改为
//     `satisfies` / 动态生成 / 抽到独立常量文件，抽取器会失效（下界自检兜底：抽不到即红）；
//   - 覆盖面只及 Me.vue 外观组这一处清单；其它页面若日后出现同类色块登记，不在本门禁面内；
//   - 键名前缀口径（`me.appearance.color*` / `themeColor*`）写死 ⇒ 日后若改用别的命名
//     前缀，反向闭合断言会扫不到新增键。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { THEME_COLOR_OPTIONS } from "../src/utils/themeColor";
import { ME_A11Y_LABELS } from "../src/utils/accessibility";
import zhPages from "../src/i18n/locales/zh-CN/pages";
import enPages from "../src/i18n/locales/en/pages";

const meVue = readFileSync(fileURLToPath(new URL("../src/pages/Me.vue", import.meta.url)), "utf8");
const templateBlock = meVue.slice(meVue.indexOf("<template>"));

interface ThemeColorEntry {
  /** 主题色 id（持久化与校验口径，= THEME_COLOR_OPTIONS 的 id） */
  id: string;
  /** i18n 键（色块下方文案，完整键字符串 ⇒ i18n 死键门禁可静态扫到） */
  labelKey: string;
  /** ME_A11Y_LABELS 注册表键（色块 accessibility-label） */
  a11yKey: string;
}

/** 清单块（`const themeColorOptions = [` … `] as const`）在源码中的位置 */
const listStart = meVue.indexOf("const themeColorOptions = [");
const listEnd = meVue.indexOf("] as const", listStart);
const listBlock = listStart >= 0 && listEnd > listStart ? meVue.slice(listStart, listEnd) : "";

/** 逐条目抽 (id, i18n 键, a11y 注册表键)——三项在源码里相邻，按出现顺序即清单顺序 */
const entries: ThemeColorEntry[] = [...listBlock.matchAll(/id: '([^']+)',\s*labelKey: '([^']+)',\s*a11yLabel: ME_A11Y_LABELS\.(\w+)/g)].map(
  (m) => ({ id: m[1], labelKey: m[2], a11yKey: m[3] }),
);

describe("Me.vue 主题色选项清单（#776 清单驱动收敛）", () => {
  it("抽取器自身有效：清单条目 ≥ 7 且三字段形态齐全（防正则失效导致恒真）", () => {
    expect(listBlock, "Me.vue 未找到 themeColorOptions 清单块（抽取器失配或清单被改形）").not.toBe("");
    expect(entries.length, "清单条目抽取数异常").toBeGreaterThanOrEqual(7);
    for (const e of entries) {
      expect(e.id, "id 形态异常").toMatch(/^\w+$/);
      expect(e.labelKey, "i18n 键形态异常").toMatch(/^me\.appearance\.color\w+$/);
      expect(e.a11yKey, "a11y 注册表键形态异常").toMatch(/^themeColor\w+$/);
    }
  });

  it("清单成员与顺序 = 主题色单一事实源 THEME_COLOR_OPTIONS（数量/成员/顺序三合一）", () => {
    // oracle = src/utils/themeColor.ts 的清单（id 单一事实源），不是本清单自身反推
    expect(entries.map((e) => e.id)).toEqual(THEME_COLOR_OPTIONS.map((o) => o.id));
  });

  it("每支主题的 i18n 键在 zh-CN / en 真实词条表里存在（键完整性）", () => {
    for (const e of entries) {
      const zh = zhPages[e.labelKey as keyof typeof zhPages];
      const en = enPages[e.labelKey as keyof typeof enPages];
      expect(typeof zh, `zh-CN 词条缺 ${e.labelKey}`).toBe("string");
      expect(typeof en, `en 词条缺 ${e.labelKey}`).toBe("string");
    }
  });

  it("词条表里每个 me.appearance.color* 键都已被清单登记（防第 8 支漏加色块）", () => {
    const dictKeys = Object.keys(zhPages).filter((k) => k.startsWith("me.appearance.color"));
    expect(dictKeys.slice().sort()).toEqual(entries.map((e) => e.labelKey).sort());
  });

  it("每支主题的 a11y label 在 ME_A11Y_LABELS 注册表里存在（屏读器可读）", () => {
    for (const e of entries) {
      const label = ME_A11Y_LABELS[e.a11yKey as keyof typeof ME_A11Y_LABELS];
      expect(typeof label, `a11y 注册表缺 ${e.a11yKey}`).toBe("string");
      expect((label as string).length, `a11y label 为空：${e.a11yKey}`).toBeGreaterThan(0);
    }
  });

  it("注册表里每个 themeColor* 键都已被清单引用（防漏标 → 屏读器读不到色块）", () => {
    const registryKeys = Object.keys(ME_A11Y_LABELS).filter((k) => k.startsWith("themeColor"));
    expect(registryKeys.slice().sort()).toEqual(entries.map((e) => e.a11yKey).sort());
  });

  it("模板单块 v-for 渲染清单：不再逐 id 手写色块", () => {
    expect(templateBlock).toContain('v-for="option in themeColorOptions"');
    // 模板内不再有逐 id 的选中态判定 / 选中动作（这些随选项下沉到清单）
    expect(templateBlock).not.toMatch(/themeColor === '/);
    expect(templateBlock).not.toMatch(/setThemeColor\('/);
    expect(templateBlock.match(/<AppIcon v-if="themeColor/g) ?? []).toHaveLength(1);
  });

  it("色块结构与样式类保持不变（纯重构：行容器 / 色块 / 预览 / 文案四层 class 逐字钉住）", () => {
    expect(templateBlock).toContain('class="flex flex-row items-start justify-between"');
    expect(templateBlock).toContain(
      'class="w-10 h-10 rounded-full flex items-center justify-center border-[0.533vw]"',
    );
    expect(templateBlock).toContain(
      'class="w-8 h-8 rounded-full bg-primary flex items-center justify-center"',
    );
    expect(templateBlock).toContain('class="text-label-small text-surface-on-variant"');
  });

  it("逐 id 的字面量调用点仍各一处（既有门禁 unit.test.ts / appearanceClasses.test.ts 的着力点）", () => {
    for (const e of entries) {
      expect(meVue, `缺 ${e.id} 的选中动作字面量`).toContain(`settings.setThemeColor('${e.id}')`);
      expect(meVue, `缺 ${e.id} 的色板类字面量`).toContain(
        `...appearanceClasses('${e.id}', resolvedDark)`,
      );
    }
  });

  it("a11y 两项随选项走（保住「每条 label 配一个 element」的源码配平不变量）", () => {
    expect(templateBlock).toContain(':accessibility-label="option.a11yLabel"');
    expect(templateBlock).toContain(':accessibility-element="option.a11yElement"');
  });
});
