import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * 备份排除规则一致性测试（防漂移）
 *
 * 背景（docs/research/android-token-storage.md h 节）：
 * 备份 XML 的 exclude path 是精确字符串匹配，且文件名必须与插件实际落盘
 * 文件名一致，否则排除规则静默失效。本项目曾因排除 `_capacitor_secure_storage.xml`
 * 而插件实际写 `WSSecureStorageSharedPreferences.xml`，导致密文随备份导出。
 *
 * 本测试从插件源码提取真实常量，与两份备份 XML 对照，任何一方漂移即红灯。
 */

// ── 路径（相对本测试文件：packages/app/tests/unit/utils/） ──
const testDir = path.dirname(fileURLToPath(import.meta.url));
const pluginSource = path.resolve(
  testDir,
  "../../../node_modules/@aparajita/capacitor-secure-storage/android/src/main/java/com/aparajita/capacitor/securestorage/SecureStorage.java",
);
const resXmlDir = path.resolve(testDir, "../../../android/app/src/main/res/xml");
const dataExtractionRules = path.join(resXmlDir, "data_extraction_rules.xml");
const backupRules = path.join(resXmlDir, "backup_rules.xml");

/** 从插件源码提取 SharedPreferences 文件名常量（形如 `"WSSecureStorageSharedPreferences"`） */
function extractPluginPrefsFile(): string {
  const source = readFileSync(pluginSource, "utf8");
  const candidates = [...source.matchAll(/=\s*"([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
  const prefsFile = candidates.find((name) => name.endsWith("SharedPreferences"));
  if (!prefsFile) {
    throw new Error(`未能从插件源码提取 SharedPreferences 文件名常量: ${pluginSource}`);
  }
  return prefsFile;
}

/** 提取 XML 中 <section> 段内 domain=sharedpref 的 exclude path 列表 */
function extractSectionExcludes(xml: string, section: string): string[] {
  const sectionMatch = xml.match(new RegExp(`<${section}>([\\s\\S]*?)<\\/${section}>`));
  if (!sectionMatch) {
    throw new Error(`XML 中未找到 <${section}> 段`);
  }
  const re = /<exclude domain="sharedpref" path="([^"]+)"\s*\/>/g;
  return [...sectionMatch[1].matchAll(re)].map((m) => m[1]);
}

describe("备份排除规则一致性（防漂移）", () => {
  const pluginPrefsFile = extractPluginPrefsFile();
  // Native 层历史明文残留文件（PixivApiPlugin PREFS_NAME，纵深防御）
  const nativePrefsFile = "PictelioPrefs.xml";
  // XML 的 exclude path 是完整文件名（带扩展名），插件常量是不带扩展名的类名
  const expectedExcludes = [`${pluginPrefsFile}.xml`, nativePrefsFile];

  it(`插件实际落盘文件名为 ${pluginPrefsFile}（从源码提取）`, () => {
    expect(pluginPrefsFile).toBe("WSSecureStorageSharedPreferences");
  });

  it("data_extraction_rules.xml：cloud-backup 排除插件密文文件与 Native 残留文件", () => {
    const xml = readFileSync(dataExtractionRules, "utf8");
    const excludes = extractSectionExcludes(xml, "cloud-backup");
    for (const expected of expectedExcludes) {
      expect(excludes, `cloud-backup 应排除 ${expected}`).toContain(expected);
    }
  });

  it("data_extraction_rules.xml：device-transfer 排除插件密文文件与 Native 残留文件", () => {
    const xml = readFileSync(dataExtractionRules, "utf8");
    const excludes = extractSectionExcludes(xml, "device-transfer");
    for (const expected of expectedExcludes) {
      expect(excludes, `device-transfer 应排除 ${expected}`).toContain(expected);
    }
  });

  it("backup_rules.xml（Android 11-）：排除插件密文文件与 Native 残留文件", () => {
    const xml = readFileSync(backupRules, "utf8");
    const excludes = extractSectionExcludes(xml, "full-backup-content");
    for (const expected of expectedExcludes) {
      expect(excludes, `full-backup-content 应排除 ${expected}`).toContain(expected);
    }
  });

  it("两个 XML 的排除集合完全一致（cloud-backup / device-transfer / full-backup 三份不漂移）", () => {
    const der = readFileSync(dataExtractionRules, "utf8");
    const br = readFileSync(backupRules, "utf8");
    const cloud = extractSectionExcludes(der, "cloud-backup");
    const device = extractSectionExcludes(der, "device-transfer");
    const full = extractSectionExcludes(br, "full-backup-content");
    expect(device).toEqual(cloud);
    expect(full).toEqual(cloud);
  });
});
