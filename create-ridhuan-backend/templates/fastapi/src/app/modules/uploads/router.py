from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, UploadFile

from app.api.dependencies import AppRuntime, RequestContext
from app.api.registry import EndpointId
from app.api.schemas import Success
from app.modules.uploads import service
from app.modules.uploads.schemas import FileResponse

router = APIRouter(prefix="/api/upload", tags=["upload"])


@router.post("", operation_id=EndpointId.UPLOAD_CREATE, status_code=201)
async def create(
    file: Annotated[UploadFile, File()], ctx: RequestContext, run: AppRuntime
) -> Success[FileResponse]:
    return Success(data=await service.create(ctx, file, run.settings, run.storage))


@router.get("/{id}", operation_id=EndpointId.UPLOAD_GET)
async def get(id: UUID, ctx: RequestContext) -> Success[FileResponse]:
    return Success(data=await service.get(ctx, id))
