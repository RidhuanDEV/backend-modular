from typing import Annotated

from email_validator import EmailNotValidError, validate_email
from pydantic import AfterValidator, BeforeValidator, Field


def normalize_email(value: object) -> object:
    return value.strip().lower() if isinstance(value, str) else value


def email_address(value: str) -> str:
    try:
        # HTTP format validation; no DNS dependency. Reserved .test is accepted for
        # generated fixtures and developer projects, as in the reference templates.
        return validate_email(value, check_deliverability=False, test_environment=True).normalized
    except EmailNotValidError as error:
        raise ValueError("Invalid email") from error


Email = Annotated[
    str,
    BeforeValidator(normalize_email),
    AfterValidator(email_address),
    Field(max_length=255, json_schema_extra={"format": "email"}),
]
