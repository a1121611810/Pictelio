// 渲染页玻璃验证（PRD #89 确认接缝）
// 运行方式：cd 仓库根目录 && playwright-cli open http://localhost:4321/pixivizer/
//           playwright-cli run-code --filename=packages/website/tests/glass-check.js
// 断言：.nav/.vc-badge/.theme-toggle/.vc-card/.vc-btn-primary 五处玻璃表面
//       backdrop-filter 含 blur+saturate；badge/按钮默认文字色与卡片一致（中性），
//       hover 时变为品牌蓝（暗 #5a9fd4 / 亮 #2b579a）；
//       --glass-* 变量亮/暗两套解析正确且有差异；输出亮/暗截图到 /tmp 供人工复核。
async (page) => {
  const targets = [".nav", ".vc-badge", ".theme-toggle", ".vc-card", ".vc-btn-primary"];
  const surfaces = {};

  // 建立确定的暗色基线：class 与 localStorage 同步，避免复用浏览器会话时的状态残留
  await page.evaluate(() => {
    localStorage.setItem("pictelio-theme", "dark");
    document.documentElement.classList.add("dark");
  });
  // 玻璃表面有 0.2~0.3s 过渡（含 badge/按钮 color 0.3s），等待样式稳定后再断言
  await page.waitForTimeout(400);

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
  for (const sel of [".vc-badge", ".vc-btn-primary"]) {
    const color = await page.locator(sel).first().evaluate((el) => getComputedStyle(el).color);
    if (color !== "rgb(232, 232, 234)") {
      throw new Error(`[FAIL] 暗色 ${sel} 默认文字色应与卡片一致 var(--text) #e8e8ea（当前: ${color}）`);
    }
  }
  for (const sel of [".vc-btn-primary"]) {
    const bg = await page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
    if (!bg.includes("255, 255, 255")) {
      throw new Error(`[FAIL] 暗色 ${sel} 玻璃底色应为中性 rgba(255,255,255,*)（当前: ${bg}）`);
    }
  }
  for (const sel of [".vc-badge", ".vc-btn-primary"]) {
    await page.locator(sel).first().hover();
    await page.waitForTimeout(600);
    const color = await page.locator(sel).first().evaluate((el) => getComputedStyle(el).color);
    if (color !== "rgb(90, 159, 212)") {
      throw new Error(`[FAIL] 暗色 ${sel} hover 文字色应为品牌蓝 #5a9fd4（当前: ${color}）`);
    }
    await page.mouse.move(0, 0);
    await page.waitForTimeout(600);
  }
  // 结构断言：hero 版本信息行 + 下载卡版本 pill + 更新日志链接
  if ((await page.locator(".vc-download-meta").count()) === 0) {
    throw new Error("[FAIL] hero 下载区缺少版本信息行 .vc-download-meta");
  }
  if ((await page.locator(".vc-version-pill").count()) === 0) {
    throw new Error("[FAIL] 缺少版本 pill .vc-version-pill");
  }
  if ((await page.locator("a.vc-meta-link, a.vc-changelog-link").count()) === 0) {
    throw new Error("[FAIL] 缺少更新日志链接");
  }
  // 导航迷你下载按钮：初始隐藏 → 滚动离开 hero 下载区后显示 → 回顶隐藏
  const mini = page.locator(".nav-download-mini");
  if ((await mini.count()) === 0) {
    throw new Error("[FAIL] 缺少导航迷你下载按钮 .nav-download-mini");
  }
  if ((await mini.getAttribute("class"))?.includes("visible")) {
    throw new Error("[FAIL] 迷你下载按钮初始应为隐藏态");
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  if (!(await mini.getAttribute("class"))?.includes("visible")) {
    throw new Error("[FAIL] 滚动离开 hero 下载区后迷你按钮应显示");
  }
  const miniOpacity = await mini.evaluate((el) => getComputedStyle(el).opacity);
  if (miniOpacity === "0") {
    throw new Error("[FAIL] 显示态迷你按钮 opacity 应为 1");
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  if ((await mini.getAttribute("class"))?.includes("visible")) {
    throw new Error("[FAIL] 回顶后迷你按钮应隐藏");
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
  await page.waitForTimeout(400);
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
  for (const sel of [".vc-badge", ".vc-btn-primary"]) {
    const color = await page.locator(sel).first().evaluate((el) => getComputedStyle(el).color);
    if (color !== "rgb(26, 26, 26)") {
      throw new Error(`[FAIL] 亮色 ${sel} 默认文字色应与卡片一致 #1a1a1a（当前: ${color}）`);
    }
  }
  for (const sel of [".vc-btn-primary"]) {
    const bg = await page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
    if (!bg.includes("255, 255, 255")) {
      throw new Error(`[FAIL] 亮色 ${sel} 玻璃底色应为中性 rgba(255,255,255,*)（当前: ${bg}）`);
    }
  }
  for (const sel of [".vc-badge", ".vc-btn-primary"]) {
    await page.locator(sel).first().hover();
    await page.waitForTimeout(600);
    const color = await page.locator(sel).first().evaluate((el) => getComputedStyle(el).color);
    if (color !== "rgb(43, 87, 154)") {
      throw new Error(`[FAIL] 亮色 ${sel} hover 文字色应为品牌蓝 #2b579a（当前: ${color}）`);
    }
    await page.mouse.move(0, 0);
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: "/tmp/glass-light.png", fullPage: false });

  return `[PASS] glass checks ok (dark+light): ${JSON.stringify({ dark, light, surfaces })}`;
}
