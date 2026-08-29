# NovaPay V6.0 — 全栈数字银行系统

> 一套完整的全栈数字银行系统：用户体系、多账户/多卡管理、真实加密算法、信用卡风控引擎、订阅/礼品卡/子账户、Admin 后台，以及**加密存储 + 匿名 + 审计**的用户建议/反馈系统。

技术栈：**Python 3.12 + Flask 3 + SQLAlchemy 2 + SQLite/PostgreSQL**；前端为适配 PC 大屏（≥1200px）的纯 HTML/CSS/JS SPA，含 3D 质感卡片与磨砂玻璃面板。

---

## 一、功能矩阵

| 模块 | 关键能力 |
|------|----------|
| 用户认证 | 注册 / 登录（5 次失败锁定 15 分钟）/ 登出 / 刷新 / **2FA(TOTP)** / 改密改 PIN / 设备管理 / 单点登出 / 消息箱 |
| 账户管理 | 账户列表 / 切换 / 子账户（$300 含免费借记卡）/ 别名 / 余额汇总 |
| 卡片管理 | 发卡（按等级收费）/ 冻结 / 解冻（$100）/ 续期（$50）/ 注销 / 虚拟卡 / 限额 / 主题 / 挂失补办 |
| 信用卡风控 | 状态机：到期冻结 → 逾期封禁 / 还款 / 续卡 / 自动注销；0.8% 转账手续费 |
| 交易系统 | 充值 / 卡对卡转账 / 历史分页筛选 / 分类 / 每月自动转账 / 大额与短时多笔可疑标记 |
| 订阅服务 | 服务目录 / 订阅 / 取消 / 绑卡 / 解绑（自动取消关联订阅） |
| 礼品卡 | 购买（+10% 费）/ 兑换 / 我的 / 校验 |
| **建议反馈** | **匿名/实名提交 → AES-256-GCM 加密 + SHA-256 防篡改；Admin 解密查看、违法审计解除匿名、归档/删除/封号/备注，全程审计日志 + 用户通知** |
| Admin 后台 | 仪表盘 / 用户管理 / 卡片管理 / 交易管理 / 建议管理 / 系统配置 / 审计日志 / 数据备份恢复 |
| 定时任务 | 每天 02:00：信用卡到期/逾期检查、订阅续费、过期卡自动注销、每日报表 |

---

## 二、快速开始

```bash
# 1. 准备 Python 环境（推荐 3.12+）
python -m venv venv && source venv/bin/activate

# 2. 安装依赖
pip install -r requirements.txt

# 3. 配置环境变量
cp .env.example .env
#   编辑 .env，至少设置 JWT_SECRET_KEY / AES_ENCRYPTION_KEY
#   生成 Admin 密码哈希：
python scripts/gen_admin.py "你的Admin密码"
#   将输出粘贴到 .env 的 ADMIN_PASSWORD_HASH

# 4. 启动
python run.py
#   浏览器访问 http://localhost:5000
```

生产部署（gunicorn + 可选 Docker）：

```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:5000 "app:app"
# 或
docker compose up --build
```

---

## 三、安全与加密（重点）

所有密钥**仅从环境变量读取，绝不硬编码**：

- **AES-256-GCM**：`cryptography` 库，用于加密 CVV 与建议内容。密钥 `AES_ENCRYPTION_KEY`（32 字节，长度不足时以 SHA-256 派生）。
- **Argon2id**：密码与 PIN 哈希，每次独立盐值。
- **SHA-256**：建议内容防篡改哈希 `content_hash`，查看时自动比对，不一致前端显示红色「⚠️ 内容已被篡改」。
- **JWT（HS256）**：存储在 **HTTP-only + SameSite=Strict** Cookie 中；含 `session_version` 以支持单点登出。
- **IP 限流**：每 IP 每分钟 ≤ 60 次请求。

### 建议/反馈系统数据流

```
用户提交
  ├─ 原文 → SHA-256(content_hash)  # 防篡改
  ├─ 原文 → AES-256-GCM(content_encrypted)  # 仅 Admin 可解密
  └─ is_anonymous=True 时仍记录真实 user_id（服务端隐藏），供违法审计解除匿名

Admin 查看
  ├─ 解密 content_encrypted → 展示原文
  ├─ 重新计算 SHA-256 并与 content_hash 比对 → 篡改告警
  └─ 「违法审计」解除匿名：
        is_deanonymized=True + 记录操作人/时间/理由
        → 向该用户消息箱推送审计通知
        → 写入 AuditLog（action=admin_deanonymize）
```

---

## 四、API 速览（统一返回 `{ success, data, message }`）

认证：`POST /api/auth/register|login|logout|refresh`，`/api/auth/2fa/*`，`/api/auth/change-password|change-pin`，`/api/auth/messages`

账户：`GET /api/accounts`、`POST /api/accounts/sub`、`PUT /api/accounts/{id}/alias`、`GET /api/accounts/balances`

卡片：`POST /api/cards/issue|freeze|unfreeze|renew|cancel|replace|virtual`，`PUT /api/cards/{id}/limits|theme`，`/api/cards/credit/*`

交易：`POST /api/transactions/topup|transfer|schedule`，`GET /api/transactions/history|{id}`，`PUT /api/transactions/{id}/category`

订阅：`GET /api/subscriptions/services|my`，`POST /api/subscriptions/subscribe|bind-card`，`DELETE /api/subscriptions/{id}|/unbind-card`

礼品卡：`POST /api/giftcards/buy|redeem|verify`，`GET /api/giftcards/my`

**建议（用户）**：`POST /api/suggestions`、`GET /api/suggestions/my`、`GET /api/suggestions/{id}`

**建议（Admin）**：`GET /api/admin/suggestions`、`GET /api/admin/suggestions/{id}`（解密+篡改校验）、`POST /api/admin/suggestions/{id}/deanonymize|archive|ban-user`、`PUT /api/admin/suggestions/{id}/note`、`DELETE /api/admin/suggestions/{id}`

Admin：`/api/admin/login|dashboard|users|cards|transactions|config|audit-logs|data/*`

---

## 五、测试

```bash
pip install pytest
pytest -q
```

覆盖核心加密模块（AES 往返、Argon2、SHA-256、JWT）与建议系统端到端流程（提交/篡改检测/解除匿名通知/归档/封号/删除二次确认），以及注册登录、发卡充值转账、订阅礼品卡、Admin 仪表盘等。

---

## 六、目录结构

```
NovaPay/
├── app/
│   ├── __init__.py        # Flask 应用工厂（DB/限流/调度/前端托管）
│   ├── crypto.py          # AES-256-GCM / Argon2id / SHA-256 / JWT
│   ├── models.py          # 10 个数据模型（含索引）
│   ├── utils.py           # 统一响应 / 审计 / 消息箱 / 配置 / Luhn
│   ├── db.py              # SQLAlchemy 引擎与会话
│   ├── tasks.py           # 定时任务（信用卡风控 / 续费 / 报表）
│   └── routes/            # auth/accounts/cards/transactions/
│                          #   subscriptions/giftcards/suggestions/admin
├── frontend/              # PC 大屏 SPA（index.html + css + js）
├── tests/                 # pytest 用例
├── scripts/gen_admin.py   # 生成 Admin 密码哈希
├── requirements.txt  config.py  system_config.json
├── Dockerfile  docker-compose.yml  start.sh  run.py
└── README.md
```

---

## 七、说明与边界

- 本系统为**自包含的数字银行演示/教学系统**，所有「银行卡号」「CVV」「金额」均为本地模拟数据，未对接任何真实支付网络或金融机构。
- 金额使用浮点计算并保留两位小数展示；生产环境建议改用 `decimal`。
- 数据库索引已按规范在 `user_id / card_number / transaction.created_at / status / suggestion.submitted_at` 等字段建立。
