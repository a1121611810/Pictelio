#!/usr/bin/env bash
# ─── 小说端 `/v1/search/novel` 对 `search_target=title_and_caption` 的校验行为取证 ───
# 目的：判定该端点对这个取值是「**忽略**（发了无害）」还是「**硬拒**（发了就坏）」——
# 这两者给出**方向完全相反**的工程结论（能否随手带上该参数），必须实测区分，不能靠推断。
# 2026-10-17 主代理一次性采样确认「实测被拒」（交错 2 轮）但**未留档脚本**，本文与
# spec `docs/specs/search-target-mode.md` §4 的 400/0 两个数字因此没有可复跑入口；
# 本脚本补上这个取证面。
#
# 用法：bash docs/research/verify-novel-title-target.sh
# 环境变量（都有默认值，直接裸跑即取证）：
#   WORD=检索词（默认 東方，真实存在的标签）
#   FILTER=for_ios（与本仓 `buildParams.ts` 请求形状一致）
#   SORT=date_desc（同上）
#   ROUNDS=交错轮数（默认 2；交错而非顺序，见下方方法论）
#   PROXY=代理（默认 http://127.0.0.1:7897）
# 前置：代理在 127.0.0.1:7897；packages/app-lynx/.env 有 PIXIV_REFRESH_TOKEN
#
# ⚠️ 方法论（沿用 verify-search-user-api.sh / verify-illust-target-equivalence.sh 的教训）：
#   - 脚本**不打印任何凭据**：access_token 只经管道/环境变量进 python，只回显长度
#   - 每条结论都打印 **HTTP 状态码 + 条数**（状态码是决定性信号，条数仅供参照）
#   - **必须交错采样**（A、B、C、D、A、B、C、D…）：搜索结果集随时间漂移——同一查询
#     连续两次采样 ID 序列 md5 不同（首位 ID 秒级内从 150944641 漂到 150944731）。
#     「先跑完 A 组再跑 B 组」会把漂移读成「A≠B」的假差异，反向亦然。
#   - 检索词用真实存在的标签，不手写自洽数据
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

WORD="${WORD:-東方}"
FILTER="${FILTER:-for_ios}"
SORT="${SORT:-date_desc}"
ROUNDS="${ROUNDS:-2}"
EP="https://app-api.pixiv.net/v1/search/novel"

echo "── 取证目标：$EP  word=$WORD  filter=$FILTER  sort=$SORT  交错 ${ROUNDS} 轮 ──"

NOVEL_TOKEN="$TOK" NOVEL_WORD="$WORD" NOVEL_FILTER="$FILTER" NOVEL_SORT="$SORT" \
  NOVEL_ROUNDS="$ROUNDS" NOVEL_EP="$EP" python3 - <<'PY'
import hashlib, json, os, subprocess, tempfile

tok = os.environ["NOVEL_TOKEN"]
word = os.environ["NOVEL_WORD"]
flt = os.environ["NOVEL_FILTER"]
sort = os.environ["NOVEL_SORT"]
rounds = int(os.environ["NOVEL_ROUNDS"])
ep = os.environ["NOVEL_EP"]

# 顺序固定，但**按轮次交错执行**（不是「跑完一组再跑下一组」）
CASES = [
    ("省略 search_target（基线）", None),
    ("search_target=title_and_caption", "search_target=title_and_caption"),
    ("search_target=partial_match_for_tags", "search_target=partial_match_for_tags"),
    ("对照组 foo=bar（不相关未知参数名）", "foo=bar"),
]


def run(extra):
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        path = f.name
    try:
        args = [
            "curl", "-s", "-G", ep,
            "-H", f"Authorization: Bearer {tok}",
            "-H", "User-Agent: PixivIOSApp/7.18.3",
            "-H", "App-OS: ios",
            "-H", "App-Version: 7.18.3",
            "--data-urlencode", f"word={word}",
            "--data-urlencode", f"filter={flt}",
            "--data-urlencode", f"sort={sort}",
            "-o", path, "-w", "%{http_code}",
        ]
        if extra is not None:
            args += ["--data-urlencode", extra]
        code = subprocess.run(args, capture_output=True, text=True).stdout.strip()
        try:
            d = json.load(open(path))
        except Exception:
            return code, None, None
        ids = [n.get("id") for n in (d.get("novels") or [])]
        digest = hashlib.md5(json.dumps(ids).encode()).hexdigest()[:8] if ids else None
        return code, len(ids), digest
    finally:
        os.unlink(path)


print()
print("── 逐条采样（轮内交错，轮间重复）──")
seen = {label: [] for label, _ in CASES}
for r in range(1, rounds + 1):
    for label, extra in CASES:
        code, n, digest = run(extra)
        seen[label].append((code, n, digest))
        d = "-" if digest is None else digest
        print(f"   轮 {r} | {label:<42}  HTTP {code}   novels {'-' if n is None else n} 条   ids md5 {d}")

print()
print("── 汇总 ──")
for label, _ in CASES:
    samples = seen[label]
    codes = sorted({c for c, _, _ in samples})
    counts = [n for _, n, _ in samples]
    stable = "一致" if len(set(counts)) <= 1 else "漂移"
    md5s = {dg for _, _, dg in samples if dg}
    md5_note = "一致" if len(md5s) <= 1 else "漂移"
    print(
        f"   {label:<42}  HTTP {'/'.join(codes)}   novels {counts}（{stable}）"
        f"   ids md5 {'/'.join(sorted(md5s)) if md5s else '-'}（{md5_note}）"
    )

print()
print("   判读：**HTTP 状态码是决定性信号**。")
print("   · `title_and_caption` 400 而未知参数名 `foo=bar` 200 ⇒ 该端点对 `search_target`")
print("     做**取值校验**：不是「不认识参数名所以忽略」（那会是无害），而是**明确拒绝该取值**。")
print("   · 条数与 ids md5 仅供参照：结果集随时间漂移（见文件头方法论），不可单独用来判等；")
print("     判等只在**交错采样**下成立。")
print("   · 判「发了会坏」还是「发了无害」只能看状态码——条数相同不构成安全证据。")
PY
