from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pydantic import SecretStr, ValidationError

from app.core.settings import Settings
from app.modules.auth.service import idle_expiry

SECRET = SecretStr("fixture-only-secret-000000000000000000")


@pytest.fixture(autouse=True)
def isolated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Keep a developer's .env out of the defaults under test.
    monkeypatch.chdir(tmp_path)


def test_refresh_lifetimes_default_to_30_idle_and_90_absolute() -> None:
    config = Settings(jwt_secret=SECRET)
    assert config.refresh_token_idle_days == 30
    assert config.refresh_token_absolute_days == 90


def test_refresh_lifetimes_come_from_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("REFRESH_TOKEN_IDLE_DAYS", "7")
    monkeypatch.setenv("REFRESH_TOKEN_ABSOLUTE_DAYS", "14")
    config = Settings(jwt_secret=SECRET)
    assert (config.refresh_token_idle_days, config.refresh_token_absolute_days) == (
        7,
        14,
    )


@pytest.mark.parametrize(("idle", "absolute"), [(0, 90), (30, 0), (31, 30)])
def test_invalid_refresh_lifetimes_fail_startup(idle: int, absolute: int) -> None:
    with pytest.raises(ValidationError):
        Settings(
            jwt_secret=SECRET,
            refresh_token_idle_days=idle,
            refresh_token_absolute_days=absolute,
        )


def test_rotation_never_extends_past_the_absolute_lifetime() -> None:
    config = Settings(jwt_secret=SECRET)
    login = datetime(2026, 1, 1, tzinfo=UTC)
    absolute = login + timedelta(days=90)
    assert idle_expiry(login, absolute, config) == login + timedelta(days=30)
    late = login + timedelta(days=80)
    assert idle_expiry(late, absolute, config) == absolute
