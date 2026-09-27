#!/usr/bin/env bash
# ─── 标签近邻「阶段 2 终止条件口径」取证脚本 ───
# 结论来源：docs/adr/ADR-0197-app-lynx-tag-neighbors.md §更正记录 1
# spec/ADR 初稿假设「用服务端 total 判够数」；本脚本证明该字段**不存在**，
# 并给出可用的等价判据。
#
# 用法：bash docs/research/verify-tag-neighbors-api.sh
# 前置：代理在 127.0.0.1:7897（或改 PROXY）；packages/app-lynx/.env 有 PIXIV_REFRESH_TOKEN
#
# ⚠️ 方法论（沿用 verify-source-tracing.sh 的教训 2/5）：
#   - 脚本不打印任何凭据（access_token 只经管道进 python，不落 stdout）
#   - 每条结论都打印**响应顶层键名**，让「字段存不存在」可直接复核
#   - 罕见标签用真实存在的词条，不手写自洽数据
set -euo pipefail

PROXY="${PROXY:-http://127.0.0.1:7897}"
export https_proxy="$PROXY" http_proxy="$PROXY"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

RT=$(grep '^PIXIV_REFRESH_TOKEN=' "$REPO/packages/app-lynx/.env" | cut -d= -f2- | tr -d '\r\n"')
CFG="$REPO/packages/app/android/app/src/main/java/io/pictelio/app/config/OAuthConfig.java"
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

g() { # g <path> [curl args...]
  local path="$1"; shift
  curl -s -G "https://app-api.pixiv.net$path" \
    -H "Authorization: Bearer $TOK" \
    -H "User-Agent: PixivIOSApp/7.18.3" -H "App-OS: ios" -H "App-Version: 7.18.3" "$@"
}

show() { # show <label> <json>
  printf '%-40s' "$1"
  python3 -c '
import sys, json
d = json.loads(sys.stdin.read())
if "error" in d:
    print("ERROR:", d["error"].get("user_message")); raise SystemExit
il = d.get("illusts", [])
nu = d.get("next_url")
print("keys=", sorted(d.keys()),
      "| illusts=", len(il),
      "| next_url=", "null" if nu is None else "SET",
      "| total=", d.get("total", "<ABSENT>"))
'
}

echo
echo "【结论 1】/v1/search/illust 响应无 total 字段；/v2/search/illust 不存在"
echo "----------------------------------------------------------------------"
show "v1/search/illust 单词"  < <(g /v1/search/illust --data-urlencode "word=原神" --data-urlencode "filter=for_ios" --data-urlencode "sort=date_desc")
show "v1/search/illust 多标签" < <(g /v1/search/illust --data-urlencode "word=原神 HoYoverse" --data-urlencode "filter=for_ios" --data-urlencode "search_target=exact_match_for_tags" --data-urlencode "sort=date_desc")
show "v2/search/illust（应 404）" < <(g /v2/search/illust --data-urlencode "word=原神" --data-urlencode "filter=for_ios")

echo
echo "【结论 2】结果集不足一页时 next_url 必为 null → 本页条数即精确总数"
echo "----------------------------------------------------------------------"
show "ホビィ（4 条，不足一页）" < <(g /v1/search/illust --data-urlencode "word=ホビィ" --data-urlencode "filter=for_ios")
show "川崎 Sera（含空格→0 条）" < <(g /v1/search/illust --data-urlencode "word=川崎 Sera" --data-urlencode "filter=for_ios")
show "原神（30 条，满页）" < <(g /v1/search/illust --data-urlencode "word=原神" --data-urlencode "filter=for_ios")

echo
echo "【结论 3】阶段 1 依赖面：/v1/user/illusts 走 next_url 游标、每条自带 tags"
echo "----------------------------------------------------------------------"
g /v1/user/illusts --data-urlencode "user_id=120290822" --data-urlencode "type=illust" --data-urlencode "filter=for_ios" | python3 -c '
import sys, json
d = json.load(sys.stdin)
il = d["illusts"]
print("本页条数      =", len(il))
print("next_url      =", "null" if d["next_url"] is None else "SET")
print("带 tags 条数  =", sum(1 for i in il if i.get("tags")), "/", len(il))
print("tags 原序样本 =", [t["name"] for t in il[0]["tags"]][:6])
'
echo
echo "⇒ 判据：enough = len(illusts) >= 5"
echo "   满页恒为 30（≫5）→ 本页 ≥5 即全站 ≥5；不足一页时 next_url=null → 本页即全量。"
