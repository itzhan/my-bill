# 账单系统前端

基于 [shadmin](https://github.com/Afee2019/shadmin)（Apache-2.0，见 LICENSE）精简而来：Next.js 16 + shadcn/ui。
业务代码在 `src/modules/ledger` 与 `src/app/(main)/dashboard/ledger`；`/ledger/api/*`（以及兼容旧地址的 `/api/*`）同源代理到后端，`LEDGER_API_URL` 在构建时确定。

```bash
pnpm install
NODE_OPTIONS=--max-old-space-size=2048 LEDGER_API_URL=http://127.0.0.1:3300 pnpm dev -p 3001
```
