using System.Diagnostics;

namespace ModularBackend.Infrastructure.Observability;

public static class BackendTelemetry
{
    public static readonly ActivitySource Storage = new("ModularBackend.Storage");
    public static readonly ActivitySource Redis = new("ModularBackend.Redis");
}
