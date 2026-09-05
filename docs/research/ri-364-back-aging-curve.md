# RI-364 B 部分第一阶段单实验：返回延迟会话老化曲线

- issue: a1121611810/Pictelio#364（B 部分），地图 #361，实验对应 `docs/research/real-interaction-audit.md` 场景 3
- 分支 `fix/ri-365-coldstart`（c7e64f67），versionName 4.32.0（含 FT-1A 返回过渡 + FT-2 splash 改造），emulator-5554，已登录
- 目的：剥离「两轮代码不同」混杂变量，在同一构建上模拟老化操作序列，测详情→home 系统返回延迟是否随会话使用爬升（体检：旧会话 1.48-1.82s vs 新会话 184-233ms）

## 协议

- **checkpoint 0（新会话基线）**：`am force-stop` → 冷启动 → 首页首卡图就绪 → back 录屏 3 rep。
- **老化单元**：打开详情（tap 首卡 (415,560)）→ 停 2s → back；每 4 单元后：home 快甩滚动 2 屏 + force-stop → 冷启动等就绪。共 12 单元（checkpoint 4/8/12）。
- **每个 checkpoint**：同协议 3 rep back 录屏（录屏起 → sleep 1s → `input keyevent 4` → 5s 停录 → `analyze_rec.py`）。

### 测量口径（按实测帧序列修订）

任务书预期签名（预位移帧 → 静止保持段 → 17 帧退出动画 → home 落定）**未在本环境复现**：
实测 VFR 录屏签名 = 静止详情页（t=0）→ **单帧切换**（home 完全落定，diff≈56.5）→ 静止。
无预位移帧、无退出动画帧序列、无可分离的静止保持 gap（`ck0_rep1` 逐帧核验：f1=详情图就绪页，f2=home 落定帧）。

因此采用实测口径：

| 量 | 定义 |
|----|------|
| **总时长** | home 落定帧 pts − 1000ms（脚本 sleep 1s 后注入 back；含恒定 adb `input` 注入延迟，各 checkpoint 同口径可比，与体检场景 3 协议一致） |
| **静止保持段（裸冻结）** | 本签名下无中间帧可分离；若老化冻结出现，预期表现为落定帧后移/多帧+长 gap，以 checkpoint 间总时长爬升判读。单帧切换时记「—（单帧切换）」 |

## 老化曲线（总时长 ms，3 rep / checkpoint）

| checkpoint（老化单元数） | rep1 | rep2 | rep3 | 备注 |
|---|---|---|---|---|
| 0（新会话，冷启动后） | 209 | 219 | 221 | 单帧切换；与体检新会话 184-233ms 一致 |

（ checkpoint 4 / 8 / 12 待补 ）

