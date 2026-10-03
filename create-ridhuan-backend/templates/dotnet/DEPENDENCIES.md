# Installed dependencies

.NET 10 LTS SDK 10.0.401/runtime 10.0.12 installed using official Microsoft script, resolved from [release metadata](https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json). All package restore sources restricted to nuget.org. No substitute library implementations. Versions from Directory.Packages.props; transitive graph from per-project packages.lock.json.

| Package | Version | Publisher | License from installed nuspec | Source |
| --- | --- | --- | --- | --- |
| Microsoft.EntityFrameworkCore | 10.0.12 | Microsoft | MIT | [NuGet metadata](https://www.nuget.org/packages/Microsoft.EntityFrameworkCore/10.0.12) |
| Microsoft.EntityFrameworkCore.Relational | 10.0.12 | Microsoft | MIT | [NuGet metadata](https://www.nuget.org/packages/Microsoft.EntityFrameworkCore.Relational/10.0.12) |
| AWSSDK.S3 | 4.0.103.4 | AWS | Apache-2.0 | [NuGet metadata](https://www.nuget.org/packages/AWSSDK.S3/4.0.103.4) |
| MailKit | 4.18.1 | Jeffrey Stedfast / .NET Foundation contributors | MIT | [NuGet metadata](https://www.nuget.org/packages/MailKit/4.18.1) |
| MSTest | 4.0.2 | Microsoft | MIT | [NuGet metadata](https://www.nuget.org/packages/MSTest/4.0.2) |
| Microsoft.AspNetCore.Authentication.JwtBearer | 10.0.12 | Microsoft | MIT | [NuGet metadata](https://www.nuget.org/packages/Microsoft.AspNetCore.Authentication.JwtBearer/10.0.12) |
| Microsoft.AspNetCore.Mvc.Testing | 10.0.12 | Microsoft | MIT | [NuGet metadata](https://www.nuget.org/packages/Microsoft.AspNetCore.Mvc.Testing/10.0.12) |
| Microsoft.AspNetCore.OpenApi | 10.0.12 | Microsoft | MIT | [NuGet metadata](https://www.nuget.org/packages/Microsoft.AspNetCore.OpenApi/10.0.12) |
| Microsoft.EntityFrameworkCore.Design | 10.0.12 | Microsoft | MIT | [NuGet metadata](https://www.nuget.org/packages/Microsoft.EntityFrameworkCore.Design/10.0.12) |
| Microsoft.Extensions.Caching.StackExchangeRedis | 10.0.12 | Microsoft | MIT | [NuGet metadata](https://www.nuget.org/packages/Microsoft.Extensions.Caching.StackExchangeRedis/10.0.12) |
| Npgsql.EntityFrameworkCore.PostgreSQL | 10.0.3 | Npgsql project | PostgreSQL | [NuGet metadata](https://www.nuget.org/packages/Npgsql.EntityFrameworkCore.PostgreSQL/10.0.3) |
| OpenTelemetry.Exporter.OpenTelemetryProtocol | 1.19.1 | OpenTelemetry project | Apache-2.0 | [NuGet metadata](https://www.nuget.org/packages/OpenTelemetry.Exporter.OpenTelemetryProtocol/1.19.1) |
| OpenTelemetry.Extensions.Hosting | 1.19.1 | OpenTelemetry project | Apache-2.0 | [NuGet metadata](https://www.nuget.org/packages/OpenTelemetry.Extensions.Hosting/1.19.1) |
| OpenTelemetry.Instrumentation.AspNetCore | 1.19.0 | OpenTelemetry project | Apache-2.0 | [NuGet metadata](https://www.nuget.org/packages/OpenTelemetry.Instrumentation.AspNetCore/1.19.0) |
| OpenTelemetry.Instrumentation.Http | 1.19.0 | OpenTelemetry project | Apache-2.0 | [NuGet metadata](https://www.nuget.org/packages/OpenTelemetry.Instrumentation.Http/1.19.0) |

Framework ASP.NET Core supplies Controllers, routing, validation, configuration/options, Identity password hashing, policy authorization, ILogger JSON, multipart and memory rate limiting. These require the Microsoft shared framework, not handwritten replacement libraries. EF Core/Npgsql own database access and migrations; Microsoft JwtBearer/IdentityModel own token handling. AWS SDK owns S3 requests/signing; StackExchange.Redis is the publisher-maintained client used by the Microsoft Redis package. Redis Lua is application atomic limiter policy, not a replacement Redis client. Microsoft OpenAPI supplies schema generation. MSTest/Mvc.Testing supply test runner and real host testing. Official OpenTelemetry supplies optional OTLP instrumentation/export.

Npgsql, AWS, Redis and OpenTelemetry are not Microsoft packages. StackExchange.Redis transitive publisher/license metadata should be checked with locked graph on updates. `dotnet list package --vulnerable --include-transitive` is the current NuGet advisory audit gate; it does not replace source/security review. No preview, floating production versions, MediatR, AutoMapper, FluentValidation, or generic repository framework.

Build-time OpenAPI additionally installs Microsoft.Extensions.ApiDescription.Server 10.0.12 (Microsoft, MIT): [NuGet](https://www.nuget.org/packages/Microsoft.Extensions.ApiDescription.Server/10.0.12). Template packaging suppresses only NU5110/NU5111: content/scripts are copied source, deliberately not NuGet installation hooks. No runtime/compiler warning is suppressed.

## MySQL provider

Official Oracle/MySQL `MySql.EntityFrameworkCore` 10.0.9 with `MySql.Data` 26.7.0 supports EF Core 10. Installed nuspec license: `GPL-2.0-only WITH Universal-FOSS-exception-1.0`, acceptance required. Review these terms for your distribution. [Provider metadata](https://www.nuget.org/packages/MySql.EntityFrameworkCore/10.0.9). The provider has separate EF context/migrations; UUIDs use varchar(36), JSON uses MySQL JSON and UTC values use datetime(6). External databases should use `SslMode=VerifyFull` with a trusted CA. Local Compose uses `Preferred`; never use disabled certificate verification as a production fix.

## Development formatting

[CSharpier 1.3.0](https://www.nuget.org/packages/CSharpier/1.3.0) is pinned as a local tool in `dotnet-tools.json`. Restore with `dotnet tool restore --tool-manifest dotnet-tools.json`; configuration targets 100 columns and excludes generated files and released migrations. It formats layout without replacing Roslyn analyzers or nullable checks.
