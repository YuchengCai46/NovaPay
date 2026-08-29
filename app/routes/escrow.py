"""
NovaPay V6.0 — 暂存池蓝图（Escrow Pool）

暂存池（Escrow Pool）功能：
  - 每个用户每个币种一个独立池子，上限 50000 CHF / 50000 USD
  - 入金：从外部货币（或借记卡余额）转入，手续费 8%
  - 出金：从池子转出到借记卡余额或提现到外部货币，手续费 5%
  - 注销借记卡时余额自动转入池子
  - 无卡用户可通过外汇直接入金
  - 所有操作记录交易流水
"""
from datetime import datetime

from flask import Blueprint, request

from app.db import Session
from app import utils, forex
from app.models import Card, Account, Transaction, User, EscrowPool

escrow_bp = Blueprint("escrow", __name__, url_prefix="/api/escrow")

# 每种货币的池子上限
POOL_LIMITS = {"CHF": 50000.0, "USD": 50000.0}

# 费率
DEPOSIT_FEE_RATE = 0.08   # 入金手续费 8%
WITHDRAW_FEE_RATE = 0.05  # 出金手续费 5%


def _get_or_create_pool(sess, user_id, currency):
    """获取或创建用户的暂存池（按币种）。"""
    pool = sess.query(EscrowPool).filter_by(user_id=user_id, currency=currency).first()
    if pool is None:
        pool = EscrowPool(user_id=user_id, currency=currency, balance=0.0)
        sess.add(pool)
        sess.flush()
    return pool


def _tx_id():
    """生成交易 ID。"""
    import hashlib, time, random
    ts = f"{time.time():.6f}{random.randint(0, 999999):06d}"
    return "ES" + hashlib.sha256(ts.encode()).hexdigest()[:24].upper()


def _own_account(sess, user_id):
    return sess.query(Account).filter_by(user_id=user_id, type="main").first()


@escrow_bp.route("/pool", methods=["GET"])
@utils.require_user
def get_pool():
    """获取暂存池余额。"""
    u = utils.get_current_user()
    sess = Session()
    try:
        pools = sess.query(EscrowPool).filter_by(user_id=u.id).all()
        out = {}
        for p in pools:
            out[p.currency] = {"balance": round(p.balance, 2), "limit": p.limit_per_currency}
        # 也返回空池信息
        for cur, limit in POOL_LIMITS.items():
            if cur not in out:
                out[cur] = {"balance": 0.0, "limit": limit}
        return utils.ok({"pools": out})
    finally:
        sess.close()


@escrow_bp.route("/deposit", methods=["POST"])
@utils.require_user
def deposit():
    """
    入金：将外部货币/借记卡余额转入暂存池。
    请求体：
      - source_currency: 来源货币（如 CNY），不传则从基础货币借记卡扣
      - amount: 金额
      - target_currency: 目标池子币种（如 CHF），默认基础货币
      - card_id: 借记卡 ID（用于从卡余额扣款，外部货币时需传）
    """
    u = utils.get_current_user()
    d = request.get_json(silent=True) or {}
    amount = float(d.get("amount", 0))
    target_currency = (d.get("target_currency") or "").upper()
    source_currency = (d.get("source_currency") or "").upper()
    card_id = d.get("card_id")

    if amount <= 0:
        return utils.fail("金额必须大于 0 / Amount > 0", 400)
    if not target_currency:
        target_currency = ((u.settings or {}).get("base_currency") or "CHF").upper()
    if target_currency not in POOL_LIMITS:
        return utils.fail(f"不支持的币种 / Unsupported currency: {target_currency}", 400)

    limit = POOL_LIMITS[target_currency]

    # 确定来源货币和金额
    if source_currency:
        # 外部货币入金：汇率换算
        try:
            rate = forex.convert(amount, source_currency, target_currency)
        except Exception as e:
            return utils.fail(f"不支持的货币对 / Unsupported pair: {source_currency}->{target_currency}", 400)
        source_amount_in_target = rate
    else:
        # 从基础货币借记卡扣款
        source_amount_in_target = amount

    fee = source_amount_in_target * DEPOSIT_FEE_RATE
    credited = source_amount_in_target - fee

    # 检查余额上限（含现有池子余额）
    sess_temp = Session()
    try:
        pool_temp = sess_temp.query(EscrowPool).filter_by(user_id=u.id, currency=target_currency).first()
        existing_balance = pool_temp.balance if pool_temp else 0.0
    finally:
        sess_temp.close()
    if existing_balance + credited > limit:
        return utils.fail(f"超出暂存池上限 / Exceeds pool limit of {limit}", 400)

    sess = Session()
    try:
        acc = _own_account(sess, u.id)
        if not acc:
            return utils.fail("未找到主账户 / No main account", 404)

        # 扣款来源
        if source_currency:
            # 外部货币直接入金：通过外汇API换算，无需借记卡
            pass  # 不从任何账户扣款，仅记录交易
        else:
            # 从基础货币借记卡扣
            base = ((u.settings or {}).get("base_currency") or "CHF").upper()
            charge_in_base = source_amount_in_target + fee

            debit_card = sess.query(Card).filter_by(account_id=acc.id, type="debit", status="active").first()
            if not debit_card:
                return utils.fail("无可用借记卡 / No active debit card", 404)
            if debit_card.balance < charge_in_base:
                return utils.fail(f"借记卡余额不足 / Insufficient balance. Need {charge_in_base:.2f} {base}", 400)
            debit_card.balance -= charge_in_base
            debit_card.last_used_at = datetime.utcnow()

        # 更新池子余额
        pool = _get_or_create_pool(sess, u.id, target_currency)
        pool.balance += credited
        pool.updated_at = datetime.utcnow()

        # 交易记录
        tx = Transaction(
            id=_tx_id(), user_id=u.id, account_id=acc.id,
            type="escrow_deposit", amount=round(source_amount_in_target, 2),
            fee=round(fee, 2), balance_after=round(pool.balance, 2),
            status="completed",
            note=f"入金 {source_currency or base}→池[{target_currency}] @ 8% fee",
            category="escrow", created_at=datetime.utcnow(),
            ip_address=request.remote_addr, user_agent=request.headers.get("User-Agent", ""),
        )
        sess.add(tx)
        sess.commit()
        utils.audit("escrow_deposit", target=target_currency, user_id=u.id, status="success")
        return utils.ok({
            "currency": target_currency, "credited": round(credited, 2),
            "fee": round(fee, 2), "pool_balance": round(pool.balance, 2),
            "limit": limit,
        }, "入金成功 / Deposited to escrow")
    except Exception as e:
        sess.rollback()
        return utils.fail(f"操作失败 / Operation failed: {str(e)}", 500)
    finally:
        sess.close()


@escrow_bp.route("/withdraw", methods=["POST"])
@utils.require_user
def withdraw():
    """
    出金：从暂存池转出到借记卡余额或外部货币。
    请求体：
      - target_currency: 目标（池子币种），默认基础货币
      - amount: 金额
      - to_card_id: 借记卡 ID（转入卡余额）
      - to_external_currency: 外部货币（提现到外部）
    """
    u = utils.get_current_user()
    d = request.get_json(silent=True) or {}
    amount = float(d.get("amount", 0))
    target_currency = (d.get("target_currency") or "").upper()
    to_card_id = d.get("to_card_id")
    to_external_currency = (d.get("to_external_currency") or "").upper()

    if amount <= 0:
        return utils.fail("金额必须大于 0 / Amount > 0", 400)
    if not target_currency:
        target_currency = ((u.settings or {}).get("base_currency") or "CHF").upper()
    if target_currency not in POOL_LIMITS:
        return utils.fail(f"不支持的币种 / Unsupported currency: {target_currency}", 400)

    sess = Session()
    try:
        acc = _own_account(sess, u.id)
        if not acc:
            return utils.fail("未找到主账户 / No main account", 404)

        pool = sess.query(EscrowPool).filter_by(user_id=u.id, currency=target_currency).first()
        if not pool or pool.balance < amount:
            return utils.fail(f"暂存池余额不足 / Insufficient escrow balance. Need {amount:.2f} {target_currency}", 400)

        fee = amount * WITHDRAW_FEE_RATE
        net = amount - fee

        pool.balance -= amount
        pool.updated_at = datetime.utcnow()

        if to_external_currency:
            # 提现到外部货币
            try:
                rate = forex.convert(net, target_currency, to_external_currency.lower())
            except Exception:
                return utils.fail("不支持的货币对 / Unsupported pair", 400)
            sent = round(net * rate, 2)
            note = f"出金 池[{target_currency}]→{to_external_currency} @ 5% fee"
        elif to_card_id:
            # 转入借记卡余额
            card = sess.query(Card).filter_by(id=to_card_id, account_id=acc.id, type="debit", status="active").first()
            if not card:
                return utils.fail("借记卡无效 / Invalid debit card", 404)
            card.balance += net
            card.last_used_at = datetime.utcnow()
            sent = round(net, 2)
            note = f"出金 池[{target_currency}]→借记卡 @ 5% fee"
        else:
            # 无目标，默认转入基础货币借记卡
            base = ((u.settings or {}).get("base_currency") or "CHF").upper()
            debit_card = sess.query(Card).filter_by(account_id=acc.id, type="debit", status="active").first()
            if base != target_currency and debit_card:
                try:
                    base_rate = forex.convert(net, target_currency, base)
                except Exception:
                    base_rate = net
                debit_card.balance += base_rate
                sent = round(base_rate, 2)
                note = f"出金 池[{target_currency}]→借记卡[{base}] @ 5% fee"
            elif debit_card:
                debit_card.balance += net
                sent = round(net, 2)
                note = f"出金 池[{target_currency}]→借记卡 @ 5% fee"
            else:
                sent = round(net, 2)
                note = f"出金 池[{target_currency}] →（无可用借记卡）@ 5% fee"

        tx = Transaction(
            id=_tx_id(), user_id=u.id, account_id=acc.id,
            type="escrow_withdraw", amount=round(amount, 2),
            fee=round(fee, 2), balance_after=round(pool.balance, 2),
            status="completed", note=note, category="escrow",
            created_at=datetime.utcnow(),
            ip_address=request.remote_addr, user_agent=request.headers.get("User-Agent", ""),
        )
        sess.add(tx)
        sess.commit()
        utils.audit("escrow_withdraw", target=target_currency, user_id=u.id, status="success")
        return utils.ok({
            "currency": target_currency, "sent": round(sent, 2),
            "fee": round(fee, 2), "pool_balance": round(pool.balance, 2),
        }, "出金成功 / Withdrawn from escrow")
    except Exception as e:
        sess.rollback()
        return utils.fail(f"操作失败 / Operation failed: {str(e)}", 500)
    finally:
        sess.close()


@escrow_bp.route("/history", methods=["GET"])
@utils.require_user
def history():
    """获取暂存池交易历史。"""
    u = utils.get_current_user()
    sess = Session()
    try:
        txs = (sess.query(Transaction)
               .filter_by(user_id=u.id, category="escrow")
               .order_by(Transaction.created_at.desc())
               .limit(50).all())
        out = []
        for t in txs:
            out.append({
                "id": t.id, "type": t.type, "amount": round(t.amount, 2),
                "fee": round(t.fee, 2), "note": t.note,
                "status": t.status, "created_at": t.created_at.isoformat() if t.created_at else None,
            })
        return utils.ok({"transactions": out})
    finally:
        sess.close()
