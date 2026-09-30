# 元启智能账单系统

一个自托管的 AI 团队记账系统（原名「合账」）：成员用「用户名 + 手机号 + 密码」注册登录，按项目分别记录**支出 / 收入**（人民币、USDT、美元），系统自动记录登记时间，并按汇率折算后统计每个项目的收入、支出与利润，以及每位成员的支出明细。

- 零构建：Node.js 24 + Express + 内置 `node:sqlite`，前端纯 HTML/CSS/JS
- 手机 / 电脑自适应：手机为底部 Tab + 底部弹层，电脑为侧栏 + 对话框
- **实时同步**：任何成员记账、建项目、改汇率，所有在线成员的页面立即更新（SSE）
- **报表**：按项目 / 时间区间查看收支 KPI（含上期对比）、利润增长曲线、每日收支柱状图、每日账单、按项目 / 按成员统计
- **AI 财务报表**：接入 Claude（默认 `claude-sonnet-5`）一键撰写财务分析，流式输出；数据变动后自动刷新
- **一键导出**：Excel（概览 / 每日账单 / 流水明细 / 按项目 / 按成员 / AI 报表）与 AI 报表 Markdown；可设置每日定时自动导出，文件保存在「导出记录」里
- **AI 助手（团队群 / 项目群 / 私聊 / 知识库）**：右下角常驻入口。团队群里所有成员和同一个 AI 对话，AI 按说话人的名字与身份响应；每个项目可新建专属项目群，群里的 AI 只负责该项目（记账不用说项目名，统计 / 报表 / 导出只针对本项目，提到别的项目会拒绝）；私聊只有自己可见。
- **AI 模型可选**：「我的 → AI」里切换 Sonnet 5 / Opus 5 / Opus 4.8 / Sonnet 4.6 / Haiku 4.5 或自定义模型名，助手、财务报表、知识库整理共用
- **语音输入**：聊天框的麦克风按钮，点一下开始 / 再点停止，长按为按住说话；边说边出字，中文数字自动转阿拉伯数字（「三百U」→「300 USDT」），可选「停顿后自动发送」。用的是浏览器自带的普通话识别（Chrome / Edge / Safari；Chrome 需能访问 Google 语音服务，国内建议 Safari 或 Edge）。
- **项目分析**：报表页选中某个项目后出现「项目分析」——支出用途分布、成员占比、币种构成、大额记录、月度趋势；AI 财务报表的项目分析也基于这些数据。
- **Excel 排版**：导出的 Excel 有封面式概览（KPI 块、上期对比、按项目 / 成员 / 币种）、深色表头、斑马纹、合计公式、冻结表头与筛选，AI 财务报表按标题 / 表格 / 列表排版成单元格；单项目导出另有「项目分析」工作表。对话即可完成系统全部操作——记账、查账、改 / 删记录、建项目、查统计、生成 / 导出报表、改设置、整理知识库
- **审批制**：AI 没有直接改数据的权力。它提出的每个写操作（记账、批量记账、改 / 删记录、建 / 改项目、改设置、生成 AI 报表、导出、整理知识库）都是一张「提案」卡片，任一成员点「批准并执行」才会生效，可拒绝；结果与批准人写入日志
- **图片 / 文件记账**：在聊天里发截图、Excel / CSV / PDF / 文本，AI 逐条识别（时间、项目、类型、金额、币种、经手人、备注），按表格里的姓名自动匹配成员，一次生成批量记账提案
- **清空 / 删除项目**：项目编辑弹层里有「清空记录」和「删除项目」（仅项目创建者，需手打项目名确认）。删除 / 清空后，这些数据立刻从总览、报表、导出、成员资金里消失，不可恢复；AI 也能做（clear_project / delete_project，需审批）
- **统计口径**：「全部项目」= 未归档项目。归档项目不计入总览 KPI、报表、导出和成员资金，只能在它自己的项目页里查看
- **成员资金沉淀**：每位成员一个资金账户视图——沉淀 = 本人经手的收款 − 本人经手的付款 + 转入 − 转出（按记账时汇率折人民币，另列各币种余额），为负表示他垫了钱；总览页看全部项目合计，项目页看单个项目
- **成员之间的转账**：谁把手上的钱交给谁，记金额 / 币种 / 汇率 / 时间 / 备注 / 是否挂项目；只在成员资金之间搬钱，不影响项目收入、支出和利润；导出 Excel 含「成员资金」表；AI 也能查和记（记转账需审批）
- **供应商 / 客户往来**：每个项目可录入供应商（应付 / 实付 / 未付）与客户（应收 / 实收 / 未收），按日期记录、每日更新，项目页有往来日报；实付 / 实收默认同步记入项目流水（支出 / 收入），应付 / 应收只挂账不影响利润；导出 Excel 含「往来」表；AI 也能查和记（需审批）
- **中转站联动（Sub2API）**：配置 `RELAY_BASE_URL` / `RELAY_ADMIN_KEY` 后：
  - 项目里的**客户**可绑定中转站邮箱（录入时填或在详情页「一键获取」，同时选**折扣**与**结算币种**），项目页实时显示累计 / 今日 / 本小时消耗、当前 RPM / TPM、余额、近 12 小时消耗柱状，30 秒自动刷新
  - **供应商**可绑定中转站「账号管理」里的上游账号，同样在绑定时选**倍率**与**结算币种**
  - **自动挂账**：应收 = 客户累计消耗（美元）× 折扣，应付 = 上游账号累计标准消耗（美元）× 倍率，按该单位的结算币种（CNY / USDT / USD，用当时汇率换算，记录里保存汇率）**逐日自动生成往来记录**（来源「中转站自动」，绑定时先记一条「期初」覆盖之前的累计）；页面每 30 秒、后台每 15 分钟同步，没人打开页面也会补齐。改倍率 / 折扣 / 币种会按新参数整体重算；绑定期间自动记录不能手动删。手工记的应付 / 应收（如固定服务费）与自动挂账并存，合计里分开列出
  - 未付 / 未收 = 应付 / 应收 − 实付 / 实收，为负显示「待消耗额度 / 预收余额」；卡片与详情页都按结算币种显示，人民币折算作辅助；项目级合计按人民币折算
  - AI 助手可查中转站总览、客户消耗 / 余额 / 实时 RPM、消耗排行、按模型、趋势、API Key（脱敏），以及每家供应商 / 客户的实时结算——只读，不需要审批
- **对外接口**：外部系统用 API 令牌实时推送应收 / 应付 / 实收 / 实付，幂等（`external_ref`），自动建客户 / 供应商
- **每笔外币记录保存记账时的汇率**：统计按各笔自己的汇率折算，之后改全局汇率不影响历史
- **知识库**：所有操作按天写入 `data/knowledge/log/日期.md`，群聊 / 私聊按天写入 `data/knowledge/chat/日期.md`；AI 每次回答都带着知识摘要与最近日志，还能检索 / 读取历史文件；「整理知识库」把日志与对话归纳进 `summary.md`（旧版本存档到 `archive/`），每 7 天到期 AI 会在群里提议整理，需批准
- 深浅色主题自动跟随系统，可手动切换
- 快捷操作：桌面按 `N` 直接记账，金额框支持算式（`120+80`），记住上次的币种 / 类型 / 项目

## 快速开始

```bash
cd team-ledger
npm install
npm start          # http://localhost:3000
```

需要 Node.js ≥ 22.13（推荐 24）。第一次打开点「注册」即可创建账号；团队其他人打开同一个网址注册，就自动成为同一团队。

## 部署

整套系统（本后端 + `../web` 前端）用仓库根目录的 `docker-compose.yml` 部署，见根目录 README。
反向代理（nginx）需要关闭缓冲以支持 SSE 实时推送：

```nginx
location / {
    proxy_pass http://127.0.0.1:3300;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;           # SSE 实时推送
    proxy_read_timeout 3600s;
}
```

### 直接运行（PM2 等）

```bash
PORT=3000 DATA_DIR=/srv/hezhang/data node server.js
```

建议前面放 nginx / caddy 做 HTTPS；开启 HTTPS 后登录 Cookie 会自动带 `Secure` 标记。

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `DATA_DIR` | `./data` | 数据目录 |
| `SESSION_SECRET` | 自动生成 | 会话签名密钥；不设置时首次启动生成并保存到 `DATA_DIR/session.secret` |
| `TRUST_PROXY` | `1` | 反向代理后面保持 `1`；直接暴露公网时设为 `0` |
| `TIMEZONE` | `Asia/Shanghai` | 报表按哪个时区分日 |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | AI 接口地址（Anthropic 兼容） |
| `ANTHROPIC_AUTH_TOKEN` | 空 | AI 接口密钥；不填则 AI 功能关闭 |
| `AI_MODEL` | `claude-sonnet-5` | 生成报表用的模型 |
| `AI_AUTO_DELAY_MS` | `45000` | 数据变动后多久自动刷新最近 24 小时看过的 AI 报表 |
| `CHAT_MAX_TOKENS` | 模型上限（Sonnet 5 / Opus 5 为 64000） | AI 单次回答的最大长度；默认不设人为上限，只有想省钱时才调小 |
| `AI_RETRIES` | 2 | 中转站抽风（403 分组 / 5xx / 断流 / 空回复）时自动重试的次数 |
| `RELAY_BASE_URL` / `RELAY_ADMIN_KEY` / `RELAY_NAME` | 空 | 中转站（Sub2API）地址与管理员 API Key（`X-API-Key`），配置后 AI 能查客户消耗与实时 RPM |

把这些写进项目根目录的 `.env` 即可（启动时自动读取；`.env` 已在 `.gitignore` 中）。反向代理需要放行 SSE：nginx 加 `proxy_buffering off;`（服务端已带 `X-Accel-Buffering: no`），并把 `proxy_read_timeout` 调到 1 小时以上。

## 功能说明

- **注册 / 登录**：用户名（2–20 位中文/字母/数字/下划线）、手机号、密码（≥6 位，scrypt 加盐存储）。登录可用用户名或手机号。会话 30 天。
- **项目**：任何成员都可新建、改名、归档；归档后只读，统计保留。
- **记一笔**：选择支出/收入、金额、币种（CNY / USDT / USD）、项目、经手人（谁付的 / 谁收的，默认自己）、备注；登记人和时间自动记录。
- **统计**：所有金额按「我的 → 汇率设置」中的汇率折算为人民币：`利润 = 收入 − 支出`。总览页汇总所有未归档项目；项目页另有按币种的分列、按成员的支出 / 收款统计，以及按日期分组的流水。
- **删除**：只能删除自己登记的记录；项目创建者可删除该项目下所有记录。
- **报表页**：范围（全部项目 / 某个项目）× 区间（本月 / 上月 / 近 30 天 / 全部 / 自定义）。所有金额折算为人民币；曲线为累计利润，柱状为每日收支；表格有每日账单、按项目、按成员。
- **AI 财务报表**：点「生成报表」后 AI 按固定结构（核心结论 / 收支概览 / 趋势 / 项目 / 成员 / 建议）撰写，所有在线成员实时看到流式输出。报表按「范围 + 区间」缓存；数据变动后标记为过期，并在约 45 秒后自动重新生成（最近 24 小时看过的报表；可在「我的」里关闭）。
- **实时同步**：浏览器通过 `/api/events` 长连接接收变更，别人记账时会弹提示并自动刷新当前页面。
- **修改记录**：点击自己登记的流水即可修改金额、币种、项目、经手人、备注和时间，或删除。
- **AI 工具清单**：只读——list_projects / list_entries / get_report / get_ai_report / get_settings / list_members / list_proposals / list_exports / list_parties / party_statement / party_live / member_funds / list_transfers / search_knowledge / read_knowledge / relay_*（中转站）；需审批——add_entry / add_entries_batch / update_entry / delete_entry / create_project（可同时建群）/ update_project / create_project_group / add_party / update_party（含倍率、绑定 / 解绑中转站、归档）/ delete_party / add_party_record / delete_party_record / add_transfer / delete_transfer / clear_project / delete_project / update_settings（汇率、AI 模型、自动刷新、群聊模式、自动导出）/ generate_ai_report / export_report / consolidate_knowledge。
- **AI 助手**：群聊消息永久保存（不可清空，知识库另有存档），私聊可在菜单里清空；群聊可「清屏」（只在本机隐藏）。自己发的消息 5 分钟内可撤回（电脑悬停 / 手机长按），撤回会打断 AI 正在生成的回复并作废相关提案。发送方式可选 Enter 或 Ctrl/⌘+Enter（输入法友好），拼音未打完时的 Enter 不会误发；AI 上下文取最近 40 条 + 知识摘要 + 最近两天日志，更早的内容通过 `search_knowledge` / `read_knowledge` 工具查。系统提示词见 `server.js` 的 `CHAT_SYSTEM`，可按团队习惯修改。「我的」里可设置群聊是每条都回复还是仅 @AI 时回复。
- **权限**：AI 提案以说话人的身份执行（只能改自己登记的记录等），批准人可以是任何成员（包括提出者本人）。
- **自动导出**：「我的 → 每日自动导出」设置时间 / 范围 / 区间；到点自动刷新 AI 报表并生成 Excel + Markdown，保存到 `DATA_DIR/exports`，最多保留 120 个文件。

## 对外接口（实时同步应收 / 应付）

令牌在「我的 → 对外接口」查看 / 重置，请求头带 `X-API-Key: <令牌>`（或 `Authorization: Bearer <令牌>`）。

```bash
# 推送一条或多条往来记录（数组，最多 500 条）
curl -X POST https://你的域名/api/integrations/records \
  -H "X-API-Key: yq_xxx" -H "Content-Type: application/json" \
  -d '[
    {"project":"海外投放 Q4","customer":"YY 科技","kind":"due","amount":20000,"date":"2026-09-21","note":"9 月账单","external_ref":"inv-2026-09-21-001"},
    {"project":"海外投放 Q4","customer":"YY 科技","kind":"paid","amount":8000,"currency":"CNY","note":"首期回款","external_ref":"pay-1001"},
    {"project":"海外投放 Q4","supplier":"XX 广告代理","kind":"due","amount":500,"currency":"USDT","rate":7.1,"date":"2026-09-20"}
  ]'
```

| 字段 | 说明 |
|---|---|
| `project` | 项目 id 或名称（可模糊） |
| `customer` / `supplier` | 客户或供应商的名称或「外部系统编号」，不存在时自动创建 |
| `kind` | `due` = 应收 / 应付发生额，`paid` = 实收 / 实付 |
| `amount` | 金额；`currency` 默认该单位的结算币种；外币可带 `rate`（不带用当前汇率） |
| `date` | 业务日期 `YYYY-MM-DD`，默认今天（团队时区） |
| `external_ref` | 外部唯一键，重复推送同一键会被忽略（返回 `duplicate: true`） |
| `link_entry` | `paid` 时是否同步记入项目流水，默认 `true` |

返回 `{ results: [...], succeeded, failed }`，每条含 `ok` 与 `record` / `error`。读取：`GET /api/integrations/parties?project=<id|名称>` 返回各项目的供应商 / 客户汇总与往来日报。

## 接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | `{username, phone, password}` |
| POST | `/api/auth/login` | `{account, password}`，account 为用户名或手机号 |
| POST | `/api/auth/logout` | |
| GET | `/api/me` | 当前用户、团队成员、汇率 |
| GET | `/api/projects` | 项目列表（含各自统计）与总览 |
| POST | `/api/projects` | `{name, note}` |
| PATCH | `/api/projects/:id` | `{name?, note?, archived?}` |
| GET | `/api/projects/:id` | 项目详情、统计、成员统计、流水 |
| POST | `/api/projects/:id/entries` | `{type, amount, currency, handler_id?, note?}` |
| DELETE | `/api/entries/:id` | |
| GET / PUT | `/api/settings` | `{rates: {USD, USDT}, ai_auto}` |
| GET | `/api/events` | SSE：`changed` / `ai` / `members` 事件 |
| GET | `/api/report` | `?scope=all|<id>&range=month|last-month|30d|all|custom&from&to`，含 AI 报表状态 |
| POST | `/api/report/ai` | 生成 / 重新生成 AI 报表（`{scope, range, from, to, force}`） |
| GET | `/api/report/ai.md` | 下载 AI 报表 Markdown |
| GET | `/api/export.xlsx` | 下载 Excel，参数同 `/api/report` |
| PATCH | `/api/entries/:id` | 修改记录（`amount, currency, type, note, handler_id, project_id, time`） |
| GET / POST / DELETE | `/api/exports`、`/api/exports/:id` | 导出记录列表 / 存档导出 / 删除；`/api/exports/:id/download` 下载 |
| GET / POST / DELETE | `/api/chat?channel=group|dm|project:<id>` | 团队群 / 私聊 / 项目群：历史 / 发送 / 清空（仅私聊）；AI 回复通过 `/api/events` 实时推送 |
| GET / POST | `/api/channels` | 会话列表 / 新建项目群（`{project_id}`） |
| GET / POST | `/api/projects/:id/parties` | 项目的供应商 / 客户汇总与往来日报 / 添加（`{kind, name, contact, note, currency, external_id}`） |
| GET / PATCH / DELETE | `/api/parties/:id` | 单位详情（含往来明细）/ 修改 / 删除 |
| POST | `/api/parties/:id/records` | 记往来：`{kind: due|paid, amount, currency, rate, date, note, link_entry}` |
| DELETE | `/api/party-records/:id` | 删除往来记录（关联流水一并删） |
| POST / GET | `/api/integrations/records`、`/api/integrations/parties` | 外部系统接口（X-API-Key） |
| POST | `/api/proposals/:id/approve|reject` | 批准 / 拒绝 AI 提案 |
| POST / GET | `/api/attachments`、`/api/attachments/:id` | 上传（base64 JSON，≤20MB）/ 下载附件 |
| GET / POST | `/api/knowledge`、`/api/knowledge/consolidate`、`/api/knowledge/file?kind=log|chat&date=` | 知识库：摘要与文件列表 / 手动整理 / 下载某天的 md |

## 目录

```
server.js          后端：接口、鉴权、SQLite、SSE、报表统计、AI 生成、Excel 导出
public/index.html  页面结构
public/style.css   样式（设计令牌 + 深浅色 + 图表）
public/app.js      前端逻辑（路由、渲染、弹层、实时同步、SVG 图表、Markdown）
.env               本机配置（端口、AI 密钥等，不入库）
data/              运行时生成：ledger.db、session.secret、exports/、uploads/、knowledge/{log,chat,archive,summary.md}
```
