using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Logging;
using ModularBackend.Application;
using ModularBackend.Domain;

namespace ModularBackend.Infrastructure.Security;

public sealed class PasswordService : IPasswordService
{
    private readonly PasswordHasher<User> hasher = new();
    public string Hash(User user, string password) => hasher.HashPassword(user, password);
    public bool Verify(User user, string password) => hasher.VerifyHashedPassword(user, user.PasswordHash, password) != PasswordVerificationResult.Failed;
}
public sealed class AuditFailureReporter(ILogger<AuditFailureReporter> logger) : IAuditFailureReporter
{
    public void Report(Exception exception, string endpointId) => logger.LogWarning("Optional audit failed for {EndpointId}: {ErrorType}", endpointId, exception.GetType().Name);
}
