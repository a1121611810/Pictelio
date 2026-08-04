// 渲染页玻璃验证（PRD #89 确认接缝）
// 运行方式：cd 仓库根目录 && playwright-cli open http://localhost:4321/pixivizer/
//           playwright-cli run-code --filename=packages/website/tests/glass-check.js
// 断言：.nav/.vc-badge/.theme-toggle/.vc-card/.vc-btn-primary/.vc-btn-glow 六处
//       backdrop-filter 含 blur+saturate；按钮文字色暗色 #f5f5f5 / 亮色 #111；
//       --glass-* 变量亮/暗两套解析正确且有差异；输出亮/暗截图到 /tmp 供人工复核。
async (page) => {
  const targets = [".nav", ".vc-badge", ".theme-toggle", ".vc-card", ".vc-btn-primary", ".vc-btn-glow"];
  const surfaces = {};

  // 建立确定的暗色基线：class 与 localStorage 同步，避免复用浏览器会话时的状态残留
  await page.evaluate(() => {
    localStorage.setItem("pictelio-theme", "dark");
    document.documentElement.classList.add("dark");
  });
  // 按钮 background 有 0.2s 过渡，等待样式稳定后再断言
  await page.waitForTimeout(250);

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
  for (const sel of [".vc-btn-primary", ".vc-btn-glow"]) {
    const color = await page.locator(sel).first().evaluate((el) => getComputedStyle(el).color);
    if (color !== "rgb(245, 245, 245)") {
      throw new Error(`[FAIL] 暗色 ${sel} 文字色应为 #f5f5f5（当前: ${color}）`);
    }
  }
  for (const sel of [".vc-btn-primary", ".vc-btn-glow"]) {
    const bg = await page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
    if (!bg.includes("90, 159, 212")) {
      throw new Error(`[FAIL] 暗色 ${sel} 玻璃底色应为品牌蓝调 rgba(90,159,212,*)（当前: ${bg}）`);
    }
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
  await page.waitForTimeout(250);
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
  for (const sel of [".vc-btn-primary", ".vc-btn-glow"]) {
    const color = await page.locator(sel).first().evaluate((el) => getComputedStyle(el).color);
    if (color !== "rgb(17, 17, 17)") {
      throw new Error(`[FAIL] 亮色 ${sel} 文字色应为 #111（当前: ${color}）`);
    }
  }
  for (const sel of [".vc-btn-primary", ".vc-btn-glow"]) {
    const bg = await page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
    if (!bg.includes("43, 87, 154")) {
      throw new Error(`[FAIL] 亮色 ${sel} 玻璃底色应为品牌蓝调 rgba(43,87,154,*)（当前: ${bg}）`);
    }
  }
  await page.screenshot({ path: "/tmp/glass-light.png", fullPage: false });

  return `[PASS] glass checks ok (dark+light): ${JSON.stringify({ dark, light, surfaces })}`;
}
