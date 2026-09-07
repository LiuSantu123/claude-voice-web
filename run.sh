#!/usr/bin/env bash
# 启动 codex-voice-web
set -e
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "未安装依赖，先执行 ./setup.sh"
  exit 1
fi
exec .venv/bin/python server.py "$@"
