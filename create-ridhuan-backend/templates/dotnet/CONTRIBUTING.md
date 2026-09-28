# Contributing

Issues and pull requests are welcome. For significant changes, describe the problem and intended behavior in an issue first. Do not include secrets or real customer data.

## Development

1. Install the SDK pinned in `global.json` and restore with `dotnet restore --locked-mode`.
2. Read `AGENTS.md`, `docs/CONTRACTS.md`, and `docs/ADDING-MODULES.md` before changing API or persistence contracts.
3. Keep nullable types explicit, preserve project dependency direction, and use official packages with pinned versions and license/publisher details.
4. Run Release build, formatter verification, unit and contract tests. Run integration tests against real PostgreSQL/Redis/S3-compatible services when changing those boundaries. Report gates that could not be run.
5. Update documentation and `CHANGELOG.md` under `Unreleased` when behavior or setup changes.

Pull requests should explain the user-visible effect, test evidence, and any migration or configuration impact. Avoid combining unrelated changes.
