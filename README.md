# 元启账单系统

```
my-bill/
├── server/   后端：Express 5 + node:sqlite，只提供 /api（账本、报表、导出、AI 助手、中转站对账、对外接口）
└── web/      前端：Next.js 16（shadmin 外壳），/ledger/api 同源代理到后端
```

## 本地运行

```bash
cd server && npm install && cp .env.example .env   # 按需填写，AI / 中转站可留空
DATA_DIR=./data PORT=3300 node server.js

cd web && pnpm install
NODE_OPTIONS=--max-old-space-size=2048 LEDGER_API_URL=http://127.0.0.1:3300 pnpm dev -p 3001
```

打开 http://localhost:3001 ，第一次点「注册」创建账号。

## 部署（服务器通过 GitHub 更新）

`docker-compose.yml` 起两个容器：`bill-server`（后端，只在容器网络内）和 `bill-web`（前端，对外 3300）。
默认接入已有的 Docker 网络 `yuanqi_default`（可用 `BILL_NETWORK` 改），数据目录默认 `./data`（可用 `BILL_DATA_DIR` 指到别处）。

首次部署：

```bash
git clone git@github.com:itzhan/my-bill.git /opt/my-bill && cd /opt/my-bill
cp server/.env.example server/.env      # 填写密钥（AI、中转站等）
docker compose up -d --build
```

之后每次更新：在服务器上执行 `./deploy.sh`（git pull + 重建容器，数据与 `.env` 不受影响）。

注意：敏感信息只放在服务器的 `server/.env` 和数据目录里，仓库中只有 `.env.example`。
