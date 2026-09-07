#!/usr/bin/env bash
# 安装依赖（创建 .venv 虚拟环境）
set -e
cd "$(dirname "$0")"
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
echo "依赖安装完成。启动：.venv/bin/python server.py"
