# NovaPay Cloudflare 部署指南

## 部署架构
- **后端**: Cloudflare Workers (Node.js) + D1 (SQLite)
- **前端**: Cloudflare Pages
- **API 地址**: https://novapay-api.workers.dev (部署后更新)
- **前端地址**: https://novapay-bank-simulator.caiyucheng32.workers.dev

---

## 第一步：安装 Wrangler CLI

```bash
# 安装 Node.js (如果还没安装)
# 下载: https://nodejs.org/

# 安装 Wrangler
npm install -g wrangler

# 登录 Cloudflare
wrangler login
```

---

## 第二步：创建 D1 数据库

```bash
# 进入 cloudflare 目录
cd cloudflare

# 创建 D1 数据库
wrangler d1 create novapay

# 记下输出的 database_id，格式类似: xxxx-xxxx-xxxx-xxxx
```

---

## 第三步：更新 wrangler.toml

编辑 `cloudflare/wrangler.toml`，将 `database_id` 替换为上面创建的 ID：

```toml
[[d1_databases]]
binding = "DB"
database_name = "novapay"
database_id = "你的D1数据库ID"  # ← 替换这里
```

---

## 第四步：执行数据库迁移

```bash
# 在 cloudflare 目录下执行
wrangler d1 execute novapay --remote --file=./schema.sql

# 验证表是否创建成功
wrangler d1 execute novapay --remote --command="SELECT name FROM sqlite_master WHERE type='table';"
```

---

## 第五步：部署 Worker

```bash
# 确保在 cloudflare 目录下
cd cloudflare

# 部署
wrangler deploy

# 成功后会显示类似:
# https://novapay-api.workers.dev
```

---

## 第六步：部署前端到 Cloudflare Pages

### 方式一：手动部署

```bash
# 进入项目根目录
cd /path/to/NovaPay

# 构建前端（如果有构建步骤）
# 注意：NovaPay 前端是纯静态文件，无需构建

# 使用 wrangler 部署 Pages
wrangler pages deploy frontend --project-name=novapay-bank-simulator

# 或者直接在 Cloudflare Dashboard 手动上传
# 访问: https://dash.cloudflare.com -> Pages -> Create a project
```

### 方式二：GitHub 自动部署

1. 将代码推送到 GitHub
2. 访问 https://dash.cloudflare.com -> Pages
3. 点击 "Connect to Git"
4. 选择仓库 `YuchengCai46/novapay-bank-simulator`
5. 设置构建配置：
   - Build command: 留空（静态文件无需构建）
   - Output directory: `frontend`
   - Build root: 留空
6. 点击 Save and Deploy

---

## 第七步：配置环境变量

在 Cloudflare Dashboard 中配置：

```
环境变量 (Worker & Pages):

JWT_SECRET_KEY = d7bbd897f4b41ac9da4f670492a8d6f8
AES_ENCRYPTION_KEY = c4902d50f71fe95acf32301ade5c3630
ADMIN_USERNAME = admin
ADMIN_PASSWORD_HASH = 4cf5ed5d189ca8caa678535d3e78e240:8kJdEM4Z0VQ3sjQAEDZ2Np55drXEZ+/hgain8EbMWzQ=
```

配置位置：
- Worker 环境变量: Dashboard -> Workers & Pages -> novapay-api -> Settings -> Variables
- 或编辑 `wrangler.toml` 中的 `[vars]` 部分

---

## 第八步：验证部署

### 1. 检查 Health Check
```
https://novapay-api.workers.dev/health
```

### 2. 测试注册接口
```bash
curl -X POST https://novapay-api.workers.dev/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123456"}'
```

### 3. 测试登录接口
```bash
curl -X POST https://novapay-api.workers.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpassword"}'
```

### 4. 前端访问
打开浏览器访问: https://novapay-bank-simulator.caiyucheng32.workers.dev

---

## 常见问题

### Q: 404 错误
- 检查 D1 数据库是否正确创建并执行了 schema.sql
- 确认 worker.js 路径正确

### Q: CORS 错误
- 检查 frontend/js/app.js 中的 API_BASE 是否正确
- 确认 Worker 已正确返回 CORS 头

### Q: 数据库连接失败
- 检查 wrangler.toml 中的 database_id 是否正确
- 运行 `wrangler d1 list` 查看所有 D1 数据库

### Q: 管理员登录失败
- 确认 ADMIN_PASSWORD_HASH 已正确配置
- 密码通过 PBKDF2-SHA256 哈希存储，不在代码中明文出现
- 建议登录后修改密码

---

## 文件清单

```
cloudflare/
├── worker.js      # 主入口 (966行)
├── crypto.js      # 加密工具 (140行)
├── db.js          # 数据库操作 (167行)
├── helpers.js     # 工具函数 (81行)
├── schema.sql     # 数据库 schema (211行)
├── wrangler.toml  # 部署配置
└── package.json   # 依赖配置

frontend/
└── js/
    └── app.js     # 前端主程序 (已更新 API_BASE)
```

---

## 完整部署命令序列

```bash
# 1. 登录
wrangler login

# 2. 创建 D1
wrangler d1 create novapay

# 3. 编辑 wrangler.toml 填入 database_id

# 4. 执行迁移
wrangler d1 execute novapay --remote --file=./schema.sql

# 5. 部署 Worker
wrangler deploy

# 6. 部署前端 (可选)
wrangler pages deploy ../frontend --project-name=novapay-bank-simulator
```

---

## 备份与恢复

### 备份数据库
```bash
wrangler d1 execute novapay --remote --command=".schema" > backup-schema.sql
wrangler d1 execute novapay --remote --command="SELECT * FROM users" > backup-users.csv
```

### 恢复数据库
```bash
wrangler d1 execute novapay --remote --file=backup-schema.sql
```
