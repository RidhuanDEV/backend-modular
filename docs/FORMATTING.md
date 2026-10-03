# Backend formatting policy

Use the checked-in formatter configuration and pinned development dependencies. Formatting must preserve types, behavior, secrets, generated files, and released migration history.

| Backend | Layout formatter | Width preference | Indentation |
| --- | --- | --- | --- |
| Express / NestJS | Prettier | 80 | 2 spaces |
| Laravel | Prettier + PHP plugin | 80 | 4 spaces |
| FastAPI | Ruff | 88 | 4 spaces |
| ASP.NET Core | CSharpier | 100 | 4 spaces |
| Spring Boot | Spotless + google-java-format | Native 100-column style | Native Java style |
| Go | gofmt | No configurable width | Native tabs |

Write larger payloads, configuration objects, and composite literals with one field per line. Prettier preserves explicitly multiline JavaScript objects; PHP, Python, Java, and CSharpier wrap long expressions according to their own syntax rules. Small expressions may remain on one line. Width preferences do not guarantee wrapping long string literals or comments. Do not insert string concatenation or alter queries solely to satisfy a visual width.

From the workspace root, after installing development dependencies and building the CLI:

```sh
npm --prefix create-ridhuan-backend run format:backends
npm --prefix create-ridhuan-backend run format:backends:check
```

Laravel needs `npm ci --ignore-scripts` in its repository. CSharpier needs `dotnet tool restore --tool-manifest dotnet-tools.json` in its repository. These are development tools; application runtime setup remains native.

Prettier owns Laravel layout. Pint remains available as an existing optional tool, but its layout can conflict with Prettier; the native verification runner now checks Prettier. Use PHPStan for PHP type and quality verification. CSharpier owns C# layout; nullable analysis and Roslyn analyzers still run during compilation.

Check format before opening a pull request, and keep formatting changes separate from behavior changes. CI checks layout in the Laravel and .NET source repositories. Workspace checks collect independent failures and put diagnostics in the OS temporary directory.

References: [Prettier options](https://prettier.io/docs/options), [PHP plugin](https://github.com/prettier/plugin-php), [CSharpier](https://github.com/belav/csharpier), [Ruff formatter](https://docs.astral.sh/ruff/formatter/), [gofmt](https://pkg.go.dev/cmd/gofmt).
