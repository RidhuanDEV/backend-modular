using System.Data.Common;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using ModularBackend.Infrastructure.Observability;
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
                "postgresql" => Identifier(new NpgsqlConnectionStringBuilder(connection).Database, 63) && Identifier(new NpgsqlConnectionStringBuilder(connection).Username, 63),
                "mysql" => Identifier(new MySqlConnectionStringBuilder(connection).Database, 64) && Identifier(new MySqlConnectionStringBuilder(connection).UserID, 32),
                _ => false
            };
        }
        catch (ArgumentException) { return false; }
    }

    private static bool Identifier(string? value, int maximum) => value is not null && value.Length <= maximum && Regex.IsMatch(value, @"^[A-Za-z_][A-Za-z0-9_]*$");

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
        if (!IsValid(provider, connection)) throw new InvalidOperationException($"Invalid {provider} connection: ASCII username maximum {(provider == "mysql" ? 32 : 63)}, database name maximum {(provider == "mysql" ? 64 : 63)}");
        if (provider == "mysql")
            return new MySqlBackendDbContext(new DbContextOptionsBuilder<MySqlBackendDbContext>().UseMySQL(connection, options => options.CommandTimeout(10)).AddInterceptors(new MySqlUtcInterceptor(), new DatabaseTelemetryInterceptor()).Options);
        return new BackendDbContext(new DbContextOptionsBuilder<BackendDbContext>().UseNpgsql(connection, options => options.CommandTimeout(10)).AddInterceptors(new DatabaseTelemetryInterceptor()).Options);
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
