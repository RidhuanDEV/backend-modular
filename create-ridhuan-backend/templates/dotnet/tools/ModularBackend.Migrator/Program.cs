using Microsoft.EntityFrameworkCore;
using ModularBackend.Infrastructure.Persistence;
var factory = new BackendDesignFactory();
await using var db = factory.CreateDbContext(args);
if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("Database__ConnectionString"))) throw new InvalidOperationException("Database__ConnectionString required");
using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(2));
await db.Database.MigrateAsync(timeout.Token);
Console.WriteLine("Migrations applied");
