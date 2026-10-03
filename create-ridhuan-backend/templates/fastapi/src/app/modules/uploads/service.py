import asyncio
import logging
from pathlib import PurePosixPath
from uuid import UUID, uuid4

from fastapi import UploadFile

from app.core.context import Context
from app.core.errors import ApiError
from app.core.settings import Settings
from app.modules.uploads.models import StoredFile
from app.modules.uploads.schemas import FileResponse, public_file
from app.platform.storage.service import Storage

logger = logging.getLogger(__name__)


def content_mime(header: bytes) -> tuple[str, str]:
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", "png"
    if header.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", "jpg"
    if header.startswith(b"%PDF-"):
        return "application/pdf", "pdf"
    raise ApiError(400, "Unsupported file content")


async def create(
    ctx: Context, upload: UploadFile, settings: Settings, storage: Storage
) -> FileResponse:
    if not settings.upload_enabled:
        raise ApiError(503, "Uploads disabled")
    # Starlette spools multipart files to disk; read bounded chunks to verify actual bytes.
    try:
        size = 0
        header = b""
        while chunk := await upload.read(65536):
            size += len(chunk)
            if size > settings.upload_max_bytes:
                raise ApiError(413, "File exceeds upload limit")
            if len(header) < 16:
                header = (header + chunk)[:16]
        mime, extension = content_mime(header)
        if (
            mime not in settings.upload_allowed_mime.split(",")
            or upload.content_type != mime
        ):
            raise ApiError(400, "File MIME does not match content")
        filename = PurePosixPath((upload.filename or "upload").replace("\\", "/")).name
        if len(filename) > 255 or any(ord(char) < 32 for char in filename):
            raise ApiError(400, "Invalid file name")
        key = f"{uuid4()}.{extension}"
        await upload.seek(0)
        try:
            await storage.put(key, upload.file, mime)
            row = StoredFile(
                storage=settings.upload_storage,
                object_key=key,
                original_name=filename,
                mime_type=mime,
                size=size,
                uploader_id=ctx.require_actor().id,
            )
            ctx.session.add(row)
            await ctx.session.flush()
            response = public_file(row)
            await ctx.commit(row.id, after=response)
            return response
        except (Exception, asyncio.CancelledError):
            try:
                await storage.delete(key)
            except Exception:
                logger.warning("Upload compensation failed; run orphan cleanup")
            raise
    finally:
        await upload.close()


async def get(ctx: Context, id: UUID) -> FileResponse:
    row = await ctx.session.get(StoredFile, id)
    if row is None or row.status != "READY":
        raise ApiError(404, "File not found")
    return public_file(row)
