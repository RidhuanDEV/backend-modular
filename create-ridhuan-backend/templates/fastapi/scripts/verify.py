"""Service-free checks using the already synchronized environment."""

import os
import subprocess
import sys


def main() -> None:
    environment = os.environ.copy()
    environment.setdefault(
        "JWT_SECRET", "verification-only-secret-that-is-never-used-for-deployment"
    )
    commands = (
        [sys.executable, "-m", "ruff", "check", "."],
        [sys.executable, "-m", "ruff", "format", "--check", "."],
        [sys.executable, "-m", "pyright"],
        [sys.executable, "-m", "pytest", "tests/unit", "-q"],
        [sys.executable, "-m", "app.cli.main", "openapi"],
    )
    for command in commands:
        subprocess.run(
            command,
            check=True,
            env=environment,
            stdout=subprocess.DEVNULL if command[-1] == "openapi" else None,
        )


if __name__ == "__main__":
    main()
