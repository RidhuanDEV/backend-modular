# Engineering rules

Read README.md, DEPENDENCIES.md and contracts before editing. Trace Pydantic DTO -> router -> service -> repository -> SQLAlchemy mapping -> Alembic migration. Use strict Pyright and explicit types; no Any or ORM entity serialization. Platform SDK boundaries must validate unknown values before passing them to application code.

Keep required audit and business mutations in one transaction. Optional audit failures must be logged. Authorization reads live grants. Session instances must never be shared between concurrent tasks. Commit before returning success. SSE uses short sessions, ordered persisted cursors and bounded batches.

Configuration is environment plus redeployment. Preserve PostgreSQL migration history. Database provider is chosen during generation; changing env alone does not convert existing data. API startup never migrates or seeds. Keep secrets out of logs, tests and Git.

Run scripts/verify.py for service-free checks; database acceptance requires actual PostgreSQL and MySQL. Distinguish local checks, Compose tests and deployment evidence. Never claim production completion from compilation alone.
