# Changelog

This project follows [Semantic Versioning](https://semver.org/). Template releases use `MAJOR.MINOR.PATCH`: breaking changes to generated contracts or setup increment major; compatible features increment minor; compatible fixes increment patch. Generated applications do not automatically receive later template updates.

## Unreleased

- Initial modular ASP.NET Core backend template.
- Security: managers cannot assign, modify or delete roles and users with permissions they do not hold (seeded `admin` exempt); timing-safe unknown-email login; expired refresh token cleanup at login; seeder rejects the `CHANGE_ME` bootstrap password; 500 errors log the exception; upload option validation reports the failing setting.
- Security: refresh sessions have a configurable idle timeout (`RefreshToken__IdleDays`, default 30) and absolute lifetime (`RefreshToken__AbsoluteDays`, default 90); rotation no longer extends the family.
- Security: emails are trimmed and lower-cased on register, login and user create/update, so case variants are one account on both providers (MySQL uses a binary collation). Before upgrading a deployment, lower-case existing `users.email` values and resolve any collisions, or mixed-case accounts cannot log in.
