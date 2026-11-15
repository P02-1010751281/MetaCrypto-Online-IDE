#!/usr/bin/env python3
"""用 Firefox headless + marionette 抓文档截图资产（本机无 Chromium，oil-ui 截图不可用）。

为什么不用现成工具: 宿主只有 Firefox，没有 Chrome/Chromium/Edge，也没有
geckodriver/selenium；Firefox 自带 marionette 协议，直接说协议就能驱动页面并在
目标状态下截图（既有 docs-assets 也是 Firefox headless 抓的，口径一致）。

用法:
    python3 scripts/tools/capture-doc-asset.py <url> <out.png> "<step>;;<step>" [width] [height]

- `<step>` 是在页面加载后依次执行的 JS 片段（用 ;; 分段），用来切语言、开面板等；
  段与段之间自动等待，脚本里不要写 await（同步执行）。
- 视口高度 = 传入的窗口高度 - 86（headless 窗口装饰），要 682 视口就传 768。
- 每次抓图前请用全新 profile 目录（或用 FX_PROFILE 指定），否则 IndexedDB
  里的旧项目会让「未命名/Untitled」出现在图里。
- 抓完必须目检：language、保存状态、项目行是否符合预期；再按 SHA-256 更新
  public/docs-assets/README.md 的哈希清单。
"""
import base64
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

HOST, PORT = "127.0.0.1", 2828


class Marionette:
    def __init__(self, sock):
        self.sock = sock
        self.buf = b""
        self.next_id = 1

    def _read_msg(self):
        while b":" not in self.buf:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise RuntimeError("marionette 连接被关闭")
            self.buf += chunk
        length_str, rest = self.buf.split(b":", 1)
        length = int(length_str)
        while len(rest) < length:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise RuntimeError("marionette 连接被关闭")
            rest += chunk
        self.buf = rest[length:]
        return json.loads(rest[:length])

    def call(self, command, params=None):
        msg_id = self.next_id
        self.next_id += 1
        payload = json.dumps([0, msg_id, command, params or {}]).encode()
        self.sock.sendall(str(len(payload)).encode() + b":" + payload)
        while True:
            msg = self._read_msg()
            # [type, id, error, result]；type 1 = 响应
            if isinstance(msg, list) and len(msg) >= 4 and msg[1] == msg_id:
                if msg[2]:
                    raise RuntimeError(f"{command} 失败: {msg[2]}")
                return msg[3]


def wait_port(timeout=25):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            return socket.create_connection((HOST, PORT), timeout=1)
        except OSError:
            time.sleep(0.3)
    raise RuntimeError("marionette 端口未就绪")


def main():
    url, out, script = sys.argv[1], sys.argv[2], sys.argv[3]
    width = int(sys.argv[4]) if len(sys.argv) > 4 else 1366
    height = int(sys.argv[5]) if len(sys.argv) > 5 else 682

    # 每次抓图用独立 profile：复用会把上次 IndexedDB 里的项目带进图里。
    profile = Path(os.environ.get("FX_PROFILE", "dist-verify/fx-asset-profile"))
    profile.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(
        [
            "firefox", "--headless", "--marionette",
            "--profile", str(profile.resolve()),
            f"--window-size={width},{height}",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        sock = wait_port()
        sock.settimeout(None)  # create_connection 留下的 1s 超时会打断 hello 读取
        m = Marionette(sock)
        m._read_msg()  # server hello
        m.call("WebDriver:NewSession", {"capabilities": {"alwaysMatch": {"acceptInsecureCerts": True}}})
        m.call("WebDriver:SetWindowRect", {"x": 0, "y": 0, "width": width, "height": height})
        m.call("WebDriver:Navigate", {"url": url})
        time.sleep(5.0)  # 等 SPA 启动（Blockly + 项目读取）；过短会拿到未挂载的 DOM
        # 脚本用 ;; 分段，逐段执行并在段间等待，避免在同步脚本里写 await。
        for step in [s for s in script.split(";;") if s.strip()]:
            m.call("WebDriver:ExecuteScript", {"script": step, "args": []})
            time.sleep(1.6)
        time.sleep(2.0)
        shot = m.call("WebDriver:TakeScreenshot", {"full": False})
        # marionette 在部分版本返回 {"value": <base64>}，而不是裸字符串。
        data = shot.get("value") if isinstance(shot, dict) else shot
        if not isinstance(data, str):
            raise RuntimeError(f"TakeScreenshot 返回了意外结构: {type(shot)} {str(shot)[:200]}")
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        Path(out).write_bytes(base64.b64decode(data))
        text = m.call(
            "WebDriver:ExecuteScript",
            {"script": "return document.body.innerText.slice(0, 400);", "args": []},
        )
        print(json.dumps({"out": out, "bodyHead": text}, ensure_ascii=False))
    finally:
        proc.terminate()
        proc.wait(timeout=15)


if __name__ == "__main__":
    main()
