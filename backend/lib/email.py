"""Email sending through SMTP (SMTP_* env vars) or Emergent's managed provider.

Guardrails: bodies come from server-side templates only, recipients from stored
records — no caller ever supplies a recipient, subject, or HTML.
"""

import asyncio
import ipaddress
import logging
import os
import re
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

# Managed email proxy. A constant on purpose: an env var would be missing in prod.
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "KasirKu")
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = (
    "reply with your password",
    "reply with the code",
    "send your password",
    "cvv",
    "send us your password",
    "enter your password below",
    "confirm your card number",
    "your full card number",
    "seed phrase",
    "recovery phrase",
    "verify your card",
    "social security number",
    "confirm your bank details",
)
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    """Structural guard: no forms, no credential asks, no unsafe links."""
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} != real link host {real!r} (G3)")


def _smtp_settings() -> dict | None:
    host = os.environ.get("SMTP_HOST", "").strip()
    user = os.environ.get("SMTP_USER", "").strip()
    password = os.environ.get("SMTP_PASSWORD", "")
    if not (host and user and password):
        return None
    return {
        "host": host,
        "port": int(os.environ.get("SMTP_PORT", "587") or 587),
        "user": user,
        "password": password,
        "sender": os.environ.get("SMTP_FROM", "").strip() or user,
    }


def email_configured() -> bool:
    return _smtp_settings() is not None or bool(EMAIL_KEY)


def _send_smtp(settings: dict, to: str, subject: str, html: str) -> None:
    message = EmailMessage()
    message["From"] = formataddr((EMAIL_FROM_NAME, settings["sender"]))
    message["To"] = to
    message["Subject"] = subject
    if EMAIL_REPLY_TO:
        message["Reply-To"] = EMAIL_REPLY_TO
    message.set_content("Email ini berisi tampilan HTML. Buka dengan aplikasi email yang mendukung HTML.")
    message.add_alternative(html, subtype="html")
    # Port 465 is implicit TLS; every other port (587) upgrades with STARTTLS.
    if settings["port"] == 465:
        server = smtplib.SMTP_SSL(settings["host"], settings["port"], timeout=30, context=ssl.create_default_context())
    else:
        server = smtplib.SMTP(settings["host"], settings["port"], timeout=30)
    with server:
        if settings["port"] != 465:
            server.starttls(context=ssl.create_default_context())
        server.login(settings["user"], settings["password"])
        server.send_message(message)


async def send_email(*, to: str, subject: str, html: str) -> str | None:
    """Send one templated email. Returns the provider id, or None when unconfigured or failed."""
    _assert_safe_email(subject, html)
    smtp = _smtp_settings()
    if smtp:
        try:
            await asyncio.to_thread(_send_smtp, smtp, to, subject, html)
            return "smtp"
        except Exception as e:
            logger.error("SMTP send failed: %s", e)
            return None
    if not EMAIL_KEY:
        logger.error("Penyedia email belum diatur (SMTP_* atau EMERGENT_EMAIL_KEY) — email tidak dikirim")
        return None

    payload: dict = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    if EMAIL_REPLY_TO:
        payload["contact_email"] = EMAIL_REPLY_TO
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": EMAIL_KEY},
                json=payload,
            )
        resp.raise_for_status()
        return resp.json().get("id")
    except httpx.HTTPStatusError as e:
        logger.error("Email send failed: %s %s", e.response.status_code, e.response.text)
        return None
    except Exception as e:  # network/provider hiccup must not crash the cron job
        logger.error("Email send error: %s", e)
        return None
