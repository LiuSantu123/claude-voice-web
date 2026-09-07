# 🎙️ claude-voice-web

在浏览器里和 **Claude** 进行**连续语音对话**的本地 Web 应用（`codex-voice-web` 的 Claude 移植版）。

说一句，Claude 回一句（自动断句/按键），回复语音自动朗读，然后继续听你下一句。思考时显示转圈 + 实时操作展示。

> 本项目与 [codex-voice-web](https://github.com/LiuSantu123/codex-voice-web) 共用同一套服务与网页，区别仅在 `/api/chat` 调用的 Agent CLI：本版默认用 **Claude Code CLI（`claude`）**。

## ✨ 功能
- **可视化网页**：麦克风/扬声器设备切换（`setSinkId`）、输入/输出音量 + 实时电平
- **两种录音方式**：自动断句（VAD）；双键切换（可自定义，默认 F8 开始 / F9 结束）或按住说话
- **连续对话**：带真实会话记忆，可无限轮
- **发送前预览**：识别完后可修改再发送（可开关）
- **实时展示 Claude 操作**：显示实际执行的命令、输出、退出码、token 用量
- **导出对话 MD**、**复制会话恢复命令**（终端 `claude ...` 续聊）
- 本地转写（Whisper）不上云

## 🚀 快速开始
```bash
# 1. 安装依赖
./setup.sh

# 2. 确认本机已安装并登录 Claude Code CLI
claude --version

# 3. 启动服务（Claude 后端）
./run-claude.sh --port 8765
#   或: AGENT_CMD="claude -p --no-input" .venv/bin/python server.py --port 8765

# 4. 浏览器打开 http://localhost:8765 ，点“开始对话”并授权麦克风
```

## 🔌 API
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 网页 |
| POST | `/api/transcribe` | 音频 → `{"text"}`（本地 Whisper） |
| POST | `/api/chat/stream` | SSE 流：实时返回 Claude 的事件/命令/输出/回复 |
| POST | `/api/chat` | 非流式回退接口 |
| POST | `/api/tts` | 文本 → mp3（edge-tts） |
| GET | `/api/health` | 健康检查 |

## ⚙️ 用其它 Agent 后端
```bash
AGENT_CMD='claude -p --no-input {}'  .venv/bin/python server.py
```
`{}` 会替换成拼好的提示词（含对话历史），stdout 视为回复。

## 🧩 Skill
- **Claude Code skill**：`skills/claude-voice-web/SKILL.md`（安装到 `.claude/skills/` 后，直接说"启动语音对话"即可）

## ⚠️ 已知限制
- 非全双工实时（真·可打断实时语音需厂商 Realtime API）；本项目用自动断句 + 低延迟轮转近似
- edge-tts 语音合成需联网；Whisper 转写全本地
- Windows/WSL：浏览器在 Windows 侧打开时，WSL2 的 `localhost` 自动转发，直接可用

## 📄 License
[MIT](LICENSE)
