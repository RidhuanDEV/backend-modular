# CI fixes and CLI release 1.3.0

## Proven failures and changes

| Repository | Failed run | Cause | Fix |
| --- | --- | --- | --- |
| Express | 36733698614 | Parallel HTTP suites created the same permission through Prisma read-then-create upsert; the unique name constraint failed. | Fixture setup uses atomic createMany with skipDuplicates followed by explicit findUniqueOrThrow. Parallel tests remain enabled. |
| NestJS | 36733706448 | Compose could not resolve DATABASE_URL_DOCKER; the smoke stack also used the same PostgreSQL host port as the Actions service. | Startup/cleanup use the committed .env.example explicitly. Compose PostgreSQL/Redis/HTTP host ports are separated from Actions services. |
| Go | 36733714635 | DATABASE_URL_DOCKER referenced app_user/app_db while PostgreSQL initialized backend/backend. | The example container URI now matches POSTGRES_USER/PASSWORD/DB. CI waits for readiness and prints scoped diagnostics on failure. |

The ASP.NET Core run 36733722709 passed and its source is unchanged.

## Focused local evidence

- Express: both database-backed HTTP suites passed concurrently on a fresh disposable PostgreSQL database (2 passed, 0 failed).
- NestJS: the updated CI Compose configuration built, migrated and reached /ready successfully, using separate host ports and the example env file.
- Go: the committed example env credentials built, migrated and reached /ready successfully; no private developer env was used.
- CLI: release 1.3.0 is prepared through normal prepack with clean framework source manifests. The actual tarball is checked with CLI scaffold/default/custom/error/recovery/npm exec/npm create tests.

## Source commits in snapshot

| Framework | Commit |
| --- | --- |
| Express | afff779f7ce45ee5fa8fb1e2f8c73a4d6e7abebb |
| NestJS | 8bc3d09080ed631789dc5e26ae06536cd6b7ddc5 |
| Go | f628ab3f00b577c526b4821dffb0e4df7d728ff2 |
| ASP.NET Core | 31b1d937905f5ea70f04140726e92a05181e5446 |

Framework commits are pushed to main and checked against the remote refs. The root commit updates the submodule pointers, clean snapshots and npm package/lockfile version together.

## Publication

1. Check the framework CI and the root CLI consumer/Compose workflow for the final commit.
2. Publish the tested 1.3.0 tarball when all required jobs are green. Publication is a user-run step; this work does not publish npm automatically.

```powershell
Set-Location "D:\Ridhuan Ngoding Moment\React\template-JS\create-ridhuan-backend"
npm publish .\create-ridhuan-backend-1.3.0.tgz --access public
npm view create-ridhuan-backend version
npx create-ridhuan-backend@latest --version
```

Version 1.2.0 was already present in the public npm registry when this fix started. Version 1.3.0 was not published when checked. The local fixtures use synthetic credentials and their containers/volumes are removed after verification.
