using Microsoft.Extensions.DependencyInjection;
using ModularBackend.Application;
using ModularBackend.Tests;

namespace ModularBackend.UnitTests;

[TestClass]
public sealed class SessionPolicyTests
{
    [TestMethod]
    public async Task RefreshLifetimesDefaultTo30IdleAnd90Absolute()
    {
        await using var host = new TestHost();
        Assert.AreEqual(
            new RefreshSessionPolicy(30, 90),
            host.Services.GetRequiredService<RefreshSessionPolicy>()
        );
    }

    [TestMethod]
    public async Task RefreshLifetimesComeFromConfiguration()
    {
        await using var host = new TestHost(
            new Dictionary<string, string?>
            {
                ["RefreshToken:IdleDays"] = "7",
                ["RefreshToken:AbsoluteDays"] = "14",
            }
        );
        Assert.AreEqual(
            new RefreshSessionPolicy(7, 14),
            host.Services.GetRequiredService<RefreshSessionPolicy>()
        );
    }

    [TestMethod]
    [DataRow("0", "90")]
    [DataRow("30", "0")]
    [DataRow("31", "30")]
    [DataRow("30", "3651")]
    public async Task InvalidRefreshLifetimesFailStartup(string idle, string absolute)
    {
        await using var host = new TestHost(
            new Dictionary<string, string?>
            {
                ["RefreshToken:IdleDays"] = idle,
                ["RefreshToken:AbsoluteDays"] = absolute,
            }
        );
        Assert.Throws<Exception>(() => host.CreateClient());
    }
}
