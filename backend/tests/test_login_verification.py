"""Login email verification: opt-in per store, guarded by the owner's password.

The emailed-code flow itself needs a working SMTP account, so only the guards that do not
send mail are exercised against the live server here.
"""
import uuid

import httpx


def _fresh_owner(client: httpx.Client) -> tuple[dict, dict]:
    suffix = uuid.uuid4().hex[:8]
    creds = {"email": f"sec-{suffix}@example.com", "password": "owner1234"}
    r = client.post("/auth/register", json={"store_name": f"tscheck-sec-{suffix}", "name": "Pemilik Sec", **creds})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}, creds


def test_default_login_has_no_verification_step(client: httpx.Client):
    _, creds = _fresh_owner(client)
    r = client.post("/auth/login", json=creds)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "token" in body and "verification_required" not in body
    assert body["store"]["login_verification_enabled"] is False


def test_toggle_requires_correct_password(client: httpx.Client):
    owner, _ = _fresh_owner(client)
    r = client.patch(
        "/auth/store/security",
        json={"login_verification_enabled": True, "current_password": "salah-total"},
        headers=owner,
    )
    assert r.status_code == 403, r.text
    assert client.get("/auth/me", headers=owner).json()["store"]["login_verification_enabled"] is False


def test_verify_rejects_unknown_challenge(client: httpx.Client):
    r = client.post("/auth/login/verify", json={"challenge_id": "tidak-ada", "code": "123456"})
    assert r.status_code == 410, r.text
