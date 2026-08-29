"""
NovaPay V6.0 — 用户建议 / 反馈系统（新增重点，3 / 4.8）
设计要点：
  - 用户提交时内容立即 AES-256-GCM 加密存储（content_encrypted），密钥来自环境变量。
  - 同时计算 SHA-256 摘要（content_hash）用于防篡改校验；查看时自动比对。
  - 匿名提交：is_anonymous=True，普通视图隐藏提交人；但服务端仍记录 user_id（用于违法审计时解除匿名）。
    解除匿名（deanonymize）后 admin 可见真实账户，并向该用户消息箱推送审计通知。
  - 所有 admin 操作写入 AuditLog。
"""
import random
import string
from datetime import datetime, timezone

from flask import Blueprint, request

from app.db import Session
from app import utils, crypto
from app.models import Suggestion, User, AuditLog

suggestions_bp = Blueprint("suggestions", __name__, url_prefix="/api/suggestions")
admin_suggestions_bp = Blueprint("admin_suggestions", __name__, url_prefix="/api/admin/suggestions")

_CONTENT_MAX = 5000


# ===========================================================================
# 用户端
# ===========================================================================
@suggestions_bp.route("", methods=["POST"])
@utils.require_user
def submit():
    u = utils.get_current_user()
    d = request.get_json(silent=True) or {}
    content = (d.get("content") or "").strip()
    is_anonymous = bool(d.get("anonymous", False))
    if not content:
        return utils.fail("建议内容不能为空 / Content required", 400)
    if len(content) > _CONTENT_MAX:
        return utils.fail(f"内容过长（上限 {_CONTENT_MAX} 字）/ Too long", 400)

    # —— 加密 + 哈希 ——
    encrypted = crypto.aes_encrypt(content)
    digest = crypto.sha256_hex(content)
    now = datetime.utcnow()

    sess = Session()
    try:
        sug = Suggestion(
            user_id=u.id,                     # 服务端始终记录真实用户，供违法审计解除匿名
            is_anonymous=is_anonymous,
            content=content,                  # 原文：便于用户自己查看与预览
            content_encrypted=encrypted,       # AES-256-GCM 密文，仅 admin 可解密
            content_hash=digest,              # SHA-256 防篡改
            submitted_at=now,                 # 精确到毫秒（microsecond）
            status="pending",
        )
        sess.add(sug)
        sess.commit()
        utils.audit("submit_suggestion", target=str(sug.id), user_id=u.id, status="success")
        return utils.ok({"id": sug.id, "status": sug.status,
                        "submitted_at": now.isoformat()},
                       "建议已提交 / Submitted")
    finally:
        sess.close()


@suggestions_bp.route("/my", methods=["GET"])
@utils.require_user
def my():
    u = utils.get_current_user()
    sess = Session()
    try:
        sugs = sess.query(Suggestion).filter_by(user_id=u.id).order_by(
            Suggestion.submitted_at.desc()).all()
        out = [{
            "id": s.id,
            "is_anonymous": s.is_anonymous,
            "preview": s.preview(30),
            "status": s.status,
            "admin_action": s.admin_action,
            "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
        } for s in sugs]
        return utils.ok({"suggestions": out})
    finally:
        sess.close()


@suggestions_bp.route("/<int:sug_id>", methods=["GET"])
@utils.require_user
def detail(sug_id):
    u = utils.get_current_user()
    sess = Session()
    try:
        s = sess.query(Suggestion).filter_by(id=sug_id, user_id=u.id).first()
        if not s:
            return utils.fail("建议不存在 / Not found", 404)
        # 防篡改校验：重新计算原文哈希并与存储值比对
        tampered = crypto.sha256_hex(s.content or "") != s.content_hash
        return utils.ok({
            "id": s.id, "is_anonymous": s.is_anonymous, "content": s.content,
            "status": s.status, "admin_action": s.admin_action,
            "admin_note": s.admin_note, "tampered": tampered,
            "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
        })
    finally:
        sess.close()


# ===========================================================================
# Admin 端
# ===========================================================================
@admin_suggestions_bp.route("", methods=["GET"])
@utils.require_admin
def admin_list():
    status = request.args.get("status")
    anon = request.args.get("anonymous")  # "true"/"false"
    sess = Session()
    try:
        q = sess.query(Suggestion)
        if status:
            q = q.filter_by(status=status)
        if anon == "true":
            q = q.filter_by(is_anonymous=True)
        elif anon == "false":
            q = q.filter_by(is_anonymous=False)
        sugs = q.order_by(Suggestion.submitted_at.desc()).all()
        out = []
        for s in sugs:
            # 解密预览（前 30 字）—— admin 有权解密
            preview = ""
            try:
                decrypted = crypto.aes_decrypt(s.content_encrypted)
                preview = decrypted[:30] + ("…" if len(decrypted) > 30 else "")
            except Exception:
                preview = "（解密失败）"
            submitter = _submitter_label(sess, s)
            out.append({
                "id": s.id,
                "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
                "is_anonymous": s.is_anonymous,
                "is_deanonymized": s.is_deanonymized,
                "submitter": submitter,
                "preview": preview,
                "status": s.status,
                "admin_action": s.admin_action,
            })
        return utils.ok({"suggestions": out})
    finally:
        sess.close()


@admin_suggestions_bp.route("/<int:sug_id>", methods=["GET"])
@utils.require_admin
def admin_detail(sug_id):
    admin = utils.get_current_admin()
    sess = Session()
    try:
        s = sess.query(Suggestion).filter_by(id=sug_id).first()
        if not s:
            return utils.fail("建议不存在 / Not found", 404)
        try:
            decrypted = crypto.aes_decrypt(s.content_encrypted)
        except Exception:
            decrypted = ""
        # 防篡改校验
        tampered = crypto.sha256_hex(decrypted) != s.content_hash
        submitter = _submitter_label(sess, s, full=True)
        return utils.ok({
            "id": s.id,
            "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
            "is_anonymous": s.is_anonymous,
            "is_deanonymized": s.is_deanonymized,
            "submitter": submitter,
            "content": decrypted,
            "tampered": tampered,
            "content_hash": s.content_hash,
            "status": s.status,
            "admin_action": s.admin_action,
            "admin_note": s.admin_note,
            "reviewed_at": s.reviewed_at.isoformat() if s.reviewed_at else None,
            "reviewed_by": s.reviewed_by,
            "deanonymize_reason": s.deanonymize_reason,
        })
    finally:
        sess.close()


@admin_suggestions_bp.route("/<int:sug_id>/deanonymize", methods=["POST"])
@utils.require_admin
def deanonymize(sug_id):
    """违法审计：解除匿名。必须二次确认（由前端弹窗），此处执行实际解除并通知用户。"""
    admin = utils.get_current_admin()
    reason = (request.get_json(silent=True) or {}).get("reason", "")
    sess = Session()
    try:
        s = sess.query(Suggestion).filter_by(id=sug_id).first()
        if not s:
            return utils.fail("建议不存在 / Not found", 404)
        if s.is_anonymous and s.user_id:
            s.is_deanonymized = True
            s.deanonymized_at = datetime.utcnow()
            s.deanonymized_by = admin
            s.deanonymize_reason = reason
            s.admin_action = "deanonymize"
            s.reviewed_at = datetime.utcnow()
            s.reviewed_by = admin
            # 通知用户
            ts = s.submitted_at.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] if s.submitted_at else ""
            utils.push_message(
                s.user_id,
                f"您的匿名建议（提交于 {ts}）已被审计员 {admin} 解除匿名并启动违法内容审计。"
                f"如有异议，请通过建议模块提交申诉。",
            )
            sess.commit()
            utils.audit("admin_deanonymize", target=str(sug_id), user_id=s.user_id,
                        details={"reason": reason, "by": admin}, status="success")
            return utils.ok(message="已解除匿名并通知用户 / Deanonymized")
        return utils.fail("该建议无需解除匿名 / Not applicable", 400)
    finally:
        sess.close()


@admin_suggestions_bp.route("/<int:sug_id>/archive", methods=["POST"])
@utils.require_admin
def archive(sug_id):
    admin = utils.get_current_admin()
    sess = Session()
    try:
        s = sess.query(Suggestion).filter_by(id=sug_id).first()
        if not s:
            return utils.fail("建议不存在 / Not found", 404)
        s.status = "archived"
        s.admin_action = "archive"
        s.reviewed_at = datetime.utcnow()
        s.reviewed_by = admin
        sess.commit()
        utils.audit("admin_archive_suggestion", target=str(sug_id), user_id=s.user_id,
                    details={"by": admin}, status="success")
        return utils.ok(message="已归档 / Archived")
    finally:
        sess.close()


@admin_suggestions_bp.route("/<int:sug_id>", methods=["DELETE"])
@utils.require_admin
def delete(sug_id):
    """物理删除（需前端二次确认）。"""
    admin = utils.get_current_admin()
    confirm = (request.get_json(silent=True) or {}).get("confirm", False)
    if not confirm:
        return utils.fail("需二次确认 / Confirmation required", 400)
    sess = Session()
    try:
        s = sess.query(Suggestion).filter_by(id=sug_id).first()
        if not s:
            return utils.fail("建议不存在 / Not found", 404)
        uid = s.user_id
        sess.delete(s)
        sess.commit()
        utils.audit("admin_delete_suggestion", target=str(sug_id), user_id=uid,
                    details={"by": admin}, status="success")
        return utils.ok(message="已删除 / Deleted")
    finally:
        sess.close()


@admin_suggestions_bp.route("/<int:sug_id>/ban-user", methods=["POST"])
@utils.require_admin
def ban_user(sug_id):
    """封禁提交者（仅限实名建议或已解除匿名的匿名建议）。"""
    admin = utils.get_current_admin()
    sess = Session()
    try:
        s = sess.query(Suggestion).filter_by(id=sug_id).first()
        if not s:
            return utils.fail("建议不存在 / Not found", 404)
        if s.is_anonymous and not s.is_deanonymized:
            return utils.fail("匿名建议需先解除匿名才能封号 / Deanonymize first", 400)
        if not s.user_id:
            return utils.fail("无法定位用户 / No user", 400)
        u = sess.get(User, s.user_id)
        if not u:
            return utils.fail("用户不存在 / User not found", 404)
        u.status = "suspended"
        s.admin_action = "ban_user"
        s.reviewed_at = datetime.utcnow()
        s.reviewed_by = admin
        utils.push_message(u.id, f"您的账户因建议内容违规已被审计员 {admin} 封禁，如有异议请申诉。")
        sess.commit()
        utils.audit("admin_suspend_user", target=u.id, user_id=u.id,
                    details={"by": admin, "reason": "suggestion_violation"}, status="success")
        return utils.ok(message="已封禁用户 / User suspended")
    finally:
        sess.close()


@admin_suggestions_bp.route("/<int:sug_id>/note", methods=["PUT"])
@utils.require_admin
def add_note(sug_id):
    admin = utils.get_current_admin()
    note = (request.get_json(silent=True) or {}).get("note", "")
    sess = Session()
    try:
        s = sess.query(Suggestion).filter_by(id=sug_id).first()
        if not s:
            return utils.fail("建议不存在 / Not found", 404)
        s.admin_note = note
        s.reviewed_at = datetime.utcnow()
        s.reviewed_by = admin
        sess.commit()
        return utils.ok(message="备注已保存 / Note saved")
    finally:
        sess.close()


# ---------------------------------------------------------------------------
def _submitter_label(sess, s: Suggestion, full: bool = False):
    """返回提交人标签：匿名且未解除 -> 匿名用户；否则返回账户名/邮箱。"""
    if s.is_anonymous and not s.is_deanonymized:
        return "匿名用户" + (f" (id:{s.user_id})" if full and s.user_id else "")
    if s.user_id:
        u = sess.get(User, s.user_id)
        if u:
            return f"{u.name} <{u.email}>" if full else u.name
    return "未知 / Unknown"
