using System.Data.Common;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using MySql.Data.MySqlClient;
using Npgsql;

namespace ModularBackend.Infrastructure.Persistence;

public static class DatabaseProvider
{
    public static bool IsValid(string provider, string connection)
    {
        try
        {
            return provider switch
            {
                "postgresql" => !string.IsNullOrWhiteSpace(new NpgsqlConnectionStringBuilder(connection).Database),
                "mysql" => !string.IsNullOrWhiteSpace(new MySqlConnectionStringBuilder(connection).Database),
                _ => false
            };
        }
        catch (ArgumentException) { return false; }
    }

    public static void ValidateGeneratedProvider(string provider)
    {
        if (!File.Exists("backend-template.json")) return;
        using var document = JsonDocument.Parse(File.ReadAllText("backend-template.json"));
        if (!document.RootElement.TryGetProperty("databaseProvider", out var property) || property.GetString() != provider)
            throw new InvalidOperationException("Database provider does not match generated project");
    }

    public static BackendDbContext Create(string provider, string connection)
    {
        ValidateGeneratedProvider(provider);
        if (!IsValid(provider, connection)) throw new InvalidOperationException("Invalid database provider/connection string");
        if (provider == "mysql")
            return new MySqlBackendDbContext(new DbContextOptionsBuilder<MySqlBackendDbContext>().UseMySQL(connection, options => options.CommandTimeout(10)).AddInterceptors(new MySqlUtcInterceptor()).Options);
        return new BackendDbContext(new DbContextOptionsBuilder<BackendDbContext>().UseNpgsql(connection, options => options.CommandTimeout(10)).Options);
    }
}

public sealed class MySqlUtcInterceptor : DbConnectionInterceptor
{
    public override void ConnectionOpened(DbConnection connection, ConnectionEndEventData eventData)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "SET time_zone = '+00:00'";
        command.ExecuteNonQuery();
    }

    public override async Task ConnectionOpenedAsync(DbConnection connection, ConnectionEndEventData eventData, CancellationToken cancellationToken = default)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SET time_zone = '+00:00'";
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
