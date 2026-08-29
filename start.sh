#!/usr/bin/env bash
# NovaPay V6.0 启动脚本
set -e
cd "$(dirname "$0")"

# 若未设置 Admin 密码哈希，给出提示
if [ -z "$ADMIN_PASSWORD_HASH" ]; then
  echo "[提示] 未检测到 ADMIN_PASSWORD_HASH 环境变量，Admin 后台将无法登录。"
  echo "       可用 'python scripts/gen_admin.py <密码>' 生成后写入 .env。"
fi

echo "正在启动 NovaPay V6.0 ..."
exec python run.py
