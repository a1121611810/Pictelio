#!/usr/bin/env bash
# ─── 查询语法透传验证：/v1/search/{illust,novel} 是否解析 `-` / `OR` / `()` / 全半角 / 大小写 ───
#
# 背景：pixiv 帮助中心 article 235646387 声明搜索框支持 AND(空格) / 负号排除 / OR / 括号嵌套，
# 且「aaa」与「ＡＡＡ」结果相同。此前只有「6 个客户端无一做客户端解析」的**反证推断**，
# 未用鉴权账号实测（见 notes/official-pixiv-search-semantics-and-product-surface.md §C）。
# 本脚本把那条推断变成事实。
#
# 用法：bash docs/research/verify-query-syntax.sh [端点] [search_target]
#   端点默认 /v1/search/illust；search_target 默认空（本仓单/多空格词的实际形态由 buildParams.ts 决定）
# 前置：代理 127.0.0.1:7897（或改 PROXY）；packages/app-lynx/.env 有 PIXIV_REFRESH_TOKEN
#
# 方法论（沿用 verify-search-user-api.sh / verify-tag-neighbors-api.sh）：
#   - 不打印任何凭据（access_token 只经管道进 python）
#   - 判别靠**结果集之间的关系**（并集 / 交集 / 空集），不靠单次结果的有无
#   - 检索词用真实存在的标签（Rosmontis / rosemary / 明日方舟），不手写自洽数据
#
# 2026-10-16 实测结论 + 判别方法 + 未实测清单：pixiv-query-syntax-verified-2026-10.md（同目录）。
# 本脚本只取证、不下结论——结论单点维护在那份摘要里，避免两份副本各自漂移。
set -uo pipefail

PROXY="${PROXY:-http://127.0.0.1:7897}"
export https_proxy="$PROXY" http_proxy="$PROXY"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

RT=$(grep '^PIXIV_REFRESH_TOKEN=' "$REPO/packages/app-lynx/.env" | cut -d= -f2- | tr -d '\r\n"')
CFG="$REPO/packages/android-host/android/app/src/main/java/io/pictelio/app/config/OAuthConfig.java"
CID=$(grep -o 'CLIENT_ID = "[^"]*"' "$CFG" | sed 's/.*"\(.*\)"/\1/')
CSEC=$(grep -o 'CLIENT_SECRET = "[^"]*"' "$CFG" | sed 's/.*"\(.*\)"/\1/')

T=$(mktemp); trap 'rm -f "$T"' EXIT
curl -s -X POST "https://oauth.secure.pixiv.net/auth/token" \
  -H "User-Agent: PixivIOSApp/7.18.3" -H "App-OS: ios" -H "App-Version: 7.18.3" \
  --data-urlencode "grant_type=refresh_token" --data-urlencode "client_id=$CID" \
  --data-urlencode "client_secret=$CSEC" --data-urlencode "refresh_token=$RT" > "$T"
TOK=$(python3 -c "import json;print(json.load(open('$T'))['access_token'])")
echo "✓ access_token 获取成功（${#TOK} 字符，不回显）"

python3 - "$TOK" "${1:-/v1/search/illust}" "${2:-}" <<'PY'
import json, subprocess, sys, time

tok, EP, TARGET = sys.argv[1], sys.argv[2], sys.argv[3] or None

def q(word):
    args = ["curl", "-s", "-G", f"https://app-api.pixiv.net{EP}",
            "-H", f"Authorization: Bearer {tok}",
            "-H", "User-Agent: PixivIOSApp/7.18.3",
            "-H", "App-OS: ios", "-H", "App-Version: 7.18.3",
            "--data-urlencode", f"word={word}",
            "--data-urlencode", "filter=for_ios",
            "--data-urlencode", "merge_plain_keyword_results=true",
            "--data-urlencode", "include_translated_tag_results=true"]
    if TARGET:
        args += ["--data-urlencode", f"search_target={TARGET}"]
    d = json.loads(subprocess.run(args, capture_output=True, text=True).stdout)
    if "error" in d:
        return "ERR:" + json.dumps(d["error"], ensure_ascii=False)[:90]
    return [x["id"] for x in (d.get("illusts") or d.get("novels") or [])]

CASES = [
    ("单查 C",       "Rosmontis"),
    ("单查 B",       "rosemary"),
    ("OR 两词",      "Rosmontis OR rosemary"),
    ("负号 自排除",  "Rosmontis -Rosmontis"),
    ("AND 空格",     "Rosmontis rosemary"),
    ("括号 嵌套",    "Rosmontis (rosemary OR 明日方舟)"),
    ("全角 归一",    "ｒｏｓｅｍａｒｙ"),
    ("大小写 归一",  "RoSeMaRy"),
    ("非法字面串",   "zzqqxx不存在词zz"),
]

got = {}
for label, word in CASES:
    v = q(word)
    if isinstance(v, str):
        print(f"  {label:<12} → ❌ {v}")
    else:
        print(f"  {label:<12} → {len(v):>2} 条 | {','.join(map(str, v[:5]))}")
        got[label] = v
    time.sleep(1.2)

print("\n── 判别 ──")
C, B, ORv, MINUS, AND, FULL, CASE = (
    got.get("单查 C"), got.get("单查 B"), got.get("OR 两词"),
    got.get("负号 自排除"), got.get("AND 空格"),
    got.get("全角 归一"), got.get("大小写 归一"))
print(f"  OR 是并集（含 B 的结果）    : {bool(B and ORv and any(i in ORv for i in B[:5]))}")
print(f"  负号被解析（自排除为空）    : {MINUS == []}")
print(f"  括号被解析（结果非空且≠单查）: {bool(AND and got.get('括号 嵌套') and got['括号 嵌套'] != C)}")
print(f"  AND ≠ OR（真布尔而非取首词） : {AND != ORv}")
print(f"  全角 == 半角                : {FULL == B}")
print(f"  大小写归一                  : {CASE == B}")
print(f"  非法字面串返回空            : {got.get('非法字面串') == []}")
PY
