#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# 溯源通道取证脚本（throwaway · 验证用，非生产代码）
#
# 用途：为 ADR-0196 D3「按引擎能力二分」建立**可复现、可跨代理对比**的
#       实测基线。单次手工 curl 的结论绑定在单一出口 IP 上，不可外推；
#       本脚本输出结构化结果，供换代理后逐行对照。
#
# 用法：  bash verify-source-tracing.sh [代理地址]
#   无参数 → 默认不代理（直连）
#   例：    bash verify-source-tracing.sh http://127.0.0.1:7897
#
# 输出：终端表格 + /tmp/source-tracing-verdict-<tag>.json
# ─────────────────────────────────────────────────────────────────

PROXY="${1:-}"
TAG="$(echo "${PROXY:-direct}" | sed 's#[^a-zA-Z0-9]#_#g')"
OUT="/tmp/source-tracing-verdict-${TAG}.json"

CURL=(curl -sS -m 25)
[ -n "$PROXY" ] && CURL+=(-x "$PROXY")
UA_CHROME='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
PIXIV_REFERER='https://app-api.pixiv.net/'

# agent 从本仓 docs/research/ri-365-evidence/diag/logcat.txt 提取的
# 12 个真实 img-original URL（HTTP 200 实证，非合成 fixture）
IMG="https://i.pximg.net/img-original/img/2026/08/29/13/57/48/149016970_p0.jpg"   # 1,252,218 B
IMG_BIG="https://i.pximg.net/img-original/img/2026/08/28/21/45/28/148991558_p0.jpg" # 8,304,522 B（> 8MiB）
NOVEL="https://i.pximg.net/c/128x128/novel-cover-master/img/2024/02/15/04/12/15/ci21588133_6336c871153e21e22effc75dec4094f6_square1200.jpg"
BOGUS="https://i.pximg.net/img-original/img/2026/08/29/13/57/48/149016970_p9.jpg"  # 不存在的页

code() { "${CURL[@]}" -o /dev/null -w '%{http_code}' "$@" 2>/dev/null || echo "ERR"; }
ctype() { "${CURL[@]}" -o /dev/null -w '%{content_type}' "$@" 2>/dev/null || echo "-"; }
bytes() { "${CURL[@]}" -o /dev/null -w '%{size_download}' "$@" 2>/dev/null || echo "-"; }

echo "════════════════════════════════════════════════════════════"
echo " 溯源通道取证 · 出口 = ${PROXY:-直连}"
echo " 时间 = $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "════════════════════════════════════════════════════════════"

# ── 出口 IP 指纹（关键：防盗链可能按 IP 维度判断）───────────────
echo ""
echo "▍出口 IP 指纹"
EGRESS_IP=$("${CURL[@]}" -sS -m 15 https://api.ipify.org 2>/dev/null || echo "?")
GEO=$("${CURL[@]}" -sS -m 15 "https://ipinfo.io/${EGRESS_IP}/json" 2>/dev/null | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin); print(f\"{d.get('city','?')}, {d.get('country','?')} · {d.get('org','?')} · {d.get('asn',{}).get('asn','?') if isinstance(d.get('asn'),dict) else d.get('asn','?')}\")
except Exception: print('(geo 不可达)')
" 2>/dev/null || echo "(geo 不可达)")
echo "  IP  = $EGRESS_IP"
echo "  GEO = $GEO"

# ── Q1 防盗链三态矩阵 ─────────────────────────────────────────
echo ""
echo "▍Q1  i.pximg.net 防盗链矩阵（img-original，真实 URL）"
printf "  %-42s %-8s %-8s %-8s\n" "请求" "无Referer" "PixivRef" "他人Ref"
probe3() {
  local url="$1" label="$2"
  local a b c
  a=$(code "$url")
  b=$(code -A "$UA_CHROME" -H "Referer: $PIXIV_REFERER" "$url")
  c=$(code -A "$UA_CHROME" -H "Referer: https://saucenao.com/" "$url")
  printf "  %-42s %-8s %-8s %-8s\n" "$label" "$a" "$b" "$c"
}
probe3 "$IMG"     "img-original 1.25MB"
probe3 "$IMG_BIG" "img-original 8.30MB (>8MiB)"
probe3 "$NOVEL"   "novel-cover 128x128"

echo ""
echo "  ▸ 判别：带 PixivRef 的 404 = 到达应用层（路径不存在）"
echo "         无 Referer 的 403 = 被防盗链拦在路径解析之前"
echo "         → 无 Referer 恒 403 时，403 与「文件不存在」不可区分"
NB=$(code "$BOGUS" -A "$UA_CHROME" -H "Referer: $PIXIV_REFERER")
NB0=$(code "$BOGUS")
echo "  对照 不存在页(带PixivRef) = $NB   不存在页(无Referer) = $NB0"

echo ""
echo ""
echo "▍Q1b 排除免 Referer 的 CDN 入口（负面结论对照）"
printf "  %-24s %s\n" "i/i2/i3/i4/img/image" 
for h in i.pximg.net i2.pximg.net i3.pximg.net i4.pximg.net img.pximg.net image.pximg.net; do
  printf "    %-22s %s\n" "$h" "$(code -m 15 "https://$h/img-original/img/2026/08/29/13/57/48/149016970_p0.jpg")"
done

echo ""
echo "▍Q1c 403 来源自检（fake-ip 环境必做：代理不伪造 403）"
printf "  %-34s %s\n" "① 目标 无Referer"      "$(code -m 15 "$IMG")"
printf "  %-34s %s\n" "② 目标 带PixivReferer"  "$(code -m 15 -A "$UA_CHROME" -H "Referer: $PIXIV_REFERER" "$IMG")"
printf "  %-34s %s\n" "③ 不存在的域名"        "$(code -m 15 "https://zzz-not-a-real-domain-9x8y7z.com/x.jpg")  <- 应为 000"
printf "  %-34s %s\n" "④ 目标不存在文件+Referer" "$(code -m 15 -H "Referer: $PIXIV_REFERER" "$BOGUS")  <- 应为 404"
echo "  ▸ ③ 若为 000 则证明 ① 的 403 来自目标站本身，不是代理伪造"

echo "▍Q2  路径段可用性（带正确 Referer）"
for seg in "img-original/img/2026/08/29/13/57/48/149016970_p0.jpg" \
           "img-master/img/2026/08/29/13/57/48/149016970_p0_master.jpg" \
           "c/540x540_70/img-master/img/2026/08/29/13/57/48/149016970_p0_master.jpg" \
           "c/128x128/novel-cover-master/img/2024/02/15/04/12/15/ci21588133_6336c871153e21e22effc75dec4094f6_square1200.jpg"; do
  printf "  %-64s %s\n" "$seg" "$(code -H "Referer: $PIXIV_REFERER" "https://i.pximg.net/$seg")"
done

# ── Q3 引擎 URL 检索端到端 ───────────────────────────────────
echo ""
echo "▍Q3  引擎 URL 直传端到端（结果页是否真出现）"
enc() { python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$1"; }

iqdb() {
  # IQDB 是异步两段式：POST 先回「Retrieving… inserting referrer…」中间页（约 2.7KB），
  # 前端轮询后才出结果页（约 24KB，含相似度）。故**单次 POST 判定可行性不可靠**——
  # 判据改用「是否出现 referrer 注入标记」，该标记稳定复现且不依赖时序。
  local r small
  r=$("${CURL[@]}" -A "$UA_CHROME" -L -m 30 -X POST https://iqdb.org/ \
        --data-urlencode "url=$1" -d "service%5B%5D=1" -d "service%5B%5D=4" 2>/dev/null)
  small=$(echo "$r" | wc -c | tr -d ' ')
  if   echo "$r" | grep -qiE "inserting referrer";              then echo "VIABLE:referrer-injected(fetch-ok, async) bytes=$small"
  elif echo "$r" | grep -qiE "does not block hotlinking|not an image format"; then echo "DEAD:hotlink-refused bytes=$small"
  elif echo "$r" | grep -qiE "[0-9]{1,3}% similarity";          then echo "VIABLE:results-present bytes=$small"
  elif echo "$r" | grep -qiE "no similarity|no results";        then echo "VIABLE:fetched-but-no-match bytes=$small"
  else echo "UNKNOWN bytes=$small"
  fi
}
tineye() {
  # SPA 无服务端渲染表单：curl 拿到的是骨架页，**不能据此判定成败**。
  # 只记录可跨代理比对的硬事实：HTTP 状态 + 是否命中错误串 + 字节数。
  local r sc
  r=$("${CURL[@]}" -A "$UA_CHROME" -L -m 30 -w $'\n__CODE__%{http_code}' "https://tineye.com/search?url=$(enc "$1")" 2>/dev/null)
  sc=$(echo "$r" | sed -n 's/^__CODE__//p'); r=$(echo "$r" | grep -v '^__CODE__')
  local hit="no-error-str"
  echo "$r" | grep -qiE "could not read|data_url_error" && hit="ERRSTR:could-not-read"
  echo "$r" | grep -qiE "PublicSearchPage|no results" && hit="$hit+HAS_RESULTS_SHELL"
  echo "http=$sc bytes=$(echo "$r" | wc -c | tr -d ' ') $hit"
}
ascii2d() {
  # 需要 Rails CSRF，curl 无法过 Cloudflare managed challenge
  local r
  r=$("${CURL[@]}" -A "$UA_CHROME" -L -m 25 -o /dev/null -w '%{http_code}' \
       "https://ascii2d.net/search/url/$(printf '%s' "$1" | base64 | tr '+/' '-_' | tr -d '=')" 2>/dev/null)
  [ "$r" = "403" ] && echo "BLOCKED(403 Cloudflare challenge)" || echo "HTTP $r"
}
sauce() {
  local r
  r=$("${CURL[@]}" -A "$UA_CHROME" -L -m 25 -o /dev/null -w '%{http_code}' \
       "https://saucenao.com/search.php?url=$(enc "$1")" 2>/dev/null)
  [ "$r" = "403" ] && echo "BLOCKED(403 Cloudflare challenge)" || echo "HTTP $r"
}

# 每引擎只发一次真实请求，结果存变量供表格与汇总共用。
# （曾因表格与汇总各调一次而使汇总值变成限流后的失败值——IQDB 对重复 POST 有速率限制）
IQ=$(iqdb "$IMG"); IQB=$(iqdb "$IMG_BIG"); TE=$(tineye "$IMG")
A2=$(ascii2d "$IMG"); SN=$(sauce "$IMG")
printf "  %-14s %s\n" "IQDB(1.25MB)" "$IQ"
printf "  %-14s %s\n" "IQDB(8.30MB)" "$IQB"
printf "  %-14s %s\n" "TinEye"       "$TE"
printf "  %-14s %s\n" "Ascii2D"      "$A2"
printf "  %-14s %s\n" "SauceNAO"     "$SN"

# ── 汇总 ─────────────────────────────────────────────────────
NR=$(code "$IMG"); NRR=$(code -A "$UA_CHROME" -H "Referer: $PIXIV_REFERER" "$IMG")
case "$IQ"  in VIABLE*) URLWORKS=true ;; *) URLWORKS=false ;; esac
case "$NR:$NRR" in 403:200) HL403=true ;; *) HL403=false ;; esac
python3 - "$OUT" "$EGRESS_IP" "$GEO" "$NR" "$NRR" "$NB" "$HL403" "$URLWORKS" "$IQ" "$IQB" "$TE" <<'PY'
import json,sys
(out,eip,geo,noref,noref_pix,notfound,hl,urlw,iq,iqb,te)=sys.argv[1:12]
def b(v): return v=="true"
d={"egress_ip":eip,"geo":geo,
   "note":"出口 IP 可能随代理池轮换；同一代理两次运行 egress_ip 不同即为轮换",
   "pximg_no_referer":noref,"pximg_with_pixiv_referer":noref_pix,
   "pximg_bogus_with_referer":notfound,
   "hotlink_unconditionally_403": b(hl),
   "url_direct_works_somewhere": b(urlw),
   "iqdb_url_direct":iq,"iqdb_oversize_8p3MB":iqb,"tineye_url_direct":te}
json.dump(d,open(out,"w"),ensure_ascii=False,indent=2)
print("  判定：防盗链无差别 403 =",b(hl),"| URL 直传至少一处可行 =",b(urlw))
PY
echo ""
echo "▍结果已存 $OUT"
echo "▍换代理后请保留旧文件以便逐行对照"
echo "════════════════════════════════════════════════════════════"
