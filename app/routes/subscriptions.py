"""NovaPay V6.0 — 订阅服务（4.6）"""
import random
import string
import uuid
from datetime import datetime, timezone, timedelta

from flask import Blueprint, request

from app.db import Session
from app import utils
from app.models import Subscription, BoundCard, Card, Account, Transaction, User
from app.utils import mask_card

subscriptions_bp = Blueprint("subscriptions", __name__, url_prefix="/api/subscriptions")

# 模拟订阅品牌目录
SERVICE_CATALOG = [
    {"brand": "Netflix", "plan_id": "nf_std", "plan_name": "Standard", "cycle": "Monthly", "amount": 15.99},
    {"brand": "Spotify", "plan_id": "sp_prem", "plan_name": "Premium", "cycle": "Monthly", "amount": 9.99},
    {"brand": "Adobe", "plan_id": "ad_cc", "plan_name": "Creative Cloud", "cycle": "Yearly", "amount": 599.88},
    {"brand": "ChatGPT", "plan_id": "cg_plus", "plan_name": "Plus", "cycle": "Monthly", "amount": 20.00},
    {"brand": "iCloud", "plan_id": "ic_200", "plan_name": "200GB", "cycle": "Monthly", "amount": 2.99},
]


@subscriptions_bp.route("/services", methods=["GET"])
@utils.require_user
def services():
    return utils.ok({"services": SERVICE_CATALOG})


@subscriptions_bp.route("/bind-card", methods=["POST"])
@utils.require_user
def bind_card():
    u = utils.get_current_user()
    d = request.get_json(silent=True) or {}
    number = (d.get("card_number") or "").replace(" ", "")
    expiry = d.get("expiry", "")
    if len(number) < 13 or not utils.luhn_valid(number):
        return utils.fail("卡号无效 / Invalid card number", 400)
    sess = Session()
    try:
        bc = BoundCard(user_id=u.id, card_number=number, masked=mask_card(number),
                      expiry=expiry, is_active=True)
        sess.add(bc)
        sess.commit()
        utils.audit("bind_card", target=mask_card(number), user_id=u.id, status="success")
        return utils.ok({"masked": bc.masked}, "绑定成功 / Card bound")
    finally:
        sess.close()


@subscriptions_bp.route("/unbind-card", methods=["DELETE"])
@utils.require_user
def unbind_card():
    u = utils.get_current_user()
    d = request.get_json(silent=True) or {}
    masked = d.get("masked")
    sess = Session()
    try:
        q = sess.query(BoundCard).filter_by(user_id=u.id, is_active=True)
        if masked:
            q = q.filter_by(masked=masked)
        cards = q.all()
        for c in cards:
            c.is_active = False
            # 解绑关联的订阅
            for sub in sess.query(Subscription).filter_by(user_id=u.id,
                                                         bound_card_number=c.card_number,
                                                         status="active").all():
                sub.status = "canceled"
        sess.commit()
        return utils.ok(message="已解绑 / Unbound")
    finally:
        sess.close()


@subscriptions_bp.route("/subscribe", methods=["POST"])
@utils.require_user
def subscribe():
    u = utils.get_current_user()
    d = request.get_json(silent=True) or {}
    plan_id = d.get("plan_id")
    bound_card_number = d.get("bound_card_number", "")  # 使用绑定的卡
    service = next((s for s in SERVICE_CATALOG if s["plan_id"] == plan_id), None)
    if not service:
        return utils.fail("订阅计划不存在 / Plan not found", 404)
    sess = Session()
    try:
        # 优先使用绑定的卡，否则从主账户借记卡扣款
        pay = None
        if bound_card_number:
            pay = sess.query(Card).filter_by(number=bound_card_number, status="active").first()
        if not pay:
            main = sess.query(Account).filter_by(user_id=u.id, type="main").first()
            pay = sess.query(Card).filter_by(account_id=main.id if main else None, type="debit",
                                            status="active").first() if main else None
        if not pay:
            return utils.fail("没有可用卡片支付 / No active card for payment", 400)
        if pay.balance < service["amount"]:
            return utils.fail("余额不足支付订阅 / Insufficient balance", 400)
        pay.balance -= service["amount"]
        now = datetime.utcnow()
        sub = Subscription(
            id="SUB" + now.strftime("%Y%m%d%H%M%S") + uuid.uuid4().hex[:4],
            user_id=u.id, brand=service["brand"], plan_id=service["plan_id"],
            plan_name=service["plan_name"], cycle=service["cycle"],
            amount=service["amount"], bound_card_number=pay.number,
            start_date=now,
            next_billing_date=now + timedelta(days=30 if service["cycle"] == "Monthly" else 365),
            status="active", auto_renew=True,
        )
        sess.add(sub)
        sess.flush()
        tx = Transaction(id=_tx_id(), user_id=u.id, account_id=pay.account_id,
                        from_card_id=pay.id, type="subscription", amount=service["amount"],
                        balance_after=pay.balance, status="completed",
                        created_at=now, ip_address=request.remote_addr,
                        user_agent=request.headers.get("User-Agent", ""))
        sess.add(tx)
        sess.commit()
        utils.audit("subscribe", target=sub.id, user_id=u.id, status="success")
        return utils.ok({"subscription": _ser(sub)}, "订阅成功 / Subscribed")
    finally:
        sess.close()


@subscriptions_bp.route("/my-bound-cards", methods=["GET"])
@utils.require_user
def my_bound_cards():
    u = utils.get_current_user()
    sess = Session()
    try:
        cards = sess.query(BoundCard).filter_by(user_id=u.id, is_active=True).all()
        return utils.ok({"cards": [{"id": c.id, "masked": c.masked, "expiry": c.expiry, "last4": c.card_number[-4:]} for c in cards]})
    finally:
        sess.close()


@subscriptions_bp.route("/my", methods=["GET"])
@utils.require_user
def my():
    u = utils.get_current_user()
    sess = Session()
    try:
        subs = sess.query(Subscription).filter_by(user_id=u.id).all()
        return utils.ok({"subscriptions": [_ser(s) for s in subs]})
    finally:
        sess.close()


@subscriptions_bp.route("/<sub_id>", methods=["DELETE"])
@utils.require_user
def cancel(sub_id):
    u = utils.get_current_user()
    sess = Session()
    try:
        s = sess.query(Subscription).filter_by(id=sub_id, user_id=u.id).first()
        if not s:
            return utils.fail("订阅不存在 / Not found", 404)
        s.status = "canceled"
        s.auto_renew = False
        sess.commit()
        utils.audit("cancel_subscription", target=sub_id, user_id=u.id, status="success")
        return utils.ok(message="已取消自动续费 / Canceled")
    finally:
        sess.close()


def _ser(s):
    return {
        "id": s.id, "brand": s.brand, "plan_name": s.plan_name, "cycle": s.cycle,
        "amount": round(s.amount, 2), "next_billing_date": s.next_billing_date.isoformat()
        if s.next_billing_date else None, "status": s.status, "auto_renew": s.auto_renew,
    }


def _tx_id():
    ts = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    return "TX" + ts + "".join(random.choice(string.ascii_uppercase + string.digits) for _ in range(6))
