"""NovaPay V6.0 — 认证与用户安全模块（4.1）"""
import os
import re
import random
import string
from datetime import datetime, timezone, timedelta

from flask import Blueprint, request, jsonify, current_app

from app.db import Session
from app import crypto, utils
from app.models import User, Account
from config import ADMIN_USERNAME, ADMIN_PASSWORD_HASH

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


def _gen_user_id(sess):
    while True:
        uid = "NP" + "".join(random.choice(string.digits) for _ in range(8))
        if not sess.get(User, uid):
            return uid


def _set_auth_cookie(resp, token):
    secure = os.environ.get("SECURE_COOKIE", "false").lower() == "true"
    resp.set_cookie(
        "access_token", token,
        httponly=True, samesite="Strict", secure=secure,
        max_age=3600, path="/",
    )


# ---------------------------------------------------------------------------
# 注册
# ---------------------------------------------------------------------------
@auth_bp.route("/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    name = (data.get("name") or "").strip()
    password = data.get("password") or ""
    pin = data.get("pin") or ""

    if not email or not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        return utils.fail("邮箱格式不正确 / Invalid email")
    if len(password) < 8:
        return utils.fail("密码至少 8 位 / Password too short")
    if not pin or not pin.isdigit() or len(pin) < 4:
        return utils.fail("PIN 必须为 4 位以上数字 / PIN must be numeric")

    sess = Session()
    try:
        if sess.query(User).filter_by(email=email).first():
            return utils.fail("该邮箱已注册 / Email already registered")
        uid = _gen_user_id(sess)
        u = User(
            id=uid, email=email, name=name or "NovaPay User",
            phone=data.get("phone"), id_number=data.get("id_number"),
            dob=_parse_date(data.get("dob")),
            address=data.get("address"), nationality=data.get("nationality"),
            tax_jurisdiction=data.get("tax_jurisdiction"),
            purpose=data.get("purpose", "Personal"),
            password_hash=crypto.hash_secret(password),
            pin_hash=crypto.hash_secret(pin),
            salt=crypto.os_urandom(16).hex(),
            status="active", created_at=datetime.utcnow(),
            settings={"session_version": 0},
            message_box=[],
        )
        sess.add(u)
        # 自动创建主账户
        acc = Account(
            id=_gen_uuid(), user_id=uid, name="Main Account",
            type="main", currency=(data.get("currency") or "USD"),
            is_active=True, sub_account_fee_paid=False,
        )
        sess.add(acc)
        sess.commit()
        utils.audit("register", target=uid, user_id=uid, status="success")
        token = crypto.encode_jwt({"sub": uid, "svf": 0})
        resp = utils.ok({"user": u.to_dict(), "account": {"id": acc.id, "name": acc.name},
                         "settings": u.settings or {}},
                        "注册成功 / Registered")
        _set_auth_cookie(resp, token)
        return resp
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# 登录
# ---------------------------------------------------------------------------
@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    identifier = (data.get("identifier") or "").strip()
    password = data.get("password") or ""

    sess = Session()
    try:
        u = sess.query(User).filter(
            (User.email == identifier.lower()) | (User.id == identifier)
        ).first()
        if not u:
            return utils.fail("账户不存在 / Account not found", 401)
        # 锁定检查
        now = datetime.utcnow()
        if u.locked_until and u.locked_until > now:
            remain = int((u.locked_until - now).total_seconds() // 60)
            return utils.fail(f"账户已锁定，请 {remain} 分钟后再试 / Locked", 429)

        if not crypto.verify_secret(u.password_hash, password):
            u.fail_count = (u.fail_count or 0) + 1
            max_att = utils.get_config("login_max_attempts", 5)
            if u.fail_count >= max_att:
                dur = utils.get_config("lock_duration_minutes", 15)
                u.locked_until = now + timedelta(minutes=dur)
                u.fail_count = 0
                sess.commit()
                utils.audit("login", target=u.id, user_id=u.id, status="failed")
                return utils.fail(f"密码错误次数过多，已锁定 {dur} 分钟 / Locked", 429)
            sess.commit()
            utils.audit("login", target=u.id, user_id=u.id, status="failed")
            return utils.fail("密码错误 / Wrong password", 401)

        # 成功
        u.fail_count = 0
        u.locked_until = None
        u.last_login_ip = request.remote_addr
        u.last_login_device = request.headers.get("User-Agent", "")[:255]
        svf = (u.settings or {}).get("session_version", 0)
        sess.commit()
        utils.audit("login", target=u.id, user_id=u.id, status="success")
        token = crypto.encode_jwt({"sub": u.id, "svf": svf})
        resp = utils.ok({"user": u.to_dict(),
                         "two_fa_required": u.is_2fa_enabled,
                         "settings": u.settings or {}},
                        "登录成功 / Logged in")
        _set_auth_cookie(resp, token)
        return resp
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# 退出
# ---------------------------------------------------------------------------
@auth_bp.route("/logout", methods=["POST"])
def logout():
    resp = utils.ok(message="已退出 / Logged out")
    resp.delete_cookie("access_token", path="/")
    return resp


@auth_bp.route("/refresh", methods=["POST"])
def refresh():
    u = utils.get_current_user()
    if not u:
        return utils.fail("会话无效 / Invalid session", 401)
    svf = (u.settings or {}).get("session_version", 0)
    token = crypto.encode_jwt({"sub": u.id, "svf": svf})
    resp = utils.ok(message="已刷新 / Refreshed")
    _set_auth_cookie(resp, token)
    return resp


@auth_bp.route("/me", methods=["GET"])
def me():
    u = utils.get_current_user()
    if not u:
        return utils.fail("未登录 / Not authenticated", 401)
    sess = Session()
    try:
        accs = sess.query(Account).filter_by(user_id=u.id).all()
        return utils.ok({
            "user": u.to_dict(),
            "accounts": [{"id": a.id, "name": a.name, "type": a.type, "currency": a.currency} for a in accs],
            "settings": u.settings or {},
        })
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# 2FA (TOTP)
# ---------------------------------------------------------------------------
@auth_bp.route("/2fa/enable", methods=["POST"])
def tfa_enable():
    u = utils.get_current_user()
    if not u:
        return utils.fail("未登录 / Not authenticated", 401)
    import pyotp
    secret = pyotp.random_base32()
    uri = pyotp.totp.TOTP(secret).provisioning_uri(name=u.email, issuer_name="NovaPay")
    sess = Session()
    try:
        u2 = sess.get(User, u.id)
        u2.totp_secret = secret  # 暂存，验证成功后才启用
        sess.commit()
    finally:
        sess.close()
    return utils.ok({"secret": secret, "otpauth": uri}, "请使用验证器扫描并输入验证码确认")


@auth_bp.route("/2fa/verify", methods=["POST"])
def tfa_verify():
    u = utils.get_current_user()
    if not u:
        return utils.fail("未登录 / Not authenticated", 401)
    code = (request.get_json(silent=True) or {}).get("code", "")
    sess = Session()
    try:
        u2 = sess.get(User, u.id)
        import pyotp
        if not u2.totp_secret:
            return utils.fail("请先启用 2FA / Enable 2FA first")
        totp = pyotp.totp.TOTP(u2.totp_secret)
        if not totp.verify(code, valid_window=1):
            return utils.fail("验证码错误 / Wrong code", 400)
        u2.is_2fa_enabled = True
        sess.commit()
        utils.audit("2fa_enable", target=u.id, user_id=u.id, status="success")
        return utils.ok(message="2FA 已启用 / 2FA enabled")
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# 修改密码 / PIN
# ---------------------------------------------------------------------------
@auth_bp.route("/change-password", methods=["POST"])
def change_password():
    u = utils.get_current_user()
    if not u:
        return utils.fail("未登录 / Not authenticated", 401)
    d = request.get_json(silent=True) or {}
    old = d.get("old_password", "")
    new = d.get("new_password", "")
    if len(new) < 8:
        return utils.fail("新密码至少 8 位 / Too short")
    sess = Session()
    try:
        u2 = sess.get(User, u.id)
        if not crypto.verify_secret(u2.password_hash, old):
            return utils.fail("原密码错误 / Wrong old password", 400)
        u2.password_hash = crypto.hash_secret(new)
        sess.commit()
        utils.audit("change_password", target=u.id, user_id=u.id, status="success")
        return utils.ok(message="密码已修改 / Password updated")
    finally:
        sess.close()


@auth_bp.route("/change-pin", methods=["POST"])
def change_pin():
    u = utils.get_current_user()
    if not u:
        return utils.fail("未登录 / Not authenticated", 401)
    d = request.get_json(silent=True) or {}
    old = d.get("old_pin", "")
    new = d.get("new_pin", "")
    if not new.isdigit() or len(new) < 4:
        return utils.fail("新 PIN 必须为 4 位以上数字")
    sess = Session()
    try:
        u2 = sess.get(User, u.id)
        if not crypto.verify_secret(u2.pin_hash, old):
            return utils.fail("原 PIN 错误 / Wrong old PIN", 400)
        u2.pin_hash = crypto.hash_secret(new)
        sess.commit()
        utils.audit("change_pin", target=u.id, user_id=u.id, status="success")
        return utils.ok(message="PIN 已修改 / PIN updated")
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# 设备管理 / 单点登出
# ---------------------------------------------------------------------------
@auth_bp.route("/devices", methods=["GET"])
def devices():
    u = utils.get_current_user()
    if not u:
        return utils.fail("未登录 / Not authenticated", 401)
    return utils.ok({
        "current_device": u.last_login_device,
        "current_ip": u.last_login_ip,
        "last_login": _iso(u.last_login_ip),
    })


@auth_bp.route("/session", methods=["DELETE"])
def logout_all():
    u = utils.get_current_user()
    if not u:
        return utils.fail("未登录 / Not authenticated", 401)
    sess = Session()
    try:
        u2 = sess.get(User, u.id)
        s = u2.settings or {}
        s["session_version"] = s.get("session_version", 0) + 1
        u2.settings = s
        sess.commit()
        utils.audit("logout_all", target=u.id, user_id=u.id, status="success")
        return utils.ok(message="已登出所有设备 / All devices signed out")
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# 消息箱
# ---------------------------------------------------------------------------
@auth_bp.route("/messages", methods=["GET"])
def messages():
    u = utils.get_current_user()
    if not u:
        return utils.fail("未登录 / Not authenticated", 401)
    sess = Session()
    try:
        u2 = sess.get(User, u.id)
        return utils.ok({"messages": u2.message_box or []})
    finally:
        sess.close()


@auth_bp.route("/messages/<int:mid>/read", methods=["PUT"])
def mark_read(mid):
    u = utils.get_current_user()
    if not u:
        return utils.fail("未登录 / Not authenticated", 401)
    sess = Session()
    try:
        u2 = sess.get(User, u.id)
        box = u2.message_box or []
        if 0 <= mid < len(box):
            box[mid]["read"] = True
            u2.message_box = box
            sess.commit()
        return utils.ok(message="ok")
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# 辅助
# ---------------------------------------------------------------------------
def _parse_date(s):
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except Exception:
        return None


def _iso(v):
    return v.isoformat() if v else None


def _gen_uuid():
    import uuid
    return str(uuid.uuid4())
