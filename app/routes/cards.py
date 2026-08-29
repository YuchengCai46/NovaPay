"""NovaPay V6.0 — 卡片管理 + 信用卡风控引擎（4.3 / 4.4）"""
import random
from datetime import datetime, timezone, timedelta

from flask import Blueprint, request

from app.db import Session
from app import utils, crypto
from app.models import Card, Account, Transaction, User
from app.utils import generate_card_number, mask_card
from config import CARD_LEVELS, CARD_LEVELS_FLAT

cards_bp = Blueprint("cards", __name__, url_prefix="/api/cards")


# ---------------------------------------------------------------------------
# 发卡内部 helper（供 accounts / 订阅等调用）
# ---------------------------------------------------------------------------
def _issue_card(sess, account_id, ctype, network, level, pay_card=True, base="USD"):
    """创建一张卡片对象并写库，返回 Card。pay_card=True 时从同账户借记卡扣除发卡费。
    base: 用户基础货币（CHF/USD）。借记卡统一 300 USD，CHF ≈ USD×0.8167（固定，不随汇率）。
    信用卡费按 network+level 查找，回退到平铺 CARD_LEVELS_FLAT。"""
    # 优先按网络+等级查找
    network_levels = CARD_LEVELS.get(network, {})
    level_conf = network_levels.get(level, None)
    # 回退到平铺格式
    if level_conf is None:
        level_conf = CARD_LEVELS_FLAT.get(level, CARD_LEVELS_FLAT["Standard"])
    usd_fee = level_conf["debit_fee"] if ctype == "debit" else level_conf["credit_fee"]
    fee = round(usd_fee * 0.8167) if str(base).upper() == "CHF" else usd_fee
    # 首张卡免费（借记卡或信用卡均适用）
    existing_card = sess.query(Card).filter_by(account_id=account_id, status="active").first()
    if not existing_card:
        fee = 0
    if pay_card and fee > 0:
        payer = sess.query(Card).filter_by(account_id=account_id, type="debit",
                                          status="active").first()
        if not payer or payer.balance < fee:
            raise ValueError(f"借记卡余额不足，无法支付发卡费 ${fee:.2f}")
        payer.balance -= fee
    number = generate_card_number(16, network=network)
    cvv = "".join(random.choice("0123456789") for _ in range(3))  # 3-digit CVV
    now = datetime.utcnow()
    # 借记卡永久有效，Eternal+ 信用卡也永久有效
    if level in ("Eternal+",) or ctype == "debit":
        expiry = "00/00"
        due = None
    elif level in ("Eternal",):
        expiry = "ETERNAL"
        due = None
    else:
        exp_year = now.year + 5
        expiry = f"{now.month:02d}/{str(exp_year)[-2:]}"
        due = now.date() + timedelta(days=30)
    card = Card(
        number=number, account_id=account_id, type=ctype,
        network=network, level=level, expiry=expiry,
        cvv_hash=crypto.hash_secret(cvv),
        cvv_encrypted=crypto.aes_encrypt(cvv),
        status="active",
        balance=0.0 if ctype == "debit" else 0.0,
        credit_limit=level_conf["credit_limit"] if ctype == "credit" else 0.0,
        credit_used=0.0 if ctype == "credit" else 0.0,
        credit_due_date=due if ctype == "credit" else None,
        daily_limit=10000.0, single_transaction_limit=5000.0,
        issued_at=now,
    )
    sess.add(card)
    sess.flush()
    return card


def _serialize_card(c):
    return {
        "id": c.id, "number_masked": c.masked_number(), "type": c.type,
        "network": c.network, "level": c.level, "expiry": c.expiry,
        "status": c.status, "theme": c.theme,
        "balance": round(c.balance, 2) if c.type == "debit" else None,
        "credit_limit": round(c.credit_limit, 2) if c.type == "credit" else None,
        "credit_used": round(c.credit_used, 2) if c.type == "credit" else None,
        "credit_due_date": c.credit_due_date.isoformat() if c.credit_due_date else None,
        "daily_limit": c.daily_limit, "single_transaction_limit": c.single_transaction_limit,
        "is_virtual": c.is_virtual, "issued_at": _iso(c.issued_at),
    }


# ---------------------------------------------------------------------------
# 列表 / 发卡
# ---------------------------------------------------------------------------
@cards_bp.route("", methods=["GET"])
@utils.require_user
def list_cards():
    u = utils.get_current_user()
    sess = Session()
    try:
        cards = (sess.query(Card).join(Account).filter(Account.user_id == u.id).all())
        return utils.ok({"cards": [_serialize_card(c) for c in cards]})
    finally:
        sess.close()


@cards_bp.route("/issue", methods=["POST"])
@utils.require_user
def issue():
    u = utils.get_current_user()
    d = request.get_json(silent=True) or {}
    ctype = d.get("type", "debit")
    level = d.get("level", "Standard")
    network = d.get("network", "NovaPay")
    base = ((u.settings or {}).get("base_currency") or "CHF").upper()
    if ctype not in ("debit", "credit"):
        return utils.fail("卡片类型无效 / Invalid type")
    if level not in CARD_LEVELS_FLAT:
        return utils.fail("卡片等级无效 / Invalid level")
    sess = Session()
    try:
        acc = sess.query(Account).filter_by(user_id=u.id, type="main").first()
        if not acc:
            return utils.fail("未找到主账户 / No main account")
        try:
            card = _issue_card(sess, acc.id, ctype, network, level, pay_card=True, base=base)
        except ValueError as e:
            sess.rollback()
            return utils.fail(str(e), 400)
        sess.commit()
        utils.audit("issue_card", target=str(card.id), user_id=u.id, status="success")
        return utils.ok(_serialize_card(card), "卡片已发行 / Card issued")
    finally:
        sess.close()


@cards_bp.route("/freeze", methods=["POST"])
@utils.require_user
def freeze():
    return _set_status("frozen", "卡片已冻结 / Frozen")


@cards_bp.route("/unfreeze", methods=["POST"])
@utils.require_user
def unfreeze():
    u = utils.get_current_user()
    card_id = (request.get_json(silent=True) or {}).get("card_id")
    fee = utils.get_config("unfreeze_fee", 100)
    sess = Session()
    try:
        c = _own_card(sess, u.id, card_id)
        if not c:
            return utils.fail("卡片不存在 / Card not found", 404)
        if c.status != "frozen":
            return utils.fail("卡片未处于冻结状态 / Not frozen")
        payer = sess.query(Card).filter_by(account_id=c.account_id, type="debit",
                                          status="active").first()
        # If no other active card, use the frozen card's own balance
        if not payer:
            payer = c
        if not payer or payer.balance < fee:
            return utils.fail(f"余额不足支付解冻费 ${fee:.2f}", 400)
        payer.balance -= fee
        c.status = "active"
        sess.commit()
        utils.audit("unfreeze", target=str(c.id), user_id=u.id, status="success")
        return utils.ok(_serialize_card(c), "卡片已解冻 / Unfrozen")
    finally:
        sess.close()


@cards_bp.route("/renew", methods=["POST"])
@utils.require_user
def renew():
    u = utils.get_current_user()
    card_id = (request.get_json(silent=True) or {}).get("card_id")
    fee = utils.get_config("renew_fee", 50)
    sess = Session()
    try:
        c = _own_card(sess, u.id, card_id)
        if not c:
            return utils.fail("卡片不存在 / Card not found", 404)
        if c.expiry == "ETERNAL":
            return utils.fail("该卡为永久卡，无需续期 / Eternal card")
        payer = sess.query(Card).filter_by(account_id=c.account_id, type="debit",
                                          status="active").first()
        # If no other active card, use the current card's own balance
        if not payer:
            payer = c
        if not payer or payer.balance < fee:
            return utils.fail(f"余额不足支付续期费 ${fee:.2f}", 400)
        payer.balance -= fee
        # 续期 5 年
        now = datetime.utcnow()
        c.expiry = f"{now.month:02d}/{str(now.year + 5)[-2:]}"
        if c.status in ("expired_grace", "expired_permanent", "credit_frozen"):
            c.status = "active"
        sess.commit()
        utils.audit("renew_card", target=str(c.id), user_id=u.id, status="success")
        return utils.ok(_serialize_card(c), "卡片已续期 / Renewed")
    finally:
        sess.close()


@cards_bp.route("/cancel", methods=["POST"])
@cards_bp.route("/<int:card_id>/cancel", methods=["POST"])
@utils.require_user
def cancel(card_id=None):
    u = utils.get_current_user()
    d = request.get_json(silent=True) or {}
    if card_id is None:
        card_id = d.get("card_id")
    target_id = d.get("target_card_id")
    sess = Session()
    try:
        c = _own_card(sess, u.id, card_id)
        if not c:
            return utils.fail("卡片不存在 / Card not found", 404)
        if c.type == "credit" and c.credit_used > 0:
            return utils.fail("信用卡尚有欠款，无法注销 / Outstanding credit", 400)
        # 余额转移
        if c.type == "debit" and c.balance > 0:
            tgt = sess.get(Card, target_id) if target_id else None
            if tgt and tgt.account_id == c.account_id and tgt.type == "debit":
                tgt.balance += c.balance
            else:
                # 无有效目标卡，余额转入暂存池
                from app.models import EscrowPool
                base = ((u.settings or {}).get("base_currency") or "CHF").upper()
                pool = sess.query(EscrowPool).filter_by(user_id=u.id, currency=base).first()
                if pool is None:
                    pool = EscrowPool(user_id=u.id, currency=base, balance=0.0)
                    sess.add(pool)
                pool.balance += c.balance
                pool.updated_at = datetime.utcnow()
                from app.routes.escrow import _tx_id
                tx = Transaction(
                    id=_tx_id(), user_id=u.id, account_id=c.account_id,
                    type="escrow_deposit", amount=round(c.balance, 2), fee=0.0,
                    balance_after=round(pool.balance, 2), status="completed",
                    note=f"注销卡[{c.id}]余额转入暂存池[{base}]",
                    category="escrow", created_at=datetime.utcnow(),
                    ip_address=request.remote_addr, user_agent=request.headers.get("User-Agent", ""),
                )
                sess.add(tx)
                utils.audit("cancel_card_to_escrow", target=str(c.id), user_id=u.id, status="success")
        c.status = "canceled"
        sess.commit()
        utils.audit("cancel_card", target=str(c.id), user_id=u.id, status="success")
        return utils.ok(message="卡片已注销 / Canceled")
    finally:
        sess.close()


@cards_bp.route("/replace", methods=["POST"])
@utils.require_user
def replace():
    """挂失补办：旧卡冻结，生成新卡号迁移余额。"""
    u = utils.get_current_user()
    card_id = (request.get_json(silent=True) or {}).get("card_id")
    sess = Session()
    try:
        old = _own_card(sess, u.id, card_id)
        if not old:
            return utils.fail("卡片不存在 / Card not found", 404)
        old.status = "frozen"
        new_card = _issue_card(sess, old.account_id, old.type, old.network, old.level, pay_card=False)
        new_card.balance = old.balance
        new_card.credit_used = old.credit_used
        new_card.parent_card_id = old.id
        old.balance = 0.0
        sess.commit()
        utils.audit("replace_card", target=str(old.id), user_id=u.id, status="success")
        return utils.ok(_serialize_card(new_card), "已补办新卡 / Replaced")
    finally:
        sess.close()


@cards_bp.route("/virtual", methods=["POST"])
@utils.require_user
def virtual():
    """生成一次性虚拟卡（借记）。"""
    u = utils.get_current_user()
    sess = Session()
    try:
        acc = sess.query(Account).filter_by(user_id=u.id, type="main").first()
        if not acc:
            return utils.fail("未找到主账户 / No main account")
        card = _issue_card(sess, acc.id, "debit", "NovaPay", "Standard", pay_card=False)
        card.is_virtual = True
        card.single_transaction_limit = 500.0
        card.daily_limit = 1000.0
        sess.commit()
        utils.audit("issue_virtual_card", target=str(card.id), user_id=u.id, status="success")
        return utils.ok(_serialize_card(card), "虚拟卡已生成 / Virtual card created")
    finally:
        sess.close()


@cards_bp.route("/<int:card_id>/theme", methods=["PUT"])
@utils.require_user
def theme(card_id):
    u = utils.get_current_user()
    theme = (request.get_json(silent=True) or {}).get("theme", "default")
    sess = Session()
    try:
        c = _own_card(sess, u.id, card_id)
        if not c:
            return utils.fail("卡片不存在 / Card not found", 404)
        c.theme = theme
        sess.commit()
        return utils.ok(message="主题已更新 / Theme updated")
    finally:
        sess.close()


@cards_bp.route("/<int:card_id>/reveal", methods=["POST"])
@utils.require_user
def reveal(card_id):
    """验 PIN 后临时返回完整卡号与 CVV（仅本会话展示用）。正常列表永远只返回掩码号。"""
    u = utils.get_current_user()
    pin = (request.get_json(silent=True) or {}).get("pin", "")
    sess = Session()
    try:
        c = _own_card(sess, u.id, card_id)
        if not c:
            return utils.fail("卡片不存在 / Card not found", 404)
        if not utils.verify_pin(u, pin):
            return utils.fail("PIN 错误 / Wrong PIN", 401)
        cvv = crypto.aes_decrypt(c.cvv_encrypted) if c.cvv_encrypted else ""
        utils.audit("reveal_card", target=str(c.id), user_id=u.id, status="success")
        return utils.ok({"number": c.number, "cvv": cvv}, "已展示，30 秒后自动隐藏 / Revealed")
    finally:
        sess.close()


@cards_bp.route("/<int:card_id>/limits", methods=["PUT"])
@utils.require_user
def limits(card_id):
    u = utils.get_current_user()
    d = request.get_json(silent=True) or {}
    sess = Session()
    try:
        c = _own_card(sess, u.id, card_id)
        if not c:
            return utils.fail("卡片不存在 / Card not found", 404)
        if "single_transaction_limit" in d:
            c.single_transaction_limit = float(d["single_transaction_limit"])
        if "daily_limit" in d:
            c.daily_limit = float(d["daily_limit"])
        sess.commit()
        return utils.ok(_serialize_card(c), "限额已更新 / Limits updated")
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# 信用卡风控引擎（4.4）
# ---------------------------------------------------------------------------
@cards_bp.route("/credit/repay", methods=["POST"])
@utils.require_user
def credit_repay():
    u = utils.get_current_user()
    d = request.get_json(silent=True) or {}
    credit_card_id = d.get("credit_card_id")
    source_card_id = d.get("source_card_id")
    amount = float(d.get("amount", 0))
    if amount <= 0:
        return utils.fail("还款金额必须大于 0 / Amount > 0")
    sess = Session()
    try:
        credit = _own_card(sess, u.id, credit_card_id)
        if not credit or credit.type != "credit":
            return utils.fail("信用卡无效 / Invalid credit card", 404)
        src = sess.get(Card, source_card_id)
        if not src or src.account_id != credit.account_id or src.type != "debit":
            return utils.fail("扣款卡无效 / Invalid source card", 400)
        if src.balance < amount:
            return utils.fail("借记卡余额不足 / Insufficient", 400)
        pay = min(amount, credit.credit_used)
        src.balance -= pay
        credit.credit_used -= pay
        # 还清后恢复
        if credit.credit_used <= 0.001:
            credit.credit_used = 0.0
            if credit.status in ("credit_frozen", "expired_grace"):
                credit.status = "active"
                u2 = sess.get(User, u.id)
                u2.credit_blacklist = False
                u2.status = "active" if u2.status == "suspended" else u2.status
        tx = Transaction(id=_tx_id(), user_id=u.id, account_id=credit.account_id,
                        from_card_id=src.id, to_card_id=credit.id, type="repayment",
                        amount=pay, status="completed",
                        balance_after=src.balance,
                        created_at=datetime.utcnow(),
                        ip_address=request.remote_addr,
                        user_agent=request.headers.get("User-Agent", ""))
        sess.add(tx)
        sess.commit()
        utils.audit("credit_repay", target=str(credit.id), user_id=u.id, status="success")
        return utils.ok(_serialize_card(credit), "还款成功 / Repaid")
    finally:
        sess.close()


@cards_bp.route("/credit/status", methods=["GET"])
@utils.require_user
def credit_status():
    u = utils.get_current_user()
    sess = Session()
    try:
        cards = (sess.query(Card).join(Account).filter(
            Account.user_id == u.id, Card.type == "credit").all())
        return utils.ok({"cards": [_serialize_card(c) for c in cards]})
    finally:
        sess.close()


@cards_bp.route("/credit/remind", methods=["POST"])
@utils.require_user
def credit_remind():
    """到期前 7 天提醒：向用户消息箱推送通知。"""
    u = utils.get_current_user()
    sess = Session()
    try:
        cards = sess.query(Card).join(Account).filter(
            Account.user_id == u.id, Card.type == "credit").all()
        now = datetime.utcnow().date()
        sent = 0
        for c in cards:
            if c.credit_due_date and 0 <= (c.credit_due_date - now).days <= 7 and c.credit_used > 0:
                utils.push_message(u.id, f"【还款提醒】信用卡尾号 {c.number[-4:]} 将于 {c.credit_due_date} 到期，欠款 ${c.credit_used:.2f}。")
                sent += 1
        return utils.ok({"reminders_sent": sent}, "提醒已发送 / Reminders sent")
    finally:
        sess.close()


@cards_bp.route("/credit/renew", methods=["POST"])
@utils.require_user
def credit_renew():
    """信用卡续卡：支付续卡费后重新激活（处于 credit_frozen / expired_grace）。"""
    u = utils.get_current_user()
    card_id = (request.get_json(silent=True) or {}).get("card_id")
    fee = utils.get_config("renew_fee", 50)
    sess = Session()
    try:
        c = _own_card(sess, u.id, card_id)
        if not c or c.type != "credit":
            return utils.fail("信用卡无效 / Invalid credit card", 404)
        payer = sess.query(Card).filter_by(account_id=c.account_id, type="debit",
                                          status="active").first()
        if not payer or payer.balance < fee:
            return utils.fail(f"余额不足支付续卡费 ${fee:.2f}", 400)
        payer.balance -= fee
        now = datetime.utcnow()
        c.expiry = f"{now.month:02d}/{str(now.year + 5)[-2:]}"
        c.credit_due_date = now.date() + timedelta(days=30)
        c.status = "active"
        sess.commit()
        utils.audit("credit_renew", target=str(c.id), user_id=u.id, status="success")
        return utils.ok(_serialize_card(c), "信用卡已续卡 / Renewed")
    finally:
        sess.close()


# ---------------------------------------------------------------------------
# 内部工具
# ---------------------------------------------------------------------------
def _own_card(sess, user_id, card_id):
    return (sess.query(Card).join(Account).filter(
        Account.user_id == user_id, Card.id == card_id).first())


def _set_status(status, msg):
    u = utils.get_current_user()
    card_id = (request.get_json(silent=True) or {}).get("card_id")
    sess = Session()
    try:
        c = _own_card(sess, u.id, card_id)
        if not c:
            return utils.fail("卡片不存在 / Card not found", 404)
        c.status = status
        sess.commit()
        utils.audit("freeze" if status == "frozen" else "unfreeze", target=str(c.id),
                    user_id=u.id, status="success")
        return utils.ok(_serialize_card(c), msg)
    finally:
        sess.close()


def _iso(v):
    return v.isoformat() if v else None


def _tx_id():
    import string
    ts = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    return "TX" + ts + "".join(random.choice(string.ascii_uppercase + string.digits) for _ in range(6))
