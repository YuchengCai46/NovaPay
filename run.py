"""
NovaPay V6.0 — 启动入口
用法：
  python run.py                # 开发模式启动（默认端口 5000）
  gunicorn -w 4 -b 0.0.0.0:5000 "app:app"   # 生产模式
"""
import os
from app import app
from app.tasks import start_scheduler


def main():
    # 启动定时任务调度器（每天 02:00）
    start_scheduler()
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug, use_reloader=False)


if __name__ == "__main__":
    main()
