using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
var noRestore = args.Contains("--no-restore"); var defaults = args.Contains("--yes");
var provider = args.FirstOrDefault(a => a.StartsWith("--database=", StringComparison.Ordinal))?[11..] ?? "postgresql";
if (provider is not ("postgresql" or "mysql")) throw new ArgumentException("Database must be postgresql or mysql");
var paths = args.Where(a => !a.StartsWith("--", StringComparison.Ordinal)).ToArray();
if (paths.Length != 1 || args.Any(a => a.StartsWith("--", StringComparison.Ordinal) && !a.StartsWith("--database=", StringComparison.Ordinal) && a is not ("--yes" or "--no-restore"))) throw new ArgumentException("Usage: initializer [--database=postgresql|mysql] [--yes] [--no-restore] <empty-target-folder>");
var target = Path.GetFullPath(paths[0]);
if (Directory.Exists(target) && Directory.EnumerateFileSystemEntries(target).Any()) throw new InvalidOperationException("Target must be empty");
if (File.Exists(target)) throw new InvalidOperationException("Target must be a directory");
for (DirectoryInfo? parent = new(target); parent is not null; parent = parent.Parent)
    if (parent.Exists && (parent.Attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("Target must not use symlinks");
var name = Path.GetFileName(target);
if (!Regex.IsMatch(name, @"^[A-Z_a-z][A-Z_a-z0-9]*(\.[A-Z_a-z][A-Z_a-z0-9]*)*$")) throw new ArgumentException("Folder name must be a C# project identifier");
string Ask(string label, string fallback) { if (defaults) return fallback; Console.Write($"{label} [{fallback}]: "); var input = Console.ReadLine(); return string.IsNullOrWhiteSpace(input) ? fallback : input; }
var port = Ask("HTTP port", "5080"); if (!int.TryParse(port, out var parsedPort) || parsedPort is < 1 or > 65535) throw new ArgumentException("Invalid port");
var database = Ask(provider + " database", name.ToLowerInvariant().Replace('.', '_'));
var databaseLimit = provider == "mysql" ? 64 : 63;
if (!Regex.IsMatch(database, @"^[a-z_][a-z0-9_]*$") || database.Length > databaseLimit) throw new ArgumentException($"{provider} database requires ASCII SQL identifier, maximum {databaseLimit} characters");
var databaseUser = Ask(provider + " username", provider == "mysql" ? "backend" : "modular_net");
var userLimit = provider == "mysql" ? 32 : 63;
if (!Regex.IsMatch(databaseUser, @"^[A-Za-z_][A-Za-z0-9_]*$") || databaseUser.Length > userLimit) throw new ArgumentException($"{provider} username requires ASCII SQL identifier, maximum {userLimit} characters");
if (provider == "mysql" && databaseUser.Equals("root", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Use a dedicated MySQL application user");
var redisChoice = Ask("Use Redis (yes/no)", "no").ToLowerInvariant();
if (redisChoice is not ("yes" or "no")) throw new ArgumentException("Choose yes or no for Redis");
var useRedis = redisChoice == "yes";
var storage = Ask("Upload storage (local/s3)", "local"); if (storage is not ("local" or "s3")) throw new ArgumentException("Invalid storage");
var endpoint = storage == "s3" ? Ask("S3 endpoint (enter aws for AWS default endpoint)", "http://127.0.0.1:19000") : "http://127.0.0.1:19000";
if (endpoint.Equals("aws", StringComparison.OrdinalIgnoreCase)) endpoint = "";
var bucket = storage == "s3" ? Ask("S3 bucket", "uploads") : "uploads";
if (endpoint.Length > 0 && (!Uri.TryCreate(endpoint, UriKind.Absolute, out var url) || url.Scheme is not ("http" or "https"))) throw new ArgumentException("Invalid endpoint");
if (!Regex.IsMatch(bucket, @"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")) throw new ArgumentException("Invalid bucket");
var source = Directory.GetCurrentDirectory(); if (!File.Exists(Path.Combine(source, ".template.config", "template.json"))) throw new InvalidOperationException("Run initializer from template checkout");
var templateHome = Path.Combine(source, "artifacts", "initializer-home", Guid.NewGuid().ToString("N"));
async Task Run(params string[] arguments)
{
    var executable = Environment.GetEnvironmentVariable("DOTNET_ROOT") is { } sdkRoot ? Path.Combine(sdkRoot, OperatingSystem.IsWindows() ? "dotnet.exe" : "dotnet") : "dotnet";
    var start = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true }; foreach (var argument in arguments) start.ArgumentList.Add(argument);
    if (arguments[0] == "new")
    {
        start.Environment["DOTNET_CLI_HOME"] = templateHome;
        start.Environment["DOTNET_GENERATE_ASPNET_CERTIFICATE"] = "false";
        start.Environment["DOTNET_CLI_TELEMETRY_OPTOUT"] = "true";
        start.Environment["DOTNET_NOLOGO"] = "true";
    }
    using var process = Process.Start(start) ?? throw new InvalidOperationException("Failed to start dotnet");
    var output = process.StandardOutput.ReadToEndAsync(); var errors = process.StandardError.ReadToEndAsync();
    await process.WaitForExitAsync(); Console.Write(await output); Console.Error.Write(await errors);
    if (process.ExitCode != 0) throw new InvalidOperationException("dotnet operation failed: " + arguments[0]);
}
var packageDirectory = Path.Combine(source, "artifacts", "initializer-package");
await Run("pack", Path.Combine(source, "templates", "ModularBackend.Template.csproj"), "-c", "Release", "-o", packageDirectory);
var package = Directory.EnumerateFiles(packageDirectory, "*.nupkg").Single();
await Run("new", "install", package, "--force");
await Run("new", "modular-net", "--name", name, "--output", target, "--port", port, "--database", provider);
using (var configuration = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(source, ".template.config", "template.json"))))
{
    var prefix = configuration.RootElement.GetProperty("sourceName").GetString() ?? throw new InvalidOperationException("Template identity missing");
    foreach (var lockPath in Directory.EnumerateFiles(target, "packages.lock.json", SearchOption.AllDirectories))
    {
        var content = await File.ReadAllTextAsync(lockPath);
        await File.WriteAllTextAsync(lockPath, content.Replace(prefix.ToLowerInvariant() + ".", name.ToLowerInvariant() + ".", StringComparison.Ordinal));
    }
}

var dbPassword = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)); var jwt = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)); var bootstrap = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)); var s3Secret = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
var env = await File.ReadAllTextAsync(Path.Combine(target, ".env.example"));
env = env.Replace("Username=modular_net;", "Username=" + databaseUser + ";").Replace("POSTGRES_USER=modular_net", "POSTGRES_USER=" + databaseUser).Replace("User ID=backend;", "User ID=" + databaseUser + ";").Replace("MYSQL_USER=backend", "MYSQL_USER=" + databaseUser);
env = env.Replace("CHANGE_ME_DATABASE_PASSWORD", dbPassword).Replace("CHANGE_ME_GENERATE_AT_LEAST_32_RANDOM_BYTES", jwt).Replace("CHANGE_ME_BOOTSTRAP_PASSWORD", bootstrap).Replace("CHANGE_ME_S3_ACCESS_KEY", "development").Replace("CHANGE_ME_S3_SECRET_KEY", s3Secret).Replace("Database=modular_net;", "Database=" + database + ";").Replace("POSTGRES_DB=modular_net", "POSTGRES_DB=" + database).Replace("MYSQL_DATABASE=modular_net", "MYSQL_DATABASE=" + database).Replace("CHANGE_ME_ADMIN_DATABASE_PASSWORD", Convert.ToHexString(RandomNumberGenerator.GetBytes(24))).Replace("Rate__Store=memory", "Rate__Store=" + (useRedis ? "redis" : "memory")).Replace("Cache__Enabled=false", "Cache__Enabled=" + useRedis.ToString().ToLowerInvariant()).Replace("Upload__Storage=local", "Upload__Storage=" + storage).Replace("Upload__Endpoint=http://127.0.0.1:19000", "Upload__Endpoint=" + endpoint).Replace("Upload__Bucket=uploads", "Upload__Bucket=" + bucket).Replace("COMPOSE_PROFILES=", "COMPOSE_PROFILES=" + string.Join(',', new[] { useRedis ? "redis" : "", storage == "s3" && endpoint == "http://127.0.0.1:19000" ? "s3" : "" }.Where(v => v.Length > 0)));
if (storage == "s3" && endpoint.Length == 0) env = env.Replace("Upload__AccessKey=development", "Upload__AccessKey=").Replace("Upload__SecretKey=" + s3Secret, "Upload__SecretKey=");
if (storage == "s3" && endpoint != "http://127.0.0.1:19000") env += "\nS3_ENDPOINT_DOCKER=" + endpoint + "\n";
var deploymentName = name.ToLowerInvariant().Replace('.', '-');
var composePath = Path.Combine(target, "compose.yaml");
var compose = await File.ReadAllTextAsync(composePath);
await File.WriteAllTextAsync(composePath, compose.Replace("name: modular-net", "name: " + deploymentName));
env = env.Replace("COMPOSE_PROJECT_NAME=modular-net", "COMPOSE_PROJECT_NAME=" + deploymentName).Replace("Cache__Prefix=modular-net:v1", "Cache__Prefix=" + deploymentName + ":v1").Replace("Rate__Prefix=modular-net:v1", "Rate__Prefix=" + deploymentName + ":v1");
await File.WriteAllTextAsync(Path.Combine(target, "backend-template.json"), JsonSerializer.Serialize(new { schemaVersion = 1, template = "dotnet", databaseProvider = provider }));
await File.WriteAllTextAsync(Path.Combine(target, ".env"), env);
if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(Path.Combine(target, ".env"), UnixFileMode.UserRead | UnixFileMode.UserWrite);
if (!noRestore) await Run("restore", Path.Combine(target, name + ".slnx"), "--locked-mode");
Console.WriteLine("Project created. Read README.md; configure database/storage credentials, migrate and seed explicitly.");
