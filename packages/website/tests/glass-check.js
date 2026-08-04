// 渲染页玻璃验证（PRD #89 确认接缝）
// 运行方式：cd 仓库根目录 && playwright-cli open http://localhost:4321/pixivizer/
//           playwright-cli run-code --filename=packages/website/tests/glass-check.js
// 断言：.nav/.vc-badge/.theme-toggle/.vc-card 四处 backdrop-filter 含 blur+saturate；
//       --glass-* 变量亮/暗两套解析正确且有差异；输出亮/暗截图到 /tmp 供人工复核。
async (page) => {
  const targets = [".nav", ".vc-badge", ".theme-toggle", ".vc-card"];
  const surfaces = {};

  // 建立确定的暗色基线：class 与 localStorage 同步，避免复用浏览器会话时的状态残留
  await page.evaluate(() => {
    localStorage.setItem("pictelio-theme", "dark");
    document.documentElement.classList.add("dark");
  });

  for (const sel of targets) {
    const el = page.locator(sel).first();
    await el.scrollIntoViewIfNeeded();
    surfaces[sel] = await el.evaluate((el) => getComputedStyle(el).backdropFilter);
  }
  for (const sel of targets) {
    const bf = surfaces[sel];
    if (!bf || !bf.includes("blur") || !bf.includes("saturate")) {
      throw new Error(`[FAIL] ${sel} 缺少磨砂玻璃 backdrop-filter（当前: ${bf}）`);
    }
  }
  if (!Object.values(surfaces).every((bf) => bf.includes("blur"))) {
    throw new Error(`[FAIL] 暗色下四处未全部生效: ${JSON.stringify(surfaces)}`);
  }

  const readVars = () =>
    page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        blur: s.getPropertyValue("--glass-blur").trim(),
        saturate: s.getPropertyValue("--glass-saturate").trim(),
        tint: s.getPropertyValue("--glass-bg").trim(),
      };
    });

  const dark = await readVars();
  if (!dark.blur || !dark.saturate || !dark.tint) {
    throw new Error(`[FAIL] 暗色 --glass-* 变量未解析: ${JSON.stringify(dark)}`);
  }
  await page.screenshot({ path: "/tmp/glass-dark.png", fullPage: false });

  // 切亮色：同样同步 class 与 localStorage
  await page.evaluate(() => {
    localStorage.setItem("pictelio-theme", "light");
    document.documentElement.classList.remove("dark");
  });
  const light = await readVars();
  if (!light.blur || !light.saturate || !light.tint) {
    throw new Error(`[FAIL] 亮色 --glass-* 变量未解析: ${JSON.stringify(light)}`);
  }
  if (light.tint === dark.tint) {
    throw new Error("[FAIL] 亮/暗 --glass-bg 无差异");
  }
  for (const sel of targets) {
    const bf = await page.locator(sel).first().evaluate((el) => getComputedStyle(el).backdropFilter);
    if (!bf || !bf.includes("blur")) {
      throw new Error(`[FAIL] 亮色 ${sel} 无 blur（当前: ${bf}）`);
    }
  }
  await page.screenshot({ path: "/tmp/glass-light.png", fullPage: false });

  return `[PASS] glass checks ok (dark+light): ${JSON.stringify({ dark, light, surfaces })}`;
}
