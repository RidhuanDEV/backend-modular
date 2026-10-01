from pathlib import Path
from typing import Literal, Self
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DatabaseProvider = Literal["postgresql", "mysql"]


class GeneratedProject(BaseModel):
    databaseProvider: DatabaseProvider


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    port: int = Field(default=8000, ge=1, le=65535)
    db_provider: DatabaseProvider = "postgresql"
    database_url: SecretStr = SecretStr("postgresql://backend:backend@localhost:5432/backend")
    database_tls: Literal["disable", "verify-full"] = "disable"
    database_ca_file: Path | None = None
    jwt_secret: SecretStr = SecretStr("")
    jwt_issuer: str = "modular-fastapi"
    jwt_audience: str = "modular-fastapi-api"
    cors_origins: str = "http://localhost:5173,http://localhost:3000"
    endpoint_policies_json: str = "{}"
    app_instance_count: int = Field(default=1, ge=1)
    rate_limit_store: Literal["memory", "redis"] = "memory"
    rate_limit_auth_max: int = Field(default=20, ge=1)
    rate_limit_auth_window_ms: int = Field(default=900000, ge=1)
    rate_limit_public_max: int = Field(default=100, ge=1)
    rate_limit_public_window_ms: int = Field(default=900000, ge=1)
    rate_limit_internal_max: int = Field(default=300, ge=1)
    rate_limit_internal_window_ms: int = Field(default=900000, ge=1)
    cache_enabled: bool = False
    redis_url: SecretStr = SecretStr("redis://localhost:6379")
    redis_namespace: str = "modular-fastapi"
    upload_enabled: bool = True
    upload_storage: Literal["local", "s3"] = "local"
    upload_local_dir: Path = Path("uploads")
    upload_max_bytes: int = Field(default=10485760, ge=1)
    upload_allowed_mime: str = "image/png,image/jpeg,application/pdf"
    upload_orphan_grace_hours: int = Field(default=24, ge=1)
    s3_endpoint: str | None = None
    s3_region: str = "us-east-1"
    s3_bucket: str = "backend-uploads"
    s3_access_key_id: SecretStr | None = None
    s3_secret_access_key: SecretStr | None = None
    s3_force_path_style: bool = True
    smtp_enabled: bool = False
    smtp_host: str = ""
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_secure: bool = False
    smtp_user: str | None = None
    smtp_password: SecretStr | None = None
    smtp_from: str = ""
    admin_email: str = "admin@example.test"
    admin_password: SecretStr | None = None

    @property
    def origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @model_validator(mode="after")
    def validate_deployment(self) -> Self:
        if len(self.jwt_secret.get_secret_value().encode()) < 32:
            raise ValueError("JWT_SECRET requires at least 32 bytes")
        scheme = urlsplit(self.database_url.get_secret_value()).scheme
        if scheme not in (
            {"postgresql", "postgres"} if self.db_provider == "postgresql" else {"mysql"}
        ):
            raise ValueError("DATABASE_URL does not match DB_PROVIDER")
        if self.database_ca_file is not None and (
            self.database_tls != "verify-full" or not self.database_ca_file.is_file()
        ):
            raise ValueError("DATABASE_CA_FILE requires verify-full and a readable CA file")
        marker = Path("backend-template.json")
        if marker.exists():
            value = GeneratedProject.model_validate_json(marker.read_text(encoding="utf-8"))
            if value.databaseProvider != self.db_provider:
                raise ValueError("DB_PROVIDER does not match the generated project")
        if self.environment == "production" and (
            not self.origins or "cors_origins" not in self.model_fields_set
        ):
            raise ValueError("Production requires CORS_ORIGINS")
        if self.environment == "production" and "CHANGE_ME" in self.jwt_secret.get_secret_value():
            raise ValueError("Production requires a generated JWT_SECRET")
        for origin in self.origins:
            parsed = urlsplit(origin)
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.netloc
                or parsed.path
                or parsed.query
                or parsed.fragment
                or parsed.username
            ):
                raise ValueError("CORS_ORIGINS requires exact HTTP(S) origins")
        if self.app_instance_count > 1 and self.rate_limit_store != "redis":
            raise ValueError("Multiple instances require RATE_LIMIT_STORE=redis")
        if self.smtp_enabled and (
            not self.smtp_host
            or not self.smtp_from
            or bool(self.smtp_user) != bool(self.smtp_password)
        ):
            raise ValueError("SMTP requires host, sender and matching credentials")
        if self.upload_storage == "s3" and (
            not self.s3_access_key_id or not self.s3_secret_access_key
        ):
            raise ValueError("S3 storage requires credentials")
        if not self.redis_namespace or any(
            char not in "abcdefghijklmnopqrstuvwxyz0123456789_-" for char in self.redis_namespace
        ):
            raise ValueError("Invalid REDIS_NAMESPACE")
        if not set(self.upload_allowed_mime.split(",")) <= {
            "image/png",
            "image/jpeg",
            "application/pdf",
        }:
            raise ValueError("Unsupported UPLOAD_ALLOWED_MIME")
        return self
