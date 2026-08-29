"""
NovaPay V6.0 — 外汇蓝图（模拟外汇：实时汇率、历史趋势、入金、提现）

费率（按基础货币）：
  基础货币 = CHF：外汇入金 2% / 提现（向外转账）1% / 体系内转账 0.2%
  基础货币 = USD：外汇入金 5% / 提现（向外转账）2% / 体系内转账 0.5%
所有操作为模拟，不涉及真实资金进出。
"""
from datetime import datetime

from flask import Blueprint, request

from app.db import Session
from app import utils, forex
from app.models import Card, Account, Transaction, User
from app.routes.cards import _own_card, _tx_id

forex_bp = Blueprint("forex", __name__, url_prefix="/api/forex")


def _base_of(u):
    return ((u.settings or {}).get("base_currency") or "CHF").upper()


def _fee_rates(base):
    """返回 (入金费率, 提现费率, 内转费率)。"""
    if base == "CHF":
        return 0.03, 0.018, 0.003
    # USD
    return 0.05, 0.03, 0.005


@forex_bp.route("/currencies", methods=["GET"])
@utils.require_user
def currencies():
    out = [{"code": c, "name": forex.currency_name(c)} for c in sorted(forex.FIAT.keys())]
    return utils.ok({"currencies": out})


@forex_bp.route("/rates", methods=["GET"])
@utils.require_user
def rates():
    base = (request.args.get("base") or "").upper() or "CHF"
    try:
        r = forex.get_rates(base.lower())
    except Exception as e:
        return utils.fail(f"汇率获取失败 / Forex rate unavailable: {e}", 502)
    cur = [{"code": c, "name": forex.currency_name(c)} for c in sorted(r.keys())]
    return utils.ok({"base": base, "rates": r, "currencies": cur})


@forex_bp.route("/history", methods=["GET"])
@utils.require_user
def history():
    frm = (request.args.get("from") or "USD").upper()
    to = (request.args.get("to") or "CHF").upper()
    try:
        days = max(7, min(180, int(request.args.get("days", 30))))
    except Exception:
        days = 30
    try:
        series = forex.get_history(frm.lower(), to.lower(), days)
    except Exception as e:
        return utils.fail(f"历史汇率获取失败 / History unavailable: {e}", 502)
    return utils.ok({"from": frm, "to": to, "days": days, "series": series})


@forex_bp.route("/deposit", methods=["POST"])
@utils.require_user
def deposit():
    u = utils.get_current_user()
    d = request.get_json(silent=True) or {}
    card_id = d.get("card_id")
    from_c = (d.get("from_currency") or "USD").upper()
    try:
        amount = float(d.get("amount", 0))
    except Exception:
        return utils.fail("金额无效 / Invalid amount", 400)
    if amount <= 0:
        return utils.fail("入金金额必须大于 0 / Amount > 0", 400)

    base = _base_of(u)
    deposit_fee, _, _ = _fee_rates(base)
    sess = Session()
    try:
        c = _own_card(sess, u.id, card_id)
        if not c or c.type != "debit":
            return utils.fail("借记卡无效 / Invalid debit card", 404)
        try:
            rate = forex.convert(1.0, from_c.lower(), base.lower())
        except Exception as e:
            return utils.fail(f"不支持的货币 / Unsupported currency: {e}", 400)
        base_amount = amount * rate
        fee_amt = base_amount * deposit_fee
        credited = base_amount - fee_amt
        c.balance += credited
        c.last_used_at = datetime.utcnow()
        tx = Transaction(
            id=_tx_id(), user_id=u.id, account_id=c.account_id, from_card_id=c.id,
            type="forex_deposit", amount=round(amount, 2), fee=round(fee_amt, 2),
            balance_after=round(c.balance, 2), status="completed",
            note=f"{from_c}→{base} @ {rate:.4f}", category="forex",
            created_at=datetime.utcnow(),
            ip_address=request.remote_addr, user_agent=request.headers.get("User-Agent", ""),
        )
        sess.add(tx)
        sess.commit()
        utils.audit("forex_deposit", target=str(c.id), user_id=u.id, status="success")
        return utils.ok({
            "balance": round(c.balance, 2), "credited": round(credited, 2),
            "fee": round(fee_amt, 2), "rate": round(rate, 6), "base": base,
            "from_currency": from_c,
        }, "外汇入金成功 / Deposited")
    finally:
        sess.close()


@forex_bp.route("/withdraw", methods=["POST"])
@utils.require_user
def withdraw():
    u = utils.get_current_user()
    d = request.get_json(silent=True) or {}
    card_id = d.get("card_id")
    to_c = (d.get("to_currency") or "USD").upper()
    try:
        amount = float(d.get("amount", 0))
    except Exception:
        return utils.fail("金额无效 / Invalid amount", 400)
    if amount <= 0:
        return utils.fail("提现金额必须大于 0 / Amount > 0", 400)

    base = _base_of(u)
    _, withdraw_fee, _ = _fee_rates(base)
    sess = Session()
    try:
        c = _own_card(sess, u.id, card_id)
        if not c or c.type != "debit":
            return utils.fail("借记卡无效 / Invalid debit card", 404)
        try:
            rate = forex.convert(1.0, base.lower(), to_c.lower())
        except Exception as e:
            return utils.fail(f"不支持的货币 / Unsupported currency: {e}", 400)
        fee_amt = amount * withdraw_fee
        total = amount + fee_amt
        if c.balance < total:
            return utils.fail(f"余额不足（含手续费 {fee_amt:.2f} {base}）/ Insufficient", 400)
        c.balance -= total
        c.last_used_at = datetime.utcnow()
        sent = amount * rate
        tx = Transaction(
            id=_tx_id(), user_id=u.id, account_id=c.account_id, from_card_id=c.id,
            type="forex_withdraw", amount=round(amount, 2), fee=round(fee_amt, 2),
            balance_after=round(c.balance, 2), status="completed",
            note=f"{base}→{to_c} @ {rate:.4f}", category="forex",
            created_at=datetime.utcnow(),
            ip_address=request.remote_addr, user_agent=request.headers.get("User-Agent", ""),
        )
        sess.add(tx)
        sess.commit()
        utils.audit("forex_withdraw", target=str(c.id), user_id=u.id, status="success")
        return utils.ok({
            "balance": round(c.balance, 2), "sent": round(sent, 2),
            "fee": round(fee_amt, 2), "rate": round(rate, 6), "base": base,
            "to_currency": to_c,
        }, "提现成功 / Withdrawn")
    finally:
        sess.close()
