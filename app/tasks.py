"""
NovaPay V6.0 — 定时任务（第七章）
每天凌晨 02:00 执行：
  1) 信用卡到期检查：到期日当天且有欠款 -> credit_frozen
  2) 信用卡逾期检查：超期 7 天 -> 用户 suspended；超期 3 天 -> 信用黑名单
  3) 订阅续期扣款：到期订阅从绑定卡扣款
  4) 过期卡片自动注销：expired_grace 超 30 天 -> canceled
  5) 每日统计报表：记录昨日汇总
"""
import random
import string
from datetime import datetime, timezone, timedelta

from app.db import Session
from app import utils
from app.models import Card, Account, User, Subscription, Transaction, SystemConfig


def _tx_id():
    ts = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    return "TX" + ts + "".join(random.choice(string.ascii_uppercase + string.digits) for _ in range(6))


def run_daily_jobs():
    """执行全部每日任务。可由 APScheduler 或手动调用。"""
    sess = Session()
    now = datetime.utcnow()
    today = now.date()
    try:
        _credit_expiry(sess, today)
        _credit_overdue(sess, today)
        _subscription_renewal(sess, today, now)
        _auto_cancel_expired(sess, today)
        _daily_report(sess, today)
        sess.commit()
    except Exception as e:
        sess.rollback()
        utils.audit("scheduler_error", target=str(e), status="failed")
        raise
    finally:
        sess.close()


def _credit_expiry(sess, today):
    # 到期日当天且有欠款 -> credit_frozen
    cards = sess.query(Card).filter(
        Card.type == "credit", Card.credit_due_date == today,
        Card.credit_used > 0, Card.status == "active").all()
    for c in cards:
        c.status = "credit_frozen"
        utils.audit("scheduler_credit_freeze", target=str(c.id), user_id=_owner(sess, c),
                    status="success")


def _credit_overdue(sess, today):
    # 超期 3 天 -> 信用黑名单；超期 7 天 -> 用户 suspended
    cards = sess.query(Card).filter(
        Card.type == "credit", Card.credit_used > 0,
        Card.credit_due_date.isnot(None)).all()
    suspend_days = int(utils.get_config("credit_overdue_suspend_days", 7))
    for c in cards:
        over = (today - c.credit_due_date).days
        if over >= 3:
            u = _owner_user(sess, c)
            if u and not u.credit_blacklist:
                u.credit_blacklist = True
        if over >= suspend_days:
            u = _owner_user(sess, c)
            if u and u.status == "active":
                u.status = "suspended"
                utils.push_message(u.id, "【账户通知】您的信用卡已严重逾期，账户已被暂停，请尽快还款。")


def _subscription_renewal(sess, today, now):
    subs = sess.query(Subscription).filter(
        Subscription.status == "active", Subscription.auto_renew == True,
        Subscription.next_billing_date <= now).all()
    for s in subs:
        main = sess.query(Account).filter_by(user_id=s.user_id, type="main").first()
        pay = sess.query(Card).filter_by(account_id=main.id, type="debit",
                                        status="active").first() if main else None
        if not pay or pay.balance < s.amount:
            s.status = "payment_failed"
            utils.push_message(s.user_id, f"【订阅提醒】{s.brand} 续费失败，余额不足，请充值。")
            continue
        pay.balance -= s.amount
        cycle_days = 30 if s.cycle == "Monthly" else 365
        s.next_billing_date = now + timedelta(days=cycle_days)
        tx = Transaction(id=_tx_id(), user_id=s.user_id, account_id=pay.account_id,
                        from_card_id=pay.id, type="subscription", amount=s.amount,
                        balance_after=pay.balance, status="completed",
                        created_at=now, ip_address="scheduler",
                        user_agent="APScheduler")
        sess.add(tx)


def _auto_cancel_expired(sess, today):
    grace_days = int(utils.get_config("credit_grace_days", 30))
    cards = sess.query(Card).filter(Card.status == "expired_grace").all()
    for c in cards:
        if c.credit_due_date and (today - c.credit_due_date).days > grace_days:
            c.status = "canceled"
            utils.audit("scheduler_auto_cancel", target=str(c.id), user_id=_owner(sess, c),
                        status="success")


def _daily_report(sess, today):
    yesterday = today - timedelta(days=1)
    txs = sess.query(Transaction).filter(Transaction.created_at >= yesterday,
                                        Transaction.created_at < today).all()
    total = sum(t.amount for t in txs)
    utils.audit("daily_report", target=today.isoformat(),
                details={"tx_count": len(txs), "tx_volume": round(total, 2)},
                status="success")


def _owner(sess, card):
    acc = sess.get(Account, card.account_id)
    return acc.user_id if acc else None


def _owner_user(sess, card):
    acc = sess.get(Account, card.account_id)
    return sess.get(User, acc.user_id) if acc else None


def start_scheduler():
    """启动 APScheduler，每天 02:00 执行。"""
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
    except Exception:
        return None
    sched = BackgroundScheduler()
    sched.add_job(run_daily_jobs, "cron", hour=2, minute=0, id="novapay_daily")
    sched.start()
    return sched
