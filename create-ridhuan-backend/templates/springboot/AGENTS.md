# Development contract
Read README.md, docs and contracts/endpoints.json before changing behavior. Derive public contracts from records, controllers, registry and persistence. Never use raw generics, unchecked casts, entity responses or free-form secret snapshots.
Java 25, Spring Boot 4.1.1, official Maven Wrapper. All runtime changes are env plus redeployment.
Preserve migration checksums and local .env/data. Add migrations; never rewrite released SQL.
Complete source and scripts before full build with tests disabled. Only then execute collecting tests. Docker fixtures must own resource names and clean/verify in finally; no global prune.
Required audit uses the same transaction and connection. SMTP/storage happen outside retryable transactions. Test both PostgreSQL and MySQL.
Never publish npm or bump versions without direct authorization.
