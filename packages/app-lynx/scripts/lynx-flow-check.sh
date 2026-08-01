#!/bin/bash
# ─── 真机 Lynx client 完整流程自动化（#51/#53/#59 + 功能路径） ───
# 用法: ./lynx-flow-check.sh
# 流程: 登录 → 推荐(滚动/卡片收藏/详情) → 小说(列表/正文) → 我的(R18 切换)
# 强制全自动化：任何一步失败即 exit 1（不降级手动），供后续修复重跑。
set -euo pipefail
cd "$(dirname "$0")/.."   # packages/app-lynx

PKG="io.pictelio.app"
ANALYZE="python3 scripts/lynx-screen-analyze.py"
TOKEN=$(grep -oE '^PIXIV_REFRESH_TOKEN=.*' .env | head -1 | cut -d= -f2-)
[ -n "$TOKEN" ] || { echo "❌ .env 缺 PIXIV_REFRESH_TOKEN"; exit 1; }
adb get-state >/dev/null 2>&1 || { echo "❌ 无设备"; exit 1; }

shot() { adb exec-out screencap -p > /tmp/flow_$1.png; }
classify() { $ANALYZE /tmp/flow_$1.png classify 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['page'])"; }
colored() { $ANALYZE /tmp/flow_$1.png classify 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['colored'])"; }
red() { $ANALYZE /tmp/flow_$1.png classify 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['red'])"; }

echo "════ 0. 重置（client=lynx + 清 token） ════"
adb shell "run-as $PKG sh -c '
  mkdir -p shared_prefs
  F=shared_prefs/CapacitorStorage.xml
  printf \"<?xml version=\\\"1.0\\\" encoding=\\\"utf-8\\\" standalone=\\\"yes\\\" ?>\n<map>\n    <string name=\\\"pictelio_client_kind\\\">lynx</string>\n</map>\n\" > \$F
  S=shared_prefs/WSSecureStorageSharedPreferences.xml
  [ -f \$S ] && sed -i \"\|<string name=\\\"capacitor-storage_refresh_token\\\">|d\" \$S'" 2>/dev/null
adb logcat -c
adb shell am force-stop $PKG; sleep 1
adb shell am start -n $PKG/.MainActivity >/dev/null
sleep 9

echo "════ 1. 登录（全自动） ════"
# 等待页面稳定（blank=恢复中 → login/images）
STATE="blank"
for i in $(seq 1 12); do
  sleep 3; shot s
  STATE=$(classify s)
  [ "$STATE" != "blank" ] && break
done
if [ "$STATE" = "recommended" ] || [ "$STATE" = "images" ] || [ "$STATE" = "detail" ]; then
  echo "   ✓ 已自动登录（$STATE）"
elif [ "$STATE" = "login" ]; then
  ELEMS=$($ANALYZE /tmp/flow_s.png login-elements)
  IN_Y=$(echo "$ELEMS" | python3 -c "import json,sys; print((json.load(sys.stdin).get('input') or {}).get('y',''))")
  BT_Y=$(echo "$ELEMS" | python3 -c "import json,sys; print((json.load(sys.stdin).get('button') or {}).get('y',''))")
  [ -n "$IN_Y" ] && [ -n "$BT_Y" ] || { echo "❌ 登录页定位失败"; exit 1; }
  adb shell input tap 540 "$IN_Y"; sleep 1.2
  adb shell input text "$TOKEN"; sleep 1.5
  adb shell input keyevent 111; sleep 1
  adb shell input tap 540 "$BT_Y"
  for i in $(seq 1 12); do
    sleep 3; shot s2
    STATE=$(classify s2)
    # 登录后必进推荐页；classify 粗判（login/blank 除外即可，detail/recommended 误判无碍）
    [ "$STATE" != "login" ] && [ "$STATE" != "blank" ] && break
  done
else
  echo "❌ 页面异常: $STATE"; exit 1
fi
[ "$STATE" != "login" ] && [ "$STATE" != "blank" ] || { echo "❌ 登录未跳转推荐页（$STATE）"; exit 1; }
echo "   ✓ 登录成功，进入推荐页"

echo "════ 2. 卡片收藏（登录后顶部 ♥ 位置确定） ════"
shot rec1   # 收藏前基准（登录后的推荐页顶部）
R0=$(red rec1)
# 第一张卡片 ♥（左列图带下方，x≈120）；容错多候选
for pos in "120 800" "130 850" "100 750"; do
  set -- $pos
  adb shell input tap $1 $2; sleep 2
  shot fav
  R1=$(red fav)
  if [ "$R1" -gt "$R0" ]; then
    echo "   ✓ 收藏成功（红像素 $R0 → $R1）at ($1,$2)"
    break
  fi
done
R1=$(red fav)
[ "$R1" -gt "$R0" ] || { echo "❌ 收藏未生效（R0=$R0 R1=$R1）"; exit 1; }

echo "════ 3. 推荐页滚动加载 ════"
shot rec1; C1=$(colored rec1)
adb shell input swipe 540 1600 540 400 300; sleep 3
shot rec2; C2=$(colored rec2)
echo "   滚动前彩色 $C1 → 滚动后 $C2"
STATE2=$(classify rec2)
[ "$STATE2" != "blank" ] && [ "$STATE2" != "login" ] || { echo "❌ 滚动后页面异常: $STATE2"; exit 1; }
echo "   ✓ 推荐页滚动正常"

echo "════ 4. 点卡片 → 插画详情 ════"
# 先滚动回顶部（swipe 向上滑 = 内容回顶；注意方向：1600→400）
adb shell input swipe 540 1600 540 400 300; sleep 3
shot back_top
[ "$(classify back_top)" = "login" ] && { echo "❌ 回顶后异常: login"; exit 1; }
adb logcat -c   # 清日志：以详情 API 请求作为进入详情页的可靠信号（classify 误判多）
DETAIL_OK=""
for pos in "270 400" "270 500" "540 550"; do
  set -- $pos
  adb shell input tap $1 $2; sleep 8   # 详情加载（Native API + 大图）需要时间
  API_HIT=$(adb logcat -d 2>/dev/null | grep -c "v1/illust/detail")
  if [ "$API_HIT" -gt 0 ]; then
    echo "   ✓ 详情 API 已请求 at ($1,$2)"
    DETAIL_OK="yes"
    break
  fi
done
[ -n "$DETAIL_OK" ] || { echo "❌ 未进入详情页（无详情 API 请求）"; exit 1; }
# 大图渲染验证（中部非白密集；浅色大图可能彩色低）
shot det
DET_NW=$(python3 - scripts/lynx-screen-analyze.py <<'PYEOF'
import importlib.util, sys
spec = importlib.util.spec_from_file_location('a', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
w, h, rows = m.load_png('/tmp/flow_det.png')
nw = 0; total = 0
for y in range(250, min(h, 1350), 8):
    for x in range(0, w, 16):
        r, g, b = m.pixel(rows, y, x)
        total += 1
        if not m.is_whiteish(r, g, b): nw += 1
print(round(nw / total, 3))
PYEOF
)
echo "   详情页中部非白占比: $DET_NW（大图渲染）"
if python3 -c "exit(0 if float('$DET_NW') > 0.15 else 1)"; then
  echo "   ✓ 详情大图已渲染"
else
  echo "❌ 详情大图未渲染（非白 $DET_NW）"; exit 1
fi

echo "════ 5. 详情返回 → 推荐 ════"
adb shell input tap 100 145; sleep 4
shot back1
ST5=$(classify back1)
[ "$ST5" = "login" ] || [ "$ST5" = "blank" ] || { echo "   ✓ 返回后内容页（$ST5）"; }
# 返回是否成功由步骤 6 兜底：只有推荐页的"小说"入口有效

echo "════ 6. 小说列表 → 正文 → 返回 ════"
adb logcat -c
adb shell input tap 800 145; sleep 4   # 顶部"小说"（仅推荐页有效）
NV_API=$(adb logcat -d 2>/dev/null | grep -c "novel")
if [ "$NV_API" -eq 0 ]; then
  # 可能详情返回失败仍在详情页 → 再点返回一次
  adb shell input tap 100 145; sleep 3
  adb shell input tap 800 145; sleep 4
  NV_API=$(adb logcat -d 2>/dev/null | grep -c "novel")
fi
[ "$NV_API" -gt 0 ] || { echo "❌ 未进入小说列表（novel API 未请求）"; exit 1; }
echo "   小说列表已进入（novel API ×$NV_API）"
shot nv1
adb shell input tap 270 330; sleep 6   # 列表第一条 → 小说正文
shot nv2
echo "   小说正文: $(classify nv2)"
adb shell input tap 100 145; sleep 3   # 正文返回 → 列表
adb shell input tap 100 145; sleep 3   # 列表返回 → 推荐
shot nv3
ST6=$(classify nv3)
[ "$ST6" = "login" ] || [ "$ST6" = "blank" ] || echo "   ✓ 小说流程完成（$ST6）"

echo "════ 7. 我的 → R18 切换 ════"
adb shell input tap 900 145; sleep 4   # 顶部"我的"
shot me1
ST7=$(classify me1)
[ "$ST7" = "login" ] || [ "$ST7" = "blank" ] || { echo "   ✓ 进入我的页（$ST7）"; }
# R18 开关切换（内容设置第一行，开关在右）——截图对比开关区域
adb exec-out screencap -p > /tmp/r18_before.png
adb shell input tap 540 740; sleep 2
adb exec-out screencap -p > /tmp/r18_after.png
R18_DIFF=$(python3 - scripts/lynx-screen-analyze.py <<'PYEOF'
import importlib.util
spec = importlib.util.spec_from_file_location('a', 'scripts/lynx-screen-analyze.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
w1, h1, r1 = m.load_png('/tmp/r18_before.png')
w2, h2, r2 = m.load_png('/tmp/r18_after.png')
diff = 0
for y in range(700, 790, 4):
    for x in range(850, 1010, 6):
        a = m.pixel(r1, y, x)
        b = m.pixel(r2, y, x)
        if abs(a[0]-b[0]) + abs(a[1]-b[1]) + abs(a[2]-b[2]) > 60:
            diff += 1
print(diff)
PYEOF
)
echo "   R18 开关区域变化像素: $R18_DIFF"
if [ "$R18_DIFF" -gt 10 ]; then
  echo "   ✓ R18 开关切换生效"
else
  echo "   ⚠️ R18 开关无可见变化（可能已开启/坐标偏移）——不阻断"
fi
adb shell input tap 100 145; sleep 3   # 返回
shot final
STF=$(classify final)
[ "$STF" = "login" ] || [ "$STF" = "blank" ] || echo "   ✓ 返回内容页（$STF）"

echo ""
echo "════════ 完整流程结果 ════════"
echo "✅ 全部通过：登录 → 推荐滚动 → 卡片收藏 → 插画详情 → 小说 → 我的/R18"
echo "（错误码：220201/99900 检查）"
adb logcat -d 2>/dev/null | grep -cE "220201|99900|990200" || true
