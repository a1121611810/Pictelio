#!/bin/bash
# ─── 真机 Lynx client 端到端自动化验证（#51/#59） ───
# 用法: ./lynx-device-check.sh [--rebuild]
# 流程: 确保 lynx 模式 → 启动 → 自动登录（.env token）→ 校验推荐页图片加载
# 前置: adb 已连真机；packages/app-lynx/.env 含 PIXIV_REFRESH_TOKEN；APK 已安装
set -euo pipefail
cd "$(dirname "$0")/.."   # 定位到 packages/app-lynx（.env 所在）

PKG="io.pictelio.app"
ANALYZE="node -e ''"  # placeholder
ANALYZE_PY="scripts/lynx-screen-analyze.py"
TOKEN=$(grep -oE '^PIXIV_REFRESH_TOKEN=.*' .env | head -1 | cut -d= -f2-)
if [ -z "$TOKEN" ]; then echo "❌ .env 缺 PIXIV_REFRESH_TOKEN"; exit 1; fi
adb get-state >/dev/null 2>&1 || { echo "❌ 无设备连接"; exit 1; }

echo "── 1. 确保 client_kind=lynx + 清 refresh_token（消除启动恢复挂起干扰） ──"
# 保留 CapacitorStorage.xml 其他键，仅设置 pictelio_client_kind
adb shell "run-as $PKG sh -c '
  mkdir -p shared_prefs
  F=shared_prefs/CapacitorStorage.xml
  if [ -f \$F ] && grep -q pictelio_client_kind \$F; then
    sed -i \"s|<string name=\\\"pictelio_client_kind\\\">[^<]*</string>|<string name=\\\"pictelio_client_kind\\\">lynx</string>|\" \$F
  else
    printf \"<?xml version=\\\"1.0\\\" encoding=\\\"utf-8\\\" standalone=\\\"yes\\\" ?>\n<map>\n    <string name=\\\"pictelio_client_kind\\\">lynx</string>\n</map>\n\" > \$F
  fi
  # 清 refresh_token：避免启动时 restoreToken → Native OAuth 交换挂起 → 登录页渲染异常/定位失败（#53 实测）
  S=shared_prefs/WSSecureStorageSharedPreferences.xml
  if [ -f \$S ]; then
    sed -i \"\|<string name=\\\"capacitor-storage_refresh_token\\\">|d\" \$S
  fi'" 2>/dev/null
adb shell "run-as $PKG cat shared_prefs/CapacitorStorage.xml" 2>/dev/null | grep -o "pictelio_client_kind[^<]*<" | head -1

echo "── 2. 重启 app ──"
adb logcat -c
adb shell am force-stop $PKG
sleep 1
adb shell am start -n $PKG/.MainActivity >/dev/null
sleep 8

echo "── 3. 等待页面稳定（blank=恢复中，images=已登录，login=登录页） ──"
STATE="blank"
for i in $(seq 1 12); do
  sleep 3
  adb exec-out screencap -p > /tmp/lynx_chk.png
  STATE=$(python3 "$ANALYZE_PY" /tmp/lynx_chk.png page-state | python3 -c "import json,sys; print(json.load(sys.stdin)['state'])")
  [ "$STATE" != "blank" ] && break
done
echo "   页面状态: $STATE"

if [ "$STATE" = "images" ]; then
  echo "   已自动登录（原生存储恢复 token）→ 直接校验"
elif [ "$STATE" = "login" ]; then
  echo "   登录页，定位元素并自动登录…"
  INPUT_Y=""; BTN_Y=""
  for i in $(seq 1 8); do
    adb exec-out screencap -p > /tmp/lynx_chk.png
    ELEMS=$(python3 "$ANALYZE_PY" /tmp/lynx_chk.png login-elements)
    INPUT_Y=$(echo "$ELEMS" | python3 -c "import json,sys; d=json.load(sys.stdin); print((d.get('input') or {}).get('y',''))")
    BTN_Y=$(echo "$ELEMS" | python3 -c "import json,sys; d=json.load(sys.stdin); print((d.get('button') or {}).get('y',''))")
    # 合理性校验：输入框/按钮应在屏幕中部（y 300-1500）
    if [ -n "$INPUT_Y" ] && [ -n "$BTN_Y" ] && [ "$INPUT_Y" -ge 300 ] && [ "$INPUT_Y" -le 1500 ] && [ "$BTN_Y" -ge 300 ] && [ "$BTN_Y" -le 1500 ]; then
      break
    fi
    INPUT_Y=""; BTN_Y=""
    sleep 3
  done
  if [ -z "$INPUT_Y" ] || [ -z "$BTN_Y" ]; then
    echo "❌ 未定位到登录页输入框/按钮（截图分析: $ELEMS）"; exit 1
  fi
  echo "   输入框 y=$INPUT_Y, 按钮 y=$BTN_Y"

  echo "── 4. 自动登录（输入验证 + 重试） ──"
  TYPED_OK=""
  for attempt in 1 2 3; do
    adb shell input tap 540 "$INPUT_Y"; sleep 1.2
    adb shell input text "$TOKEN"; sleep 1.5
    # 验证输入生效：输入框区域非白占比显著上升（token 文本出现）
    adb exec-out screencap -p > /tmp/lynx_typed.png
    TY=$(python3 - "$ANALYZE_PY" <<'PYEOF'
import importlib.util, sys
spec = importlib.util.spec_from_file_location('a', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
w, h, rows = m.load_png('/tmp/lynx_typed.png')
nw = 0; total = 0
for y in range(0, h, 8):
    for x in range(0, w, 12):
        r, g, b = m.pixel(rows, y, x)
        total += 1
        if not m.is_whiteish(r, g, b): nw += 1
print(round(nw / total, 3))
PYEOF
)
    echo "   第${attempt}次输入：非白占比 $TY（未输入约 0.05，输入后应 >0.15）"
    if python3 -c "exit(0 if float('$TY') > 0.15 else 1)"; then
      TYPED_OK="yes"
      break
    fi
    adb shell input keyevent 111; sleep 1  # 收键盘，重试前恢复布局
  done
  if [ -z "$TYPED_OK" ]; then
    echo "❌ token 自动输入 3 次未生效（输入框定位或 IME 问题）"; exit 1
  fi
  adb shell input keyevent 111; sleep 1   # 收键盘
  adb shell input tap 540 "$BTN_Y"
  echo "   已提交登录，等待跳转…"

  echo "── 5. 等待推荐页（最多 36s）──"
  for i in $(seq 1 12); do
    sleep 3
    adb exec-out screencap -p > /tmp/lynx_chk.png
    STATE=$(python3 "$ANALYZE_PY" /tmp/lynx_chk.png page-state | python3 -c "import json,sys; print(json.load(sys.stdin)['state'])")
    [ "$STATE" = "images" ] && break
  done
else
  echo "❌ 页面异常状态: $STATE（应 login 或 images）"; exit 1
fi

echo "── 6. 校验结果 ──"
ERR_2202=$(adb logcat -d 2>/dev/null | grep -c "220201\|illegal list item-key" || true)
ERR_999=$(adb logcat -d 2>/dev/null | grep -c "99900\|no scheme" || true)
IMG_RATIO=$(python3 "$ANALYZE_PY" /tmp/lynx_chk.png page-state | python3 -c "import json,sys; print(json.load(sys.stdin)['image_ratio'])")

echo "   页面状态: $STATE | 图片占比: $IMG_RATIO | 220201错误: $ERR_2202 | 99900错误: $ERR_999"
if [ "$STATE" = "images" ] && [ "$ERR_2202" = "0" ] && [ "$ERR_999" = "0" ]; then
  echo "✅ PASS: 登录成功 + 推荐页图片已加载 + 无关键错误"
  exit 0
else
  echo "❌ FAIL: state=$STATE img=$IMG_RATIO err2202=$ERR_2202 err999=$ERR_999"
  exit 1
fi
