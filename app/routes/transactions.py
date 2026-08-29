"""NovaPay V6.0 — 交易系统（4.5）"""
import random
import string
from datetime import datetime, timezone

from flask import Blueprint, request

from app.db import Session
from app import utils
from app.models import Transaction, Card, Account, User
from app.routes.cards import _own_card

transactions_bp = Blueprint("transactions", __name__, url_prefix="/api/transactions")


def _tx_id():
    ts = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    return "TX" + ts + "".join(random.choice(string.ascii_uppercase + string.digits) for _ in range(6))


@transactions_bp.route("/topup", methods=["POST"])
@utils.require_user
def topup():
    u = utils.get_current_user()
    d = request.get_json(silent=True) or {}
    card_id = d.get("card_id")
    amount = float(d.get("amount", 0))
    if amount <= 0:
        return utils.fail("充值金额必须大于 0 / Amount > 0")
    sess = Session()
    try:
        c = _own_card(sess, u.id, card_id)
        if not c or c.type != "debit":
            return utils.fail("借记卡无效 / Invalid debit card", 404)
        c.balance += amount
        c.last_used_at = datetime.utcnow()
        tx = Transaction(id=_tx_id(), user_id=u.id, account_id=c.account_id,
                        from_card_id=c.id, type="topup", amount=amount,
                        balance_after=c.balance, status="completed",
                        created_at=datetime.utcnow(),
                        ip_address=request.remote_addr,
                        user_agent=request.headers.get("User-Agent", ""))
        sess.add(tx)
        sess.commit()
        utils.audit("topup", target=tx.id, user_id=u.id, status="success")
        return utils.ok({"balance": round(c.balance, 2), "tx_id": tx.id}, "充值成功 / Topped up")
    finally:
        sess.close()


@transactions_bp.route("/transfer", methods=["POST"])
@utils.require_user
def transfer():
    u = utils.get_current_user()
    d = request.get_json(silent=True) or {}
    from_card_id = d.get("from_card_id")
    to_card_number = (d.get("to_card_number") or "").replace(" ", "")
    amount = float(d.get("amount", 0))
    pin = d.get("pin", "")
    note = d.get("note", "")
    if amount <= 0:
        return utils.fail("转账金额必须大于 0 / Amount > 0")

    sess = Session()
    try:
        src = _own_card(sess, u.id, from_card_id)
        if not src or src.type != "debit":
            return utils.fail("扣款卡无效 / Invalid source card", 404)
        if src.status != "active":
            return utils.fail("扣款卡状态异常 / Card not active", 400)
        # PIN 校验（敏感操作）
        u2 = sess.get(User, u.id)
        if not utils.verify_pin(u2, pin):
            return utils.fail("PIN 错误 / Wrong PIN", 400)
        # 限额
        if amount > src.single_transaction_limit:
            return utils.fail(f"超出单笔限额 ${src.single_transaction_limit:.0f} / Limit exceeded", 400)
        today = datetime.utcnow().date()
        day_sum = sum(t.amount for t in sess.query(Transaction).filter_by(
            user_id=u.id, type="transfer_out", status="completed").all()
            if t.created_at.date() == today)
        global_limit = float(utils.get_config("daily_transfer_limit", 5000))
        day_limit = min(src.daily_limit, global_limit)
        if day_sum + amount > day_limit:
            return utils.fail(f"超出单日转账限额 ${day_limit:.0f} / Daily limit", 400)

        # 体系内转账费率随基础货币变化：CHF 0.3% / USD 0.5%
        base = ((u2.settings or {}).get("base_currency") or "CHF").upper()
        fee_rate = 0.003 if base == "CHF" else 0.005
        fee = round(amount * fee_rate, 2)
        total = amount + fee
        if src.balance < total:
            return utils.fail("余额不足（含手续费）/ Insufficient (incl. fee)", 400)

        dest = sess.query(Card).filter_by(number=to_card_number).first()
        if not dest:
            return utils.fail("收款卡号不存在 / Destination card not found", 404)

        src.balance -= total
        src.last_used_at = datetime.utcnow()
        if dest.type == "debit":
            dest.balance += amount
        elif dest.type == "credit":
            # 转账到信用卡视作还款
            dest.credit_used = max(0.0, dest.credit_used - amount)

        # 可疑检测：单笔 > 5000 或短时多笔
        suspicious = amount > 5000
        tx_out = Transaction(id=_tx_id(), user_id=u.id, account_id=src.account_id,
                            from_card_id=src.id, to_card_id=dest.id, type="transfer_out",
                            amount=amount, fee=fee, balance_after=src.balance,
                            note=note, status="completed",
                            is_suspicious=suspicious,
                            created_at=datetime.utcnow(),
                            ip_address=request.remote_addr,
                            user_agent=request.headers.get("User-Agent", ""),
                            encrypted_note=utils.encrypt_note(note))
        _acc = sess.get(Account, dest.account_id)
        tx_in = Transaction(id=_tx_id(), user_id=_acc.user_id if _acc else None,
                           account_id=dest.account_id, from_card_id=src.id,
                           to_card_id=dest.id, type="transfer_in", amount=amount,
                           balance_after=dest.balance if dest.type == "debit" else dest.credit_used,
                           status="completed", created_at=datetime.utcnow(),
                           ip_address=request.remote_addr,
                           user_agent=request.headers.get("User-Agent", ""))
        sess.add_all([tx_out, tx_in])
        if suspicious:
            utils.push_message(u.id, f"【安全提醒】检测到一笔大额转账 ${amount:.2f}，如非本人操作请尽快冻结卡片。")
        sess.commit()
        utils.audit("transfer", target=tx_out.id, user_id=u.id, status="success")
        return utils.ok({"tx_id": tx_out.id, "fee": fee, "balance": round(src.balance, 2)},
                        "转账成功 / Transferred")
    finally:
        sess.close()


@transactions_bp.route("/history", methods=["GET"])
@utils.require_user
def history():
    u = utils.get_current_user()
    page = int(request.args.get("page", 1))
    per = int(request.args.get("per_page", 20))
    ttype = request.args.get("type")
    status = request.args.get("status")
    sess = Session()
    try:
        q = sess.query(Transaction).filter_by(user_id=u.id)
        if ttype:
            q = q.filter_by(type=ttype)
        if status:
            q = q.filter_by(status=status)
        q = q.order_by(Transaction.created_at.desc())
        total = q.count()
        items = q.limit(per).offset((page - 1) * per).all()
        out = [{
            "id": t.id, "type": t.type, "amount": round(t.amount, 2), "fee": round(t.fee, 2),
            "status": t.status, "is_suspicious": t.is_suspicious,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "category": t.category,
        } for t in items]
        return utils.ok({"transactions": out, "page": page, "per_page": per, "total": total})
    finally:
        sess.close()


@transactions_bp.route("/<tx_id>", methods=["GET"])
@utils.require_user
def detail(tx_id):
    u = utils.get_current_user()
    sess = Session()
    try:
        t = sess.query(Transaction).filter_by(id=tx_id, user_id=u.id).first()
        if not t:
            return utils.fail("交易不存在 / Not found", 404)
        return utils.ok({
            "id": t.id, "type": t.type, "amount": round(t.amount, 2), "fee": round(t.fee, 2),
            "balance_after": round(t.balance_after, 2), "note": t.note,
            "category": t.category, "status": t.status, "is_suspicious": t.is_suspicious,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "ip_address": t.ip_address, "user_agent": t.user_agent,
        })
    finally:
        sess.close()


@transactions_bp.route("/<tx_id>/category", methods=["PUT"])
@utils.require_user
def set_category(tx_id):
    u = utils.get_current_user()
    cat = (request.get_json(silent=True) or {}).get("category", "")
    sess = Session()
    try:
        t = sess.query(Transaction).filter_by(id=tx_id, user_id=u.id).first()
        if not t:
            return utils.fail("交易不存在 / Not found", 404)
        t.category = cat
        sess.commit()
        return utils.ok(message="分类已更新 / Category updated")
    finally:
        sess.close()


@transactions_bp.route("/schedule", methods=["POST"])
@utils.require_user
def schedule():
    """设置每月自动转账（存储于用户 settings，由定时任务执行）。"""
    u = utils.get_current_user()
    d = request.get_json(silent=True) or {}
    sess = Session()
    try:
        u2 = sess.get(User, u.id)
        s = u2.settings or {}
        schedules = s.get("schedules", [])
        schedules.append({
            "from_card_id": d.get("from_card_id"),
            "to_card_number": d.get("to_card_number"),
            "amount": float(d.get("amount", 0)),
            "day_of_month": int(d.get("day_of_month", 1)),
            "created_at": datetime.utcnow().isoformat(),
        })
        s["schedules"] = schedules
        u2.settings = s
        sess.commit()
        return utils.ok(message="自动转账已设置 / Scheduled")
    finally:
        sess.close()
