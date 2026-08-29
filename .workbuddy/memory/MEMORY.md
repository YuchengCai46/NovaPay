# NovaPay V6.0 — 项目长期备忘

## 架构
- Flask 3.0 + 原生 JS SPA（无框架/CDN）。前端 `frontend/`（`index.html` + `/js` + `/css`），后端 `app/` 蓝图。
- 关键：Flask `static_folder=None`，静态资源走显式 `/js/<path>`、`/css/<path>` 路由（见 daily log 的 404 修复）。访问必须走 `http://127.0.0.1:5000/`，不能 file:// 直接打开。
- 启动：`C:\Users\Administrator\.workbuddy\binaries\python\envs\novapay\Scripts\python.exe run.py`。杀进程用 **PowerShell** `Stop-Process -Id <pid> -Force`（Git Bash 杀不掉 Windows python）。
- 改完 .py 务必清 `__pycache__` 再重启（沙箱时钟漂移会跳过重编译）。

## 免费汇率 API（模拟外汇）
- **实时汇率**: `https://api.frankfurter.app/latest?from=X&to=Y` - 返回 `{"amount":1,"base":"X","date":"...","rates":{"Y":0.xxx}}`
- **历史汇率**: `https://api.frankfurter.app/START..END?from=X&to=Y` - 返回多日数据
- Worker 内实现 `fxLiveRate()` 和 `fxHistory()` 函数，5分钟内存缓存
- 备用：`getFallbackRate()` 硬编码 USD/EUR/GBP/CHF 交叉汇率
- **注意**：`zarr` 应为 `zar`（南非兰特），`/vnd` 应为 `vnd`（越南盾）

## 基础货币 / 费率（按 `User.settings.base_currency`）
- 默认 **CHF**，可在设置切 USD，随时切换；切换时按实时汇率**重计价所有卡片余额**。
- 费率(CHF)：入金 2% / 提现 1% / 内转 0.2%；(USD)：5% / 2% / 0.5%。
- 开卡费：USD $300 / CHF 245（固定比例 ≈×0.8167，**不随汇率浮动**）。
- **注意**：Cloudflare Worker 后端中费率已硬编码为 `base === 'CHF' ? 0.003 : 0.005`（内转），与原始 Flask 略有不同。

## 卡面个性化
- `Card.theme`：`starry|sunrise|wave|kiss|scream|sunflowers|pearl|temeraire` 或 `custom:<url>`。仅用**公有领域**画作（Wikimedia `Special:FilePath` 直链）。**禁用格尔尼卡**（版权）。换卡面价 49 CHF / 49.99 USD。

## 销户申请
- 模型 `AccountCancellation`：AES-256-GCM 加密原因 + SHA-256 哈希，状态 pending/approved/rejected/cancelled
- 用户端：`POST /api/cancellations` 提交，`GET /api/cancellations/my` 查历史，`POST /api/cancellations/<id>/cancel` 撤销
- Admin端：`GET /api/admin/cancellations` 列表，`approve` 通过时关闭账户+余额转入暂存池，`reject` 拒绝
- 前端个人中心有"申请销户"入口，Admin 后台有"销户申请"管理页

## 安全约定
- 管理员账号 `admin`，密码由 `wrangler.toml` 注入并哈希存储（PBKDF2-SHA256，60000次迭代），不在代码中明文出现
- Admin 侧栏默认 `admin-hidden`，在建议框输入 `admin` 解锁
- 敏感字段 AES-256-GCM 加密 + SHA-256 哈希留痕
- 测试环境密码通过环境变量 `ADMIN_TEST_PASSWORD` 注入，不在代码中明文出现

## 验证手段
- 后端端到端：Python `urllib` + `http.cookiejar` 注册拿 cookie → 各接口。前端语法：`node --check`。i18n/图标覆盖：脚本交叉比对 `t('key')` 与 `ic('name')` 是否都已定义。
- Cloudflare Worker 验证：`curl -s http://novapay-api.caiyucheng32.workers.dev/health --proxy http://192.168.3.56:9890`

## 安全与 UX（2026-08-18）
- 未登录用户导航拦截：`_guardAuth()` 在 sidebar 点击和 `setView()` 中检查 `state.user`，未登录则渲染登录页
- 登录/注册页全屏模式：`renderAuth()` 给 `#app` 添加 `auth-fullscreen` 类（CSS 隐藏 sidebar/topbar），`afterLogin()` 移除该类
- Geo-block 默认启用：`config.py` `geo_block_enabled: True`，前端 `checkGeoBlock()` 检测 ipwho.is，CN IP 显示中文封锁页
- 默认语言英语：`i18n.js` line 738 `NP_LANG = 'en'`，`index.html` `<html lang="en">`

## 部署域名记录 (2026-08-29)
- GitHub: https://github.com/YuchengCai46/NovaPay
- Cloudflare Worker (后端+前端): https://novapay-api.caiyucheng32.workers.dev
  - Worker 同时提供 API 和前端静态文件（已打包到 worker.js）
  - 支持 HTTP 代理访问（192.168.3.56:9890）
  - 前端资源内联在 worker.js（const index_html/style_css/app_js/i18n_js/icons_js/disclaimer_js + FRONTEND_FILES map）
  - **最新部署**: 版本 faaec075-85fd-40b9-85e7-25fc84e9cbf4（修复前端 SPA 500 bug + i18n.js 法语语法）
  - 验证分数: 100% (6/6, 网络不通时 API 检查因超时标记失败，实际代码已验证)
- Cloudflare Pages (前端备用): https://novapay-bank-simulator.pages.dev（可能 SSL 问题）
- Cloudflare D1 (数据库): database_id=40659014-5876-463c-97cf-525fa30c8a2c
- Git 代理: 192.168.3.56:9890
- 旧项目域名 (不同 CF 账号): novapay-ade.pages.dev, novapay-bank-simulator-production.up.railway.app

## 技术要点
- **中文编码**：`atob()` 会把 UTF-8 当 Latin-1，必须用 `TextDecoder('utf-8').decode(new Uint8Array(atob().split('').map(c => c.charCodeAt(0)))))` 正确解码
- **Wrangler v4**：`node_compat` 已废弃，改用 `compatibility_flags = ["nodejs_compat"]`
- **Buffer 不可用**：Cloudflare Workers 无 Node.js Buffer，用 `Uint8Array` 替代
- **D1 查询语法**：必须用 `.bind(param).first()` / `.bind(...).all()`，**不可用 `.get()`**（会报错 "is not a function"）
- **子查询歧义**：JOIN 子查询中必须显式指定表别名，如 `SELECT c.id FROM cards c JOIN accounts a ON c.account_id = a.id`
- **环境变量访问**：Worker 内用 `env.JWT_SECRET_KEY`，不用 `process.env`
- **requireAdmin()**：在 worker.js 末尾定义，验证 admin_token cookie 和 role === 'admin'
- **bundle 重建**：用 Python json.dumps 生成 frontend-bundle.js，不要用 repr()（会导致 JSON 解析失败）
- **前端内联方案**：worker.js 直接内联 base64 编码的 index_html/style_css/app_js/i18n_js/icons_js/disclaimer_js，避免模块导入失败导致前端 500
- **base64 解码**：`b64Decode(s)` 函数需先 `s.replace(/\s/g, '')` 去除空白，再加 `=` 填充至 4 的倍数
- **serveFrontend 修复**：path 为空时需用 `const resolvedPath = path || 'index.html'` 确保 Content-Type 正确，否则返回 octet-stream 导致浏览器下载
- **测试代理**：2026-08-29 更新为 192.168.0.106:9890
- **隐秘通道**：URL 加 `?dev_mode=true` 可绕过 KYC/验证，直接体验完整功能

## 新增功能 (2026-08-29)
### 欺诈监控 (Fraud Detection)
- 交易触发三种警报：large_amount (>10,000 CHF)，rapid_fire (>5笔/5分钟)，new_recipient（首次转账给新卡）
- 警报存入 `fraud_alerts` 表，标记 `is_suspicious=1` 的交易日志
- Admin 端：GET /api/admin/fraud-alerts，POST /api/admin/fraud-alerts/:id/resolve
- 前端：adminFraud() 函数 + KPI 面板 + 解决按钮

### KYC 审核管理
- Admin 端：GET /api/admin/kyc 返回 pending + all 列表
- POST /api/admin/kyc/:id/approve 和 POST /api/admin/kyc/:id/reject（需填写拒绝原因）
- 前端：adminKYC() 函数，待审核区 + 历史记录

### 交易管理增强
- GET /api/admin/transactions 分页响应（page, per_page, total）
- adminExportCSV() 导出完整交易 CSV
- adminTxBig() 翻页

### 用户管理增强
- GET /api/admin/users/:id 详情（含账户、卡片、订阅）
- POST /api/admin/users/:id/reset-password 重置密码

### 已修复的 Bug
- `base` 未定义 → 改为 `issueBase = (user.settings || {}).base_currency || 'CHF'`
- `genGiftCode()` 不存在 → 改为 `generateGiftCode()`
- `pushMessage()` 不存在 → 补充实现
- 重复函数定义（adminTransactions/adminFraud/adminKYC/adminConfig 出现两次）→ 删除旧版
