#!/usr/bin/env bash
# 一次跑完 capture-md3-matrix.sh 里**全部**分流块的真跑探针。
#
# 用法：
#   bash md3-split-batch.sh <SH_PATH> <AWK_FILE> <USE_LOW 0|1> [<VAR> <COND> <LOW>]...
#
# 为什么单独成文件：这段程序若塞进 TS 字符串，" 与 $ 与 ${} 会在**转义层**被吃掉
# （实测两次都栽在这儿）。argv + 纯文件 = 两侧都零转义。
#
# 探针值按「每条各自的低阈值合法读数」给：$l 判明暗，12.91 反而是合法暗色(<70)
# 会走「一致」而不打印，必须给 200 才落到 else。
set -u
SH_PATH=$1
AWK=$2
USE_LOW=$3
shift 3

f=/dev/null; name=x; want=dark
MIN_CONTENT_SD=20; MIN_FAB_SAT=20; DARK_MAX=70; LIGHT_MIN=140
ERR=$(mktemp)

# 参数是 VAR COND LOW 三元组一组；条件里含空格与双引号，作为 argv 不会被二次解释。
args=("$@")
n=$(( ${#args[@]} / 3 ))
for (( i=0; i<n; i++ )); do
  VAR=${args[$((i*3))]}
  COND=${args[$((i*3+1))]}
  LOW=${args[$((i*3+2))]}
  # ⚠️ 只在**每个出现处**打标记，且必须在输出之前。
  #    打成「每条一个」会与逐出现处的标记互相 flush，凭空多出一个空条目（实测取到空串）。
  #    打成末尾则整体错位一格。
  if [ "$USE_LOW" = 1 ]; then V=$LOW; else V=; fi
  eval "$VAR=\"$V\""
  cnt=$(grep -cF "$COND" "$SH_PATH")
  for (( k=1; k<=cnt; k++ )); do
    # ⚠️ 每个**出现处**都要单独打标记：同名条件出现多次时（复制副本顶替原块），
    #    若把它们拼成一段，**正确的那份会掩盖被破坏的那份**（第十九轮实测 23 全绿）。
    echo "@@$i@$k"
    (
      # ⚠️ 标签带 **NONCE**（调用方经环境现场生成，被测代码读不到）。这不是装饰：
      #    被测块自己 `echo "W[…]"` 会抢在真值前面把 pick 骗过去（第二十轮 Spec F2
      #    实测：`why` 真值是错的、门禁却绿）。NONCE 让标签**不可伪造** —— 标签与
      #    真值同源，冒充不了。另：eval 的 stdout 丢进 /dev/null，块自己的 echo
      #    根本进不了这条通道（双保险）。
      eval "$(awk -v k="$k" -v a="$COND" -f "$AWK" "$SH_PATH" \
        | grep -v '^[ \t]*#' | grep -v '^[ \t]*return')" >/dev/null 2>"$ERR"
      echo "W$NONCE[${why:-}]"
      echo "R$NONCE[${RESUME_WHY:-}]"
    ) 2>/dev/null
    echo "  O$NONCE[$(cat "$ERR")]"
  done
done
