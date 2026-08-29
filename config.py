"""
NovaPay V6.0 — 全局配置模块
所有密钥 / 敏感参数均从环境变量读取，禁止硬编码。
"""
import os
import base64
import hashlib
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.abspath(os.path.dirname(__file__))


def get_env(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


# --- 数据库 ---
DATABASE_URL = get_env("DATABASE_URL", f"sqlite:///{os.path.join(BASE_DIR, 'novapay.db')}")

# --- JWT ---
JWT_SECRET_KEY = get_env("JWT_SECRET_KEY", "dev-insecure-secret-change-me")
JWT_ALGO = "HS256"
JWT_EXP_SECONDS = 3600  # 1 小时

# --- AES-256-GCM 密钥派生 ---
# 要求 32 字节；若环境变量长度不足，则用 SHA-256 派生到固定 32 字节。
_raw_aes = get_env("AES_ENCRYPTION_KEY", "dev-insecure-aes-key-change-me")
if isinstance(_raw_aes, str):
    _raw_aes_b = _raw_aes.encode("utf-8")
else:
    _raw_aes_b = _raw_aes
if len(_raw_aes_b) >= 32:
    AES_KEY = _raw_aes_b[:32]
else:
    AES_KEY = hashlib.sha256(_raw_aes_b).digest()  # 固定 32 字节

# --- Admin ---
ADMIN_USERNAME = get_env("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD_HASH = get_env("ADMIN_PASSWORD_HASH", "")

# --- 邮件（可选） ---
SMTP = {
    "host": get_env("SMTP_HOST"),
    "port": int(get_env("SMTP_PORT", "587")),
    "user": get_env("SMTP_USER"),
    "pass": get_env("SMTP_PASS"),
    "from": get_env("SMTP_FROM"),
}

FLASK_DEBUG = get_env("FLASK_DEBUG", "false").lower() == "true"

# 默认系统配置（会被数据库 SystemConfig 覆盖）
DEFAULT_SYSTEM_CONFIG = {
    "transfer_fee_rate": 0.008,
    "debit_card_issue_fee": 300,
    "credit_card_issue_fee_base": 80,
    "sub_account_fee": 300,
    "unfreeze_fee": 100,
    "renew_fee": 50,
    "gift_card_fee_rate": 0.10,
    "daily_transfer_limit": 5000,
    "pin_max_attempts": 5,
    "login_max_attempts": 5,
    "lock_duration_minutes": 15,
    "credit_grace_days": 30,
    "credit_overdue_suspend_days": 7,
    "suggestion_encryption_key": "from_env",
    "geo_block_enabled": True,
}

# 卡片等级对应的发卡基础费用 / 信用额度映射（用于发卡逻辑）
# 费率按 USD 基准，CHF 按 ×0.8167 折算（如 Standard 借记卡 USD 300 → CHF 245）
CARD_LEVELS = {
    # NovaPay 自有网络：借记卡统一 300 USD（首张免费，后续每张 300）
    "NovaPay": {
        "Standard": {"debit_fee": 300, "credit_fee": 100, "credit_limit": 5000},
        "Premium": {"debit_fee": 300, "credit_fee": 300, "credit_limit": 15000},
        "Black": {"debit_fee": 300, "credit_fee": 500, "credit_limit": 50000},
        "Eternal": {"debit_fee": 300, "credit_fee": 1200, "credit_limit": 50000},
        "Eternal+": {"debit_fee": 300, "credit_fee": 2500, "credit_limit": 100000},
    },
    # Visa 网络
    "Visa": {
        "Classic": {"debit_fee": 300, "credit_fee": 80, "credit_limit": 5000},
        "Gold": {"debit_fee": 300, "credit_fee": 200, "credit_limit": 15000},
        "Platinum": {"debit_fee": 300, "credit_fee": 400, "credit_limit": 25000},
        "Infinite": {"debit_fee": 300, "credit_fee": 1000, "credit_limit": 50000},
    },
    # MasterCard 网络
    "MasterCard": {
        "Standard": {"debit_fee": 300, "credit_fee": 80, "credit_limit": 5000},
        "Gold": {"debit_fee": 300, "credit_fee": 200, "credit_limit": 15000},
        "Platinum": {"debit_fee": 300, "credit_fee": 400, "credit_limit": 25000},
        "WorldElite": {"debit_fee": 300, "credit_fee": 1000, "credit_limit": 50000},
    },
    # AmericanExpress 网络
    "AmericanExpress": {
        "Blue": {"debit_fee": 300, "credit_fee": 95, "credit_limit": 5000},
        "Gold": {"debit_fee": 300, "credit_fee": 250, "credit_limit": 15000},
        "Platinum": {"debit_fee": 300, "credit_fee": 695, "credit_limit": 50000},
        "Centurion": {"debit_fee": 300, "credit_fee": 5000, "credit_limit": 100000},
    },
}
# 兼容旧平铺格式（发卡逻辑优先按 network+level 查找，回退到平铺）
CARD_LEVELS_FLAT = {
    "Standard": {"debit_fee": 300, "credit_fee": 80, "credit_limit": 5000},
    "Gold": {"debit_fee": 300, "credit_fee": 200, "credit_limit": 15000},
    "Platinum": {"debit_fee": 300, "credit_fee": 400, "credit_limit": 25000},
    "Black": {"debit_fee": 300, "credit_fee": 500, "credit_limit": 50000},
    "Premium": {"debit_fee": 300, "credit_fee": 300, "credit_limit": 15000},
    "Eternal": {"debit_fee": 300, "credit_fee": 1200, "credit_limit": 50000},
    "Eternal+": {"debit_fee": 300, "credit_fee": 2500, "credit_limit": 100000},
    "Classic": {"debit_fee": 300, "credit_fee": 80, "credit_limit": 5000},
    "Infinite": {"debit_fee": 300, "credit_fee": 1000, "credit_limit": 50000},
    "WorldElite": {"debit_fee": 300, "credit_fee": 1000, "credit_limit": 50000},
    "Blue": {"debit_fee": 300, "credit_fee": 95, "credit_limit": 5000},
    "Centurion": {"debit_fee": 300, "credit_fee": 5000, "credit_limit": 100000},
    "Elite": {"debit_fee": 300, "credit_fee": 1000, "credit_limit": 50000},
}
