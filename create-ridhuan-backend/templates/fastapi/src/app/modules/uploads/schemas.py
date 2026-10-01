from datetime import datetime
from uuid import UUID

from app.api.schemas import DTO
from app.modules.uploads.models import StoredFile


class FileResponse(DTO):
    id: UUID
    originalName: str
    mimeType: str
    size: int
    createdAt: datetime


def public_file(row: StoredFile) -> FileResponse:
    return FileResponse(
        id=row.id,
        originalName=row.original_name,
        mimeType=row.mime_type,
        size=row.size,
        createdAt=row.created_at,
    )
