import os
import tempfile
from argon2 import PasswordHasher

# 在导入 app 之前设置测试环境变量（隔离数据库与密钥）
_tmp = os.path.join(tempfile.mkdtemp(), "test_novapay.db")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}"
os.environ["JWT_SECRET_KEY"] = "test-jwt-secret-key-0123456789"
os.environ["AES_ENCRYPTION_KEY"] = "test-aes-key-32-bytes-long-ok!!"
os.environ["ADMIN_USERNAME"] = "admin"
# 从环境变量读取（CI/CD 注入），默认用本地 argon2 哈希
os.environ.setdefault(
    "ADMIN_PASSWORD_HASH",
    PasswordHasher().hash(os.environ.get("ADMIN_TEST_PASSWORD", "admin123")),
)
os.environ["FLASK_DEBUG"] = "false"

import app as app_module
from app.db import init_db, Session, Base

app_module.init_db(os.environ["DATABASE_URL"], create=True)

import pytest


@pytest.fixture
def client():
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as c:
        yield c


@pytest.fixture(autouse=True)
def clean_db():
    # 每个测试前清空所有表，保证隔离
    sess = Session()
    try:
        for table in reversed(Base.metadata.sorted_tables):
            sess.execute(table.delete())
        sess.commit()
    finally:
        sess.close()


def register(client, email="a@test.com", password="Password1", pin="1234", name="Alice"):
    return client.post("/api/auth/register", json={
        "email": email, "password": password, "pin": pin, "name": name,
        "phone": "123456", "nationality": "CN", "purpose": "Personal",
    })


def login(client, identifier="a@test.com", password="Password1"):
    return client.post("/api/auth/login", json={"identifier": identifier, "password": password})


def admin_login(client, username="admin", password=None):
    if password is None:
        from argon2 import PasswordHasher
        password = os.environ.get("ADMIN_TEST_PASSWORD", "admin123")
    return client.post("/api/admin/login", json={"username": username, "password": password})
