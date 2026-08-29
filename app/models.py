"""
NovaPay V6.0 — SQLAlchemy 数据模型（全部 10 个）
索引策略（见规范第十二章）：
  user_id / card_number / transaction.created_at / status / suggestion.submitted_at
"""
from datetime import datetime, date

from sqlalchemy import (
    Column, String, Integer, Float, Boolean, Date, DateTime, JSON, Text, Index, ForeignKey, func
)
from app.db import Base


# ----------------------------------------------------------------------------
# 2.1 用户
# ----------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"

    id = Column(String(20), primary_key=True)            # NP + 8 位数字
    email = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(120), nullable=False)
    phone = Column(String(40))
    id_number = Column(String(60))
    dob = Column(Date)
    address = Column(Text)
    nationality = Column(String(60))
    tax_jurisdiction = Column(String(60))
    purpose = Column(String(40), default="Personal")    # Personal/Business/Investment/Savings
    password_hash = Column(String(255), nullable=False)
    pin_hash = Column(String(255))
    salt = Column(String(64))
    status = Column(String(20), default="active", index=True)  # active/suspended/blacklisted/closed
    created_at = Column(DateTime, default=datetime.utcnow)
    locked_until = Column(DateTime)
    fail_count = Column(Integer, default=0)
    pin_fail_count = Column(Integer, default=0)
    credit_blacklist = Column(Boolean, default=False)
    is_2fa_enabled = Column(Boolean, default=False)
    totp_secret = Column(String(255))
    last_login_ip = Column(String(64))
    last_login_device = Column(String(255))
    settings = Column(JSON, default=dict)
    message_box = Column(JSON, default=list)            # [{timestamp, content, read}]

    def to_dict(self, public: bool = True):
        d = {
            "id": self.id, "email": self.email, "name": self.name,
            "phone": self.phone, "nationality": self.nationality,
            "tax_jurisdiction": self.tax_jurisdiction, "purpose": self.purpose,
            "status": self.status, "created_at": _iso(self.created_at),
            "credit_blacklist": self.credit_blacklist,
            "is_2fa_enabled": self.is_2fa_enabled,
        }
        if not public:
            d.update({
                "id_number": self.id_number, "dob": _iso(self.dob),
                "address": self.address, "last_login_ip": self.last_login_ip,
                "last_login_device": self.last_login_device,
                "fail_count": self.fail_count, "pin_fail_count": self.pin_fail_count,
            })
        return d


# ----------------------------------------------------------------------------
# 2.2 账户
# ----------------------------------------------------------------------------
class Account(Base):
    __tablename__ = "accounts"

    id = Column(String(36), primary_key=True)
    user_id = Column(String(20), ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    type = Column(String(20), default="main")            # main / sub
    currency = Column(String(10), default="USD")
    created_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean, default=True)
    alias = Column(String(120))
    sub_account_fee_paid = Column(Boolean, default=False)


# ----------------------------------------------------------------------------
# 2.3 卡片
# ----------------------------------------------------------------------------
class Card(Base):
    __tablename__ = "cards"

    id = Column(Integer, primary_key=True, autoincrement=True)
    number = Column(String(19), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    type = Column(String(10), nullable=False)            # debit / credit
    network = Column(String(20), default="NovaPay")      # NovaPay/Visa/MasterCard
    level = Column(String(20), default="Standard")       # Standard/Gold/Platinum/Black/Eternal/Eternal+
    expiry = Column(String(10), default="ETERNAL")      # MM/YY 或 ETERNAL
    cvv_hash = Column(String(255))                       # 不存明文，存哈希
    cvv_encrypted = Column(String(512))                  # AES 加密备用
    status = Column(String(24), default="active", index=True)
    balance = Column(Float, default=0.0)                 # 仅借记卡
    credit_limit = Column(Float, default=0.0)            # 仅信用卡
    credit_used = Column(Float, default=0.0)             # 仅信用卡
    credit_due_date = Column(Date)                       # 仅信用卡
    theme = Column(String(40), default="default")
    daily_limit = Column(Float, default=10000.0)
    single_transaction_limit = Column(Float, default=5000.0)
    wrong_cvv_count = Column(Integer, default=0)
    issued_at = Column(DateTime, default=datetime.utcnow)
    last_used_at = Column(DateTime)
    is_virtual = Column(Boolean, default=False)
    parent_card_id = Column(Integer, ForeignKey("cards.id"))

    def masked_number(self):
        return "**** **** **** " + (self.number[-4:] if self.number else "****")


# ----------------------------------------------------------------------------
# 2.4 交易
# ----------------------------------------------------------------------------
class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(String(48), primary_key=True)            # TX + 时间戳 + 随机码
    user_id = Column(String(20), ForeignKey("users.id"))
    account_id = Column(Integer, ForeignKey("accounts.id"))
    from_card_id = Column(Integer, ForeignKey("cards.id"))
    to_card_id = Column(Integer, ForeignKey("cards.id"))
    type = Column(String(24))                            # topup/transfer_out/...
    amount = Column(Float, default=0.0)
    fee = Column(Float, default=0.0)
    balance_after = Column(Float, default=0.0)
    note = Column(Text)
    category = Column(String(40))
    status = Column(String(16), default="completed", index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    ip_address = Column(String(64))
    user_agent = Column(String(255))
    is_suspicious = Column(Boolean, default=False)
    encrypted_note = Column(Text)


# ----------------------------------------------------------------------------
# 2.5 订阅
# ----------------------------------------------------------------------------
class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(String(48), primary_key=True)            # SUB + 时间戳
    user_id = Column(String(20), ForeignKey("users.id"), nullable=False, index=True)
    brand = Column(String(120), nullable=False)
    plan_id = Column(String(40))
    plan_name = Column(String(120))
    cycle = Column(String(20), default="Monthly")        # Monthly / Yearly
    amount = Column(Float, default=0.0)
    bound_card_number = Column(String(19))
    start_date = Column(DateTime, default=datetime.utcnow)
    next_billing_date = Column(DateTime)
    status = Column(String(20), default="active")        # active/canceled/payment_failed
    auto_renew = Column(Boolean, default=True)


# ----------------------------------------------------------------------------
# 2.6 礼品卡
# ----------------------------------------------------------------------------
class GiftCard(Base):
    __tablename__ = "giftcards"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(19), unique=True, nullable=False)  # XXXX-XXXX-XXXX-XXXX
    amount = Column(Float, default=0.0)
    status = Column(String(12), default="active")        # active / used
    owner_user_id = Column(String(20), ForeignKey("users.id"))
    redeemed_by_user_id = Column(String(20), ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    redeemed_at = Column(DateTime)


# ----------------------------------------------------------------------------
# 2.7 绑定卡
# ----------------------------------------------------------------------------
class BoundCard(Base):
    __tablename__ = "bound_cards"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(20), ForeignKey("users.id"), nullable=False, index=True)
    card_number = Column(String(19), nullable=False)
    masked = Column(String(32))
    expiry = Column(String(10))
    is_active = Column(Boolean, default=True)


# ----------------------------------------------------------------------------
# 2.8 审计日志
# ----------------------------------------------------------------------------
class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(20), index=True)             # 可为空
    action = Column(String(40), index=True)             # login/logout/transfer/.../admin_archive_suggestion
    target = Column(String(255))
    details = Column(JSON, default=dict)
    ip_address = Column(String(64))
    user_agent = Column(String(255))
    status = Column(String(16), default="success")        # success / failed
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


# ----------------------------------------------------------------------------
# 2.9 系统配置
# ----------------------------------------------------------------------------
class SystemConfig(Base):
    __tablename__ = "system_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(String(80), unique=True, nullable=False)
    value = Column(JSON)
    description = Column(String(255))
    updated_at = Column(DateTime, default=datetime.utcnow)
    updated_by = Column(String(40))


# ----------------------------------------------------------------------------
# 2.10 用户建议 / 反馈（新增重点）
# ----------------------------------------------------------------------------
class Suggestion(Base):
    __tablename__ = "suggestions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(20), ForeignKey("users.id"), index=True)  # 匿名时为空
    is_anonymous = Column(Boolean, default=False)
    content = Column(Text)                              # 建议内容原文（提交时保存，便于展示）
    content_encrypted = Column(Text)                    # AES-256-GCM 密文（仅 admin 可解密）
    content_hash = Column(String(64))                   # SHA-256 防篡改哈希
    submitted_at = Column(DateTime, default=datetime.utcnow, index=True)  # 精确到毫秒
    status = Column(String(16), default="pending")      # pending/reviewed/archived/deleted
    admin_action = Column(String(40))                   # 归档/删除/封号/解除匿名 等
    admin_note = Column(Text)                           # admin 处理备注
    reviewed_at = Column(DateTime)
    reviewed_by = Column(String(40))
    is_deanonymized = Column(Boolean, default=False)
    deanonymized_at = Column(DateTime)
    deanonymized_by = Column(String(40))
    deanonymize_reason = Column(Text)                   # 违法审计原因

    def preview(self, length: int = 30):
        """解密前的内容预览（取原文前 length 字）。"""
        if not self.content:
            return ""
        return self.content[:length] + ("…" if len(self.content) > length else "")


# ----------------------------------------------------------------------------
# 2.11 暂存池
# ----------------------------------------------------------------------------
class EscrowPool(Base):
    __tablename__ = "escrow_pools"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(20), ForeignKey("users.id"), nullable=False, index=True)
    currency = Column(String(10), nullable=False, default="USD")  # 记账货币
    balance = Column(Float, default=0.0)                        # 池内余额
    limit_per_currency = Column(Float, default=50000.0)         # 每种货币上限
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ----------------------------------------------------------------------------
# 2.12 销户申请
# ----------------------------------------------------------------------------
class AccountCancellation(Base):
    __tablename__ = "account_cancellations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(20), ForeignKey("users.id"), nullable=False, index=True)
    reason = Column(Text)                                   # 用户填写的销户原因
    reason_encrypted = Column(Text)                        # AES-256-GCM 密文（仅 admin 可解密）
    reason_hash = Column(String(64))                       # SHA-256 防篡改哈希
    submitted_at = Column(DateTime, default=datetime.utcnow, index=True)
    status = Column(String(20), default="pending")         # pending/approved/rejected/cancelled
    admin_note = Column(Text)
    admin_action = Column(String(40))                      # approved / rejected / cancelled
    reviewed_at = Column(DateTime)
    reviewed_by = Column(String(40))


def _iso(v):
    if v is None:
        return None
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return str(v)
