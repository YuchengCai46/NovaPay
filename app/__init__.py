"""
NovaPay V6.0 — Flask 应用工厂
负责：初始化数据库、注册蓝图、CORS、IP 限流中间件、定时任务、前端静态资源托管。
"""
import os
import time
from collections import defaultdict

from flask import Flask, send_from_directory, jsonify, request, g, current_app

from config import DATABASE_URL, FLASK_DEBUG
from app.db import init_db, Session

# 蓝图
from app.routes import auth_bp, accounts_bp, cards_bp, transactions_bp
from app.routes import subscriptions_bp, giftcards_bp, suggestions_bp, admin_bp
from app.routes.suggestions import admin_suggestions_bp
from app.routes.forex import forex_bp
from app.routes.escrow import escrow_bp
from app.routes.cancellation_requests import cancellation_bp, admin_cancellation_bp


def create_app():
    # 注意：static_folder 必须为绝对路径，否则 Flask 会相对 app 包目录解析
    # （即 NovaPay/app/frontend，实际前端在 NovaPay/frontend，导致 /js、/css 404）。
    # 这里直接禁用内置 static 路由，改用显式 send_from_directory 精确托管前端资源。
    frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
    app = Flask(__name__, static_folder=None, static_url_path="")
    app.secret_key = os.environ.get("JWT_SECRET_KEY", "dev-secret")
    app.debug = FLASK_DEBUG

    # 1) 数据库
    init_db(DATABASE_URL, echo=False, create=True)

    # 2) CORS（允许跨域，支持凭证 Cookie）
    try:
        from flask_cors import CORS
        # supports_credentials=True 时必须指定具体 origins，不能用 "*"
        CORS(app, supports_credentials=True)
    except Exception:
        pass

    # 手动添加 CORS 头（应对没有 flask-cors 的情况）
    @app.after_request
    def _add_cors_headers(response):
        origin = request.headers.get('Origin')
        if origin:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,DELETE,OPTIONS'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
            response.headers['Access-Control-Allow-Credentials'] = 'true'
        return response

    # 3) 请求级 DB 会话清理
    @app.teardown_appcontext
    def _close_session(exc=None):
        Session.remove()

    # 4) IP 限流中间件：每 IP 每分钟最多 60 次
    _hits = defaultdict(list)
    LIMIT = 60
    WINDOW = 60

    @app.before_request
    def _rate_limit():
        if request.path.startswith(("/static", "/favicon")):
            return
        # 测试环境下跳过限流，避免共享 IP 计数器影响测试
        if current_app.config.get("TESTING"):
            return
        ip = request.remote_addr
        now = time.time()
        window = _hits[ip]
        # 清理窗口外记录
        _hits[ip] = [t for t in window if now - t < WINDOW]
        if len(_hits[ip]) >= LIMIT:
            return jsonify({"success": False, "data": None,
                            "message": "请求过于频繁，请稍后再试 / Too many requests"}), 429
        _hits[ip].append(now)

    # 5) 健康检查
    @app.route("/health")
    def health():
        return jsonify({"success": True, "data": {"status": "ok"}, "message": ""})

    # 6) 注册 API 蓝图
    app.register_blueprint(auth_bp)
    app.register_blueprint(accounts_bp)
    app.register_blueprint(cards_bp)
    app.register_blueprint(transactions_bp)
    app.register_blueprint(subscriptions_bp)
    app.register_blueprint(giftcards_bp)
    app.register_blueprint(suggestions_bp)
    app.register_blueprint(admin_suggestions_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(forex_bp)
    app.register_blueprint(escrow_bp)
    app.register_blueprint(cancellation_bp)
    app.register_blueprint(admin_cancellation_bp)

    # 7) 前端页面托管
    @app.route("/")
    def index():
        return send_from_directory(frontend_dir, "index.html")

    @app.route("/admin")
    def admin_page():
        # Admin 后台同样由前端 SPA 处理
        return send_from_directory(frontend_dir, "index.html")

    @app.route("/js/<path:filename>")
    def frontend_js(filename):
        # 精确托管前端静态资源，避免 Flask 内置 static 因相对路径误解析为 404
        # 路由前缀 /js/ 已被规则消费，filename 仅含子路径（如 icons.js）
        return send_from_directory(os.path.join(frontend_dir, "js"), filename)

    @app.route("/css/<path:filename>")
    def frontend_css(filename):
        return send_from_directory(os.path.join(frontend_dir, "css"), filename)

    return app


# 应用级单例（供 scheduler / gunicorn 使用）
app = create_app()
