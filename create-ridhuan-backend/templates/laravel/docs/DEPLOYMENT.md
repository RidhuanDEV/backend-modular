# Deployment

Public HTTP service web uses Nginx8080; app FPM9000 stays private and worker has no HTTP. Public document root is public/. .env/vendor/storage/config paths are denied. API is stateless, exact origin allowlist, credentials=false; no-Origin requests work. TRUST_PROXY is an exact trusted IP/CIDR list; set it only for your proxy.

The bundled Nginx upstream uses Docker DNS (127.0.0.11), a shared upstream zone and `resolve` so replacing/scaling app containers updates FPM addresses within five seconds. Custom deployment DNS must be configured for its own infrastructure. This uses the native [Nginx upstream resolver](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#server); no web restart is required for a routine app replacement.

The upstream explicitly sets `keepalive 0`, matching per-response FastCGI connection closure. Nginx1.29.7+ enables an upstream cache of32 idle connections by default, while FastCGI reuse requires `fastcgi_keep_conn on`. Keeping the idle cache disabled preserves the configured FPM connection budget and prevents reusing closed sockets. See the native [upstream keepalive contract](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#keepalive) and [FastCGI connection contract](https://nginx.org/en/docs/http/ngx_http_fastcgi_module.html#fastcgi_keep_conn).

Application containers set DNS resolver timeout1s/attempts2 to limit repeated DNS waits when a Compose dependency disappears. PDO connection timeout5s applies after hostname resolution; custom DNS/network and query budgets still depend on the deployment.

Run migrations as one release job, then start replicas. Seed explicit. Configuration cache runs after runtime env injection and stays private per container. Env update requires clear/cache/restart including worker. Local storage volume persists; APP_INSTANCE_COUNT>1 requires Redis quota. File quota is local per instance. FPM_MAX_CHILDREN=8 and SSE_MAX_CONNECTIONS_PER_INSTANCE=4 reserve HTTP workers; adjust deployment memory/DB limits coherently. Long SSE uses no FastCGI buffering/compression, heartbeat15s/read timeout900s/send timeout15s. Slow-client backpressure still consumes one FPM worker; measure actual deployment limits.

TLS termination and trusted SMTP/DB CA configuration are deployment responsibilities. Symfony TLS verification is never disabled. SMTP at least once and object+SQL compensation boundaries require operational recovery. Schedule cleanup --apply explicitly, dry-run review first. Back up provider-native database including migration history, uploads and metadata. Test restoration in isolated infrastructure; source/unit/runtime checks are not backup/restore or production load evidence.

Stop worker using SIGTERM (Linux), console interruption (Windows), or --stop-file path. Parent stops claims, allows bounded10s completion, then stops children; interrupted leases expire for recovery. Parent renewal remains live while child SMTP blocks.
