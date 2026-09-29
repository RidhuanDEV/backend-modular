# Express endpoint baseline

`express-endpoints.json` records the original endpoint IDs, HTTP methods, paths, statuses, and default audit, cache, and rate policies from `modular-express-typescript-starter-postgre/src/core/http/endpoint-registry.ts` at commit `0d679e35d14c0430549848f7d245518a8d5c3757`. `notification-endpoints.json` pins the four shared Notifications extensions. The NestJS build verifies its registry against both fixtures. Request and response DTOs are implemented in NestJS classes and checked by integration tests and generated OpenAPI.

When intentionally changing the shared HTTP contract, inspect the current Express source, update the fixture, NestJS DTOs/controllers, tests, and examples together. A matching fixture only proves the listed route metadata; it does not prove response body parity.
