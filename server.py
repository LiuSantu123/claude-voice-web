#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
codex-voice-web — 与 Codex 连续语音对话的本地 Web 服务
=======================================================
- GET  /                 网页界面
- POST /api/transcribe   音频 → 文本 (faster-whisper, 本地)
- POST /api/chat         文本 → Codex 回复 (codex exec)
- POST /api/tts          文本 → 语音 mp3 (edge-tts)
- GET  /api/health       健康检查

用法:  <venv-python> server.py [--host 127.0.0.1] [--port 8765] [--model base] [--cwd DIR]
"""
import argparse, asyncio, json, os, shlex, shutil, subprocess, tempfile, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.join(HERE, "frontend")

# 可选的通用 Agent 命令模板（用于移植到 Claude 等其它 CLI Agent）：
#   AGENT_CMD='claude -p --no-input {}'  .venv/bin/python server.py
# {} 会被替换成"提示词（含对话历史）"，stdout 视为回复。
AGENT_CMD = os.environ.get("AGENT_CMD", "")

# 国内网络：Whisper 模型走 hf-mirror，禁用 Xet
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

ARGS = None
_whisper = None
_whisper_lock = threading.Lock()

def get_whisper():
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel
        _whisper = WhisperModel(ARGS.model, device="cpu", compute_type="int8")
    return _whisper

def transcribe(data: bytes) -> str:
    """转写音频字节（webm/opus/wav/mp3 均可）。"""
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
        f.write(data); path = f.name
    try:
        with _whisper_lock:
            model = get_whisper()
            segments, _ = model.transcribe(path, beam_size=1)
            text = "".join(s.text for s in segments).strip()
        return text
    finally:
        try: os.unlink(path)
        except OSError: pass

def build_prompt(text: str, history: list) -> str:
    sys = ("你正在通过语音与用户对话。请用自然、口语化、简洁的方式直接回答，"
           "控制在 2~4 句话以内（回复会被朗读出来）。")
    msgs = [f"用户：{h['user']}\n助手：{h['assistant']}" for h in history[-6:]]
    return sys + "\n\n" + "\n".join(msgs) + f"\n用户：{text}\n助手："

def _run_codex(base_cmd: list, prompt: str) -> tuple:
    """执行一条 codex exec 命令，返回 (reply, thread_id)。"""
    codex_bin = shutil.which("codex") or os.path.expanduser("~/.npm-global/bin/codex")
    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as f:
        reply_file = f.name
    try:
        cmd = [codex_bin] + base_cmd + ["-o", reply_file, prompt]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        tid = ""
        for line in r.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except Exception:
                continue
            if ev.get("type") == "thread.started":
                tid = ev.get("thread_id") or ""
        reply = ""
        if os.path.exists(reply_file):
            reply = open(reply_file, encoding="utf-8").read().strip()
        return reply, tid
    finally:
        try: os.unlink(reply_file)
        except OSError: pass

def ask_codex(text: str, history: list, thread_id: str = "") -> tuple:
    """把对话交给 Agent。返回 (reply, thread_id)。

    - 默认后端 codex exec；带 thread_id 时用 `codex exec resume` 续接同一会话（真实记忆）。
    - 可用 AGENT_CMD 换成 claude 等命令行 Agent（此时无 thread_id 概念）。
    """
    sys = ("你正在通过语音与用户对话。请用自然、口语化、简洁的方式直接回答，"
           "控制在 2~4 句话以内（回复会被朗读出来）。")

    if AGENT_CMD:
        prompt = build_prompt(text, history)
        parts = shlex.split(AGENT_CMD)
        cmd = [p.replace("{}", prompt) if "{}" in p else p for p in parts]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        return (r.stdout or "").strip(), ""

    if thread_id:
        # 续接既有会话（线程自带记忆，不再注入历史）
        prompt = sys + f"\n\n用户：{text}\n助手："
        reply, tid = _run_codex(["exec", "resume", thread_id, "--json",
                                 "--skip-git-repo-check"], prompt)
        if reply:
            return reply, tid or thread_id
        # resume 失败 → 兜底新建会话
    prompt = build_prompt(text, history)
    reply, tid = _run_codex(["exec", "--json", "-s", "danger-full-access",
                             "--skip-git-repo-check", "-C", ARGS.cwd], prompt)
    return reply, tid

async def tts(text: str, voice=None, rate="+0%", pitch="+0Hz", volume="+0%") -> bytes:
    import edge_tts
    voice = voice or ARGS.voice
    last_err = None
    for attempt in range(3):  # edge 服务偶发“空音频”，重试
        try:
            com = edge_tts.Communicate(text, voice=voice, rate=rate, pitch=pitch, volume=volume)
            buf = bytearray()
            async for chunk in com.stream():
                if chunk["type"] == "audio":
                    buf.extend(chunk["data"])
            if buf:
                return bytes(buf)
            last_err = Exception("edge-tts 返回空音频")
        except Exception as e:
            last_err = e
        await asyncio.sleep(0.8 * (attempt + 1))
    raise last_err

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, body, ctype="text/plain; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        p = u.path
        if p == "/" or p == "/index.html":
            return self._serve_file("index.html", "text/html; charset=utf-8")
        if p == "/app.js":
            return self._serve_file("app.js", "application/javascript; charset=utf-8")
        if p == "/style.css":
            return self._serve_file("style.css", "text/css; charset=utf-8")
        if p == "/vad-processor.js":
            return self._serve_file("vad-processor.js", "application/javascript; charset=utf-8")
        if p == "/api/health":
            return self._send(200, json.dumps({"ok": True, "model": ARGS.model, "voice": ARGS.voice}),
                              "application/json")
        self._send(404, "Not Found")

    def _serve_file(self, name, ctype):
        path = os.path.join(FRONTEND, name)
        if not os.path.exists(path):
            return self._send(404, "Not Found")
        with open(path, "rb") as f:
            return self._send(200, f.read(), ctype)

    def do_POST(self):
        u = urlparse(self.path)
        p = u.path
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length) if length else b""
        try:
            if p == "/api/transcribe":
                text = transcribe(body)
                return self._send(200, json.dumps({"text": text}), "application/json")
            if p == "/api/chat/stream":
                data = json.loads(body.decode("utf-8"))
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "close")
                self.end_headers()
                self.close_connection = True  # 流结束后关闭连接（close-delimited）
                try:
                    for ev in stream_codex(data.get("text", ""), data.get("history", []),
                                           data.get("thread_id", "")):
                        line = "data: " + json.dumps(ev, ensure_ascii=False) + "\n\n"
                        self.wfile.write(line.encode("utf-8"))
                        self.wfile.flush()
                except Exception as e:
                    err = "data: " + json.dumps({"type": "error", "error": str(e)}, ensure_ascii=False) + "\n\n"
                    self.wfile.write(err.encode("utf-8"))
                    self.wfile.flush()
                return
            if p == "/api/chat":
                data = json.loads(body.decode("utf-8"))
                reply, tid = ask_codex(data.get("text", ""), data.get("history", []),
                                       data.get("thread_id", ""))
                return self._send(200, json.dumps({"reply": reply, "thread_id": tid}),
                                  "application/json")
            if p == "/api/tts":
                data = json.loads(body.decode("utf-8"))
                audio = asyncio.run(tts(data.get("text", ""),
                                        voice=data.get("voice"),
                                        rate=data.get("rate", "+0%"),
                                        pitch=data.get("pitch", "+0Hz"),
                                        volume=data.get("volume", "+0%")))
                return self._send(200, audio, "audio/mpeg")
        except Exception as e:
            return self._send(500, json.dumps({"error": str(e)}), "application/json")
        self._send(404, "Not Found")

    def log_message(self, fmt, *args):
        print("[http]", fmt % args)

def stream_codex(text: str, history: list, thread_id: str = ""):
    """运行 codex exec --json，逐个产出事件 dict（供网页实时展示思考/工具操作）。"""
    sys = ("你正在通过语音与用户对话。请用自然、口语化、简洁的方式直接回答，"
           "控制在 2~4 句话以内（回复会被朗读出来）。")
    codex_bin = shutil.which("codex") or os.path.expanduser("~/.npm-global/bin/codex")
    if thread_id:
        prompt = sys + f"\n\n用户：{text}\n助手："
        base = ["exec", "resume", thread_id, "--json", "--skip-git-repo-check"]
    else:
        prompt = build_prompt(text, history)
        base = ["exec", "--json", "-s", "danger-full-access",
                "--skip-git-repo-check", "-C", ARGS.cwd]
    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as f:
        reply_file = f.name
    try:
        cmd = [codex_bin] + base + ["-o", reply_file, prompt]
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             text=True, encoding="utf-8", errors="replace")
        saw_agent_message = False
        for line in p.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except Exception:
                continue
            yield ev
            if ev.get("type") == "item.completed":
                it = ev.get("item") or {}
                if it.get("type") == "agent_message":
                    saw_agent_message = True
        p.wait()
        # 兜底：流里没有 agent_message 时，从回复文件取最终回复
        reply = ""
        if os.path.exists(reply_file):
            reply = open(reply_file, encoding="utf-8").read().strip()
        if not saw_agent_message:
            yield {"type": "final_reply", "reply": reply}
    finally:
        try: os.unlink(reply_file)
        except OSError: pass

def main():
    global ARGS
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--model", default="base")
    ap.add_argument("--voice", default="zh-CN-XiaoxiaoNeural")
    ap.add_argument("--cwd", default=os.getcwd())
    ARGS = ap.parse_args()
    srv = ThreadingHTTPServer((ARGS.host, ARGS.port), Handler)
    print(f"codex-voice-web 已启动: http://{ARGS.host}:{ARGS.port}  (cwd={ARGS.cwd})")
    print("按 Ctrl+C 停止")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    main()
