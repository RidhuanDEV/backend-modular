from datetime import datetime
from uuid import UUID

from pydantic import Field, field_validator

from app.api.schemas import DTO
from app.modules.notifications.models import EmailStatus, Notification


class CreateNotification(DTO):
    recipientId: UUID
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(min_length=1, max_length=4000)
    sendEmail: bool = False

    @field_validator("title")
    @classmethod
    def single_line_title(cls, value: str) -> str:
        # The title becomes the email subject header; line breaks would inject headers.
        if "\r" in value or "\n" in value:
            raise ValueError("title must be a single line")
        return value


class NotificationResponse(DTO):
    id: UUID
    recipientId: UUID
    title: str
    body: str
    emailStatus: EmailStatus
    readAt: datetime | None
    createdAt: datetime


def public_notification(row: Notification) -> NotificationResponse:
    return NotificationResponse(
        id=row.id,
        recipientId=row.recipient_id,
        title=row.title,
        body=row.body,
        emailStatus=row.email_status,
        readAt=row.read_at,
        createdAt=row.created_at,
    )


class NotificationAudit(DTO):
    """Audit snapshot: the private message body is recorded by length only."""

    id: UUID
    recipientId: UUID
    title: str
    bodyLength: int
    emailStatus: EmailStatus
    readAt: datetime | None


def audit_notification(row: Notification) -> NotificationAudit:
    return NotificationAudit(
        id=row.id,
        recipientId=row.recipient_id,
        title=row.title,
        bodyLength=len(row.body),
        emailStatus=row.email_status,
        readAt=row.read_at,
    )
