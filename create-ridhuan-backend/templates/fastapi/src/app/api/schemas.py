from pydantic import BaseModel, ConfigDict, JsonValue, TypeAdapter


class DTO(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Success[T](DTO):
    success: bool = True
    data: T


def snapshot(model: BaseModel) -> JsonValue:
    return TypeAdapter[JsonValue](JsonValue).validate_python(
        model.model_dump(mode="json", by_alias=True)
    )
