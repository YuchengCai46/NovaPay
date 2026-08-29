"""测试辅助函数（在多个测试文件中复用）"""
import os
from app import crypto


def register(client, email="a@test.com", password="Password1", pin="1234", name="Alice"):
    return client.post("/api/auth/register", json={
        "email": email, "password": password, "pin": pin, "name": name,
        "phone": "123456", "nationality": "CN", "purpose": "Personal",
    })


def login(client, identifier="a@test.com", password="Password1"):
    return client.post("/api/auth/login", json={"identifier": identifier, "password": password})


def admin_login(client, username="admin", password=None):
    if password is None:
        password = os.environ.get("ADMIN_TEST_PASSWORD", "admin123")
    return client.post("/api/admin/login", json={"username": username, "password": password})


def crypto_sha(s):
    return crypto.sha256_hex(s)
