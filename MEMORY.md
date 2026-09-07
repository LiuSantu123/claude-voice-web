## 项目记忆（claude-voice-web）
# 🧠 项目记忆 · codex-voice-web（2026-09-08）

> 本文件记录项目的关键状态、近期改动与环境坑，供后续会话快速接手。配套的 CLI 工具见 `../codex-voice/`（本项目的前身）。

## 1. 项目是什么
在浏览器里与 **Codex / Claude** 连续语音对话的本地 Web 应用。
- 说一句 → 自动断句/按键录音 → 本地 Whisper 转写 → `codex exec` 回复 → edge-tts 朗读 → 自动进入下一轮。
- 页面：**左设置 / 右对话**；支持设备切换、音量、音色/语速/语调、发送前预览、导出 MD、终端 resume、实时展示操作。

## 2. 目录与启动
- 主项目：`/mnt/f/protein_design/codex-voice-web`
- Claude 移植版：`/mnt/f/protein_design/claude-voice-web`
- 启动（服务当前跑在 127.0.0.1:8765，PID 见 `/tmp/codex-voice-web.pid`）：
  ```bash
  cd /mnt/f/protein_design/codex-voice-web
  ./setup.sh                  # 首次：创建 .venv + 装依赖
  ./run.sh --port 8765        # Codex 后端
  # Claude 版用: ./run-claude.sh  （内部 export AGENT_CMD='claude -p --no-input {}'）
  ```
- 依赖 venv 可复用 `../codex-voice/.venv`；Whisper 模型缓存在 `~/.cache/huggingface`（走 hf-mirror，需 `HF_ENDPOINT=https://hf-mirror.com` + `HF_HUB_DISABLE_XET=1`）。

## 3. 核心接口（server.py）
| 接口 | 说明 |
|---|---|
| `/` | 网页（frontend/） |
| `/api/transcribe` | 音频字节 → 文本（faster-whisper，base 模型） |
| `/api/chat/stream` | **SSE 流**：实时返回 codex exec --json 的事件（命令/输出/回复） |
| `/api/chat` | 非流式回退；支持 `thread_id` 续接（resume） |
| `/api/tts` | 文本 → mp3（edge-tts，支持 voice/rate/pitch） |
| `/api/health` | 健康检查 |

## 4. 关键实现细节
- **PTT 录音用浏览器原生 MediaRecorder**（输出 webm/opus，server 端 faster-whisper 直接可转写）；**不要**依赖 AudioWorklet 缓冲做 PTT。
- **AudioWorklet 必须接一个静音输出**（`muteGain.gain=0` → destination），否则 Chrome/Edge 可能不调用 process()，VAD/电平全停摆。也绝不能直接连 destination（会回声啸叫）。
- **双键录音**（默认 F8 开始 / F9 结束，可自定义）与**按住说话**（默认空格）两种模式；键位捕获时按 Esc 取消。
- **会话续接**：首次 `/api/chat` 拿 `thread_id`（解析 `--json` 的 `thread.started`）；后续用 `codex exec resume <thread_id> --json --skip-git-repo-check -o file` 续同一线程（真实记忆，实测记暗号跨轮可答出）。注意：`resume` 子命令**不支持** `-s`/`-C` 参数。
- **发送前预览**：转写后经 `previewResolve` Promise 等待确认；按钮处理**必须先保存回调再 hidePreview()**（否则 TypeError，之前因此卡死）。
- **思考/操作展示**：`/api/chat/stream` 推送 `item.started/completed`（`command_execution` 含 command/aggregated_output/exit_code；`agent_message` 为最终回复），前端渲染成可折叠面板 + 实时状态。
- **AGENT_CMD 通用后端**：`AGENT_CMD='claude -p --no-input {}'` 可把回复生成换成任意命令行 Agent（stdout 即回复，无 thread 概念）。

## 5. 环境坑（务必记住）
- **无 /dev/snd**：WSL 里没有麦克风/扬声器设备。麦克风/扬声器都走 **Windows 浏览器**（localhost 自动转发）；录音脚本 `../codex-voice/win_record.ps1` 用 Windows ffmpeg dshow。
- **默认音频路由涉及 ToDesk 虚拟声卡**：回复语音可能被路由到虚拟声卡而"听不见"；在 Windows 声音设置把默认播放设备改成实体音箱/耳机。
- **浏览器设备列表**：授权麦克风前只有 1 个默认设备；授权后自动重新 enumerate 才有完整列表。
- **hf-mirror 必须禁用 Xet**（`HF_HUB_DISABLE_XET=1`），否则模型下载 401。
- **github.com 被墙**，但 api.github.com 通：git push 走不通，发布走 **Git Data API**（脚本 `/tmp/publish_github.py`，空仓库先 Contents API 建 .gitkeep 解锁，最后 `force:true` 更新 ref）。

## 6. GitHub 发布（public）
- Codex 版：https://github.com/LiuSantu123/codex-voice-web （origin 已配）
- Claude 版：https://github.com/LiuSantu123/claude-voice-web （origin 需另配）
- 线上目前为单 commit（API 发布）；本地 codex-voice-web 有完整 8 个 commit，网络通了可 `git push --force origin main` 补全历史。

## 7. Skills
- `skills/codex-voice-web/SKILL.md`（已安装到 `~/.codex/skills/codex-voice-web/`）
- `skills/claude-voice-web/SKILL.md`（Claude Code 版）
- 触发词：语音对话 / 打开语音 / 音色 / 语速 等。

## 8. 待办/可能的下一步
- 等 Codex 官方 `realtime_conversation`（全双工）落地后接入
- 本地 TTS（纯离线）替代 edge-tts
- 局域网/手机访问（`--host 0.0.0.0`）
- 若切换会暴露 reasoning 增量的后端，前端已预留 `🧠` 思考行渲染

- **服务当前已停止**：`server.py` 已 kill（端口 8765 已释放）。重启：`cd codex-voice-web && ./run.sh --port 8765`，或对 Codex 说"启动语音对话"（走 skill）。网页服务只是 Python HTTP，不是额外 Codex 对话；每轮语音 = 一次 `codex exec`/`claude -p` 子进程，与当前交互式会话彼此独立。
- **codex-voice CLI 现已支持 AGENT_CMD**（`/mnt/f/protein_design/codex-voice/codex-voice.py`）：
  - `AGENT_CMD='claude -p {}' codex-voice ask "..." --speak` → Claude 回复 + edge-tts 朗读（已实测）
  - `AGENT_CMD='claude -p {}' codex-voice talk --windows` → Windows 麦克风语音对话 + Claude 后端
  - 本机 `claude` CLI v2.1.263 可用；**注意 claude 没有 `--no-input`，用 `-p`**。
- **社区方案**：`mbailey/voicemode`（⭐1.3k，Python，Claude Code 语音对话，voicemode.dev）可作对比；`T0mSIlver/localvoxtral`（macOS 本地）、`Enriquefft/yap`（按住说话）。Claude Code 官方有语音**输入**，但无内置**朗读** TTS，需外接。
- **踩坑记录**：用"行号替换 + 只匹配 `def ` 没匹配 `async def `" 会误删 `async def speak` 函数（本次发生过），改动 Python 文件后务必 `grep -n 'async def'` 复查。
- GitHub 已发布（含本 MEMORY.md）：`LiuSantu123/codex-voice-web` 与 `LiuSantu123/claude-voice-web`，均为单 commit（API 发布，因 github.com 被墙、git push 不通）。
## 📌 更新日志 2026-09-08（最新状态）
- 本版与 codex-voice-web 同步更新：服务已停止；CLI 支持 AGENT_CMD=claude；社区可对比 mbailey/voicemode。详见 codex-voice-web/MEMORY.md。
