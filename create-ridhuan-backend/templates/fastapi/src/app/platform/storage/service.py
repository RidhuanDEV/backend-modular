from __future__ import annotations

import shutil
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, BinaryIO

import boto3
from boto3.s3.transfer import TransferConfig
from botocore.config import Config

if TYPE_CHECKING:
    from mypy_boto3_s3.client import S3Client

from app.core.blocking import BlockingPool
from app.core.settings import Settings


@dataclass(frozen=True)
class ObjectInfo:
    key: str
    modified: datetime


class Storage:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.work = BlockingPool(workers=4, wait_on_cancel=True)
        self.root = settings.upload_local_dir.resolve()
        self.client: S3Client | None = None
        if settings.upload_storage == "s3":
            self.client = boto3.client(
                "s3",
                endpoint_url=settings.s3_endpoint,
                region_name=settings.s3_region,
                aws_access_key_id=settings.s3_access_key_id.get_secret_value()
                if settings.s3_access_key_id
                else None,
                aws_secret_access_key=settings.s3_secret_access_key.get_secret_value()
                if settings.s3_secret_access_key
                else None,
                config=Config(
                    connect_timeout=3,
                    read_timeout=10,
                    retries={"max_attempts": 2},
                    s3={"addressing_style": "path" if settings.s3_force_path_style else "auto"},
                ),
            )

    def path(self, key: str) -> Path:
        target = self.root / key
        if (
            not key
            or Path(key).name != key
            or "\\" in key
            or target.is_symlink()
            or target.parent.resolve() != self.root
        ):
            raise ValueError("Unsafe storage key")
        return target

    def _put(self, key: str, stream: BinaryIO, mime: str) -> None:
        if self.client:
            self.client.upload_fileobj(
                stream,
                self.settings.s3_bucket,
                key,
                ExtraArgs={"ContentType": mime},
                Config=TransferConfig(use_threads=False, max_concurrency=1),
            )
        else:
            self.root.mkdir(parents=True, exist_ok=True)
            with self.path(key).open("xb") as target:
                shutil.copyfileobj(stream, target, length=65536)

    async def put(self, key: str, stream: BinaryIO, mime: str) -> None:
        await self.work.run(self._put, key, stream, mime)

    def _delete(self, key: str) -> None:
        if self.client:
            self.client.delete_object(Bucket=self.settings.s3_bucket, Key=key)
        else:
            self.path(key).unlink(missing_ok=True)

    async def delete(self, key: str) -> None:
        await self.work.run(self._delete, key)

    async def close(self) -> None:
        await self.work.close()
        if self.client:
            self.client.close()

    def objects(self) -> Iterator[ObjectInfo]:
        if self.client:
            paginator = self.client.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=self.settings.s3_bucket):
                for item in page.get("Contents", []):
                    if "Key" in item and "LastModified" in item:
                        yield ObjectInfo(item["Key"], item["LastModified"])
        elif self.root.exists():
            for path in self.root.iterdir():
                if path.is_file() and not path.is_symlink():
                    yield ObjectInfo(path.name, datetime.fromtimestamp(path.stat().st_mtime, UTC))
