"""NovaPay V6.0 — 礼品卡系统（4.7）"""
import random
import string
from datetime import datetime, timezone

from flask import Blueprint, request

from app.db import Session
from app import utils
from app.models import GiftCard, Card, Account, Transaction, User
from app.utils import generate_gift_code
from app.routes.cards import _own_card

giftcards_bp = Blueprint("giftcards", __name__, url_prefix="/api/giftcards")


@giftcards_bp.route("/buy", methods=["POST"])
@utils.require_user
def buy():
    u = utils.get_current_user()
    d = request.get_json(silent=True) or {}
    amount = float(d.get("amount", 0))
    if amount <= 0:
        return utils.fail("面值必须大于 0 / Amount > 0")
    fee_rate = float(utils.get_config("gift_card_fee_rate", 0.10))
    fee = round(amount * fee_rate, 2)
    total = amount + fee
    sess = Session()
    try:
        main = sess.query(Account).filter_by(user_id=u.id, type="main").first()
        pay = sess.query(Card).filter_by(account_id=main.id, type="debit",
                                        status="active").first() if main else None
        if not pay or pay.balance < total:
            return utils.fail(f"余额不足（含 {fee_rate*100:.0f}% 手续费 ${fee:.2f}）/ Insufficient", 400)
        pay.balance -= total
        gc = GiftCard(code=generate_gift_code(), amount=amount, status="active",
                     owner_user_id=u.id, created_at=datetime.utcnow())
        sess.add(gc)
        tx = Transaction(id=_tx_id(), user_id=u.id, account_id=pay.account_id,
                        from_card_id=pay.id, type="giftcard_buy", amount=total,
                        balance_after=pay.balance, status="completed",
                        created_at=datetime.utcnow(),
                        ip_address=request.remote_addr,
                        user_agent=request.headers.get("User-Agent", ""))
        sess.add(tx)
        sess.commit()
        utils.audit("giftcard_buy", target=gc.code, user_id=u.id, status="success")
        return utils.ok({"code": gc.code, "amount": amount, "fee": fee}, "礼品卡已购买 / Purchased")
    finally:
        sess.close()


@giftcards_bp.route("/redeem", methods=["POST"])
@utils.require_user
def redeem():
    u = utils.get_current_user()
    d = request.get_json(silent=True) or {}
    code = (d.get("code") or "").strip().upper()
    card_id = d.get("card_id")
    sess = Session()
    try:
        gc = sess.query(GiftCard).filter_by(code=code).first()
        if not gc:
            return utils.fail("礼品卡不存在 / Not found", 404)
        if gc.status != "active":
            return utils.fail("礼品卡已使用 / Already used", 400)
        c = _own_card(sess, u.id, card_id)
        if not c or c.type != "debit":
            return utils.fail("收款借记卡无效 / Invalid card", 404)
        c.balance += gc.amount
        gc.status = "used"
        gc.redeemed_by_user_id = u.id
        gc.redeemed_at = datetime.utcnow()
        tx = Transaction(id=_tx_id(), user_id=u.id, account_id=c.account_id,
                        to_card_id=c.id, type="giftcard_redeem", amount=gc.amount,
                        balance_after=c.balance, status="completed",
                        created_at=datetime.utcnow(),
                        ip_address=request.remote_addr,
                        user_agent=request.headers.get("User-Agent", ""))
        sess.add(tx)
        sess.commit()
        utils.audit("giftcard_redeem", target=code, user_id=u.id, status="success")
        return utils.ok({"balance": round(c.balance, 2)}, "兑换成功 / Redeemed")
    finally:
        sess.close()


@giftcards_bp.route("/my", methods=["GET"])
@utils.require_user
def my():
    u = utils.get_current_user()
    sess = Session()
    try:
        gcs = sess.query(GiftCard).filter_by(owner_user_id=u.id).all()
        out = [{"code": g.code, "amount": g.amount, "status": g.status,
                "created_at": g.created_at.isoformat() if g.created_at else None}
               for g in gcs]
        return utils.ok({"giftcards": out})
    finally:
        sess.close()


@giftcards_bp.route("/verify", methods=["POST"])
def verify():
    code = (request.get_json(silent=True) or {}).get("code", "").strip().upper()
    sess = Session()
    try:
        gc = sess.query(GiftCard).filter_by(code=code).first()
        if not gc:
            return utils.ok({"valid": False, "reason": "not_found"})
        return utils.ok({"valid": gc.status == "active",
                        "amount": gc.amount if gc.status == "active" else 0,
                        "status": gc.status})
    finally:
        sess.close()


def _tx_id():
    ts = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    return "TX" + ts + "".join(random.choice(string.ascii_uppercase + string.digits) for _ in range(6))
