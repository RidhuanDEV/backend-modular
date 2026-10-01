from email.message import EmailMessage

import aiosmtplib

from app.core.settings import Settings


async def send_notification(settings: Settings, recipient: str, title: str, body: str) -> None:
    if not settings.smtp_enabled:
        raise RuntimeError("SMTP is disabled")
    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = recipient
    message["Subject"] = title
    message.set_content(body)
    await aiosmtplib.send(
        message,
        hostname=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_user or None,
        password=(
            settings.smtp_password.get_secret_value()
            if settings.smtp_user and settings.smtp_password
            else None
        ),
        use_tls=settings.smtp_secure,
        start_tls=not settings.smtp_secure,
        validate_certs=True,
        timeout=10,
    )
