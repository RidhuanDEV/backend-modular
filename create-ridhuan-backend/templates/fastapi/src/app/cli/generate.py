"""Generate a typed read module and register its route, policy and database model."""

import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

from pydantic import JsonValue, TypeAdapter


def generate_module(name: str) -> None:
    if not re.fullmatch(r"[a-z][a-z0-9]*(?:_[a-z0-9]+)*", name) or len(name) > 40:
        raise ValueError("Use a snake_case module name of at most 40 characters")
    if importlib.util.find_spec("ruff") is None:
        raise ValueError(
            "Module generation requires development tools; run uv sync --locked --extra "
            "postgresql or uv sync --locked --extra mysql for the selected provider"
        )
    root = Path("src/app")
    target = root / "modules" / name
    symbol = "".join(part.capitalize() for part in name.split("_"))
    router_alias = f"generated_{name}_router"
    identifier = name.upper() + "_LIST"
    registry = root / "api/registry.py"
    main = root / "main.py"
    models = root / "database/models.py"
    if target.exists():
        raise ValueError("Module already exists; no files overwritten")
    original_models = models.read_text(encoding="utf-8")
    if re.search(rf"\b{symbol}\b", original_models):
        raise ValueError("Entity name collides with an existing model; choose another module name")
    edits = {
        registry: (
            "class EndpointId(StrEnum):",
            f'class EndpointId(StrEnum):\n    {identifier} = "{name}.list"',
        ),
        main: (
            "feature_routers = (",
            f"feature_routers = ({router_alias}, ",
        ),
    }
    contents: dict[Path, str] = {}
    for path, (anchor, replacement) in edits.items():
        original = path.read_text(encoding="utf-8")
        if original.count(anchor) != 1:
            raise ValueError(f"Composition anchor changed: {path}")
        contents[path] = original.replace(anchor, replacement)
    policy_anchor = "_policies = ["
    if contents[registry].count(policy_anchor) != 1:
        raise ValueError("Policy registry anchor changed")
    contents[registry] = contents[registry].replace(
        policy_anchor,
        policy_anchor + f'\n    Policy(EndpointId.{identifier}, "GET", "/api/{name}", "{name}"),',
    )
    contents[main] = (
        f"from app.modules.{name}.router import router as {router_alias}\n" + contents[main]
    )
    contents[models] = original_models + (
        f"\nfrom app.modules.{name}.models import {symbol} as {symbol}\n"
    )
    contract = Path("contracts/endpoints.json")
    inventory = TypeAdapter(list[dict[str, JsonValue]]).validate_json(
        contract.read_text(encoding="utf-8")
    )
    declaration: dict[str, JsonValue] = {
        "id": f"{name}.list",
        "method": "GET",
        "path": f"/api/{name}",
        "module": name,
        "status": 200,
        "audit": "none",
        "rateLimit": "internal",
        "cache": "off",
        "permission": None,
        "authenticated": True,
    }
    contents[contract] = json.dumps([declaration, *inventory], indent=2) + "\n"
    files = {
        "__init__.py": "",
        "models.py": f'''from uuid import UUID, uuid4
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column
from app.database.base import Base
from app.database.types import Guid

class {symbol}(Base):
    __tablename__ = "{name}"
    id: Mapped[UUID] = mapped_column(Guid(), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
''',
        "schemas.py": f"""from uuid import UUID
from app.api.schemas import DTO

class {symbol}Response(DTO):
    id: UUID
    name: str
""",
        "repository.py": f"""from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.{name}.models import {symbol}

async def list_items(session: AsyncSession) -> list[{symbol}]:
    return list(await session.scalars(select({symbol}).order_by({symbol}.id).limit(100)))
""",
        "service.py": f"""from app.core.context import Context
from app.modules.{name}.repository import list_items
from app.modules.{name}.schemas import {symbol}Response

async def list_responses(ctx: Context) -> list[{symbol}Response]:
    return [{symbol}Response(id=row.id, name=row.name) for row in await list_items(ctx.session)]
""",
        "router.py": f'''from fastapi import APIRouter
from app.api.dependencies import RequestContext
from app.api.registry import EndpointId
from app.api.schemas import Success
from app.modules.{name}.schemas import {symbol}Response
from app.modules.{name}.service import list_responses

router = APIRouter(prefix="/api/{name}", tags=["{name}"])

@router.get("", operation_id=EndpointId.{identifier})
async def list_module(ctx: RequestContext) -> Success[list[{symbol}Response]]:
    return Success(data=await list_responses(ctx))
''',
    }
    target.mkdir()
    for filename, content in files.items():
        (target / filename).write_text(content, encoding="utf-8", newline="\n")
    for path, content in contents.items():
        path.write_text(content, encoding="utf-8", newline="\n")
    python_paths = [str(target), *(str(path) for path in contents if path.suffix == ".py")]
    subprocess.run([sys.executable, "-m", "ruff", "check", *python_paths, "--fix"], check=True)
    subprocess.run([sys.executable, "-m", "ruff", "format", *python_paths], check=True)
    print(
        f"Generated {name}: review authorization, then create/review a provider migration before serving."
    )
