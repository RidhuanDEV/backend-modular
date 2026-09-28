using ModularBackend.Application;
using ModularBackend.Domain;
using ModularBackend.Infrastructure.Security;

namespace ModularBackend.UnitTests;

[TestClass]
public sealed class SecurityTests
{
    [TestMethod]
    public void OfficialIdentityHashVerifiesAndRejectsWrongPassword()
    {
        var user = new User { Email = "person@example.test", PasswordHash = "" };
        var service = new PasswordService(); user.PasswordHash = service.Hash(user, "test-password");
        Assert.IsTrue(service.Verify(user, "test-password")); Assert.IsFalse(service.Verify(user, "wrong-password"));
    }
    [TestMethod]
    public void AuditRedactsNestedCredentials()
    {
        var json = AuditRedactor.Redact("{\"email\":\"a\",\"nested\":{\"PasswordHash\":\"sensitive\",\"accessToken\":\"secret\"}}");
        Assert.IsNotNull(json); Assert.IsFalse(json.Contains("sensitive", StringComparison.Ordinal)); Assert.IsFalse(json.Contains("secret", StringComparison.Ordinal)); Assert.IsTrue(json.Contains("email", StringComparison.Ordinal));
    }
    [TestMethod]
    public void InstantRequiresOffsetAndHandlesIanaDst()
    {
        Assert.ThrowsExactly<ApiException>(() => TimeContracts.ParseInstant("2026-09-26T12:00:00"));
        var utc = TimeContracts.ParseInstant("2026-09-26T19:00:00+07:00"); Assert.AreEqual(TimeSpan.Zero, utc.Offset); Assert.AreEqual(12, utc.Hour);
        Assert.AreEqual(TimeSpan.FromHours(7), TimeContracts.InZone(utc, "Asia/Jakarta").Offset);
        Assert.AreEqual(TimeSpan.FromHours(8), TimeContracts.InZone(utc, "Asia/Makassar").Offset);
        Assert.AreEqual(TimeSpan.FromHours(9), TimeContracts.InZone(utc, "Asia/Jayapura").Offset);
        Assert.AreEqual(TimeSpan.FromHours(-5), TimeContracts.InZone(TimeContracts.ParseInstant("2026-01-01T00:00:00Z"), "America/New_York").Offset);
        Assert.AreEqual(TimeSpan.FromHours(-4), TimeContracts.InZone(TimeContracts.ParseInstant("2026-07-01T00:00:00Z"), "America/New_York").Offset);
    }
    [TestMethod]
    public void UploadRejectsForgedContentTypes()
    {
        Assert.IsFalse(UploadService.ValidSignature("hello"u8, "image/png")); Assert.IsTrue(UploadService.ValidSignature("%PDF-test"u8, "application/pdf"));
    }
}
