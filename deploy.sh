#!/bin/sh
# 在服务器上执行：拉最新代码并重建容器（data 与 server/.env 不受影响）
set -e
cd "$(dirname "$0")"
git pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
sleep 3
curl -s http://127.0.0.1:3300/api/health; echo
