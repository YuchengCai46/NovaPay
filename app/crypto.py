"""
NovaPay V6.0 — 加密与安全工具
集中实现：
  - AES-256-GCM 对称加密（用于 CVV、用户建议内容）
  - Argon2id 密码 / PIN 哈希
  - SHA-256 内容防篡改哈希（用于建议完整性校验）
  - JWT 签发 / 校验（HTTP-only Cookie 配合）

所有密钥均来自 config（环境变量），本模块不硬编码任何密钥。
"""
import base64
import hashlib
import json
import time
from datetime import datetime, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from config import AES_KEY, JWT_SECRET_KEY, JWT_ALGO, JWT_EXP_SECONDS

_ph = PasswordHasher()  # 默认 argon2id


# ----------------------------------------------------------------------------
# AES-256-GCM
# ----------------------------------------------------------------------------
def aes_encrypt(plaintext: str) -> str:
    """使用 AES-256-GCM 加密明文，返回 base64(nonce || tag || ciphertext)。"""
    if plaintext is None:
        plaintext = ""
    data = plaintext.encode("utf-8")
    aes = AESGCM(AES_KEY)
    nonce = os_urandom(12)
    ct = aes.encrypt(nonce, data, None)  # ct 末尾 16 字节为 GCM tag
    return base64.b64encode(nonce + ct).decode("ascii")


def aes_decrypt(token_b64: str) -> str:
    """解密 AES-256-GCM 密文，返回明文。校验失败抛出 InvalidTag。"""
    if not token_b64:
        return ""
    raw = base64.b64decode(token_b64)
    nonce, ct = raw[:12], raw[12:]
    aes = AESGCM(AES_KEY)
    pt = aes.decrypt(nonce, ct, None)
    return pt.decode("utf-8")


def os_urandom(n: int) -> bytes:
    import os
    return os.urandom(n)


# ----------------------------------------------------------------------------
# Argon2id 密码 / PIN
# ----------------------------------------------------------------------------
def hash_secret(secret: str) -> str:
    """对密码或 PIN 进行 Argon2id 哈希。"""
    return _ph.hash(secret)


def verify_secret(hash_str: str, secret: str) -> bool:
    """校验密码或 PIN。哈希非法或损坏时返回 False。"""
    if not hash_str:
        return False
    try:
        return _ph.verify(hash_str, secret)
    except (VerifyMismatchError, InvalidHashError):
        return False


def needs_rehash(hash_str: str) -> bool:
    try:
        return _ph.check_needs_rehash(hash_str)
    except Exception:
        return False


# ----------------------------------------------------------------------------
# SHA-256 防篡改哈希
# ----------------------------------------------------------------------------
def sha256_hex(content: str) -> str:
    """计算内容 SHA-256 十六进制摘要，用于建议完整性校验。"""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


# ----------------------------------------------------------------------------
# JWT
# ----------------------------------------------------------------------------
def encode_jwt(payload: dict) -> str:
    """签发 JWT，附带过期时间与签发时间。"""
    now = int(time.time())
    body = dict(payload)
    body["iat"] = now
    body["exp"] = now + JWT_EXP_SECONDS
    return jwt.encode(body, JWT_SECRET_KEY, algorithm=JWT_ALGO)


def decode_jwt(token: str):
    """校验并解码 JWT，失败返回 None。"""
    try:
        return jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGO])
    except jwt.PyJWTError:
        return None


def now_ms() -> str:
    """返回精确到毫秒的 UTC 时间戳字符串（用于建议提交时间等）。"""
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.") + f"{datetime.utcnow().microsecond // 1000:03d}"


def now_dt() -> datetime:
    return datetime.utcnow()
