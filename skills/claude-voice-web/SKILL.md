---
name: claude-voice-web
description: 启动本地语音对话服务，让用户在浏览器里通过麦克风与 Claude 连续语音对话（支持设备切换、音量、自动/双键按键说话（可自定义开始/结束键）、音色/语速/语调、思考动画、发送前预览、导出MD；页面左设置右对话）。当用户说“语音对话/和我说话/打开语音/voice chat/talk to me”等意图时使用。
---

# claude-voice-web — Claude 语音对话（codex-voice-web 的 Claude 移植版）

在浏览器里与 **Claude** 连续语音对话：说一句，Claude 回一句（自动断句、自动朗读回复并继续聆听）。

> 本项目与 `codex-voice-web` 共用同一套服务与网页；区别仅在 `/api/chat` 调用的 Agent CLI。
> 本移植版默认把回复生成交给本机的 **Claude Code CLI（`claude`）**，因此 Claude 用户可直接使用。

## 工作原理

```
浏览器麦克风 → VAD 断句/按键录音 → 本地 server.py
  → /api/transcribe  faster-whisper（本地转写）
  → /api/chat        claude -p（本机 Claude Code CLI，带对话历史）
  → /api/tts         edge-tts（语音合成）→ 浏览器播放
```

## 安装与启动

1. 安装 Python 依赖：`./setup.sh`（创建 `.venv`）
2. 确认本机已安装并登录 Claude Code CLI：`claude --version`
3. 启动服务：
   ```bash
   ./run.sh --port 8765
   # 或指定用 Claude 后端:
   AGENT_CMD="claude -p --no-input" .venv/bin/python server.py --port 8765
   ```
4. 浏览器打开 **http://localhost:8765**，点“开始对话”、授权麦克风即可。

## 自定义 Agent 命令

服务端默认执行 `codex exec`；本版可通过环境变量换成任意命令行 Agent：

```bash
AGENT_CMD="claude -p --no-input" .venv/bin/python server.py
```

`AGENT_CMD` 里的 `{}` 会替换成拼好的提示词（含对话历史）。

## 页面功能

- 麦克风 / 扬声器设备选择、输入输出音量、实时电平
- 自动模式（说话自动断句）/ 按键模式（按住说话）
- 连续对话 + 会话内记忆 + 分段朗读

## 排障

- 服务日志：`/tmp/codex-voice-web.log`
- 转写不准：调高输入音量或换 `--model small`
- 听不到回复：检查扬声器设备与输出音量；Windows 下避免默认输出为虚拟声卡
