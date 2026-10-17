#!/usr/bin/env bash
# ─── 插画端 `search_target` / `merge_plain_keyword_results` 等价性取证（交错采样）───
# 目的：复核 docs/research/pixiv-appapi-search-filter-params.md §11 的两条一手结论——
#   ① illust 端「显式传 partial_match_for_tags 会转严格标签匹配并忽略 merge_plain_keyword_results」
#      （Shaft #906）本次**未复现**：**五组**组合交错采样，A/B/C/D 四组的 ID 序列逐位相同；
#   ② `merge_plain_keyword_results` 不传 / 传 true **结果不变**。
#      ⚠️ 订正：merge 轴本脚本只采「不传 vs true」两档（见下方 A–D 定义），**不采 false 档**。
#         上游 §11「true / false / 不传 三档不变」是更宽的结论，其 false 档与 novel / user
#         两端的实测**不在本脚本范围**（见 §11.2）。
# 附带记录 illust 端对非法 `search_target` / `merge_plain_keyword_results` 值的枚举校验行为
# （非法值 → 400；novel / user 端对同一值静默接受，见 §11.2）。
#
# 用法：
#   bash docs/research/verify-illust-target-equivalence.sh
#   WORD="初音ミク" bash docs/research/verify-illust-target-equivalence.sh   # 换检索词
#   ROUNDS=3 bash docs/research/verify-illust-target-equivalence.sh          # 加采样轮数
#
# 前置：
#   - 代理在 127.0.0.1:7897（或改 PROXY 环境变量）
#   - packages/app-lynx/.env 有 PIXIV_REFRESH_TOKEN
#   - OAuth 凭据在 packages/android-host/android/app/src/main/java/io/pictelio/app/config/OAuthConfig.java
#
# ⚠️ 采样方法论（本脚本存在的**唯一理由**，删了它结论就不成立）：
#   **插画端结果集随时间漂移**——同一查询连续采样，首位 ID 可从 150944641 漂到 150944731
#   （秒级内稳定，即短窗口内稳定、跨窗口漂移）。
#   ⇒ 必须**交错采样** A/B/C/D/E/A/B/C/D/E，绝不能顺序采样（先把 A 采完再采 B）。
#   顺序采样会把服务端漂移当成参数差异，产出**方向完全相反**的假结论。
#   本脚本对每个 ROUND 都按 A,B,C,D,E 顺序发一轮请求，然后才进入下一轮。
#
# ⚠️ 凭据纪律（沿用 verify-search-user-api.sh）：
#   - **绝不回显任何凭据**：access_token 经 `$(python3 …)` 命令替换进 shell 变量，
#     只经 `-H "Authorization: …"` 交给 curl，**不落 stdout**；回显处只有长度 `${#TOK}`
#   - OAuth 响应临时落 mktemp 文件（token 本体在响应体内），`trap … EXIT` 退出即删
#   - 每次结论都打印**完整 ID 序列**与 **HTTP 状态码 + 条数**，让「是否逐位相同」可被第三方直接复核
set -euo pipefail

PROXY="${PROXY:-http://127.0.0.1:7897}"
export https_proxy="$PROXY" http_proxy="$PROXY"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

RT=$(grep '^PIXIV_REFRESH_TOKEN=' "$REPO/packages/app-lynx/.env" | cut -d= -f2- | tr -d '\r\n"')
CFG="$REPO/packages/android-host/android/app/src/main/java/io/pictelio/app/config/OAuthConfig.java"
CID=$(grep -o 'CLIENT_ID = "[^"]*"' "$CFG" | sed 's/.*"\(.*\)"/\1/')
CSEC=$(grep -o 'CLIENT_SECRET = "[^"]*"' "$CFG" | sed 's/.*"\(.*\)"/\1/')

TOKEN_FILE=$(mktemp)
trap 'rm -f "$TOKEN_FILE" /tmp/px-illst-*.json' EXIT

curl -s -X POST "https://oauth.secure.pixiv.net/auth/token" \
  -H "User-Agent: PixivIOSApp/7.18.3" -H "App-OS: ios" -H "App-Version: 7.18.3" \
  --data-urlencode "grant_type=refresh_token" \
  --data-urlencode "client_id=$CID" \
  --data-urlencode "client_secret=$CSEC" \
  --data-urlencode "refresh_token=$RT" > "$TOKEN_FILE"

TOK=$(python3 -c "import json;print(json.load(open('$TOKEN_FILE'))['access_token'])")
echo "✓ access_token 获取成功（${#TOK} 字符，不回显）"
echo "✓ 代理：$PROXY"

WORD="${WORD:-東方}"
ROUNDS="${ROUNDS:-2}"

# 五组组合（A–D 证「彼此无差异」，E 证「参数确实被服务端消费」）：
#   A = omit search_target + omit merge   （基线；即显式 partial 不发的那条路径）
#   B = 显式 search_target=partial_match_for_tags + omit merge
#   C = omit search_target + merge_plain_keyword_results=true
#   D = 显式 search_target=partial_match_for_tags + merge_plain_keyword_results=true
#   E = 显式 exact_match_for_tags + omit merge   ← **决定性对照组**
#
#   ⇒ **E 为什么不可省**（与「交错采样」并列的另一根支柱，互不替代）：
#     只看 A==B，结论是**二义的**——既可能是「服务端把 partial 参数整个忽略了」，也可能是
#     「partial 真的生效、但 partial 档与不传恰好等价」。两种解释下 ID 序列**都是 A**，
#     不设对照组就**无从区分**，等于拿一个二义观测下二元结论。
#     E(exact) 与 A 出现 ID 集合差异 ⇒ `search_target` 确实被消费 ⇒ 此时 A==B 才读作真等价。
#       判据：⚠️ **不能用条数判**——结果集会补满一页（都是 30 条），条数相同 ≠ 结果集相同，
#             必须比 ID **集合**差异（脚本末尾汇总已如此实现）。
#       另一路信号（#906 假设成立时应成立）：若 partial 真会转严格标签匹配，E(exact) 应 ≈ B
#       而非 ≈ A；E 贴近 A 正是 #906 未复现的证据。
sample() { # $1=tag  $2=round  $3=search_target(可空)  $4=merge(可空)
  local tag="$1" round="$2" st="$3" mg="$4"
  local out="/tmp/px-illst-${tag}-${round}.json"
  local -a args=(
    -s -G "https://app-api.pixiv.net/v1/search/illust"
    -H "Authorization: Bearer $TOK"
    -H "User-Agent: PixivIOSApp/7.18.3" -H "App-OS: ios" -H "App-Version: 7.18.3"
    -H "Accept: application/json"
    --data-urlencode "word=$WORD"
    --data-urlencode "filter=for_ios"
    --data-urlencode "sort=date_desc"
    -o "$out" -w '%{http_code}'
  )
  if [ -n "$st" ]; then args+=(--data-urlencode "search_target=$st"); fi
  if [ -n "$mg" ]; then args+=(--data-urlencode "merge_plain_keyword_results=$mg"); fi
  local code
  code=$(curl "${args[@]}")
  # 状态码只落 stdout 的这一行；响应体落文件，由 python 读 ID 序列（凭据永不经此管道）
  python3 - "$out" "$tag" "$round" "$code" <<'PY'
import json, sys, hashlib
path, tag, rnd, code = sys.argv[1:5]
try:
    d = json.load(open(path))
except Exception:
    d = {}
ids = [i.get("id") for i in (d.get("illusts") or [])]
# HTTP 4xx 的响应体是 {"error":{"message":...}}，没有 illusts
print(f"[{tag} r{rnd}] HTTP {code}  条数={len(ids)}  md5={hashlib.md5(','.join(map(str, ids)).encode()).hexdigest()[:12]}")
print(f"[{tag} r{rnd}] ID 序列：{ids}")
PY
}

echo
# 注意：变量名后紧跟中文标点时必须写 ${WORD}——非 UTF-8 locale 下 bash 会把多字节字符
# 吃进变量名，报 "unbound variable"
echo "══ 交错采样：检索词「${WORD}」，$ROUNDS 轮（A,B,C,D / E 依次发，逐轮推进）══"
for r in $(seq 1 "$ROUNDS"); do
  echo "── 第 $r 轮 ──"
  sample A "$r" "" ""
  sample B "$r" "partial_match_for_tags" ""
  sample C "$r" "" "true"
  sample D "$r" "partial_match_for_tags" "true"
  sample E "$r" "exact_match_for_tags" ""
done

echo
echo "══ 枚举校验（illust 端非法值 → 预期 400）══"
sample ZZZ_TARGET "$ROUNDS" "zzz" ""
sample ZZZ_MERGE "$ROUNDS" "" "zzz"
echo "（对照：novel / user 端对同一批非法值**静默接受**——那两端的实测见"
echo "  docs/research/pixiv-appapi-search-filter-params.md §11.2，不在本脚本范围）"

echo
echo "══ 汇总：逐轮比较 A/B/C/D 的 ID 序列 ══"
python3 - "$WORD" "$ROUNDS" <<'PY'
import json, sys
word, rounds = sys.argv[1], int(sys.argv[2])
def ids(tag, r):
    try:
        return [i.get("id") for i in (json.load(open(f"/tmp/px-illst-{tag}-{r}.json")).get("illusts") or [])]
    except Exception:
        return None
for r in range(1, rounds + 1):
    a, b, c, d = ids("A", r), ids("B", r), ids("C", r), ids("D", r)
    if a is None:
        print(f"第 {r} 轮：A 组无响应，跳过"); continue
    same_abcd = a == b == c == d
    e = ids("E", r)
    print(f"第 {r} 轮：A==B==C==D ? {'是 ✅' if same_abcd else '否 ❌'}")
    if e is None:
        print("         E 组无响应，跳过对照组比较"); continue
    # ⚠️ **别用条数判对照组**：结果集会补满一页（都是 30），条数相同不代表结果集相同。
    # robust 信号 = ID 集合差异（A 独有 / E 独有）。
    sa, se = set(a), set(e)
    only_a, only_e = sorted(sa - se), sorted(se - sa)
    print(f"         对照组 E(exact) vs A(omit)：条数 A={len(a)} E={len(e)}"
          f"  A 独有 {len(only_a)} 条 / E 独有 {len(only_e)} 条")
    print(f"         → A∩E = {len(sa & se)} 条；A 独有前 3 = {only_a[:3]}  E 独有前 3 = {only_e[:3]}")
print()
print("解读（对照 §11.1）：")
print("  · A==B==C==D 全是 ⇒ 「显式 partial 会转严格标签匹配」本次未复现，且 merge 无可观测效果")
print("  · E(exact) 与 A(omit) 存在 ID 集合差异 ⇒ search_target 确实被服务端消费，")
print("    对照组有效（否则 A==E 与 A==B 一样无信息量，分不清「参数被忽略」和「参数生效但等价」）")
print("  · 多词检索（如 WORD=\"Rosmontis rosemary\"）是更强的对照：exact 会显著收窄条数")
print("  · 若某轮 A≠B，**先别下结论**：确认是否为顺序采样/服务端漂移，改 ROUNDS 加轮次交错复跑")
PY

echo
echo "✓ 复跑入口：WORD=... ROUNDS=... bash docs/research/verify-illust-target-equivalence.sh"
