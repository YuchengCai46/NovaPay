"""NovaPay V6.0 — Admin 后台（5 / 4.9）"""
import json
import os
from datetime import datetime, timezone, timedelta

from flask import Blueprint, request, jsonify, current_app, send_file

from app.db import Session, Base
from app import utils, crypto
from app.models import (User, Account, Card, Transaction, Subscription, GiftCard,
                        BoundCard, AuditLog, SystemConfig, Suggestion, EscrowPool,
                        AccountCancellation)
from config import ADMIN_USERNAME, ADMIN_PASSWORD_HASH
from app.routes.cards import _serialize_card

admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")


# ---------------------------------------------------------------------------
# Admin 登录
# ---------------------------------------------------------------------------
@admin_bp.route("/login", methods=["POST"])
def login():
    d = request.get_json(silent=True) or {}
    username = (d.get("username") or "").strip()
    password = d.get("password") or ""
    if not ADMIN_PASSWORD_HASH:
        return utils.fail("Admin 密码未配置（请设置环境变量 ADMIN_PASSWORD_HASH）/ Admin not configured", 500)
    if username != ADMIN_USERNAME or not crypto.verify_secret(ADMIN_PASSWORD_HASH, password):
        utils.audit("admin_login", target=username, status="failed")
        return utils.fail("Admin 账号或密码错误 / Invalid admin credentials", 401)
    token = crypto.encode_jwt({"sub": ADMIN_USERNAME, "role": "admin"})
    secure = os.environ.get("SECURE_COOKIE", "false").lower() == "true"
    resp = utils.ok(message="Admin 登录成功 / Logged in")
    resp.set_cookie("admin_token", token, httponly=True, samesite="Strict", secure=secure, max_age=3600, path="/")
    utils.audit("admin_login", target=username, status="success")
    return resp


@admin_bp.route("/logout", methods=["POST"])
def logout():
    resp = utils.ok(message="已退出 Admin / Logged out")
    resp.delete_cookie("admin_token", path="/")
    return resp


# ---------------------------------------------------------------------------
# 仪表盘
# ---------------------------------------------------------------------------
@admin_bp.route("/dashboard", methods=["GET"])
@utils.require_admin
def dashboard():
    sess = Session()
    try:
        now = datetime.utcnow()
        today = now.date()
        total_users = sess.query(User).count()
        active_users = sess.query(User).filter_by(status="active").count()
        banned = sess.query(User).filter(User.status.in_(["suspended", "blacklisted", "closed"])).count()
        total_cards = sess.query(Card).count()
        frozen_cards = sess.query(Card).filter_by(status="frozen").count()
        today_tx = sess.query(Transaction).filter(Transaction.created_at >= today).all()
        month_tx = sess.query(Transaction).filter(Transaction.created_at >= now.replace(day=1)).all()
        all_tx = sess.query(Transaction).all()
        pending_sug = sess.query(Suggestion).filter_by(status="pending").count()
        subs_rev = sum(s.amount for s in sess.query(Subscription).filter_by(status="active").all())
        gift_rev = sum(g.amount * 0.10 for g in sess.query(GiftCard).filter_by(status="used").all())
        recent_logs = sess.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(10).all()
        return utils.ok({
            "total_users": total_users, "active_users": active_users, "banned_users": banned,
            "total_cards": total_cards, "frozen_cards": frozen_cards,
            "tx_today": round(sum(t.amount for t in today_tx), 2),
            "tx_month": round(sum(t.amount for t in month_tx), 2),
            "tx_total": round(sum(t.amount for t in all_tx), 2),
            "pending_suggestions": pending_sug,
            "subscription_revenue": round(subs_rev, 2),
            "giftcard_revenue": round(gift_rev, 2),
            "recent_logs": [{"action": l.action, "target": l.target, "status": l.status,
                            "created_at": l.created_at.isoformat() if l.created_at else None}
                           for l in recent_logs],
        })
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# 用户管理
# ---------------------------------------------------------------------------
@admin_bp.route("/users", methods=["GET"])
@utils.require_admin
def users():
    sess = Session()
    try:
        us = sess.query(User).order_by(User.created_at.desc()).all()
        return utils.ok({"users": [u.to_dict(public=False) for u in us]})
    finally:
        sess.close()


@admin_bp.route("/users/search", methods=["GET"])
@utils.require_admin
def search_users():
    q = (request.args.get("q") or "").strip()
    sess = Session()
    try:
        if not q:
            return utils.ok({"users": []})
        us = sess.query(User).filter(
            (User.id.like(f"%{q}%")) | (User.email.like(f"%{q}%")) |
            (User.name.like(f"%{q}%")) | (User.id_number.like(f"%{q}%"))
        ).all()
        return utils.ok({"users": [u.to_dict(public=True) for u in us]})
    finally:
        sess.close()


@admin_bp.route("/users/<uid>", methods=["GET"])
@utils.require_admin
def user_detail(uid):
    sess = Session()
    try:
        u = sess.get(User, uid)
        if not u:
            return utils.fail("用户不存在 / Not found", 404)
        accounts = sess.query(Account).filter_by(user_id=uid).all()
        acc_out = []
        for a in accounts:
            cards = sess.query(Card).filter_by(account_id=a.id).all()
            acc_out.append({
                "id": a.id, "name": a.name, "type": a.type, "currency": a.currency,
                "cards": [_serialize_card(c) for c in cards],
            })
        subs = sess.query(Subscription).filter_by(user_id=uid).all()
        bound = sess.query(BoundCard).filter_by(user_id=uid).all()
        txs = sess.query(Transaction).filter_by(user_id=uid).order_by(Transaction.created_at.desc()).limit(50).all()
        return utils.ok({
            "user": u.to_dict(public=False),
            "accounts": acc_out,
            "subscriptions": [{"id": s.id, "brand": s.brand, "status": s.status} for s in subs],
            "bound_cards": [{"masked": b.masked, "expiry": b.expiry, "is_active": b.is_active} for b in bound],
            "transactions": [{"id": t.id, "type": t.type, "amount": round(t.amount, 2),
                            "status": t.status, "created_at": t.created_at.isoformat() if t.created_at else None}
                           for t in txs],
        })
    finally:
        sess.close()


@admin_bp.route("/users/<uid>/ban", methods=["POST"])
@utils.require_admin
def ban_user(uid):
    return _set_user_status(uid, "suspended", "ban")


@admin_bp.route("/users/<uid>/unban", methods=["POST"])
@utils.require_admin
def unban_user(uid):
    return _set_user_status(uid, "active", "unban")


@admin_bp.route("/users/<uid>/blacklist", methods=["POST"])
@utils.require_admin
def blacklist(uid):
    sess = Session()
    try:
        u = sess.get(User, uid)
        if not u:
            return utils.fail("用户不存在 / Not found", 404)
        u.credit_blacklist = True
        sess.commit()
        utils.audit("admin_mark_blacklist", target=uid, status="success")
        return utils.ok(message="已标记信用黑名单 / Blacklisted")
    finally:
        sess.close()


@admin_bp.route("/users/<uid>/unblacklist", methods=["POST"])
@utils.require_admin
def unblacklist(uid):
    sess = Session()
    try:
        u = sess.get(User, uid)
        if not u:
            return utils.fail("用户不存在 / Not found", 404)
        u.credit_blacklist = False
        sess.commit()
        utils.audit("admin_unmark_blacklist", target=uid, status="success")
        return utils.ok(message="已移除信用黑名单 / Blacklist removed")
    finally:
        sess.close()


@admin_bp.route("/users/<uid>/reset-password", methods=["POST"])
@utils.require_admin
def reset_password(uid):
    new_pw = (request.get_json(silent=True) or {}).get("new_password", "")
    if len(new_pw) < 8:
        return utils.fail("新密码至少 8 位 / Too short")
    sess = Session()
    try:
        u = sess.get(User, uid)
        if not u:
            return utils.fail("用户不存在 / Not found", 404)
        u.password_hash = crypto.hash_secret(new_pw)
        sess.commit()
        utils.audit("admin_reset_password", target=uid, status="success")
        return utils.ok(message="密码已重置 / Password reset")
    finally:
        sess.close()


@admin_bp.route("/users/<uid>", methods=["DELETE"])
@utils.require_admin
def delete_user(uid):
    confirm = (request.get_json(silent=True) or {}).get("confirm", False)
    if not confirm:
        return utils.fail("需二次确认 / Confirmation required", 400)
    sess = Session()
    try:
        u = sess.get(User, uid)
        if not u:
            return utils.fail("用户不存在 / Not found", 404)
        # 物理删除所有关联数据
        for m in (Account, Card, Transaction, Subscription, BoundCard, Suggestion,
                  EscrowPool, AccountCancellation):
            if m is Account:
                ids = [a.id for a in sess.query(Account).filter_by(user_id=uid).all()]
                for aid in ids:
                    sess.query(Card).filter_by(account_id=aid).delete()
                sess.query(Account).filter_by(user_id=uid).delete()
            else:
                sess.query(m).filter_by(user_id=uid).delete()
        sess.query(User).filter_by(id=uid).delete()
        sess.commit()
        utils.audit("admin_delete_user", target=uid, status="success")
        return utils.ok(message="用户已删除 / User deleted")
    finally:
        sess.close()


def _set_user_status(uid, status, action):
    sess = Session()
    try:
        u = sess.get(User, uid)
        if not u:
            return utils.fail("用户不存在 / Not found", 404)
        u.status = status
        sess.commit()
        utils.audit(f"admin_{action}_user", target=uid, status="success")
        return utils.ok(message="OK")
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# 卡片管理（全局）
# ---------------------------------------------------------------------------
@admin_bp.route("/cards", methods=["GET"])
@utils.require_admin
def cards():
    ctype = request.args.get("type")
    status = request.args.get("status")
    sess = Session()
    try:
        q = sess.query(Card)
        if ctype:
            q = q.filter_by(type=ctype)
        if status:
            q = q.filter_by(status=status)
        cards = q.order_by(Card.issued_at.desc()).all()
        return utils.ok({"cards": [_serialize_card(c) for c in cards]})
    finally:
        sess.close()


@admin_bp.route("/cards/<int:card_id>/freeze", methods=["POST"])
@utils.require_admin
def freeze_card(card_id):
    return _admin_card_action(card_id, "frozen", "freeze")


@admin_bp.route("/cards/<int:card_id>/unfreeze", methods=["POST"])
@utils.require_admin
def unfreeze_card(card_id):
    return _admin_card_action(card_id, "active", "unfreeze")


@admin_bp.route("/cards/<int:card_id>/cancel", methods=["POST"])
@utils.require_admin
def cancel_card(card_id):
    return _admin_card_action(card_id, "canceled", "cancel")


@admin_bp.route("/cards/<int:card_id>/restore", methods=["POST"])
@utils.require_admin
def restore_card(card_id):
    """Admin 恢复已注销的卡片（软恢复，数据保留）。"""
    return _admin_card_action(card_id, "active", "restore")


@admin_bp.route("/cards/<int:card_id>", methods=["DELETE"])
@utils.require_admin
def delete_card(card_id):
    sess = Session()
    try:
        c = sess.get(Card, card_id)
        if not c:
            return utils.fail("卡片不存在 / Not found", 404)
        # 物理删除关联数据
        sess.query(Transaction).filter_by(card_id=card_id).delete()
        sess.delete(c)
        sess.commit()
        utils.audit("admin_delete_card", target=str(card_id), status="success")
        return utils.ok(message="卡片已删除 / Card deleted")
    finally:
        sess.close()


def _admin_card_action(card_id, status, action):
    sess = Session()
    try:
        c = sess.get(Card, card_id)
        if not c:
            return utils.fail("卡片不存在 / Not found", 404)
        c.status = status
        sess.commit()
        utils.audit(f"admin_{action}_card", target=str(card_id), status="success")
        return utils.ok(_serialize_card(c), "OK")
    finally:
        sess.close()


@admin_bp.route("/cards/<int:card_id>/adjust-balance", methods=["POST"])
@utils.require_admin
def adjust_balance(card_id):
    d = request.get_json(silent=True) or {}
    delta = float(d.get("delta", 0))
    sess = Session()
    try:
        c = sess.get(Card, card_id)
        if not c:
            return utils.fail("卡片不存在 / Not found", 404)
        if c.type == "debit":
            c.balance = round(c.balance + delta, 2)
        elif c.type == "credit":
            c.credit_used = max(0.0, round(c.credit_used + delta, 2))
        sess.commit()
        utils.audit("admin_adjust_balance", target=str(card_id),
                    details={"delta": delta}, status="success")
        return utils.ok(_serialize_card(c), "余额已调整 / Adjusted")
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# 交易管理（全局）
# ---------------------------------------------------------------------------
@admin_bp.route("/transactions", methods=["GET"])
@utils.require_admin
def transactions():
    ttype = request.args.get("type")
    status = request.args.get("status")
    sess = Session()
    try:
        q = sess.query(Transaction)
        if ttype:
            q = q.filter_by(type=ttype)
        if status:
            q = q.filter_by(status=status)
        txs = q.order_by(Transaction.created_at.desc()).limit(200).all()
        return utils.ok({"transactions": [{
            "id": t.id, "user_id": t.user_id, "type": t.type, "amount": round(t.amount, 2),
            "fee": round(t.fee, 2), "status": t.status, "is_suspicious": t.is_suspicious,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "ip_address": t.ip_address,
        } for t in txs]})
    finally:
        sess.close()


@admin_bp.route("/transactions/<tx_id>", methods=["GET"])
@utils.require_admin
def tx_detail(tx_id):
    sess = Session()
    try:
        t = sess.get(Transaction, tx_id)
        if not t:
            return utils.fail("交易不存在 / Not found", 404)
        return utils.ok({
            "id": t.id, "user_id": t.user_id, "type": t.type, "amount": round(t.amount, 2),
            "fee": round(t.fee, 2), "balance_after": round(t.balance_after, 2),
            "note": t.note, "category": t.category, "status": t.status,
            "is_suspicious": t.is_suspicious,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "ip_address": t.ip_address, "user_agent": t.user_agent,
        })
    finally:
        sess.close()


@admin_bp.route("/transactions/<tx_id>/flag", methods=["POST"])
@utils.require_admin
def flag_tx(tx_id):
    sess = Session()
    try:
        t = sess.get(Transaction, tx_id)
        if not t:
            return utils.fail("交易不存在 / Not found", 404)
        t.is_suspicious = not t.is_suspicious
        sess.commit()
        utils.audit("admin_flag_transaction", target=tx_id, status="success")
        return utils.ok({"is_suspicious": t.is_suspicious}, "OK")
    finally:
        sess.close()


@admin_bp.route("/transactions/<tx_id>/reverse", methods=["POST"])
@utils.require_admin
def reverse_tx(tx_id):
    # 仅限 24 小时内交易
    confirm = (request.get_json(silent=True) or {}).get("confirm", False)
    if not confirm:
        return utils.fail("需二次确认 / Confirmation required", 400)
    sess = Session()
    try:
        t = sess.get(Transaction, tx_id)
        if not t:
            return utils.fail("交易不存在 / Not found", 404)
        if t.created_at and (datetime.utcnow() - t.created_at) > timedelta(hours=24):
            return utils.fail("仅支持 24 小时内交易撤销 / Only within 24h", 400)
        if t.status == "reversed":
            return utils.fail("已撤销 / Already reversed", 400)
        t.status = "reversed"
        sess.commit()
        utils.audit("admin_reverse_transaction", target=tx_id, status="success")
        return utils.ok(message="交易已撤销 / Reversed")
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# 系统配置
# ---------------------------------------------------------------------------
@admin_bp.route("/config", methods=["GET"])
@utils.require_admin
def get_config():
    return utils.ok({"config": utils.all_configs()})


@admin_bp.route("/meta/geo-block", methods=["GET"])
def meta_geo_block():
    """公开端点：仅返回地理封锁开关状态（供前端在登录前决定是否拦截）。"""
    return utils.ok({"enabled": bool(utils.get_config("geo_block_enabled", False))})


@admin_bp.route("/config", methods=["PUT"])
@utils.require_admin
def put_config():
    d = request.get_json(silent=True) or {}
    sess = Session()
    try:
        for key, value in d.items():
            row = sess.query(SystemConfig).filter_by(key=key).first()
            if row:
                row.value = value
                row.updated_at = datetime.utcnow()
                row.updated_by = utils.get_current_admin()
            else:
                sess.add(SystemConfig(key=key, value=value, updated_by=utils.get_current_admin()))
        sess.commit()
        utils.audit("admin_update_config", target=",".join(d.keys()), status="success")
        return utils.ok(message="配置已更新 / Updated")
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# 审计日志
# ---------------------------------------------------------------------------
@admin_bp.route("/audit-logs", methods=["GET"])
@utils.require_admin
def audit_logs():
    user_id = request.args.get("user_id")
    action = request.args.get("action")
    sess = Session()
    try:
        q = sess.query(AuditLog)
        if user_id:
            q = q.filter_by(user_id=user_id)
        if action:
            q = q.filter_by(action=action)
        logs = q.order_by(AuditLog.created_at.desc()).limit(500).all()
        return utils.ok({"logs": [{
            "id": l.id, "user_id": l.user_id, "action": l.action, "target": l.target,
            "status": l.status, "ip_address": l.ip_address,
            "created_at": l.created_at.isoformat() if l.created_at else None,
            "details": l.details,
        } for l in logs]})
    finally:
        sess.close()


@admin_bp.route("/audit-logs/export", methods=["GET"])
@utils.require_admin
def export_logs():
    fmt = request.args.get("format", "json")
    sess = Session()
    try:
        logs = sess.query(AuditLog).order_by(AuditLog.created_at.desc()).all()
        data = [{"action": l.action, "target": l.target, "status": l.status,
                "created_at": l.created_at.isoformat() if l.created_at else None,
                "details": l.details} for l in logs]
        if fmt == "csv":
            import csv, io
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(["action", "target", "status", "created_at"])
            for r in data:
                w.writerow([r["action"], r["target"], r["status"], r["created_at"]])
            return current_app.response_class(buf.getvalue(), mimetype="text/csv",
                                             headers={"Content-Disposition": "attachment; filename=audit_logs.csv"})
        return utils.ok({"logs": data})
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# 数据管理（备份 / 恢复 / 清空）
# ---------------------------------------------------------------------------
@admin_bp.route("/data/export", methods=["GET"])
@utils.require_admin
def data_export():
    """导出完整数据库为加密 JSON（AES-256-GCM）。"""
    sess = Session()
    try:
        dump = {}
        # 逐表导出（通用方式）
        for table in Base.metadata.tables.values():
            rows = sess.execute(table.select()).mappings().all()
            dump[table.name] = [dict(r) for r in rows]
        raw = json.dumps(dump, default=str)
        enc = crypto.aes_encrypt(raw)
        out_path = os.path.join(current_app.root_path, "..", "backup_encrypted.json")
        out_path = os.path.abspath(out_path)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(enc)
        return utils.ok({"file": out_path, "encrypted": True,
                        "size": len(enc)}, "备份已生成（加密）/ Backup created")
    finally:
        sess.close()


@admin_bp.route("/data/wipe", methods=["POST"])
@utils.require_admin
def data_wipe():
    confirm = (request.get_json(silent=True) or {}).get("confirm", "")
    if confirm != "CONFIRM_DELETE_ALL":
        return utils.fail("需输入 CONFIRM_DELETE_ALL 二次确认 / Confirmation required", 400)
    sess = Session()
    try:
        for table in reversed(Base.metadata.sorted_tables):
            sess.execute(table.delete())
        sess.commit()
        utils.audit("admin_clear_data", target="ALL", status="success")
        return utils.ok(message="全部数据已清空 / All data wiped")
    finally:
        sess.close()
