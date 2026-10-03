# create-ridhuan-backend

Create a backend project with your preferred framework and database. The CLI copies a working starter, writes your configuration, and gives you instructions for running it.

Choose **Express, NestJS, Go, ASP.NET Core, FastAPI, Spring Boot, or Laravel**, with **PostgreSQL or MySQL**. Each generated project includes authentication, permissions, audit logging, notifications, uploads, and API documentation.

**Start here:** [Get the CLI](#get-the-cli) → [Create a project](#create-a-project) → [Run your application](#run-your-application).

| Looking for… | Go to |
| --- | --- |
| Frameworks and required tools | [Choose a framework](#choose-a-framework) |
| Windows, macOS, Linux, and Docker | [Choose how to run it](#choose-how-to-run-it) |
| What the generated folders contain | [Understand your project](#understand-your-project) |
| Ports, Redis, storage, and other options | [Customize your setup](#customize-your-setup) |
| Detailed framework documentation | [Where to read next](#where-to-read-next) |
| Package tests and publication | [For maintainers](#for-maintainers) |

## Features

- Seven framework choices, each with PostgreSQL or MySQL.
- Typed starters with authentication, live permissions, audit, uploads, notifications, and an email worker.
- Manual or Docker setup, optional Redis and S3, and fresh local secrets.
- A generated setup guide and source/hash provenance for your selected template.

## Requirements

Run the CLI with Node `^22.13.0` or `>=24.0.0 <27`. Docker mode needs Docker Engine and Compose 2.24.4+; manual mode also needs the selected framework tools shown below. You need a database, but Redis, S3, and SMTP are optional.

## Get the CLI

Start the published CLI's guided setup:

```sh
npx create-ridhuan-backend@latest my-api
```

Or use npm create:

```sh
npm create ridhuan-backend@latest my-api
```

For a global installation:

```sh
npm install --global create-ridhuan-backend@latest
create-ridhuan-backend --help
```

The examples below use `create-ridhuan-backend` after global installation. You can also put `npx` before it to use a published version without installing globally.

<details>
<summary>Use a packed source artifact instead of a published release</summary>

Repository changes reach npm only after publication. To try an exact source revision, get the `cli-package` artifact from a completed [GitHub Actions run](https://github.com/RidhuanDEV/backend-modular/actions/workflows/cli-templates.yml), or [build it locally](#for-maintainers).

```sh
npm install --global ./create-ridhuan-backend-1.6.0.tgz
create-ridhuan-backend --help
```

Use the actual archive filename if its version differs. For npm-create options, add `--` before them:

```sh
npm create ridhuan-backend@latest my-api -- --template express-typescript --yes
```

`@latest` uses the published release, not unpublished repository changes.

</details>

## Create a project

**Guided setup:**

```sh
create-ridhuan-backend my-api
```

The wizard asks for your framework, database, run mode, ports, and optional Redis or S3 storage. Password input is hidden. Leaving a password empty generates one for you.

**Express + PostgreSQL + Docker, without prompts:**

```sh
create-ridhuan-backend my-api --template express-typescript --database postgresql --mode docker --yes
```

**Laravel + MySQL + Docker:**

```sh
create-ridhuan-backend my-api --template laravel --database mysql --mode docker --yes
```

`--yes` accepts defaults for remaining settings. Without it, the CLI prompts for anything you have not supplied. Defaults are Express, PostgreSQL, and manual mode.

The CLI creates your project; it does not start the application. Open **`GETTING-STARTED.md`** for the next commands. Generated passwords are saved in the ignored **`.env`** file and are not printed.

## Choose a framework

Every framework supports PostgreSQL and MySQL. These host tools are for **manual mode**; Docker builds the application inside containers.

| Framework | `--template` value | Main tools for manual mode | Default API port |
| --- | --- | --- | --- |
| Express TypeScript | `express-typescript` | Node 24.15+ and npm, below Node 27 | 3000 |
| NestJS | `nestjs` | Node 24.15+ and npm, below Node 27 | 3000 |
| Go | `golang` | Go 1.27.1 | 8080 |
| ASP.NET Core | `dotnet` | .NET SDK 10.0.401 | 5080 |
| FastAPI | `fastapi` | Python 3.13.3 and uv 0.12.21+ | 8000 |
| Spring Boot | `springboot` | JDK 25; included Maven Wrapper 3.9.16 | 8080 |
| Laravel | `laravel` | 64-bit PHP 8.5, required extensions, Composer 2.9.8+ | 8000 |

The CLI itself needs Node `^22.13.0` or `>=24.0.0 <27`. Your generated guide lists exact application requirements. Laravel also needs the selected PDO database driver. The .NET env loader uses PowerShell 7 on Windows or Python 3 on Linux/macOS.

## Choose how to run it

| Mode | Where the application runs | What the CLI does |
| --- | --- | --- |
| `--mode docker` | Inside Linux containers | Prepares Compose; skips host application dependency installation |
| `--mode manual` | Directly on your computer or server | Checks framework tools and installs dependencies |
| Either mode with `--no-install` | You decide later | Generates files and defers tool checks and installation |

Docker mode needs Docker Engine and Compose 2.24.4+. Node is still needed to run the CLI, but host PHP, Java, Go, or .NET is not needed to build their containers.

The same Compose setup runs on a Linux server or through Docker Desktop with Linux containers on Windows/macOS. **The CLI does not ask for a server OS.** It adapts local commands where needed, such as Windows Maven wrappers.

You receive **one selected framework project**. “Fourteen combinations” means seven frameworks × two databases in our test matrix. It does not mean fourteen projects or OS-specific Docker setups in your generated folder. Database alternatives and optional override files may remain beside the active Compose file.

## Run your application

Follow your generated `GETTING-STARTED.md`: its commands match your framework, database, and ports.

### Express + Docker example

After generating the Express Docker example above:

```sh
cd my-api
docker compose up --build -d --wait
docker compose exec app npm run seed:prod
```

Compose runs migrations before starting the application. The explicit seed command creates initial application data. The API process itself does not run migrations or seed.

| Default address | Purpose |
| --- | --- |
| `http://localhost:3000/docs` | Browse API documentation |
| `http://localhost:3000/live` | Check that HTTP is responding |
| `http://localhost:3000/ready` | Check required dependencies |

Other frameworks have different seed commands. Spring Boot also builds the app image separately before starting Compose; use its generated guide.

### Express + manual example

Generate with `--mode manual`. Provide the selected database first, create the database named in `.env`, and make sure its credentials match. Then:

```sh
cd my-api
npm run prisma:migrate:deploy
npm run build
npm run seed
npm start
```

Manual mode normally installs dependencies. If you used `--no-install`, run `npm ci` first. To process notification emails, run `npm run worker` in a separate terminal after building. SMTP is disabled by default.

## Understand your project

Folder names follow each framework's conventions. The generated framework README explains its own structure; linked technical reference and upgrade guides hold the deeper contracts.

<details>
<summary>Explore a generated Express project and its helper files</summary>

Here is a shortened **generated Express project**, including files the CLI adds:

```text
my-api/
├── src/
│   ├── app.ts                 # Connects Express middleware and routes
│   ├── server.ts              # Starts the HTTP server
│   ├── config/                # Environment, Prisma, and Redis settings
│   ├── constants/             # Permissions, modules, and audit identifiers
│   ├── core/                  # Shared auth, audit, cache, HTTP, and services
│   ├── modules/               # auth, user, roles, permissions, notifications, upload
│   ├── scripts/               # Seed, CRUD generator, email worker, cleanup
│   ├── docs/                  # OpenAPI generation and Swagger setup
│   ├── types/                 # Shared types and Express request declarations
│   └── utils/                 # Response and pagination helpers
├── prisma/                    # PostgreSQL schema and migration history
│   └── mysql/                 # MySQL schema and independent migrations
├── scripts/                   # Docker service helpers; explained below
├── tests/                     # Application and database integration checks
├── docs/                      # Upgrade and operational guidance
├── Dockerfile                 # Builds the application container
├── docker-compose.yml         # Active stack for the chosen database
├── docker-compose.mysql.yml   # Alternative MySQL stack
├── docker-compose.override.yml # Host port mappings
├── .env                       # Settings and secrets; ignored by Git
├── .env.example               # Configuration reference
├── .env.mysql.example         # MySQL configuration reference
├── .gitignore
├── package.json               # Dependencies and application commands
├── package-lock.json          # Locked dependency versions
├── prisma.config.ts           # Selects database schema and migrations
├── tsconfig.json              # TypeScript compiler configuration
├── eslint.config.js           # Code lint rules
├── backend-template.json      # Selected template, database, and source revision
├── template-manifest.json     # Bundled source file hashes and requirements
├── GETTING-STARTED.md          # Instructions matching CLI choices
├── DEVELOPER-GUIDE.md          # Feature development and module contracts
├── README.md                  # Framework setup and configuration
└── LICENSE
```

### Inside a feature module

The `user` module demonstrates the pattern:

| File or folder | Responsibility |
| --- | --- |
| `user.routes.ts` | Connects registered endpoints to controllers |
| `user.controller.ts` | Handles HTTP input and responses |
| `user.schema.ts` | Defines Zod validation and response schemas |
| `user.service.ts` | Implements business rules |
| `user.repository.ts` | Reads and writes database records |
| `dto/` | Defines request and response types |
| `mappers/` | Converts internal data to public response fields |
| `queries/` | Builds supported database queries |
| `policies/` | Implements feature access rules |

Other modules contain the parts they need; not every module has every folder. `src/core/http/endpoint-registry.ts` defines endpoint methods, paths, access, validation, audit, cache, and rate-limit policies. Read `DEVELOPER-GUIDE.md` before adding endpoints.

### Why there are two scripts folders

**Root `scripts/` supports Docker services:**

| File | What it does | Used when |
| --- | --- | --- |
| `mysql-entrypoint.sh` | Prepares startup before invoking the official MySQL entrypoint | Starting the MySQL stack |
| `mysql-init-user.sh` | Sets the app account's password with server-side quoting | Initializing MySQL |
| `minio.Dockerfile` | Builds the local S3-compatible server and client from pinned official source | Using local MinIO |
| `init-bucket.sh` | Creates the configured upload bucket | Starting local MinIO |
| `otel-collector.yaml` | Configures collection of traces and metrics | Using the telemetry collector |

**`src/scripts/` contains application commands:** seeding, CRUD generation/registration, OpenAPI generation, the email worker, and orphan-upload cleanup. For example, `npm run make:crud product` creates a feature scaffold; you still define its business fields, database model, and permissions. Both folders contain working files.

</details>

## Customize your setup

Keep settings in `.env` and restart/redeploy after changes. Generated escaping preserves quotes, dollar signs, backslashes, spaces, and Unicode; do not rewrite it by hand.

| Need | Option |
| --- | --- |
| Framework | `--template`, `-t` |
| Database | `--database postgresql` or `--database mysql` |
| Remaining defaults without prompts | `--yes`, `-y` |
| Manual or container setup | `--mode manual` or `--mode docker` |
| Files only | `--no-install` |
| Different host/manual API port | `--port 4000` |
| Database connection settings | `--db-host`, `--db-port`, `--db-name`, `--db-user` |
| Shared quota and cache | `--redis` or `--no-redis` |
| Upload storage | `--storage local` or `--storage s3` |
| S3 host/container connections | `--s3-endpoint`, `--s3-docker-endpoint` |
| S3 settings | `--s3-region`, `--s3-bucket`, `--s3-access-key` |
| Go import/module path | `--go-module` |
| Spring Boot Java namespace | `--java-package` |
| Complete help or installed version | `--help`, `--version` |

Without Redis, the CLI configures the single-instance memory limiter and disables its cache. Redis provides a shared limiter and cache. Local uploads do not need S3. Selecting the local S3 fixture enables its Compose profile; a remote S3 provider does not start that fixture. For multiple replicas, follow the framework guide's shared Redis configuration.

For automated credentials use the `RIDHUAN_DB_PASSWORD` and `RIDHUAN_S3_SECRET_KEY` environment variables. Passwords are not command arguments. Newline and NUL characters are rejected. MySQL also receives a separate generated root password.

<details>
<summary>Default service ports and option aliases</summary>

| Framework | API host / container | PostgreSQL host | Redis host | Local S3 host |
| --- | --- | --- | --- | --- |
| Express / NestJS | 3000 / 3000 | 5432 | 6379 | 9000 |
| Go | 8080 / 8080 | 5432 | 6379 | 9000 |
| ASP.NET Core | 5080 / 8080 | 55432 | 56379 | 19000 (S3Mock) |
| FastAPI | 8000 / 8000 | 5432 | 6379 | 9000 |
| Spring Boot | 8080 / 8080 | 5432 | 6379 | 9000 |
| Laravel | 8000 / 8080 | 5432 | 6379 | 9000 |

MySQL defaults to host port 3306 for every framework. Development database, Redis, and S3 ports bind to localhost. Change conflicting host ports when running several projects. `--port` changes the host/manual API port; container HTTP stays fixed.

Template aliases: `express`, `ts`, `nest`, `go`, `net`, `csharp`, `python`, `py`, `spring`, `java`, `php`. PostgreSQL also accepts `postgres` and `pg`.

</details>

### Common questions

<details>
<summary>Can I generate into an existing folder?</summary>

The target must be empty and must not be a symlink. The CLI rejects a nonempty destination to protect existing files.

</details>

<details>
<summary>What if dependency installation fails?</summary>

Generated files and secrets are preserved. The CLI prints a recovery command. Fix the tool/dependency issue, then follow that command and `GETTING-STARTED.md`.

</details>

<details>
<summary>Can I switch PostgreSQL to MySQL by editing .env?</summary>

Choose the database when generating. The project records that choice and rejects a provider mismatch. Editing `.env` does not convert tables or data; an existing app needs a reviewed database export/import or migration process.

</details>

<details>
<summary>Is every implementation file explained individually?</summary>

The guides explain the main structure, configuration, and development workflows. They are not a line-by-line description of every implementation file. Use the folder map and module pattern above to locate the relevant code.

</details>

## Where to read next

Inside your generated project:

| Document | Read it when… |
| --- | --- |
| `GETTING-STARTED.md` | You want to install and run the app using your choices |
| `README.md` | You need framework configuration and startup details |
| `DEVELOPER-GUIDE.md` (Express) | You want to add endpoints or understand module contracts |
| `docs/REFERENCE.md` | You need detailed configuration, contracts, and implementation reasoning |
| `docs/HARDENING-UPGRADE.md` | You are upgrading existing data or configuring sessions, SSE, workers, retention, or telemetry |
| Running `/docs` | You need API requests, responses, and access requirements |

Browse the bundled guides here:

[Express](templates/express-typescript/README.md) · [Express developer guide](templates/express-typescript/DEVELOPER-GUIDE.md) · [NestJS](templates/nestjs/README.md) · [Go](templates/golang/README.md) · [ASP.NET Core](templates/dotnet/README.md) · [FastAPI](templates/fastapi/README.md) · [Spring Boot](templates/springboot/README.md) · [Laravel](templates/laravel/README.md)

Email delivery is at least once: a crash after SMTP accepts an email can cause duplicate delivery. Cleanup is a separate command, not part of HTTP startup; inspect its dry run before applying deletions. Detailed settings follow each framework's actual contracts.

## For maintainers

<details>
<summary>Build, verify, and package this CLI</summary>

From `create-ridhuan-backend/`:

```sh
npm ci
npm run prepare:templates
npm run build
npm test
npm pack
```

`npm pack` also prepares templates and builds through its prepack hook. It creates the archive; it does not publish. Release snapshots require clean source repositories and record source commits and per-file hashes. `--allow-dirty` is for local development snapshots only.

Set `CLI_TARBALL` to a specific archive path to verify that artifact. Examples:

```sh
node scripts/verify-consumer.mjs express-typescript postgresql --runtime
node scripts/verify-compose.mjs express-typescript postgresql
```

Consumer checks install the archive outside the checkout and generate a project. `--runtime` additionally exercises a real database and API. Compose checks exercise the containerized app and dependencies. Use any template ID and either database.

| CI platform | Configured coverage |
| --- | --- |
| Linux | Fourteen consumers including database/API runtime, plus fourteen Compose stacks |
| Windows | Fourteen native/package/generator consumers |
| macOS | Six native consumers: FastAPI, Spring Boot, and Laravel with both databases |

Jobs use the run's shared immutable package. This describes configured coverage; check the actual run for passing results. It does not establish production deployment, capacity, or recovery.

For the hardening inventory and collected stages:

```sh
npm run test:hardening:plan
npm run test:hardening -- --stage all
```

Diagnostics live in OS TEMP outside the npm payload. Fixtures use owned project labels and clean their own Docker resources. The Spring runtime harness also needs Python 3.13.3 and JDK 25/keytool for client/TLS fixtures; these are verification tools, not host requirements for Docker generation.

Evidence: [testing task](https://github.com/RidhuanDEV/backend-modular/blob/main/docs/BACKEND-HARDENING-TEST-TASK.md) · [original five frameworks](https://github.com/RidhuanDEV/backend-modular/blob/main/docs/BACKEND-HARDENING-TEST-RESULTS.md) · [Spring Boot](https://github.com/RidhuanDEV/backend-modular/blob/main/docs/SPRING-BOOT-JAVA-VERIFICATION.md) · [Laravel](https://github.com/RidhuanDEV/backend-modular/blob/main/docs/LARAVEL-PHP-VERIFICATION.md).

Version bumps and npm publication need separate release authorization. Do not publish development snapshots.

</details>

MIT © RidhuanDEV
