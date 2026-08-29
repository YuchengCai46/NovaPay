"""
NovaPay V6.0 — 数据库引擎与会话
使用原生 SQLAlchemy。Session 在模块加载时即创建为 scoped_session，
引擎在 init_db() 中通过 configure(bind=...) 延迟绑定，
避免「导入时 Session 为 None」导致的绑定失效问题。
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker, scoped_session

Base = declarative_base()

# 在导入时创建一次，引擎稍后通过 configure 绑定
Session = scoped_session(sessionmaker(future=True))


def make_engine(database_url: str, echo: bool = False):
    if database_url.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
        return create_engine(database_url, connect_args=connect_args, echo=echo, future=True)
    return create_engine(database_url, echo=echo, future=True)


def init_db(database_url: str, echo: bool = False, create: bool = True):
    """初始化数据库：创建引擎并绑定到全局 Session。"""
    engine = make_engine(database_url, echo=echo)
    Session.configure(bind=engine)
    if create:
        import app.models  # noqa: F401  确保模型注册到 metadata
        Base.metadata.create_all(engine)
    return engine
