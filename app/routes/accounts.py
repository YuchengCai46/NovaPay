"""NovaPay V6.0 — 账户管理模块（4.2）"""
import uuid
from datetime import datetime, timezone

from flask import Blueprint, request

from app.db import Session
from app import utils, crypto, forex
from app.models import Account, Card, User, Transaction

accounts_bp = Blueprint("accounts", __name__, url_prefix="/api/accounts")


@accounts_bp.route("", methods=["GET"])
@utils.require_user
def list_accounts():
    u = utils.get_current_user()
    sess = Session()
    try:
        accs = sess.query(Account).filter_by(user_id=u.id).all()
        out = []
        for a in accs:
            cards = sess.query(Card).filter_by(account_id=a.id).all()
            out.append({
                "id": a.id, "name": a.name, "type": a.type,
                "currency": a.currency, "is_active": a.is_active,
                "alias": a.alias, "created_at": _iso(a.created_at),
                "cards": [{"id": c.id, "number_masked": c.masked_number(),
                           "type": c.type, "level": c.level, "status": c.status}
                          for c in cards],
            })
        return utils.ok({"accounts": out, "current": (u.settings or {}).get("current_account_id")})
    finally:
        sess.close()


@accounts_bp.route("/switch", methods=["POST"])
@utils.require_user
def switch_account():
    u = utils.get_current_user()
    acc_id = (request.get_json(silent=True) or {}).get("account_id")
    sess = Session()
    try:
        a = sess.query(Account).filter_by(id=acc_id, user_id=u.id).first()
        if not a:
            return utils.fail("账户不存在 / Account not found", 404)
        u2 = sess.get(User, u.id)
        s = u2.settings or {}
        s["current_account_id"] = acc_id
        u2.settings = s
        sess.commit()
        return utils.ok({"account_id": acc_id}, "已切换账户 / Switched")
    finally:
        sess.close()


@accounts_bp.route("/sub", methods=["POST"])
@utils.require_user
def create_sub():
    u = utils.get_current_user()
    fee = utils.get_config("sub_account_fee", 300)
    sess = Session()
    try:
        # 查找主账户的一张可用借记卡支付费用
        main = sess.query(Account).filter_by(user_id=u.id, type="main").first()
        if not main:
            return utils.fail("未找到主账户 / No main account")
        pay_card = sess.query(Card).filter_by(account_id=main.id, type="debit",
                                             status="active").first()
        if not pay_card or pay_card.balance < fee:
            return utils.fail(f"主账户借记卡余额不足（需 ${fee:.2f}）/ Insufficient balance", 400)
        pay_card.balance -= fee
        acc = Account(
            id=str(uuid.uuid4()), user_id=u.id, name="Sub Account",
            type="sub", currency=main.currency, is_active=True,
            sub_account_fee_paid=True,
        )
        sess.add(acc)
        sess.flush()
        # 免费借记卡
        from app.routes.cards import _issue_card
        card = _issue_card(sess, acc.id, "debit", "NovaPay", "Standard", pay_card=False)
        # 手续费交易记录
        tx = Transaction(
            id=_tx_id(), user_id=u.id, account_id=main.id,
            from_card_id=pay_card.id, type="sub_account_fee",
            amount=fee, fee=0.0, balance_after=pay_card.balance,
            status="completed", created_at=datetime.utcnow(),
            ip_address=request.remote_addr, user_agent=request.headers.get("User-Agent", ""),
        )
        sess.add(tx)
        sess.commit()
        utils.audit("create_sub_account", target=acc.id, user_id=u.id, status="success")
        return utils.ok({"account": {"id": acc.id}, "card": {"id": card.id}},
                        "子账户已创建 / Sub account created")
    finally:
        sess.close()


@accounts_bp.route("/<acc_id>/alias", methods=["PUT"])
@utils.require_user
def set_alias(acc_id):
    u = utils.get_current_user()
    alias = (request.get_json(silent=True) or {}).get("alias", "")
    sess = Session()
    try:
        a = sess.query(Account).filter_by(id=acc_id, user_id=u.id).first()
        if not a:
            return utils.fail("账户不存在 / Account not found", 404)
        a.alias = alias
        sess.commit()
        return utils.ok(message="别名已更新 / Alias updated")
    finally:
        sess.close()


@accounts_bp.route("/balances", methods=["GET"])
@utils.require_user
def balances():
    u = utils.get_current_user()
    sess = Session()
    try:
        accs = sess.query(Account).filter_by(user_id=u.id).all()
        total = 0.0
        out = []
        for a in accs:
            cards = sess.query(Card).filter_by(account_id=a.id).all()
            bal = sum(c.balance for c in cards if c.type == "debit")
            credit = sum(c.credit_used for c in cards if c.type == "credit")
            total += bal
            out.append({"id": a.id, "name": a.name, "debit_balance": round(bal, 2),
                        "credit_used": round(credit, 2), "currency": a.currency})
        return utils.ok({"accounts": out, "total_debit_balance": round(total, 2)})
    finally:
        sess.close()


@accounts_bp.route("/settings", methods=["GET"])
@utils.require_user
def get_settings():
    u = utils.get_current_user()
    return utils.ok({"settings": u.settings or {}})


@accounts_bp.route("/settings", methods=["PUT"])
@utils.require_user
def put_settings():
    u = utils.get_current_user()
    d = request.get_json(silent=True) or {}
    sess = Session()
    try:
        u2 = sess.get(User, u.id)
        s = dict(u2.settings or {})
        converted = False
        if "base_currency" in d and d["base_currency"] in ("CHF", "USD"):
            old_base = (u2.settings or {}).get("base_currency") or "CHF"
            new_base = d["base_currency"]
            if new_base != old_base:
                try:
                    rate = forex.convert(1.0, old_base.lower(), new_base.lower())
                except Exception:
                    rate = 1.0
                # 切换计价单位：将所有卡片余额（借记余额 / 信用已用）按实时汇率重计价
                acc_ids = [a.id for a in sess.query(Account).filter_by(user_id=u.id).all()]
                if acc_ids:
                    for c in sess.query(Card).filter(Card.account_id.in_(acc_ids)).all():
                        if c.type == "debit" and c.balance:
                            c.balance = round(c.balance * rate, 2)
                        elif c.type == "credit" and c.credit_used:
                            c.credit_used = round(c.credit_used * rate, 2)
                converted = True
            s["base_currency"] = new_base
        u2.settings = s
        sess.commit()
        return utils.ok({"settings": s, "balance_converted": converted}, "设置已保存 / Saved")
    finally:
        sess.close()


# ---------------------------------------------------------------------------
def _iso(v):
    return v.isoformat() if v else None


def _tx_id():
    import random, string
    ts = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    return "TX" + ts + "".join(random.choice(string.ascii_uppercase + string.digits) for _ in range(6))
