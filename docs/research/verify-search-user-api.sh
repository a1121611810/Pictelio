#!/usr/bin/env bash
# ─── 用户搜索 `/v1/search/user` 响应面取证脚本 ───
# 目的：`/v1/search/user` 的响应字段在本仓此前**无任何一手样例**，只有第三方客户端
# 的 schema 声明（pixez `models/user_preview.dart`、PixivBiu `api/openapi.yaml`
# `UserPreview`）。本脚本抓真实响应，把「字段存不存在」变成可复核事实，
# 并产出契约测试用的 fixture（测试硬约束 2：契约测试必须使用真实样例）。
#
# 用法：bash docs/research/verify-search-user-api.sh
# 前置：代理在 127.0.0.1:7897（或改 PROXY）；packages/app-lynx/.env 有 PIXIV_REFRESH_TOKEN
#
# ⚠️ 方法论（沿用 verify-tag-neighbors-api.sh 的教训 2/5）：
#   - 脚本不打印任何凭据（access_token 只经管道进 python，不落 stdout）
#   - 每条结论都打印**响应顶层键名**与**条目键名**，让「字段存不存在」可直接复核
#   - 检索词用真实存在的画师名（CONTEXT.md §搜索 2026-09-27 实测记录：ソーダ豆汁
#     在 user 端点命中 1 个用户），不手写自洽数据
set -euo pipefail

PROXY="${PROXY:-http://127.0.0.1:7897}"
export https_proxy="$PROXY" http_proxy="$PROXY"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

RT=$(grep '^PIXIV_REFRESH_TOKEN=' "$REPO/packages/app-lynx/.env" | cut -d= -f2- | tr -d '\r\n"')
CFG="$REPO/packages/android-host/android/app/src/main/java/io/pictelio/app/config/OAuthConfig.java"
CID=$(grep -o 'CLIENT_ID = "[^"]*"' "$CFG" | sed 's/.*"\(.*\)"/\1/')
CSEC=$(grep -o 'CLIENT_SECRET = "[^"]*"' "$CFG" | sed 's/.*"\(.*\)"/\1/')

TOKEN_FILE=$(mktemp)
trap 'rm -f "$TOKEN_FILE"' EXIT

curl -s -X POST "https://oauth.secure.pixiv.net/auth/token" \
  -H "User-Agent: PixivIOSApp/7.18.3" -H "App-OS: ios" -H "App-Version: 7.18.3" \
  --data-urlencode "grant_type=refresh_token" \
  --data-urlencode "client_id=$CID" \
  --data-urlencode "client_secret=$CSEC" \
  --data-urlencode "refresh_token=$RT" > "$TOKEN_FILE"

TOK=$(python3 -c "import json;print(json.load(open('$TOKEN_FILE'))['access_token'])")
echo "✓ access_token 获取成功（${#TOK} 字符，不回显）"

WORD="${WORD:-ソーダ豆汁}"
SORT="${SORT:-date_desc}"
# ⚠️ 默认输出到 /tmp，**不覆盖已提交的 fixture**：直接复跑本脚本会用另一个检索词的
# 全量响应盖掉库里那份裁剪版（fixture 是「4 条预览 / 各数组取前 2」的精选样本，
# 覆盖后 spec §3.1 的取证面与契约测试的断言对象都会漂移）。
# 要重造 fixture：OUT=.../search-users.json bash docs/research/verify-search-user-api.sh
OUT="${OUT:-/tmp/search-users-verify.json}"

curl -s -G "https://app-api.pixiv.net/v1/search/user" \
  -H "Authorization: Bearer $TOK" \
  -H "User-Agent: PixivIOSApp/7.18.3" -H "App-OS: ios" -H "App-Version: 7.18.3" \
  --data-urlencode "word=$WORD" \
  --data-urlencode "filter=for_ios" \
  --data-urlencode "sort=$SORT" > "$OUT"

echo "── 顶层键名 ──"
python3 -c "import json;print(sorted(json.load(open('$OUT')).keys()))"

python3 - "$OUT" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
ups = d.get("user_previews") or []
print(f"── user_previews 条数: {len(ups)} ──")
print(f"── next_url: {'有' if d.get('next_url') else 'null'} ──")
if not ups:
    sys.exit("!! 未命中用户，检索词可能失效（换 WORD 重跑）")
u = ups[0]
print(f"── user_previews[0] 键名 ──\n{sorted(u.keys())}")
print(f"── user_previews[0].user 键名 ──\n{sorted(u['user'].keys())}")
print(f"── user_previews[0].profile 键名 ──\n{sorted(u['user'].get('profile', {}).keys())}")
for key in ("illusts", "novels"):
    items = u.get(key) or []
    print(f"── user_previews[0].{key} 条数: {len(items)} ──")
    if items:
        print(f"── user_previews[0].{key}[0] 键名 ──\n{sorted(items[0].keys())}")
PY

echo "✓ fixture 已写入：${OUT}（$(wc -c < "$OUT") 字节）"
