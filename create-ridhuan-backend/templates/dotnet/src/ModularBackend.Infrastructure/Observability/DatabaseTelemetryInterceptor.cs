using System.Collections.Concurrent;
using System.Data.Common;
using System.Diagnostics;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace ModularBackend.Infrastructure.Observability;

public sealed class DatabaseTelemetryInterceptor : DbCommandInterceptor
{
    private readonly ConcurrentDictionary<Guid, Activity> spans = new();
    private void Begin(CommandEventData data)
    {
        var span = BackendTelemetry.Source.StartActivity("database");
        span?.SetTag("operationId", span.Parent?.GetTagItem("operationId") ?? "operations.worker");
        if (span is not null) spans[data.CommandId] = span;
    }
    private void End(Guid id, bool failed = false)
    {
        if (!spans.TryRemove(id, out var span)) return;
        if (failed) span.SetStatus(ActivityStatusCode.Error);
        span.Dispose();
    }
    public override InterceptionResult<DbDataReader> ReaderExecuting(DbCommand command, CommandEventData data, InterceptionResult<DbDataReader> result) { Begin(data); return result; }
    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData data, InterceptionResult<DbDataReader> result, CancellationToken ct = default) { Begin(data); return ValueTask.FromResult(result); }
    public override DbDataReader ReaderExecuted(DbCommand command, CommandExecutedEventData data, DbDataReader result) { End(data.CommandId); return result; }
    public override ValueTask<DbDataReader> ReaderExecutedAsync(DbCommand command, CommandExecutedEventData data, DbDataReader result, CancellationToken ct = default) { End(data.CommandId); return ValueTask.FromResult(result); }
    public override InterceptionResult<int> NonQueryExecuting(DbCommand command, CommandEventData data, InterceptionResult<int> result) { Begin(data); return result; }
    public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData data, InterceptionResult<int> result, CancellationToken ct = default) { Begin(data); return ValueTask.FromResult(result); }
    public override int NonQueryExecuted(DbCommand command, CommandExecutedEventData data, int result) { End(data.CommandId); return result; }
    public override ValueTask<int> NonQueryExecutedAsync(DbCommand command, CommandExecutedEventData data, int result, CancellationToken ct = default) { End(data.CommandId); return ValueTask.FromResult(result); }
    public override InterceptionResult<object> ScalarExecuting(DbCommand command, CommandEventData data, InterceptionResult<object> result) { Begin(data); return result; }
    public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(DbCommand command, CommandEventData data, InterceptionResult<object> result, CancellationToken ct = default) { Begin(data); return ValueTask.FromResult(result); }
    public override object? ScalarExecuted(DbCommand command, CommandExecutedEventData data, object? result) { End(data.CommandId); return result; }
    public override ValueTask<object?> ScalarExecutedAsync(DbCommand command, CommandExecutedEventData data, object? result, CancellationToken ct = default) { End(data.CommandId); return ValueTask.FromResult(result); }
    public override void CommandFailed(DbCommand command, CommandErrorEventData data) => End(data.CommandId, true);
    public override Task CommandFailedAsync(DbCommand command, CommandErrorEventData data, CancellationToken ct = default) { End(data.CommandId, true); return Task.CompletedTask; }
    public override void CommandCanceled(DbCommand command, CommandEndEventData data) => End(data.CommandId);
    public override Task CommandCanceledAsync(DbCommand command, CommandEndEventData data, CancellationToken ct = default) { End(data.CommandId); return Task.CompletedTask; }
}
