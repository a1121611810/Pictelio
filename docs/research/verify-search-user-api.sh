#!/usr/bin/env bash
# ─── 用户搜索 `/v1/search/user` 响应面取证脚本 ───
# 目的：`/v1/search/user` 的响应字段在本仓此前**无任何一手样例**，只有第三方客户端
# 的 schema 声明（pixez `models/user_preview.dart`、PixivBiu `api/openapi.yaml`
# `UserPreview`）。本脚本抓真实响应，把「字段存不存在」变成可复核事实，
# 并产出契约测试用的 fixture（测试硬约束 2：契约测试必须使用真实样例）。
#
# 用法：bash docs/research/verify-search-user-api.sh
# 环境变量（都有默认值，直接裸跑即取证，不重造 fixture）：
#   WORD=检索词（默认 ソーダ豆汁，**只命中 1 个用户**——重造 fixture 务必覆盖成 水上）
#   SORT=date_asc|date_desc|popular_desc（默认 date_desc）
#   OUT=原始响应落盘路径（默认 /tmp/search-users-verify.json；**不覆盖已提交的 fixture**）
#   TRIM_FIXTURE=裁剪后 fixture 落盘路径（留空=不裁剪；非空则按下方「精选」口径裁剪）
#   PROBE_SEARCH_TARGET=1 追加 search_target 枚举校验取证（默认关，不影响常规路径）
# 前置：代理在 127.0.0.1:7897（或改 PROXY）；packages/app-lynx/.env 有 PIXIV_REFRESH_TOKEN
#
# ⚠️ 方法论（沿用 verify-tag-neighbors-api.sh 的教训 2/5）：
#   - 脚本不打印任何凭据（access_token 只经管道/环境变量进 python，不落 stdout）
#   - 每条结论都打印**响应顶层键名**与**条目键名**，让「字段存不存在」可直接复核
#   - 打印 `user_previews[*].user.id` 全序列（带 sort 标注），供 SORT=date_asc /
#     date_desc / popular_desc 三档复跑时逐位比对（spec §3.4「用户端点忽略 sort」的取证面）
#     ⚠️ 默认 WORD 只命中 1 个用户，比对请同时覆盖 WORD（水上 实测三档均 30 条；§3.4 另用 柊/凛/蒼）
#     ⚠️⚠️ **比对应交错采样**（2026-10-17 实测教训）：搜索结果集随时间漂移——同一查询
#     连续两次采样 ID 序列 md5 不同（首位 ID 秒级内从 150944641 漂到 150944731）。
#     「先跑完 A 档三 sort、再跑 B 档」会把漂移读成「A≠B」的假差异，反向亦然。
#     ⇒ 逐位相同这条结论只在 A/B/A/B 交替取样下才成立；顺序采样的「差异」不可作证。
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
# 全量响应盖掉库里那份裁剪版（fixture 是「4 条精选预览 / 各非空数组取前 2」的样本，
# 覆盖后 spec §3.1 的取证面与契约测试的断言对象都会漂移）。
OUT="${OUT:-/tmp/search-users-verify.json}"

# ─── 裁剪出契约测试用的 fixture（TRIM_FIXTURE=<路径> 开启）──────────────────
# 已提交的 `packages/app-lynx/src/api/__fixtures__/search-users.json` 是**精选**样本，
# **不是「前 4 条」**：4 条预览取自实时 30 条里的**第 0/1/3/5 位**（跳过第 2、4 位）；
# 每个非空数组（illusts / novels）取**前 2** 个元素；next_url 原样保留（它是全量响应
# 的真实分页游标，带 offset=30）。⇒ 不裁剪的复跑产物是 30 条全量，**不能**当 fixture。
#
# 完整重造配方（一步到位，产物口径与已提交 fixture 一致；缺 WORD 或缺 TRIM_FIXTURE
# 都会产出与库内那份不同形状的文件，从而让契约测试三条用例失去断言对象）：
#
#   WORD=水上 SORT=date_desc \
#   TRIM_FIXTURE=packages/app-lynx/src/api/__fixtures__/search-users.json \
#   bash docs/research/verify-search-user-api.sh
#
# 跑完请核对脚本打印的「实时 {N} 条 → 精选 4 条（实时下标 [0, 1, 3, 5]）」与
# 各条裁剪后 (illusts, novels) 条数——与 fixture 本体逐条清点一致才算复现成功。
TRIM_FIXTURE="${TRIM_FIXTURE:-}"

SEARCH_USER_URL="https://app-api.pixiv.net/v1/search/user"

curl -s -G "$SEARCH_USER_URL" \
  -H "Authorization: Bearer $TOK" \
  -H "User-Agent: PixivIOSApp/7.18.3" -H "App-OS: ios" -H "App-Version: 7.18.3" \
  --data-urlencode "word=$WORD" \
  --data-urlencode "filter=for_ios" \
  --data-urlencode "sort=$SORT" > "$OUT"

echo "── 顶层键名 ──"
python3 -c "import json;print(sorted(json.load(open('$OUT')).keys()))"

python3 - "$OUT" "$SORT" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
sort = sys.argv[2]
ups = d.get("user_previews") or []
print(f"── user_previews 条数: {len(ups)} ──")
print(f"── next_url: {'有' if d.get('next_url') else 'null'} ──")
if not ups:
    sys.exit("!! 未命中用户，检索词可能失效（换 WORD 重跑）")
ids = [p.get("user", {}).get("id") for p in ups]
print(f"── user_previews[*].user.id 序列（sort={sort}）──\n{ids}")
u = ups[0]
usr = u["user"]
print(f"── user_previews[0] 键名 ──\n{sorted(u.keys())}")
print(f"── user_previews[0].user 键名 ──\n{sorted(usr.keys())}")
# §3.2 的核心取证面：头像**只有 medium**（无 px_16x16 / px_50x50 / px_170x170）⇒ UI 只取 medium
print(f"── user_previews[0].user.profile_image_urls 键名 ──\n{sorted((usr.get('profile_image_urls') or {}).keys())}")
# account 是**字符串**不是对象（决定副标题怎么取：§5.4「副标题：user.account」）
acct = usr.get("account")
print(f"── user_previews[0].user.account ──\n值={acct!r} 类型={type(acct).__name__}")
# 负向取证：实测 user **不存在** profile 键（粉丝数/作品数只在 /v1/user/detail）。
# ⚠️ 早先这里打印的是 sorted(user.get('profile', {}).keys())——字段不存在时恒输出
# `[]`：零信息量却**长得像取证**。改为直接打印「键在不在」这个事实本身。
print(f"── 负向取证：user 含 'profile' 键? ──\n{'profile' in usr}")
print(f"── 负向取证：user 含 'comment'（简介）键? ──\n{'comment' in usr}")
for key in ("illusts", "novels"):
    items = u.get(key) or []
    print(f"── user_previews[0].{key} 条数: {len(items)} ──")
    if items:
        print(f"── user_previews[0].{key}[0] 键名 ──\n{sorted(items[0].keys())}")
        if key == "novels":
            # §3.3 的核心取证面：预览小说 image_urls **无 original**（只有三档）
            print(f"── user_previews[0].novels[0].image_urls 键名 ──\n{sorted(items[0].get('image_urls', {}).keys())}")
PY

echo "✓ 原始响应已写入：${OUT}（$(wc -c < "$OUT") 字节）"

# ─── 可选一：裁剪 fixture（TRIM_FIXTURE=<路径>）─────────────────────────────
if [ -n "$TRIM_FIXTURE" ]; then
  python3 - "$OUT" "$TRIM_FIXTURE" <<'PY'
import json, sys

src, dst = sys.argv[1], sys.argv[2]
PICK = [0, 1, 3, 5]  # 实时 30 条里的第 0/1/3/5 位（跳过第 2、4 位）——「精选」非「前 4 条」
PER_ARRAY = 2        # 每个非空数组（illusts / novels）取前 2

d = json.load(open(src))
ups = d.get("user_previews") or []
picked = [(i, ups[i]) for i in PICK if i < len(ups)]
if len(picked) < len(PICK):
    print(
        f"⚠️ 实时响应只有 {len(ups)} 条，取不到下标 {PICK[len(picked):]}；"
        f"已取到的 {len(picked)} 条全部保留。要取满 4 条请用 WORD=水上。"
    )
trimmed = []
for _, p in picked:
    q = dict(p)
    for key in ("illusts", "novels"):
        items = q.get(key) or []
        if items:
            q[key] = items[:PER_ARRAY]
    trimmed.append(q)
d["user_previews"] = trimmed

# 与已提交 fixture 逐字同形：2 空格缩进、UTF-8 直出、**无尾随换行**
with open(dst, "w", encoding="utf-8") as f:
    json.dump(d, f, ensure_ascii=False, indent=2)

print(f"── 裁剪：实时 {len(ups)} 条 → 精选 {len(trimmed)} 条（实时下标 {[i for i, _ in picked]}）──")
print(f"── 各条裁剪后 (illusts, novels) 条数 ──\n{[(len(q.get('illusts') or []), len(q.get('novels') or [])) for q in trimmed]}")
print(f"✓ fixture 已写入：{dst}")
PY
fi

# ─── 可选二：search_target 枚举校验取证（PROBE_SEARCH_TARGET=1）─────────────
# 为什么要有这段：本仓对 /v1/search/user **不发** search_target。此前文档给的理由是
# 「端点不消费该参数」——那句话**方向危险**：若端点是「忽略」，发了无害（那是弱约束，
# 未来开始消费也不坏）；若端点是「校验」，发了就坏。2026-10-17 一手实测区分了二者：
# 该端点对 search_target 做**枚举校验**，任何取值（含空串 / 非法值）一律 400，而
# 传不相关的未知参数名（foo=bar）返回 200 且结果不变 ⇒ 不是忽略，是硬拒。
# ⇒ 「必须不发」的真实依据是 400，不是「不消费」。
if [ "${PROBE_SEARCH_TARGET:-0}" = "1" ]; then
  echo "── PROBE：/v1/search/user 对 search_target 的校验行为（判「忽略」还是「硬拒」）──"
  SEARCH_TOKEN="$TOK" SEARCH_WORD="$WORD" SEARCH_SORT="$SORT" SEARCH_EP="$SEARCH_USER_URL" \
    python3 - <<'PY'
import json, os, subprocess, tempfile

tok = os.environ["SEARCH_TOKEN"]
word, sort = os.environ["SEARCH_WORD"], os.environ["SEARCH_SORT"]
ep = os.environ["SEARCH_EP"]

CASES = [
    ("（基线：不发该参数）", None),
    ("search_target=（空串）", "search_target="),
    ("search_target=partial_match_for_tags", "search_target=partial_match_for_tags"),
    ("search_target=exact_match_for_tags", "search_target=exact_match_for_tags"),
    ("search_target=title_and_caption", "search_target=title_and_caption"),
    ("search_target=zzz（非法枚举值）", "search_target=zzz"),
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
            "--data-urlencode", "filter=for_ios",
            "--data-urlencode", f"sort={sort}",
            "-o", path, "-w", "%{http_code}",
        ]
        if extra is not None:
            args += ["--data-urlencode", extra]
        code = subprocess.run(args, capture_output=True, text=True).stdout.strip()
        try:
            n = len(json.load(open(path)).get("user_previews") or [])
        except Exception:
            n = None
        return code, n
    finally:
        os.unlink(path)


for label, extra in CASES:
    code, n = run(extra)
    print(f"   {label:<44}  HTTP {code}   user_previews {'-' if n is None else n} 条")
print(
    "\n   判读：**状态码**是决定性信号。任意 search_target 取值 400、而未知参数名\n"
    "   foo=bar 返回 200 ⇒ 该端点对 search_target 做**枚举校验**（「发了就坏」），\n"
    "   不是忽略（「发了无害」）⇒ 「必须不发」的真实依据是 400。\n"
    "   条数列仅供参照：结果集随时间漂移（见文件头方法论），不可单独用来判等。"
)
PY
fi
