"""
NovaPay V6.0 — 销户申请系统（7 / 用户侧 + Admin侧）
用户提交销户申请（AES-256-GCM 加密原因）→ Admin 后台审核/处理/归档。
状态：pending → approved / rejected / cancelled（用户撤销）
"""
from datetime import datetime

from flask import Blueprint, request

from app.db import Session
from app import utils, crypto
from app.models import AccountCancellation, User, AuditLog

cancellation_bp = Blueprint("cancellations", __name__, url_prefix="/api/cancellations")
admin_cancellation_bp = Blueprint("admin_cancellations", __name__, url_prefix="/api/admin/cancellations")

_REASON_MAX = 2000


# ===========================================================================
# 用户端
# ===========================================================================
@cancellation_bp.route("", methods=["POST"])
@utils.require_user
def submit():
    u = utils.get_current_user()
    d = request.get_json(silent=True) or {}
    reason = (d.get("reason") or "").strip()
    if not reason:
        return utils.fail("销户原因不能为空 / Reason required", 400)
    if len(reason) > _REASON_MAX:
        return utils.fail(f"原因过长（上限 {_REASON_MAX} 字）/ Too long", 400)

    encrypted = crypto.aes_encrypt(reason)
    digest = crypto.sha256_hex(reason)
    now = datetime.utcnow()

    sess = Session()
    try:
        # 用户只能有一个 pending 状态的申请
        existing = sess.query(AccountCancellation).filter_by(
            user_id=u.id, status="pending"
        ).first()
        if existing:
            return utils.fail("已有待处理销户申请 / Existing pending request", 409)

        req = AccountCancellation(
            user_id=u.id,
            reason=reason,
            reason_encrypted=encrypted,
            reason_hash=digest,
            submitted_at=now,
            status="pending",
        )
        sess.add(req)
        sess.commit()
        utils.audit("submit_cancellation", target=str(req.id), user_id=u.id, status="success")
        return utils.ok({"id": req.id, "status": req.status,
                         "submitted_at": now.isoformat()},
                        "销户申请已提交 / Submitted")
    finally:
        sess.close()


@cancellation_bp.route("/my", methods=["GET"])
@utils.require_user
def my():
    u = utils.get_current_user()
    sess = Session()
    try:
        reqs = sess.query(AccountCancellation).filter_by(user_id=u.id).order_by(
            AccountCancellation.submitted_at.desc()).all()
        out = [{
            "id": r.id,
            "reason_preview": (r.reason or "")[:40] + ("…" if (r.reason or "") else ""),
            "status": r.status,
            "admin_action": r.admin_action,
            "admin_note": r.admin_note,
            "submitted_at": r.submitted_at.isoformat() if r.submitted_at else None,
            "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
        } for r in reqs]
        return utils.ok({"requests": out})
    finally:
        sess.close()


@cancellation_bp.route("/<int:req_id>", methods=["GET"])
@utils.require_user
def detail(req_id):
    u = utils.get_current_user()
    sess = Session()
    try:
        r = sess.query(AccountCancellation).filter_by(id=req_id, user_id=u.id).first()
        if not r:
            return utils.fail("申请不存在 / Not found", 404)
        tampered = crypto.sha256_hex(r.reason or "") != r.reason_hash
        return utils.ok({
            "id": r.id,
            "reason": r.reason,
            "status": r.status,
            "admin_action": r.admin_action,
            "admin_note": r.admin_note,
            "tampered": tampered,
            "submitted_at": r.submitted_at.isoformat() if r.submitted_at else None,
            "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
        })
    finally:
        sess.close()


@cancellation_bp.route("/<int:req_id>/cancel", methods=["POST"])
@utils.require_user
def cancel_request(req_id):
    """用户撤销自己的 pending 申请。"""
    u = utils.get_current_user()
    sess = Session()
    try:
        r = sess.query(AccountCancellation).filter_by(id=req_id, user_id=u.id).first()
        if not r:
            return utils.fail("申请不存在 / Not found", 404)
        if r.status != "pending":
            return utils.fail("只有待处理申请可撤销 / Only pending requests can be cancelled", 400)
        r.status = "cancelled"
        r.admin_action = "cancelled_by_user"
        sess.commit()
        utils.audit("cancel_cancellation_request", target=str(req_id), user_id=u.id, status="success")
        return utils.ok(message="已撤销销户申请 / Request cancelled")
    finally:
        sess.close()


# ===========================================================================
# Admin 端
# ===========================================================================
@admin_cancellation_bp.route("", methods=["GET"])
@utils.require_admin
def admin_list():
    status = request.args.get("status")
    sess = Session()
    try:
        q = sess.query(AccountCancellation)
        if status:
            q = q.filter_by(status=status)
        reqs = q.order_by(AccountCancellation.submitted_at.desc()).all()
        out = []
        for r in reqs:
            try:
                decrypted = crypto.aes_decrypt(r.reason_encrypted)
                preview = decrypted[:30] + ("…" if len(decrypted) > 30 else "")
            except Exception:
                preview = "（解密失败）"
            submitter = "未知"
            if r.user_id:
                user = sess.get(User, r.user_id)
                if user:
                    submitter = f"{user.name} <{user.email}>"
            out.append({
                "id": r.id,
                "submitted_at": r.submitted_at.isoformat() if r.submitted_at else None,
                "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
                "user_id": r.user_id,
                "submitter": submitter,
                "preview": preview,
                "status": r.status,
                "admin_action": r.admin_action,
                "admin_note": r.admin_note,
            })
        return utils.ok({"requests": out})
    finally:
        sess.close()


@admin_cancellation_bp.route("/<int:req_id>", methods=["GET"])
@utils.require_admin
def admin_detail(req_id):
    admin = utils.get_current_admin()
    sess = Session()
    try:
        r = sess.query(AccountCancellation).filter_by(id=req_id).first()
        if not r:
            return utils.fail("申请不存在 / Not found", 404)
        try:
            decrypted = crypto.aes_decrypt(r.reason_encrypted)
        except Exception:
            decrypted = ""
        tampered = crypto.sha256_hex(decrypted) != r.reason_hash
        user = None
        if r.user_id:
            user = sess.get(User, r.user_id)
        return utils.ok({
            "id": r.id,
            "submitted_at": r.submitted_at.isoformat() if r.submitted_at else None,
            "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
            "user_id": r.user_id,
            "user_name": user.name if user else None,
            "user_email": user.email if user else None,
            "user_status": user.status if user else None,
            "reason": decrypted,
            "tampered": tampered,
            "reason_hash": r.reason_hash,
            "status": r.status,
            "admin_action": r.admin_action,
            "admin_note": r.admin_note,
        })
    finally:
        sess.close()


@admin_cancellation_bp.route("/<int:req_id>/approve", methods=["POST"])
@utils.require_admin
def approve(req_id):
    """通过销户申请：关闭用户账户，将余额转入暂存池，冻结所有卡片。"""
    admin = utils.get_current_admin()
    sess = Session()
    try:
        r = sess.query(AccountCancellation).filter_by(id=req_id).first()
        if not r:
            return utils.fail("申请不存在 / Not found", 404)
        if r.status != "pending":
            return utils.fail(f"申请状态不允许处理 / Status: {r.status}", 400)

        from app.models import Account, Card, EscrowPool

        user = sess.get(User, r.user_id)
        if not user:
            return utils.fail("用户不存在 / User not found", 404)

        # 将每张卡片的借记卡余额转入暂存池
        if user.settings:
            base_currency = (user.settings.get("base_currency") or "CHF").upper()
        else:
            base_currency = "CHF"

        accounts = sess.query(Account).filter_by(user_id=r.user_id).all()
        for acc in accounts:
            cards = sess.query(Card).filter_by(account_id=acc.id, type="debit", status="active").all()
            for card in cards:
                if card.balance > 0:
                    pool = sess.query(EscrowPool).filter_by(user_id=r.user_id, currency=base_currency).first()
                    if pool is None:
                        pool = EscrowPool(user_id=r.user_id, currency=base_currency, balance=0.0)
                        sess.add(pool)
                    pool.balance += card.balance
                    card.balance = 0.0
                    card.status = "canceled"

        # 冻结用户账户
        user.status = "closed"
        # 归档申请
        r.status = "approved"
        r.admin_action = "approved"
        r.admin_note = (r.admin_note or "") + (" [Approved by " + admin + "]" if r.admin_note else "[Approved by " + admin + "]")
        r.reviewed_at = datetime.utcnow()
        r.reviewed_by = admin

        sess.commit()
        utils.push_message(
            r.user_id,
            f"您的销户申请（提交于 {r.submitted_at.strftime('%Y-%m-%d %H:%M:%S') if r.submitted_at else '未知'}）已通过。账户已关闭，卡内余额已转入暂存池。",
        )
        utils.audit("admin_approve_cancellation", target=str(req_id), user_id=r.user_id,
                    details={"by": admin}, status="success")
        return utils.ok(message="销户申请已通过，账户已关闭 / Account closed")
    finally:
        sess.close()


@admin_cancellation_bp.route("/<int:req_id>/reject", methods=["POST"])
@utils.require_admin
def reject(req_id):
    """拒绝销户申请。"""
    admin = utils.get_current_admin()
    note = (request.get_json(silent=True) or {}).get("note", "")
    sess = Session()
    try:
        r = sess.query(AccountCancellation).filter_by(id=req_id).first()
        if not r:
            return utils.fail("申请不存在 / Not found", 404)
        if r.status != "pending":
            return utils.fail(f"申请状态不允许处理 / Status: {r.status}", 400)
        r.status = "rejected"
        r.admin_action = "rejected"
        r.admin_note = note
        r.reviewed_at = datetime.utcnow()
        r.reviewed_by = admin
        sess.commit()
        utils.push_message(
            r.user_id,
            f"您的销户申请（提交于 {r.submitted_at.strftime('%Y-%m-%d %H:%M:%S') if r.submitted_at else '未知'}）已被拒绝。",
        )
        utils.audit("admin_reject_cancellation", target=str(req_id), user_id=r.user_id,
                    details={"by": admin, "note": note}, status="success")
        return utils.ok(message="销户申请已拒绝 / Request rejected")
    finally:
        sess.close()


@admin_cancellation_bp.route("/<int:req_id>/note", methods=["PUT"])
@utils.require_admin
def add_note(req_id):
    admin = utils.get_current_admin()
    note = (request.get_json(silent=True) or {}).get("note", "")
    sess = Session()
    try:
        r = sess.query(AccountCancellation).filter_by(id=req_id).first()
        if not r:
            return utils.fail("申请不存在 / Not found", 404)
        r.admin_note = note
        r.reviewed_at = datetime.utcnow()
        r.reviewed_by = admin
        sess.commit()
        return utils.ok(message="备注已保存 / Note saved")
    finally:
        sess.close()
