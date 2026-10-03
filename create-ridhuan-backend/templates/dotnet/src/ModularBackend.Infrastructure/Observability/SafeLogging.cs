using Microsoft.Extensions.Logging;

namespace ModularBackend.Infrastructure.Observability;

public static class SafeLogging
{
    public static ILoggingBuilder AddBackendJsonLogs(this ILoggingBuilder logging)
    {
        logging.ClearProviders();
        logging.AddJsonConsole(options => options.IncludeScopes = true);
        // Framework HTTP/SQL messages can contain query strings, parameters or provider error data.
        // Backend middleware and telemetry emit bounded operation IDs and sanitized error types.
        foreach (
            var category in new[]
            {
                "Microsoft.AspNetCore.Hosting.Diagnostics",
                "Microsoft.AspNetCore.HttpLogging",
                "Microsoft.EntityFrameworkCore.Database.Command",
                "Microsoft.EntityFrameworkCore.Query",
                "Microsoft.EntityFrameworkCore.Update",
            }
        )
            logging.AddFilter(category, LogLevel.None);
        return logging;
    }
}
