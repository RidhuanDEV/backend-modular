# Changelog

This project follows [Semantic Versioning](https://semver.org/). Template releases use `MAJOR.MINOR.PATCH`: breaking changes to generated contracts or setup increment major; compatible features increment minor; compatible fixes increment patch. Generated applications do not automatically receive later template updates.

## Unreleased

- Initial modular ASP.NET Core backend template.
- Security: managers cannot assign, modify or delete roles and users with permissions they do not hold (seeded `admin` exempt); timing-safe unknown-email login; expired refresh token cleanup at login; seeder rejects the `CHANGE_ME` bootstrap password; 500 errors log the exception; upload option validation reports the failing setting.
