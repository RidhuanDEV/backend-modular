using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ModularBackend.Infrastructure.Persistence;
var factory = new BackendDesignFactory();
await using var db = factory.CreateDbContext(args);
if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("Database__ConnectionString"))) throw new InvalidOperationException("Database__ConnectionString required");
using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(2));
if (args.Length != 0 && (args.Length != 2 || args[0] != "--to-migration" || !db.Database.GetMigrations().Contains(args[1])))
    throw new ArgumentException("Use --to-migration with an existing migration ID, or omit it to apply all migrations");
await db.GetService<IMigrator>().MigrateAsync(args.Length == 2 ? args[1] : null, timeout.Token);
Console.WriteLine("Migrations applied");
