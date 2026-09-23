"""Shared login helpers for backend tests."""
import httpx

from tests.conftest import API_URL

PEMILIK = {"email": "pemilik@demo.id", "password": "demo1234"}
KASIR = {"email": "kasir@demo.id", "password": "demo1234"}


def login(client: httpx.Client, creds: dict) -> dict:
    r = client.post("/auth/login", json=creds)
    assert r.status_code == 200, r.text
    return r.json()


def auth_headers(client: httpx.Client, creds: dict) -> dict:
    data = login(client, creds)
    return {"Authorization": f"Bearer {data['token']}"}
