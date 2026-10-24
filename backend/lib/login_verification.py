"""Emailed one-time login codes for stores that turned on login verification.

The code is never stored: only an HMAC bound to the challenge id and the server secret, so a
leaked database row cannot be replayed or reversed without JWT_SECRET.
"""

import hashlib
import hmac
import secrets
from datetime import timedelta
from html import escape

from lib.auth import _secret

LOGIN_CODE_TTL = timedelta(minutes=10)
LOGIN_CODE_MAX_ATTEMPTS = 5
LOGIN_CODE_SEND_WINDOW = timedelta(minutes=10)
LOGIN_CODE_SENDS_PER_WINDOW = 5


def new_login_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_login_code(challenge_id: str, code: str) -> str:
    return hmac.new(_secret().encode(), f"{challenge_id}:{code}".encode(), hashlib.sha256).hexdigest()


def login_code_html(store_name: str, user_name: str, code: str) -> str:
    minutes = int(LOGIN_CODE_TTL.total_seconds() // 60)
    return (
        "<main style='font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#172033'>"
        "<p style='color:#0284c7;font-weight:bold'>VERIFIKASI LOGIN</p>"
        f"<h1 style='font-size:20px'>{escape(store_name)}</h1>"
        f"<p>Halo {escape(user_name)}, gunakan kode berikut untuk menyelesaikan login Anda:</p>"
        f"<p style='font-size:32px;letter-spacing:8px;font-weight:bold;margin:16px 0'>{escape(code)}</p>"
        f"<p>Kode berlaku {minutes} menit dan hanya bisa dipakai sekali.</p>"
        "<p style='color:#64748b;font-size:12px'>Jika Anda tidak sedang mencoba masuk, abaikan email ini "
        "dan segera ganti password Anda. Tim kami tidak pernah meminta kode ini.</p></main>"
    )
