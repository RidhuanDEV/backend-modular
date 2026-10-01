from email.message import EmailMessage

import pytest
from pydantic import SecretStr

from app.core.settings import Settings
from app.platform.mail.service import send_notification


@pytest.mark.parametrize("secure", [False, True])
async def test_empty_smtp_credentials_do_not_request_authentication(
    monkeypatch: pytest.MonkeyPatch, secure: bool
) -> None:
    captured: dict[str, object] = {}

    async def capture(message: EmailMessage, **kwargs: object) -> None:
        assert message["To"] == "recipient@example.test"
        captured.update(kwargs)

    monkeypatch.setattr("app.platform.mail.service.aiosmtplib.send", capture)
    settings = Settings(
        jwt_secret=SecretStr("fixture-only-secret-000000000000000000"),
        smtp_enabled=True,
        smtp_host="mailfixture",
        smtp_from="sender@example.test",
        smtp_user="",
        smtp_password=SecretStr(""),
        smtp_secure=secure,
    )
    await send_notification(settings, "recipient@example.test", "Title", "Body")
    assert captured["username"] is None
    assert captured["password"] is None
    assert captured["validate_certs"] is True
    assert captured["use_tls"] is secure
    assert captured["start_tls"] is not secure
