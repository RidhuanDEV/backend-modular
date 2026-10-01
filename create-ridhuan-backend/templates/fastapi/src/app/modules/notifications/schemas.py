from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.api.schemas import DTO
from app.modules.notifications.models import EmailStatus, Notification


class CreateNotification(DTO):
    recipientId: UUID
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(min_length=1, max_length=4000)
    sendEmail: bool = False


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
