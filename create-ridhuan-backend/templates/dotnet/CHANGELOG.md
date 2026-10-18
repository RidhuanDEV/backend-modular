# Changelog

This project follows [Semantic Versioning](https://semver.org/). Template releases use `MAJOR.MINOR.PATCH`: breaking changes to generated contracts or setup increment major; compatible features increment minor; compatible fixes increment patch. Generated applications do not automatically receive later template updates.

## Unreleased

- Initial modular ASP.NET Core backend template.
- Security: managers cannot assign, modify or delete roles and users with permissions they do not hold (no role exempt; new permissions go to every `manage_permissions` role); timing-safe unknown-email login; expired refresh token cleanup at login; seeder rejects the `CHANGE_ME` bootstrap password; 500 errors log the exception; upload option validation reports the failing setting.
- Security: refresh sessions have a configurable idle timeout (`RefreshToken__IdleDays`, default 30) and absolute lifetime (`RefreshToken__AbsoluteDays`, default 90); rotation no longer extends the family.
- Security: emails are trimmed and lower-cased on register, login and user create/update, so case variants are one account on both providers (MySQL uses a binary collation). Before upgrading a deployment, lower-case existing `users.email` values and resolve any collisions, or mixed-case accounts cannot log in.
- Security audit: immutable system roles/permissions; system permissions always keep an active holder; refresh sessions revoked on user delete or role change; owner-or-admin file access; rate limit before database access with a single quota; deleted-account login timing; 1 MiB JSON body limit; security headers; `/docs` off in Production by default; docs index includes notifications; audit redaction for notifications; `System.Security.Cryptography.Pkcs` pinned to 10.0.13 for GHSA-846f-f764-76mx and GHSA-2fmv-rv2c-59x7.
- Security: optional httpOnly refresh cookie (`RefreshCookie__Transport=cookie`, X-Requested-With required); optional least-privilege PostgreSQL role for Compose.
