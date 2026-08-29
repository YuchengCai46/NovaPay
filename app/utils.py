"""
NovaPay V6.0 — 通用工具
  - 统一 API 响应格式
  - 当前用户 / Admin 解析（JWT Cookie）
  - 审计日志写入
  - 用户消息箱推送
  - 系统配置读取
  - Luhn 校验 / 卡号生成 / 脱敏
"""
from datetime import datetime, timezone
from functools import wraps

from flask import request, jsonify, g, has_request_context

from app.db import Session
from app import crypto
from app.models import User, AuditLog, SystemConfig
from config import DEFAULT_SYSTEM_CONFIG

# ---------------------------------------------------------------------------
# 统一响应格式：{ success, data, message }
# ---------------------------------------------------------------------------
def ok(data=None, message="", code=200):
    resp = jsonify({"success": True, "data": data, "message": message})
    resp.status_code = code
    return resp


def fail(message, code=400, data=None):
    resp = jsonify({"success": False, "data": data, "message": message})
    resp.status_code = code
    return resp


# ---------------------------------------------------------------------------
# 审计日志
# ---------------------------------------------------------------------------
def audit(action, target="", details=None, user_id=None, status="success"):
    """写入一条审计日志（使用当前请求上下文的 IP / UA）。

    注意：不在此处关闭 session —— 使用 scoped_session，关闭会 detach 调用方仍在使用的对象。
    请求结束时由 app teardown（Session.remove()）统一清理。
    """
    sess = Session()
    try:
        ip = None
        ua = None
        if has_request_context():
            ip = request.remote_addr
            ua = request.headers.get("User-Agent")
        log = AuditLog(
            user_id=user_id,
            action=action,
            target=str(target),
            details=details or {},
            ip_address=ip,
            user_agent=ua,
            status=status,
            created_at=datetime.utcnow(),
        )
        sess.add(log)
        sess.commit()
    except Exception:
        sess.rollback()
        raise


# ---------------------------------------------------------------------------
# 用户消息箱
# ---------------------------------------------------------------------------
def push_message(user_id, content):
    """向指定用户的 message_box 追加一条系统消息。"""
    sess = Session()
    try:
        u = sess.get(User, user_id)
        if not u:
            return
        box = u.message_box or []
        box.append({
            "timestamp": crypto.now_ms(),
            "content": content,
            "read": False,
        })
        u.message_box = box
        sess.commit()
    except Exception:
        sess.rollback()


# ---------------------------------------------------------------------------
# 系统配置
# ---------------------------------------------------------------------------
def get_config(key, default=None):
    """读取系统配置：优先数据库 SystemConfig，回退到 DEFAULT_SYSTEM_CONFIG。"""
    if key in DEFAULT_SYSTEM_CONFIG:
        default = DEFAULT_SYSTEM_CONFIG[key]
    sess = Session()
    try:
        row = sess.query(SystemConfig).filter_by(key=key).first()
        if row is not None:
            return row.value
    finally:
        pass
    return default


def all_configs():
    out = dict(DEFAULT_SYSTEM_CONFIG)
    sess = Session()
    try:
        for row in sess.query(SystemConfig).all():
            out[row.key] = row.value
    finally:
        pass
    return out


# ---------------------------------------------------------------------------
# 当前用户 / Admin（基于 JWT Cookie）
# ---------------------------------------------------------------------------
def _user_from_token(cookie_name):
    """解析 JWT Cookie 返回当前用户对象（不关闭 session，保持对象与请求会话绑定）。

    注意：使用 scoped_session，这里不 close，由请求结束时的 teardown 统一 remove。
    """
    token = request.cookies.get(cookie_name)
    if not token:
        return None
    payload = crypto.decode_jwt(token)
    if not payload:
        return None
    uid = payload.get("sub")
    if not uid:
        return None
    sess = Session()
    u = sess.get(User, uid)
    if not u:
        return None
    # 单点登出：JWT 携带的 session_version 必须与用户当前版本一致
    svf = payload.get("svf")
    cur = (u.settings or {}).get("session_version", 0) if u.settings else 0
    if svf != cur:
        return None
    return u


def get_current_user():
    """返回当前登录用户对象，或 None。"""
    u = getattr(g, "current_user", None)
    if u is not None:
        return u
    u = _user_from_token("access_token")
    g.current_user = u
    return u


def get_current_admin():
    """返回当前登录的 admin 标识（字符串），或 None。"""
    token = request.cookies.get("admin_token")
    if not token:
        return None
    payload = crypto.decode_jwt(token)
    if not payload or payload.get("role") != "admin":
        return None
    return payload.get("sub")


def require_user(f):
    @wraps(f)
    def wrapper(*a, **kw):
        u = get_current_user()
        if not u:
            return fail("未登录或会话已失效 / Not authenticated", 401)
        if u.status == "suspended":
            return fail("账户已被暂停 / Account suspended", 403)
        return f(*a, **kw)
    return wrapper


def require_admin(f):
    @wraps(f)
    def wrapper(*a, **kw):
        if not get_current_admin():
            return fail("需要 Admin 权限 / Admin required", 403)
        return f(*a, **kw)
    return wrapper


# ---------------------------------------------------------------------------
# Luhn / 卡号 / 脱敏
# ---------------------------------------------------------------------------
def luhn_valid(number: str) -> bool:
    digits = [int(d) for d in number if d.isdigit()]
    if len(digits) < 13:
        return False
    total = 0
    rev = digits[::-1]
    for i, d in enumerate(rev):
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def generate_card_number(length: int = 16, network: str = "NovaPay") -> str:
    """生成通过 Luhn 校验的卡号，使用真实 BIN 段。
    network: Visa/MasterCard/NovaPay/AmericanExpress
    """
    import random
    # 真实 BIN 段定义
    bin_ranges = {
        "Visa": ["4"],  # Visa 以 4 开头
        "MasterCard": ["51", "52", "53", "54", "55", "2221", "2222", "2223", "2224",
                      "2225", "2226", "2227", "2228", "2229", "223", "224", "225",
                      "226", "227", "228", "229", "23", "24", "25", "26", "270",
                      "271", "272", "2720"],  # MasterCard 2系和5系
        "AmericanExpress": ["34", "37"],  # 运通以 34 或 37 开头
        "NovaPay": ["4", "5", "6", "9"],  # NovaPay 通用
    }
    prefix_list = bin_ranges.get(network, bin_ranges["NovaPay"])
    # 随机选择前缀
    prefix = random.choice(prefix_list)
    prefix_len = len(prefix)
    body_len = length - prefix_len - 1  # 最后一位是校验位
    body = [random.randint(0, 9) for _ in range(body_len)]
    partial = prefix + "".join(map(str, body))
    # 计算 Luhn 校验位（parity 需反转：partial 末位在完整卡号中 parity 翻转）
    digits = [int(c) for c in partial]
    total = 0
    # partial 为奇数长度时，末位（index 0 从右）在完整卡号中变为偶数位（index 1），需反转 parity
    flip_parity = (len(partial) % 2 == 1)
    for i, d in enumerate(digits):
        pos = len(digits) - 1 - i  # 从右数的位置（0-based）
        if flip_parity:
            pos = 15 - pos  # 反转 parity
        if pos % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    check = (10 - (total % 10)) % 10
    full = partial + str(check)
    if luhn_valid(full):
        return full
    return None  # 理论上不会到这儿


def mask_card(number: str) -> str:
    if not number or len(number) < 4:
        return "****"
    return "**** **** **** " + number[-4:]


def verify_pin(user, pin: str) -> bool:
    """校验用户 PIN。"""
    if not user or not getattr(user, "pin_hash", None):
        return False
    return crypto.verify_secret(user.pin_hash, pin)


def encrypt_note(note: str):
    """端到端加密交易备注（可为空）。"""
    if not note:
        return None
    return crypto.aes_encrypt(note)


def generate_gift_code() -> str:
    import random
    import string
    chars = string.digits
    groups = ["".join(random.choice(chars) for _ in range(4)) for _ in range(4)]
    return "-".join(groups)
