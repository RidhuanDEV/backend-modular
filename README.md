# Backend Modular

**Choose your framework. Generate one backend. Run it your way.**

[![Main CI](https://github.com/RidhuanDEV/backend-modular/actions/workflows/cli-templates.yml/badge.svg?branch=main&event=push)](https://github.com/RidhuanDEV/backend-modular/actions/workflows/cli-templates.yml)
[![GitHub stars](https://img.shields.io/github/stars/RidhuanDEV/backend-modular?style=flat-square)](https://github.com/RidhuanDEV/backend-modular/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/RidhuanDEV/backend-modular?style=flat-square)](https://github.com/RidhuanDEV/backend-modular/forks)
[![npm version](https://img.shields.io/npm/v/create-ridhuan-backend?style=flat-square)](https://www.npmjs.com/package/create-ridhuan-backend)
[![npm monthly downloads](https://img.shields.io/npm/dm/create-ridhuan-backend?style=flat-square)](https://www.npmjs.com/package/create-ridhuan-backend)
[![MIT license](https://img.shields.io/github/license/RidhuanDEV/backend-modular?style=flat-square)](LICENSE)

Backend Modular brings seven backend starters together behind one CLI: **`create-ridhuan-backend`**. Choose a framework, PostgreSQL or MySQL, and manual or Docker setup. The CLI creates a project with configuration and instructions matching your choices.

This repository contains the CLI, bundled template snapshots, the framework source repositories as Git submodules, and shared verification documentation. Your generated application contains only the framework you select.

**Explore:** [Quick start](#quick-start) · [Frameworks](#frameworks) · [What you get](#what-you-get) · [Repository map](#repository-map) · [Metrics](#repository-metrics) · [CI explained](#how-verification-works) · [Contribute](#work-on-this-repository)

## Quick start

### Use the published CLI

```sh
npx create-ridhuan-backend@latest my-api
```

The wizard guides you through the setup. For an Express project with PostgreSQL in Docker:

```sh
npx create-ridhuan-backend@latest my-api --template express-typescript --database postgresql --mode docker --yes
```

Open the generated **`GETTING-STARTED.md`** before running the application. Passwords are generated or entered through hidden prompts and saved in the ignored `.env` file.

**Release note:** `@latest` uses the version published to npm. Repository changes and CI artifacts can be newer than that release. For the exact source revision, use the packed artifact described in the [CLI guide](create-ridhuan-backend/README.md#get-the-cli).

<details>
<summary>What happens after I run the command?</summary>

1. You choose a framework, database, and run mode.
2. The CLI copies that framework's bundled template into `my-api/`.
3. It writes your settings, secrets, and template provenance.
4. In manual mode it checks host tools and installs dependencies, unless you choose `--no-install`. Docker mode skips host application dependency installation.
5. You follow `GETTING-STARTED.md` to migrate, seed, and start the application.

The CLI generates the project; it does not start your server. Generated files are bundled in the npm package, so scaffolding does not clone the framework repositories from GitHub.

</details>

## Frameworks

All seven templates in this source revision support **PostgreSQL and MySQL**.

| Framework | CLI template | Main building blocks | Source |
| --- | --- | --- | --- |
| Express TypeScript | `express-typescript` | Express, Prisma, Zod | [Express repository](https://github.com/RidhuanDEV/modular-express-typescript-starter-postgre) |
| NestJS | `nestjs` | NestJS, Prisma, validation, Swagger | [NestJS repository](https://github.com/RidhuanDEV/modular-nestjs) |
| Go | `golang` | Chi, Huma, sqlc, Goose | [Go repository](https://github.com/RidhuanDEV/golang-backend) |
| ASP.NET Core | `dotnet` | ASP.NET Core, EF Core | [.NET repository](https://github.com/RidhuanDEV/NET-backend) |
| FastAPI | `fastapi` | FastAPI, Pydantic, SQLAlchemy, Alembic | [FastAPI repository](https://github.com/RidhuanDEV/modular-fastapi) |
| Spring Boot | `springboot` | Spring MVC, JPA, Flyway | [Spring Boot repository](https://github.com/RidhuanDEV/modular-springboot) |
| Laravel | `laravel` | Laravel, Eloquent, native migrations | [Laravel repository](https://github.com/RidhuanDEV/modular-laravel) |

Read the [CLI framework table](create-ridhuan-backend/README.md#choose-a-framework) for host tool requirements. Each framework keeps its own contracts, migrations, and development conventions.

## What you get

| Included | Purpose |
| --- | --- |
| Authentication and permissions | Sign-in, refresh sessions, roles, and access checks |
| Audit logging | Record application changes according to endpoint policies |
| Notifications and SSE | Persist notifications and stream updates to recipients |
| Email worker | Process notification email through the configured SMTP service |
| Local or S3 uploads | Store files using the selected adapter |
| Optional Redis | Shared rate limiting and caching |
| API documentation | Inspect the application's requests and responses at `/docs` |
| Migrations and seed commands | Set up database structure and initial data explicitly |
| Docker configuration | Build and run the application with its selected services |
| Generated setup guide | Follow commands matching your framework, ports, and database |

### One project, two ways to run it

| Choice | Application runs in | Required on the host |
| --- | --- | --- |
| Docker mode | Linux containers | Node for the CLI, Docker Engine, and Compose |
| Manual mode | Your computer or server | Node for the CLI, selected framework tools, and database access |

Docker projects can run on Linux servers or locally through Docker Desktop using Linux containers on Windows/macOS. The CLI does not ask for the server OS. There are **14 framework/database combinations**, not 14 Docker setups copied into each generated project. Database variants and optional override files may remain in that one project.

For an Express folder walkthrough, including the difference between `scripts/` and `src/scripts/`, see [Understand your project](create-ridhuan-backend/README.md#understand-your-project).

## Repository map

```text
backend-modular/
├── create-ridhuan-backend/              # npm CLI package
│   ├── src/                            # CLI prompts and project generation
│   ├── templates/                      # Bundled, source-verified snapshots
│   ├── scripts/                        # Packaging and verification tools
│   └── README.md                       # User setup, options, and folder guide
├── modular-express-typescript-starter-postgre/ # Express source submodule
├── nestjs/                             # NestJS source submodule
├── modular-golang/                     # Go source submodule
├── modular-NET/                        # .NET source submodule
├── modular-fastapi/                    # FastAPI source submodule
├── modular-springboot/                 # Spring Boot source submodule
├── modular-laravel/                    # Laravel source submodule
├── docs/                               # Plans, audits, and verification evidence
├── .github/workflows/                  # CI and explicit publication workflow
├── .gitmodules                         # Source repository paths and URLs
├── LICENSE
└── README.md
```

**Using the CLI?** Start with the [CLI README](create-ridhuan-backend/README.md). **Changing a framework?** Work in its source repository; bundled template snapshots are prepared from those sources.

## Repository metrics

The badges above show live public metrics, subject to their providers' caching. Click a badge to visit its source. The npm badges describe the **published package**, while the CI badge describes the latest matching main-branch push workflow.

| Metric | What it tells you |
| --- | --- |
| Stars and forks | Public GitHub interest and repository copies |
| npm downloads per month | Package download requests; not distinct people or active users |
| npm version | The currently published release |
| Main CI | Status of the matching workflow, not a production uptime measurement |

<details>
<summary>Repository visits and clones: dated GitHub traffic snapshot</summary>

Snapshot retrieved **3 October 2026**. GitHub returned the rolling traffic window **19 September–2 October 2026 (UTC days)**:

| GitHub traffic metric | Count |
| --- | ---: |
| Views | 6 |
| Unique visitors | 2 |
| Clone operations | 440 |
| Unique cloners | 127 |

These are recorded values, not live counters. Visits, clones, and npm downloads measure different activities and must not be added together or presented as the number of people using generated applications. We do not have an active-user count for projects created with the CLI.

GitHub traffic is available to people with repository push access and covers the past 14 days. Maintainers can see the current values under [Insights → Traffic](https://github.com/RidhuanDEV/backend-modular/graphs/traffic). See [GitHub's traffic documentation](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-traffic-to-a-repository).

</details>

## How verification works

**Consumer checks test the package users receive. Compose checks test the generated application running in Docker.**

| Check | What it verifies |
| --- | --- |
| Package | Builds the CLI and creates the shared npm archive |
| Consumer | Installs that archive, generates a project, installs dependencies, and checks its build/types/generator; runtime cases also exercise the database and API |
| Compose | Builds and runs the selected Docker stack, then checks migrations, API behavior, workers, storage, outages, and owned cleanup |

| Platform | Configured CI coverage |
| --- | --- |
| Linux | All 14 consumers with database/API runtime, plus all 14 Compose stacks |
| Windows | All 14 native/package/generator consumers |
| macOS | Six native consumers: FastAPI, Spring Boot, and Laravel, each with both databases |

This table describes the workflow's configured coverage. Check the [actual CI run](https://github.com/RidhuanDEV/backend-modular/actions/workflows/cli-templates.yml) and the reports for completed results. A configured check or successful build does not establish production deployment or capacity.

### Does editing documentation restart the whole CI matrix?

With the current workflow:

| Change | Automatic consumer/Compose workflow? |
| --- | --- |
| This root `README.md` only | **No** |
| Root `docs/` only | **No** |
| Anything under `create-ridhuan-backend/`, including its README | **Yes** |
| Framework submodule references or tracked workflow/configuration paths | **Yes** |
| Manual workflow dispatch | Runs the selected scope |

The distinction comes from the [workflow path filters](.github/workflows/cli-templates.yml). A root README change does not alter the npm payload. The CLI README is included in the package, so its change is currently covered by the broader package path filter. If a commit mixes root documentation and package/code changes, the matching code paths still trigger CI.

## Guides and evidence

| Document | Use it for |
| --- | --- |
| [CLI guide](create-ridhuan-backend/README.md) | Installation, setup choices, examples, and generated structure |
| [Hardening test task](docs/BACKEND-HARDENING-TEST-TASK.md) | Verification scope and ownership rules |
| [Original five-framework results](docs/BACKEND-HARDENING-TEST-RESULTS.md) | Recorded checks and limitations |
| [Spring Boot report](docs/SPRING-BOOT-JAVA-VERIFICATION.md) | Spring-specific implementation and verification evidence |
| [Laravel report](docs/LARAVEL-PHP-VERIFICATION.md) | Laravel-specific implementation and verification evidence |

Inside a generated project, read `GETTING-STARTED.md` first, its framework `README.md` for configuration, and `docs/HARDENING-UPGRADE.md` before upgrading existing data.

## Work on this repository

<details>
<summary>Clone the sources and build the CLI locally</summary>

```sh
git clone --recurse-submodules https://github.com/RidhuanDEV/backend-modular.git
cd backend-modular/create-ridhuan-backend
npm ci
npm run prepare:templates
npm run build
npm test
npm pack
```

For an existing clone, initialize sources from the repository root with `git submodule update --init --recursive`.

Template preparation checks source provenance and file hashes. Release snapshots require clean framework source repositories. Keep `.env`, uploads, and local runtime artifacts out of commits and packages. Framework changes belong in the corresponding source repository before refreshing its bundled snapshot.

When reporting a problem, include the framework, database, CLI version, run mode, and relevant error output with secrets removed. [Open an issue](https://github.com/RidhuanDEV/backend-modular/issues/new).

Packing creates an archive; publishing it to npm is a separate release action. See the [maintainer guide](create-ridhuan-backend/README.md#for-maintainers) for checks and publication boundaries.

</details>

## License

[MIT](LICENSE) · Maintained by [RidhuanDEV](https://github.com/RidhuanDEV).
