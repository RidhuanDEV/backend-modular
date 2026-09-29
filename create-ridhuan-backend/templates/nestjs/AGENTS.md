# NestJS template contribution rules

- Treat `src/common/endpoint/endpoint.registry.ts`, DTOs, services, Prisma schema, and migrations as the source of truth. Check current Express/Go implementations before claiming parity.
- Keep TypeScript strict. Do not introduce `any` in application code; narrow `unknown` at boundaries.
- Use NestJS class DTOs with `class-validator`, `class-transformer`, `ValidationPipe`, and `@nestjs/swagger`. Do not add Zod or JSDoc based API contracts.
- Add every HTTP action to the endpoint registry with `@Endpoint`. Confirm the startup registry/OpenAPI validator and tests pass.
- Write `required` activity audit within the same database transaction as its mutation. Map public responses explicitly and never expose password or token hashes.
- Keep PostgreSQL migrations in this template only. Do not auto run migrations or seed at replica startup.
- Preserve local `.env`, `.legacy`, upload data, and uncommitted work. Ask before changing public contract, moving old MySQL data, or creating a remote repository.
