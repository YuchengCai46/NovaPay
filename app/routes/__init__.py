"""NovaPay V6.0 — API 蓝图集合（供 app 工厂导入）"""
from app.routes.auth import auth_bp
from app.routes.accounts import accounts_bp
from app.routes.cards import cards_bp
from app.routes.transactions import transactions_bp
from app.routes.subscriptions import subscriptions_bp
from app.routes.giftcards import giftcards_bp
from app.routes.suggestions import suggestions_bp
from app.routes.admin import admin_bp

__all__ = [
    "auth_bp", "accounts_bp", "cards_bp", "transactions_bp",
    "subscriptions_bp", "giftcards_bp", "suggestions_bp", "admin_bp",
]
