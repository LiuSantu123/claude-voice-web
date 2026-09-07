#!/usr/bin/env bash
# 用 Claude Code CLI 作为语音对话后端启动
set -e
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "未安装依赖，先执行 ./setup.sh"
  exit 1
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "未找到 claude 命令，请先安装并登录 Claude Code CLI"
  exit 1
fi
export AGENT_CMD='claude -p --no-input {}'
exec .venv/bin/python server.py "$@"
