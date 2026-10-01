# Dependencies

Runtime resolutions are recorded exactly in `uv.lock`; install with `uv sync --locked`. Python is 3.13; the Docker runtime uses the verified 3.13.12 patch. Update pins/locks intentionally and rerun both provider gates.

| Component | Locked version | Publisher / license | Purpose |
| --- | --- | --- | --- |
| FastAPI | 0.139.2 | FastAPI / MIT | HTTP routing, DI, OpenAPI, native SSE |
| Starlette | 1.7.0 | Encode / BSD-3-Clause | ASGI/multipart/streaming |
| Uvicorn | 0.54.0 | Encode / BSD-3-Clause | ASGI server |
| Pydantic | 2.13.5 | Pydantic / MIT | Explicit DTO and settings validation |
| SQLAlchemy | 2.0.54 | SQLAlchemy / MIT | Async persistence and native type mapping |
| Alembic | 1.20.0 | SQLAlchemy / MIT | Separate migration histories |
| psycopg | 3.3.6 | Psycopg / LGPL-3.0 | PostgreSQL async driver |
| aiomysql | 0.3.2 | aio-libs / MIT | MySQL async driver |
| PyJWT | 2.15.1 | PyJWT / MIT | JWT with official cryptography extra |
| pwdlib | 0.3.1 | pwdlib / MIT | Argon2 password hashes |
| redis | 7.4.1 | Redis / MIT | Optional Redis cache and atomic limiter |
| boto3 | 1.43.106 | AWS / Apache-2.0 | Official S3 SDK |
| aiosmtplib | 5.1.3 | aiosmtplib / MIT | Async SMTP with verified TLS |
| python-multipart | 0.0.32 | python-multipart / Apache-2.0 | Spooled multipart parsing |
| uv | 0.12.21 | Astral / MIT or Apache-2.0 | Locked installs/builds |

Development tooling: Ruff, strict Pyright, pytest, HTTPX, pip-audit and AWS boto3-stubs-lite. SDK response typing stays within the storage adapter. The Redis SDK's unannotated execution boundary is narrowly suppressed and its output validated before returning a typed value; suppressions must not hide application contract errors.

Primary documentation: [FastAPI](https://fastapi.tiangolo.com/), [SQLAlchemy](https://docs.sqlalchemy.org/en/20/), [Alembic](https://alembic.sqlalchemy.org/), [uv Docker integration](https://docs.astral.sh/uv/guides/integration/docker/), [boto3](https://boto3.amazonaws.com/v1/documentation/api/latest/index.html).

Docker images: official Python, PostgreSQL and MySQL; Redis; verified MinIO images in `scripts/minio.Dockerfile`. Review bundled/transitive licenses and redistribution terms when distributing a derived application.
