# ADR-0210：Lynx 样式栈能力边界 —— 动效落地的可行路径与死类名台账

## 状态

accepted（2026-10-01）

## 背景

视觉改造连续三次差点建立在同一个**错误前提**上：**「工具类被 preset 裁掉了，所以写不出来的效果就别想了」**。
这个前提本身是错的，而它错得**有说服力** —— 因为它有一半是真的。

### 一、错误的来源：把「白名单」当成了「能力表」

`@lynx-js/tailwind-preset@0.5.1` 在 `lynx.js` 里设了 `corePlugins: DEFAULT_CORE_PLUGINS`，
一份 **57 项**的白名单。这份白名单**确实**裁掉了一批 core plugin，
`pointer-events` 就在其中 —— 这一点已由 issue #867 前的复核与
`tests/lynxUnsupportedTailwindClasses.test.ts` 的门禁钉住，是**真结论**。

问题出在推论这一步。仓库里两处注释把白名单外推成了能力边界：

- `src/components/ActionButton.vue` 的文件头注释
- `tests/lynxUnsupportedTailwindClasses.test.ts` 的头部说明

两处都写着「**同样被裁的还有 `transition` / `cursor` / `select` / `transform`**」。
其中 `cursor` 与 `select` **是对的**（本 ADR 实测复现，确为死类名），
但 `transition` 与 `transform` **是错的** —— 它们产出完整、正确的 CSS 规则。
一条真假各半的注释，比一条全错的注释更危险：它让读者以为「白名单 = 能力表」已经核实过了。

### 二、真实机制：白名单之外还有 35 个自定义 plugin

preset 不只有 `corePlugins`，还有 `plugins:` 数组，实测 **35 个**自定义 plugin
（`transitionProperty` / `createTransitionTimingPlugin` 就在其中）。
这些 plugin **绕开白名单**把工具类补了回来。所以：

> **`corePlugins` 白名单既不是充分条件，也不是必要条件。**
> 它是「哪些 core plugin 被关掉」的清单，**不是**「哪些 CSS 属性在本项目不可用」的清单。

这个判据的失效是**双向**的，方向相反的两条都要记住：

- `cursor-pointer` / `select-none` / `touch-none` / `pointer-events-none`：**不在白名单，产物也确实 0 规则** ⇒ 推断碰巧对了
- `transition-colors` / `transform` / `scale-50` / `rotate-45`：**不在白名单，产物却产出真规则** ⇒ 推断错了

### 三、为什么这份 ADR 现在才写

令牌层（`tokens.css` + `tailwind.config.ts`）在 ADR-0205～0209 之后已经合规，
但**消费层无路可走**：不知道哪些动效写法能落地，就要么不敢写（放弃视觉改造），
要么凭白名单猜（大概率猜错，且错得静默）。后续三份 ADR（连续性契约 / 色调层级 / 沉浸模式）
都要在这块地面上施工，**必须先有这份事实底座**。

## 能力矩阵

判据是**构建产物 CSS 表**，不是配置、不是注释。探测方法（19 个候选类名，
用项目真实 `tailwind.config.ts` 跑一次 Tailwind JIT）见「验证与复算」。

| 路径 | 写法 | 是否产出 CSS | 失败方式 | 证据坐标 |
|---|---|---|---|---|
| **A** ✅ | Tailwind `transition-*` + `duration-[…]` + `ease-[…]` | ✅ 产出真规则 | — | `.transition-colors` → `transition-property: background-color,border-color,color` + `transition-duration: 150ms×3` + `transition-timing-function: var(--motion-emphasized)`×3；`duration-[var(--durationNormal)]` / `ease-[var(--motion-standard)]` 各产出一条。产物侧在 `dist/main.lynx.bundle` 的 CSS 查找表同批可见 |
| **B** ✅ | inline `:style` 绑定 | ✅ 产出真规则 | — | `src/components/GlobalFab.vue` 的 `transform: translateX(${…})` / `translate(${…})` 已在生产运行（产物 `transform:` 10 处，全为 inline 路径） |
| **C** ✅ | `<style>` 块内 `@keyframes` + `animation` | ✅ 产出真规则 | — | `animation` **在** 57 项白名单内；`src` 有 **4 个文件 / 10 条** `@keyframes` 定义（`App.vue` / `GlobalFab.vue` / `RefreshableList.vue` / `BookmarkButton.vue`），产物 CSS 表同批可见 **8 个**动画名（`fab-spin` / `scrim-in` / `item-rise` / `bookmark-pop-add` / `bookmark-pop-remove` / `bookmark-ring-in` / `bookmark-ring-out` / `fab-ring-spin`） |
| **D** ❌ | `hover-class` 属性 | ❌ 属性本身无视觉切换 | **静默无样式**（不报错、无警告） | ADR-0207「引擎能力边界」第 3 条真机实证（#868）：5 色块按住全零变化，连阳性对照都不变。存量已清零（`src` 内 `hover-class` 实测 **0** 处），由 ADR-0207 决策 9 的门禁 C4 守住 |
| **E** ⚠️ | `transform` / `scale` / `translate` / `rotate` 工具类 | ⚠️ **产出 CSS，但渲染无效** | **静默无样式**（第三类，见决策 1） | 19 个候选里这族**全部产出规则**（`.transform` / `.transform-gpu` / `.transform-none` / `.rotate-45` / `.scale-50` / `.scale-[1.5]` / `.translate-x-2` / `.-translate-y-1/2` / `.origin-*`），但见下方「路径 E 的失效机制」 |

### 真死类名（0 规则，与路径 E 不同）

`cursor-pointer` / `select-none` / `touch-none` / `pointer-events-none` —— 候选里有、产物里**一条规则都没有**。
这 4 个是**构建期就 0 规则**，属路径 D/E 之外的第三种形态：**类名不产出任何东西**。

### 路径 E 的失效机制（本表最容易被误判的一格）

⚠️ **路径 E 既不是「不可用」也不是「构建期失败」，而是「构建期全对、渲染期全错」。**
这是本项目最危险的一格，理由是它**通过了所有静态检查**。

Tailwind 产出的 `transform` 是一条**组合声明**，引用 Tailwind 内部自定义属性：

```css
.rotate-45 {
  --tw-rz: 45deg;
  transform: translate3d(var(--tw-tx), var(--tw-ty), var(--tw-tz))
             rotateX(var(--tw-rx)) rotateY(var(--tw-ry)) rotateZ(var(--tw-rz))
             skew(var(--tw-skx), var(--tw-sky)) scale(var(--tw-sx), var(--tw-sy))
}
```

但**除该工具类自己设置的那一个之外，其余 `--tw-*` 全部没有定义**：

- preset **不注入** Tailwind 的 base/preflight 层（实测 `preflight` 不在 `corePlugins`，preset 无 base 层），
  而 Tailwind 的 `--tw-*` 初值**恰恰只在那一层里**
- `src` 内 `--tw-` 定义实测 **0** 处
- 产物 `dist/main.lynx.bundle` 内 `--tw-*` **只见 `var()` 引用**，唯一定义是 `.rotate-45` 自己的
  `--tw-rz`（产物侧判别形状见下方引文）

按 CSS 自定义属性规范，声明中任一 `var()` 指向未定义且无 fallback 的属性 ⇒
该声明**在计算值阶段失效** ⇒ `transform` 回落为初始值 `none` ⇒ **元素不发生任何变换**。

> **产物侧的判别形状**：`tw-rz` 出现 **4** 次，其余 8 个 `--tw-*` 各 **3** 次。
> 多出来的那 1 次就是 `.rotate-45` 自己的定义（`--tw-rz: 45deg`），
> 其余 8 个**只有引用、没有定义** —— 这就是「单写一个工具类必然无效」在产物里的形状。

⇒ **单写一个工具类必然无效**（其余分量全 undefined）。
要它生效就得把 9 个 `--tw-*` 全部补齐，等于手工实现 Tailwind 的 base 层。

> **可证伪预测（待真机取证）**：`src/components/TextSelectionToolbar.vue` 的抓手元素
> 写了 `rotate-45`（产物里确有 `--tw-rz: 45deg` + 组合 `transform`），
> 按上述机制它在真机上应当**渲染为未旋转**。
> **取证方法**：真机打开「小说详情 → 文本选中工具条」，截图量抓手那条斜杠的角度。
> 若确为 45°，则本条判读被证伪，需回头查 Lynx 对 undefined `var()` 的容错实现。

### 与令牌层的关系

可用路径依赖的自定义属性**都是已定义的**，这正是 A/B/C 成立的原因：

| 依赖的变量 | 定义位置 |
|---|---|
| `--motion-emphasized` | `src/styles/tokens.css` ✅ |
| `--motion-standard` | `src/styles/tokens.css` ✅ |
| `--durationNormal` | `src/styles/tokens.css` ✅ |
| `--tw-tx` / `--tw-ty` / `--tw-tz` / `--tw-rx` / `--tw-ry` / `--tw-skx` / `--tw-sky` / `--tw-sx` / `--tw-sy` | **无定义** ❌ |

⇒ 判据可以收敛成一句：**看这条 CSS 声明的每个 `var()` 是否有定义。**
有定义才会渲染；没定义就是构建期正确、运行期静默失效。

## 决策

### 决策 1：确立能力判据 —— 白名单不是能力表，「`var()` 是否有定义」才是

废止「查 `DEFAULT_CORE_PLUGINS` 白名单即可判断某个 CSS 能力在本项目可用」这条推论。
判据分两级，顺序不可颠倒：

1. **是否产出 CSS 规则**（构建期）—— 判据是 Tailwind JIT 产物，不是白名单、不是 preset 导出、不是注释
2. **产出的声明是否有效**（运行期）—— 判据是该声明里**每个 `var()` 是否有定义**

两级都过才是可用。**只过第一级就会踩进路径 E。**

本项目已经为**第一级的假阴性**付过代价（`pointer-events-none`：以为在防护、实际不防护，
真缺陷已由 `NovelIntro.vue` 书签 wrap 承担）；本 ADR 登记的是**第一级的假阳性** ——
`transform` 族**能过第一级、不能过第二级**。两类都要按机制区分，不能笼统叫「不支持」。

### 决策 2：动效实现只走路径 A / B / C，禁 D；`transform` 类需求一律走路径 B

| 需求 | 唯一合规路径 |
|---|---|
| 颜色 / 透明度 / 尺寸等属性的过渡 | **A**（`transition-*` + `duration-[…]` + `ease-[…]`） |
| 位移 / 缩放 / 旋转 | **B**（inline `:style`，写**字面量**，不写 `var()` 引用未定义变量） |
| 进入 / 退出 / 循环动画 | **C**（`<style>` 块内 `@keyframes` + `animation`） |
| 按压反馈 | `active:` 变体（ADR-0207 决策 4/8/9），**不写** `hover-class` |

**为什么 `transform` 类需求必须走 B**：路径 E 是唯一「能过构建、不能过渲染」的一格，
而它的失效方式**没有任何静态信号**（构建成功、产物有规则、类型检查通过、code review 看不出来）。
要排除它，唯一的办法是不产生那条声明。B 路径写的是字面量，不依赖任何 `--tw-*`，
且已有 `GlobalFab.vue` 的生产实证。

**路径 B 的写法约束**：`:style` 里**不得**引用 `--tw-*`（一律无定义），
也不得依赖未在 `tokens.css` 定义的变量。跨主题需要的值应取自 `tokens.css` 的既有令牌。

### 决策 3：登记两处过期注释，以本 ADR 事实为准

`src/components/ActionButton.vue` 文件头注释与
`tests/lynxUnsupportedTailwindClasses.test.ts` 头部说明中
「同样被裁的还有 `transition` / `cursor` / `select` / `transform`」一句，
**其中 `transition` 与 `transform` 两项已过期**（正确口径 = 本 ADR 能力矩阵 A/C/E 三行）。

- `cursor` / `select` 两项**正确**，保留
- ⚠️ **该门禁的判据本身仍然有效、不得因此改动**：它扫的是 `pointer-events-none`
  （该类实测仍为死类名），只有**说明文字**过期，不是判据过期。
  白名单快照判据（把 57 项钉住）同样保留 —— 快照要钉的是「白名单内容」这个事实，
  而本 ADR 恰恰是它**不能被当成能力表**的原因。
- 两处文件的修订在本轮之外单独处理（属注释/文档改动，不在本 ADR 的写权限内）。

### 决策 4：新增视觉能力前先验产物 —— 判据是 CSS 表，不是配置、不是注释

工作纪律，写死三条：

1. **先验产物再写码**：动效/视觉类改动落地前，用「验证与复算」的 JIT 探针跑一次候选类名，
   确认「产出规则」；再确认该规则里每个 `var()` 有定义。
2. **判据只认三类证据**（从强到弱）：① 产物 CSS 表 / 真机截图 ② 用项目真实 config 跑 Tailwind JIT
   ③ preset 源码。**配置与注释不是证据** —— 本 ADR 的起因就是一条「看起来很有据」的注释。
3. **真机未取证的能力按「待取证」写，不按「能用」写**：本项目已多次出现
   「构建全绿 ⇒ 以为能用 ⇒ 真机不渲染」（路径 E 即其一）。

> 这条纪律是本 ADR 的**主要产出**。能力矩阵会随 preset 升级而变（35 个自定义 plugin 是
> 0.5.1 的实现细节），但**「先验产物」的纪律不会过期**。

### 决策 5：路径 E 的存量影响登记为待取证项，不在本轮修改

`TextSelectionToolbar.vue` 的 `rotate-45` 是**唯一**已知的存量路径 E 用法。
按决策 2 它应改走路径 B，但**本轮不改**：

- 改它需要先取证确认它当前确实未旋转（决策 1 的可证伪预测），
  否则可能「修」一个其实正常的东西
- 属于可见视觉变更，须进截图回归（沿用 ADR-0207 的分批落地纪律）

⇒ 登记为**待真机取证项**，取证方法见能力矩阵节。

## 后果

**正面**

- 视觉改造从「猜白名单」变成「查矩阵」：后续三份 ADR 有明确可用路径
- 路径 E 的机制被拆到「`var()` 无定义」这一层 ⇒ 遇到同类静默失效能**按机制排查**，而不是逐个试
- 决策 4 的纪律可迁移到本仓任何 CSS/Tailwind 能力问题，不依赖本表的具体条目
- 修正了一条**真假各半**的注释口径，避免它继续以「已核实」的姿态误导

**负面**

- 决策 2 把 `transform` 类需求**收敛**到 inline `:style`，而 B 路径**不能被静态工具分析**
  ⇒ 一批以前能写的样式现在写不了（这是代价，不是缺陷）
- 能力矩阵是 0.5.1 的快照，preset 升级后需重跑探针；决策 4 的纪律要求有人在升级时真的去跑
- 本 ADR 推迟了 `rotate-45` 的修复 ⇒ 那个抓手**可能继续以错误姿态渲染**，
  且是「看起来正常因为它只是一条线」的低危视觉缺陷

**风险（如实登记，不粉饰）**

- ⚠️ **决策 1 的第二级（`var()` 有定义 ⇒ 有效）是一条 CSS 规范推断，不是本项目真机实证。**
  若 Lynx 对 undefined `var()` 的容错实现与规范不同（例如回落为 `0` 而非让整条声明失效），
  则路径 E 的结论需修正。**取证方法**：真机对照一个只写 `rotate-45` 的元素与一个 inline 写
  `transform: rotate(45deg)` 的元素，比对是否发生旋转。
- ✅ **路径 A 已于 2026-10-01 完成真机取证 —— 通过。原风险条目解除。**
  **方法**（长过渡探针，理由见术语文档 §13.6 的采样能力边界）：把 `--durationNormal` 令牌
  **临时**由 `200ms` 改为 `2000ms`，构建 + 安装到 `emulator-5554`（Android 14 / Lynx SDK 4.0.1），
  切换「显示 R-18 内容」开关并连拍 12 帧。
  **结果**：k1→k6 **六帧连续不同且单调收敛**，k6 之后 7 帧完全静止；按单帧 420ms 采样换算，
  收敛于 **≈2100ms**，与 2000ms 设定吻合。目视 k3 帧可见开关轨道呈
  **OFF 浅灰 → ON 实心 primary 蓝之间的中间色**。
  **结论**：Tailwind `transition-colors` 工具类**真实产生过渡**，`var(--duration*)` **真实解析**，
  Lynx **真实插值**。探针改动已回退，worktree 干净。
  ⚠️ **本条只覆盖「时长令牌解析 + 颜色属性插值」**。缓动曲线（`var(--motion-*)`）的**形状**
  是否被正确应用**未单独取证** —— 判据是「收敛时刻吻合」，它对「用错曲线但总时长相同」无判别力。
  该项仍列为待取证。
- ⚠️ 真死类名 4 个中，只有 `pointer-events-none` 有门禁钉住；
  `cursor-*` / `select-*` / `touch-*` **无任何机器防线**，写出来是纯静默失效。

## 验证与复算

全部命令在 `packages/app-lynx` 下执行，**不修改仓库任何文件**（探针产物落在 `mktemp -d` 目录）。

**1. 白名单是 57 项，且不含本 ADR 讨论的族**

```bash
cd packages/app-lynx && node -e "const s=require('fs').readFileSync('node_modules/@lynx-js/tailwind-preset/dist/lynx.js','utf8');console.log(s.match(/DEFAULT_CORE_PLUGINS\s*=\s*\[([\s\S]*?)\]/)[1].split(',').length)"
```

**2. 白名单之外还有 35 个自定义 plugin（背景二节的依据）**

```bash
cd packages/app-lynx && node -e "const p=require('./node_modules/@lynx-js/tailwind-preset/dist/lynx.cjs').default;console.log('corePlugins',p.corePlugins.length,'plugins',p.plugins.length);console.log('animation 在白名单:',p.corePlugins.includes('animation'),'| preflight 在白名单:',p.corePlugins.includes('preflight'))"
```

预期：`corePlugins 57 plugins 35`、`animation 在白名单: true`、`preflight 在白名单: false`。

**3. 能力矩阵主表（19 个候选类名 → 15 规则 / 4 死类名）**

```bash
cd packages/app-lynx
D=$(mktemp -d)
cat > "$D/probe.html" <<'EOF'
<div class="transition-colors duration-[var(--durationNormal)] ease-[var(--motion-standard)] animate-[spin_1s_linear_infinite] transform transform-none transform-gpu rotate-45 rotate-0 scale-50 scale-[1.5] translate-x-2 -translate-y-1/2 origin-left origin-top touch-none pointer-events-none cursor-pointer select-none"></div>
EOF
printf '@tailwind utilities;\n' > "$D/in.css"
node -e "
const fs=require('fs');
let s=fs.readFileSync('tailwind.config.ts','utf8')
 .replace(/^import[\s\S]*?from\s+'[^']*'\n/gm,'')
 .replace(/: Config\b/g,'')
 .replace(/content:\s*\[[^\]]*\]/, \"content: ['$D/probe.html']\")
 .replace(/export default config;?/,'module.exports = config;');
fs.writeFileSync('$D/tw.js', \"const lynxPreset=require('$PWD/node_modules/@lynx-js/tailwind-preset').default;\n\"+s);
"
./node_modules/.bin/tailwindcss -c "$D/tw.js" -i "$D/in.css" -o "$D/out.css" >/dev/null 2>&1
grep -o '^\.[^ ,{]*' "$D/out.css" | sort -u          # 15 条
cat "$D/out.css"                                      # 看声明体（路径 E 的 --tw-* 组合声明在此可见）
```

**4. 路径 E 的第二级判据：`--tw-*` 无定义**

```bash
cd packages/app-lynx
grep -ao 'tw-[a-z]*' dist/main.lynx.bundle | sort | uniq -c   # tw-rz 4 次，其余 8 个各 3 次
grep -rn -- '--tw-' src | wc -l                              # 0
```

预期：`tw-rz` 比其余多 1 次（那 1 次是它自己的定义），其余 8 个**只有引用**。
⚠️ **不要用 `--tw-[a-z]*:` 去 grep 定义** —— 产物 CSS 查找表把「键 / 值」用标记字节分隔，
存的是 `--tw-rz` + 标记 + `45deg`，**没有冒号**，所以带冒号的 pattern 对**定义和引用一律查不到**。
要看定义的真身，请用命令 3 的 JIT 产物（那里是普通 CSS，`--tw-rz: 45deg` 完整可读）。

**5. 路径 C 的动画证据**

```bash
cd packages/app-lynx
grep -rn '@keyframes' src --include='*.vue' --include='*.css' | grep '@keyframes [a-z]'   # 10 条定义
grep -rl '@keyframes' src --include='*.vue' --include='*.css'                              # 4 个文件
grep -ao '[a-z][a-z0-9-]* {{--duration' dist/main.lynx.bundle | awk '{print $1}' | sort -u   # 8 个动画名
```

> ⚠️ 裸 `grep -c '@keyframes' src` 会得到 **11** 而非 10：`App.vue` 有一处是**正文里提到**
> `@keyframes`（说明该特性在浏览器渲染），不是定义。故须加 `@keyframes [a-z]` 过滤到真定义。

**6. 路径 B / D 的存量现状**

```bash
cd packages/app-lynx
grep -ao 'transform:[^;"}]\{0,50\}' dist/main.lynx.bundle | head    # inline 路径，10 处
grep -rn 'hover-class' src --include='*.vue' | wc -l                # 0（ADR-0207 决策 9 已清）
```

**7. 令牌层依赖确有定义（能力矩阵末表的依据）**

```bash
cd packages/app-lynx
for t in --motion-emphasized --motion-standard --durationNormal; do
  printf '%-20s %s\n' "$t" "$(grep -c -- "$t:" src/styles/tokens.css)"; done
```

> ⚠️ 复算说明：命令 3 依赖 Tailwind CLI（实测 3.4.19），且**必须**用项目的
> `tailwind.config.ts`（`presets: [lynxPreset]` 不可省）—— 换成裸 Tailwind 配置会得到不同答案。
> 另注：产物 `dist/main.lynx.bundle` 的 CSS 查找表**类名与属性名均被压缩成单字符 key**
> （`o` = `transition-duration`、`n` = `transition-property`、`q` = `transition-timing-function`），
> 该映射可由同表内 `duration-200 → o → .2s` 校准得出；直接 `grep 'transition-duration'`
> 在产物里**查不到**，这不是「没有规则」。

## 参考

- 前置决策：[`ADR-0207`](./ADR-0207-shape-and-state-layer-guardrails.md) 决策 4 / 6 / 9
  与「引擎能力边界」表第 1、3 条（`background-color` 替换语义、`hover-class` 静默失效）
- 缓动与时长令牌：[`ADR-0206`](./ADR-0206-typography-type-scale.md) 同批落地纪律（**必须分批回归**）
- MD3 偏离封闭清单：[`ADR-0205`](./ADR-0205-md3-baseline-and-scope.md) 决策 4
- 术语文档：[`glossary-md3-alignment.md`](./glossary-md3-alignment.md)（§4.2 证据锚点规范：路径 + 符号名，不写行号）
- 白名单门禁与依据：[`lynxUnsupportedTailwindClasses.test.ts`](../../packages/app-lynx/tests/lynxUnsupportedTailwindClasses.test.ts)
- 待修改的过期注释（本轮不动）：
  [`ActionButton.vue`](../../packages/app-lynx/src/components/ActionButton.vue) 文件头、
  上述测试文件头部说明
- 引擎能力边界的原始记录：[issue #868](https://github.com/a1121611810/Pictelio/issues/868)（`hover-class` 静默无反馈）
- 官方数值来源：
  [`_md-sys-motion.scss`](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-motion.scss)
