FROM ghcr.io/astral-sh/uv:0.12.21 AS uv
FROM python:3.13.12-slim-bookworm AS build
COPY --from=uv /uv /uvx /bin/
WORKDIR /app
ARG DB_PROVIDER=postgresql
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 UV_PYTHON_DOWNLOADS=never UV_PYTHON=/usr/local/bin/python
COPY pyproject.toml uv.lock .python-version ./
COPY src ./src
RUN test "$DB_PROVIDER" = postgresql -o "$DB_PROVIDER" = mysql && uv sync --locked --no-dev --extra "$DB_PROVIDER" --no-editable

FROM python:3.13.12-slim-bookworm AS runtime
WORKDIR /app
ENV PATH=/app/.venv/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --no-create-home app && mkdir uploads && chown app:app uploads
COPY --from=build /app/.venv ./.venv
COPY migrations ./migrations
COPY alembic.ini ./
USER app
EXPOSE 8000
CMD ["backend", "serve"]
