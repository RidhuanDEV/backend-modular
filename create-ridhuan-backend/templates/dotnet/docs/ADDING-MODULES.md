# Adding a module

The starter keeps a small number of projects with compile-time dependency direction. It groups use cases in `BackendService` and persistence mappings in `BackendStore`; a module feature follows those boundaries without adding a project for every feature. For a larger domain, split application and infrastructure classes into feature folders or projects while keeping the same reference direction.

## 1. Add the domain model

Add an entity in `src/ModularBackend.Domain/Entities.cs` (or a domain feature file). Keep persistence-independent invariants in Domain. Do not put EF attributes or API DTOs in the domain model. In `BackendDbContext`, add a typed `DbSet<T>` and configure its table, key, required fields, indexes, unique constraints, and foreign-key delete behavior explicitly.

## 2. Add the application contract and use case

Add typed request/response records in `src/ModularBackend.Api/Contracts/Requests.cs` and `src/ModularBackend.Application/Contracts.cs`. Add explicit operations to `IBackendStore` in `Abstractions.cs`; do not create a generic repository or expose `IQueryable` outside Infrastructure. Implement the use case in `BackendService`, using its transaction/audit flow for mutations. Include cancellation tokens for I/O.

## 3. Implement persistence and migration

Implement the new port methods in `src/ModularBackend.Infrastructure/Persistence/BackendStore.cs`. Configure the model in `BackendDbContext` and create a migration using the pinned official EF tool:

```sh
dotnet tool restore
dotnet ef migrations add AddOrders \
  --project src/ModularBackend.Infrastructure \
  --startup-project src/ModularBackend.Infrastructure \
  --context BackendDbContext \
  --output-dir Persistence/Migrations
```

For MySQL use `--context MySqlBackendDbContext --output-dir Persistence/MySqlMigrations` and the MySQL connection/provider configuration. The Infrastructure project owns the design factory and official EF Design dependency. Review the generated migration and run `dotnet ef migrations has-pending-model-changes` with the same project/context arguments. Apply it through `tools/ModularBackend.Migrator` as a release job before starting new API replicas; the API does not migrate during startup. The dedicated database must have this application's own migration history.

## 4. Add endpoint and permission

Add a controller under `src/ModularBackend.Api/Controllers`, decorate every action with a new `EndpointId`, and use typed DTOs and response metadata. Add the matching endpoint policy to `EndpointRegistry.Defaults`, with the actual method, route, module, public flag, permission, audit mode, rate group, cache mode, and success status. The registry validates every mounted action and permission at startup. Add a new permission name to its explicit allowed-permission check. Add it to the seeder's permission names if it should exist on every fresh install; the seeded admin role is granted all known permissions. Grant it to other roles only through deliberate seed logic or the role/permission API.

Use required audit for mutations when losing the audit row would invalidate the operation; the audit row and mutation then share one database transaction. Optional audit is best effort after commit. Read [the endpoint policy section](OPERATIONS.md#endpoint-policy-configuration) for configuration rules.

## 5. Describe and verify the contract

Add or update the contract fixture in `contracts/express-endpoints.json` when the endpoint belongs to a parity surface. Add contract checks for operation ID, route, status, request/response schema, and envelope. Add unit tests for domain/application rules. Add service-backed integration coverage for database constraints, audit transaction behavior, authorization, or storage effects.

Run OpenAPI generation and inspect the generated document rather than hand-writing a parallel schema. Verify project references still point inward: API may reference Application and Infrastructure for the composition root; Infrastructure references Application and Domain; Application references Domain; Domain references no project in this solution.

## Current enforcement

Project references and compiler checks enforce the layer dependency direction. Endpoint registry and contract tests enforce endpoint metadata consistency. This starter does not include a separate architecture-test framework; feature-level dependency rules beyond project references require review and CI checks.
