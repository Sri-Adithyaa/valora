from sqlalchemy import text

from tests.conftest import register


def test_registration_creates_user_with_hashed_password(make_client, db):
    c = make_client()
    r = register(c, "alice")
    assert r.status_code == 201
    body = r.json()
    assert body["user"]["username"] == "alice"
    assert body["user"]["base_currency"]["currency_code"] == "INR"
    assert body["wallet"] is None  # wallet setup comes next
    assert "valora_session" in c.cookies
    stored = db.execute(text("SELECT password_hash FROM users WHERE username = 'alice'")).scalar_one()
    assert stored.startswith("$argon2") and "Secret123" not in stored


def test_duplicate_email_rejected(make_client):
    c = make_client()
    assert register(c, "alice", email="same@example.com").status_code == 201
    r = register(make_client(), "bob", email="SAME@example.com")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "email_taken"


def test_duplicate_username_rejected_case_insensitive(make_client):
    assert register(make_client(), "alice").status_code == 201
    r = register(make_client(), "ALICE", email="other@example.com")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "username_taken"


def test_invalid_registration_input_rejected(make_client):
    c = make_client()
    r = register(c, "carol", password="short")
    assert r.status_code == 422
    r = c.post("/api/auth/register", json={
        "full_name": "Carol", "username": "carol", "email": "not-an-email", "phone": "12", "password": "Secret123",
        "confirm_password": "Different1", "country": "India", "base_currency": "INR"})
    assert r.status_code == 422
    fields = {d["field"] for d in r.json()["error"]["details"]}
    assert {"email", "phone"} <= fields
    r = register(c, "carol", base="XYZ")
    assert r.status_code == 404 and r.json()["error"]["code"] == "currency_not_supported"


def test_login_with_email_or_username(make_client):
    register(make_client(), "alice")
    c = make_client()
    assert c.post("/api/auth/login", json={"identifier": "alice", "password": "Secret123"}).status_code == 200
    c2 = make_client()
    r = c2.post("/api/auth/login", json={"identifier": "ALICE@example.com", "password": "Secret123"})
    assert r.status_code == 200 and r.json()["user"]["username"] == "alice"
    assert c2.get("/api/auth/me").status_code == 200


def test_login_rejects_wrong_password(make_client):
    register(make_client(), "alice")
    r = make_client().post("/api/auth/login", json={"identifier": "alice", "password": "Wrong1234"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_credentials"


def test_protected_routes_require_login(make_client):
    c = make_client()
    for path in ("/api/auth/me", "/api/wallet", "/api/portfolio", "/api/trade/history", "/api/notifications"):
        assert c.get(path).status_code == 401, path


def test_logout_revokes_session_server_side(make_client):
    c = make_client()
    register(c, "alice")
    token = c.cookies.get("valora_session")
    assert c.post("/api/auth/logout").status_code == 200
    replay = make_client()
    assert replay.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_profile_update_and_password_change(make_client):
    c = make_client()
    register(c, "alice")
    r = c.patch("/api/profile", json={"full_name": "Alice Wonder", "country": "Singapore"})
    assert r.status_code == 200 and r.json()["user"]["full_name"] == "Alice Wonder"
    bad = c.post("/api/profile/password", json={"current_password": "nope", "new_password": "NewSecret9",
                                                "confirm_password": "NewSecret9"})
    assert bad.status_code == 422
    ok = c.post("/api/profile/password", json={"current_password": "Secret123", "new_password": "NewSecret9",
                                               "confirm_password": "NewSecret9"})
    assert ok.status_code == 200
    assert make_client().post("/api/auth/login", json={"identifier": "alice", "password": "NewSecret9"}).status_code == 200
