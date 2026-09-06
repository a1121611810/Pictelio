#!/usr/bin/env python3
"""CDP evaluate 单发工具：cdp_eval.py <localPort> <js-expression>
自动取第一个 page 目标，Runtime.evaluate（awaitPromise+returnByValue），打印结果。"""
import json
import sys
import urllib.request

from websocket import create_connection


def main():
    port, expr = sys.argv[1], sys.argv[2]
    targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=10))
    page = next(t for t in targets if t.get("type") == "page")
    ws = create_connection(page["webSocketDebuggerUrl"], timeout=60, suppress_origin=True)
    ws.send(json.dumps({
        "id": 1,
        "method": "Runtime.evaluate",
        "params": {"expression": expr, "returnByValue": True, "awaitPromise": True, "userGesture": True},
    }))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == 1:
            result = msg.get("result", {})
            inner = result.get("result", {})
            exc = result.get("exceptionDetails")
            if exc:
                print("EXCEPTION:", json.dumps(exc, ensure_ascii=False)[:800])
            else:
                out = json.dumps(inner.get("value"), ensure_ascii=False) if "value" in inner else json.dumps(inner, ensure_ascii=False)
                print(out[:5000])
            ws.close()
            return


if __name__ == "__main__":
    main()
