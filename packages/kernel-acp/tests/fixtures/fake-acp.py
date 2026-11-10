#!/usr/bin/env python3
"""Small ACP agent: echoes the cloned repo's app.txt in a session prompt."""
import json
import os
import sys

cwd = None
for line in sys.stdin:
    try:
        message = json.loads(line)
    except Exception:
        continue
    method = message.get("method")
    if method == "initialize":
        print(json.dumps({"jsonrpc":"2.0","id":message["id"],"result":{"protocolVersion":1,"agentCapabilities":{}}}), flush=True)
    elif method == "session/new":
        cwd = message.get("params", {}).get("cwd")
        print(json.dumps({"jsonrpc":"2.0","id":message["id"],"result":{"sessionId":"clone-session"}}), flush=True)
    elif method == "session/prompt":
        try:
            with open(os.path.join(cwd or ".", "app.txt"), encoding="utf-8") as handle:
                content = handle.read().strip()
        except Exception as error:
            content = f"READ_FAILED: {error}"
        print(json.dumps({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":message["params"]["sessionId"],"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":f"cloned content: {content}"}}}}), flush=True)
        print(json.dumps({"jsonrpc":"2.0","id":message["id"],"result":{"stopReason":"end_turn"}}), flush=True)
